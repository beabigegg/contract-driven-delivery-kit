import { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ASSET } from '../utils/paths.js';
import { log } from '../utils/logger.js';

export type HookMode = 'advisory' | 'strict';
/** Back-compat alias for the original (graph-first-only) public name. */
export type GraphFirstMode = HookMode;

export interface InstallAgentHooksOptions {
  /** Arm the graph-first Read hook at this mode. */
  graphFirst?: HookMode;
  /** Arm the contract-write Edit/Write hook at this mode (ADR 0004 §6, Stage 2). */
  contractWrite?: HookMode;
  /** Arm the test-runner Bash hook at this mode (ADR 0005 §10). */
  testRunner?: HookMode;
  /**
   * When invoked from `cdd-kit init`, recoverable problems (missing asset,
   * malformed settings.json) warn and return instead of hard-exiting — arming
   * is best-effort during init.
   */
  fromInit?: boolean;
}

const SETTINGS_REL_PATH = '.claude/settings.json';

/**
 * Marker substrings identifying each cdd-kit PreToolUse handler. Exported as the
 * single source of truth: the installer writes them (via `HookDef.marker`) and
 * `doctor`'s chokepoint probes read them, so arming and detection can never drift
 * apart (if they did, a live hook would read as dormant).
 */
export const GRAPH_FIRST_MARKER = 'pre-tool-use-graph-first';
export const CONTRACT_WRITE_MARKER = 'pre-tool-use-contract-write';
export const TEST_RUNNER_MARKER = 'pre-tool-use-test-runner';

/** Static description of one agent PreToolUse hook the kit can arm. */
interface HookDef {
  /** Stable short id shown in logs. */
  id: string;
  /** Bundled script filename under assets/hooks and the project's .claude/hooks. */
  filename: string;
  /** Tool name(s) the hook matches — a Claude Code matcher (regex alternation ok). */
  matcher: string;
  /** Substring identifying OUR handler for idempotent replace. */
  marker: string;
  /** Env var that flips the script from advisory to hard-block. */
  strictEnv: string;
  /** One-line advisory/strict explainer for the success log. */
  describe: (mode: HookMode) => string;
}

const GRAPH_FIRST: HookDef = {
  id: 'graph-first',
  filename: 'pre-tool-use-graph-first.sh',
  matcher: 'Read',
  marker: GRAPH_FIRST_MARKER,
  strictEnv: 'CDD_GRAPH_FIRST_STRICT',
  describe: (mode) => mode === 'advisory'
    ? 'advisory mode: reminds agents to use `cdd-kit index query --with-source` before Read; does not block.'
    : 'strict mode: blocks source-file Read when .cdd/code-map.yml exists, steering to graph/index queries.',
};

const CONTRACT_WRITE: HookDef = {
  id: 'contract-write',
  filename: 'pre-tool-use-contract-write.sh',
  // The agent's file-mutation tools; a human's editor is unaffected.
  matcher: 'Write|Edit|MultiEdit',
  marker: CONTRACT_WRITE_MARKER,
  strictEnv: 'CDD_CONTRACT_WRITE_STRICT',
  describe: (mode) => mode === 'advisory'
    ? 'advisory mode: reminds agents to use `cdd-kit contract set` before editing contracts/api/api-contract.md; does not block.'
    : "strict mode: blocks the agent's Edit/Write of contracts/api/api-contract.md, routing to `cdd-kit contract set`.",
};

const TEST_RUNNER: HookDef = {
  id: 'test-runner',
  filename: 'pre-tool-use-test-runner.sh',
  // The agent's shell tool; broad test runs arrive as Bash commands.
  matcher: 'Bash',
  marker: TEST_RUNNER_MARKER,
  strictEnv: 'CDD_TEST_RUNNER_STRICT',
  describe: (mode) => mode === 'advisory'
    ? 'advisory mode: warns when a broad whole-suite test command (e.g. bare `pytest`/`npm test`) runs instead of the bounded ladder (`cdd-kit test run --phase ...`); does not block.'
    : 'strict mode: blocks a broad whole-suite test command, routing to `cdd-kit test run` or an explicit bounded target.',
};

/** A single hook handler — Claude Code executes `{ type: 'command', command }`. */
interface HookHandler {
  type?: string;
  command?: string;
  [k: string]: unknown;
}

interface HookEntry {
  matcher?: string;
  /**
   * Claude Code's schema nests handlers under `hooks`; the matcher group is a
   * container, not a handler. (`command` is kept on the type only to detect and
   * clean up entries written by older cdd-kit versions that wrote it here.)
   */
  hooks?: HookHandler[];
  command?: string;
  [k: string]: unknown;
}

interface SettingsShape {
  hooks?: { PreToolUse?: HookEntry[]; [event: string]: HookEntry[] | undefined };
  [k: string]: unknown;
}

/** POSIX-style relative path so the settings.json command resolves from the
 * project root regardless of OS path separators. */
function hookRelPath(filename: string): string {
  return `.claude/hooks/${filename}`;
}

/**
 * Strip OUR handler for `def` from the PreToolUse list, preserving everything
 * else. Removes only the marker-matched handler — in both the correct nested
 * shape and the legacy top-level `command` shape older versions wrote — so an
 * unrelated hook (including the OTHER cdd hook, which carries a different marker)
 * sharing the same matcher group is preserved rather than dropped. Re-running is
 * therefore idempotent and a mode switch (advisory <-> strict) cleanly replaces.
 */
function withoutHandler(preTool: HookEntry[], def: HookDef): HookEntry[] {
  const isOurs = (h: HookHandler): boolean =>
    typeof h?.command === 'string' && h.command.includes(def.marker);
  const out: HookEntry[] = [];
  for (const e of preTool) {
    // Legacy top-level cdd entry (no nested handlers) — drop it entirely.
    if (typeof e?.command === 'string' && e.command.includes(def.marker) && !Array.isArray(e?.hooks)) {
      continue;
    }
    if (Array.isArray(e?.hooks) && e.hooks.some(isOurs)) {
      const others = e.hooks.filter(h => !isOurs(h));
      // The group held nothing but our handler(s) — drop the whole group.
      if (others.length === 0) continue;
      // Mixed group — keep it minus our handler, preserving the rest.
      out.push({ ...e, hooks: others });
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * Install the kit's agent PreToolUse hooks into the project's
 * `.claude/settings.json` so steering toward `cdd-kit` chokepoints becomes a
 * harness-enforced chokepoint rather than prose the agent can ignore.
 *
 * Three hooks are armed independently:
 *  - graph-first (`Read`)  → steer to `cdd-kit index query --with-source`;
 *  - contract-write (`Edit`/`Write`) → route API-contract edits to
 *    `cdd-kit contract set` (ADR 0004 §6, Stage 2).
 *  - test-runner (`Bash`) → steer broad whole-suite test runs to the bounded
 *    ladder `cdd-kit test run --phase ...` (ADR 0005 §10).
 *
 * With no hook flag at all, defaults to graph-first advisory — the historical
 * behavior of a bare `install-agent-hooks` and of `init`'s arming step. Naming a
 * flag arms only that hook and leaves the other untouched, so the two can be
 * armed across separate invocations. Idempotent: re-running replaces only the
 * cdd-kit entry for each named hook and preserves every other setting/hook.
 */
export async function installAgentHooks(opts: InstallAgentHooksOptions = {}): Promise<void> {
  const requested: Array<{ def: HookDef; mode: HookMode }> = [];
  if (opts.graphFirst === undefined && opts.contractWrite === undefined && opts.testRunner === undefined) {
    requested.push({ def: GRAPH_FIRST, mode: 'advisory' });
  } else {
    if (opts.graphFirst !== undefined) requested.push({ def: GRAPH_FIRST, mode: opts.graphFirst });
    if (opts.contractWrite !== undefined) requested.push({ def: CONTRACT_WRITE, mode: opts.contractWrite });
    if (opts.testRunner !== undefined) requested.push({ def: TEST_RUNNER, mode: opts.testRunner });
  }

  for (const { def, mode } of requested) {
    if (mode !== 'advisory' && mode !== 'strict') {
      log.error(`invalid mode for ${def.id}: ${mode}. Use 'advisory' or 'strict'.`);
      process.exit(1);
    }
  }

  const cwd = process.cwd();

  // 1. Every requested hook script must be bundled before we touch settings.
  for (const { def } of requested) {
    const srcHook = join(ASSET.hooks, def.filename);
    if (!existsSync(srcHook)) {
      if (opts.fromInit) {
        log.warn(`${def.id} hook not armed: bundled hook missing (${srcHook}). Reinstall the package, then run \`cdd-kit install-agent-hooks\`.`);
        return;
      }
      log.error(`bundled hook not found: ${srcHook}. Reinstall the cdd-kit package.`);
      process.exit(1);
    }
  }

  // 2. Load .claude/settings.json once (preserve everything we do not own).
  const settingsPath = join(cwd, SETTINGS_REL_PATH);
  let settings: SettingsShape = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as SettingsShape;
    } catch (err) {
      if (opts.fromInit) {
        log.warn(`agent hooks not armed: ${SETTINGS_REL_PATH} is not valid JSON (${(err as Error).message}). Fix it, then run \`cdd-kit install-agent-hooks\`.`);
        return;
      }
      log.error(`${SETTINGS_REL_PATH} is not valid JSON: ${(err as Error).message}. Fix or remove it, then re-run.`);
      process.exit(1);
    }
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      if (opts.fromInit) {
        log.warn(`agent hooks not armed: ${SETTINGS_REL_PATH} must be a JSON object. Fix it, then run \`cdd-kit install-agent-hooks\`.`);
        return;
      }
      log.error(`${SETTINGS_REL_PATH} must be a JSON object.`);
      process.exit(1);
    }
  }

  mkdirSync(join(cwd, '.claude', 'hooks'), { recursive: true });
  settings.hooks = settings.hooks ?? {};
  let preTool: HookEntry[] = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];

  // 3. Arm each requested hook: copy its script, then replace its entry. Nest the
  // command under `hooks` as a `{ type: 'command' }` handler — the shape Claude
  // Code actually executes. Writing `command` on the matcher group directly
  // leaves the chokepoint silently dormant.
  for (const { def, mode } of requested) {
    const destHook = join(cwd, hookRelPath(def.filename));
    copyFileSync(join(ASSET.hooks, def.filename), destHook);
    try {
      chmodSync(destHook, 0o755);
    } catch { /* ignore on Windows */ }

    preTool = withoutHandler(preTool, def);
    const invoke = `./${hookRelPath(def.filename)}`;
    const run = mode === 'strict' ? `${def.strictEnv}=1 ${invoke}` : invoke;
    // Anchor the run to the project root via $CLAUDE_PROJECT_DIR. Claude Code does
    // NOT guarantee the hook's cwd is the project root (the actual cwd is only
    // passed on stdin), so a bare relative `./.claude/hooks/...` fails to resolve
    // ("/bin/sh: ./.claude/hooks/...: not found") whenever the session cwd differs.
    // The `cd` also fixes each hook's INTERNAL relative probes (`.cdd/code-map.yml`,
    // `.cdd/`, `contracts/api/api-contract.md`): without a correct cwd those resolve
    // to nothing and the hook silently no-ops (always-allow) instead of steering —
    // worse than erroring. `${CLAUDE_PROJECT_DIR:-.}` falls back to the current dir
    // on an older harness that does not export the var, preserving prior behavior.
    // The command runs through `sh -c`, so `$CLAUDE_PROJECT_DIR` and `&&` are honored.
    const command = `cd "\${CLAUDE_PROJECT_DIR:-.}" && ${run}`;
    preTool.push({ matcher: def.matcher, hooks: [{ type: 'command', command }] });
  }

  settings.hooks.PreToolUse = preTool;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  for (const { def, mode } of requested) {
    log.ok(`${def.id} PreToolUse hook installed (${mode}) at ${SETTINGS_REL_PATH}`);
    log.info(`hook script: ${hookRelPath(def.filename)}`);
    log.info(def.describe(mode));
  }
}
