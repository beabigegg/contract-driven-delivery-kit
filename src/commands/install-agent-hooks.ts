import { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ASSET } from '../utils/paths.js';
import { log } from '../utils/logger.js';

export type GraphFirstMode = 'advisory' | 'strict';

export interface InstallAgentHooksOptions {
  graphFirst?: GraphFirstMode;
}

const HOOK_FILENAME = 'pre-tool-use-graph-first.sh';
// Stable in-repo location the settings.json entry points at. Kept under
// .claude/ so it travels with the project alongside settings.json itself.
const HOOK_REL_PATH = `.claude/hooks/${HOOK_FILENAME}`;
const SETTINGS_REL_PATH = '.claude/settings.json';
// Identifies our PreToolUse entry for idempotent replace.
const HOOK_MARKER = 'pre-tool-use-graph-first';

interface HookEntry {
  matcher?: string;
  command?: string;
  [k: string]: unknown;
}

interface SettingsShape {
  hooks?: { PreToolUse?: HookEntry[]; [event: string]: HookEntry[] | undefined };
  [k: string]: unknown;
}

/**
 * Install the graph-first PreToolUse hook into the project's
 * `.claude/settings.json` so steering toward `cdd-kit index query --with-source`
 * becomes an actual harness-enforced chokepoint rather than a prose suggestion
 * the agent can ignore. Idempotent: re-running replaces the cdd-kit entry and
 * preserves every other setting/hook.
 */
export async function installAgentHooks(opts: InstallAgentHooksOptions = {}): Promise<void> {
  const mode: GraphFirstMode = opts.graphFirst ?? 'advisory';
  if (mode !== 'advisory' && mode !== 'strict') {
    log.error(`invalid mode: ${mode}. Use 'advisory' or 'strict'.`);
    process.exit(1);
  }

  const cwd = process.cwd();

  // 1. Copy the hook script into the project at a stable path.
  const srcHook = join(ASSET.hooks, HOOK_FILENAME);
  if (!existsSync(srcHook)) {
    log.error(`bundled hook not found: ${srcHook}. Reinstall the cdd-kit package.`);
    process.exit(1);
  }
  const destHook = join(cwd, HOOK_REL_PATH);
  mkdirSync(join(cwd, '.claude', 'hooks'), { recursive: true });
  copyFileSync(srcHook, destHook);
  try {
    chmodSync(destHook, 0o755);
  } catch { /* ignore on Windows */ }

  // 2. Merge a PreToolUse entry into .claude/settings.json (preserve the rest).
  const settingsPath = join(cwd, SETTINGS_REL_PATH);
  let settings: SettingsShape = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as SettingsShape;
    } catch (err) {
      log.error(`${SETTINGS_REL_PATH} is not valid JSON: ${(err as Error).message}. Fix or remove it, then re-run.`);
      process.exit(1);
    }
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      log.error(`${SETTINGS_REL_PATH} must be a JSON object.`);
      process.exit(1);
    }
  }

  settings.hooks = settings.hooks ?? {};
  const preTool: HookEntry[] = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];

  // Drop any prior cdd-kit graph-first entry so re-running is idempotent and a
  // mode switch (advisory <-> strict) cleanly replaces the old command.
  const preserved = preTool.filter(
    e => !(typeof e?.command === 'string' && e.command.includes(HOOK_MARKER)),
  );

  // Use a POSIX-style relative command so it resolves from the project root
  // regardless of OS path separators; prefix the strict env inline.
  const invoke = `./${HOOK_REL_PATH}`;
  const command = mode === 'strict' ? `CDD_GRAPH_FIRST_STRICT=1 ${invoke}` : invoke;

  preserved.push({ matcher: 'Read', command });
  settings.hooks.PreToolUse = preserved;

  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  log.ok(`graph-first PreToolUse hook installed (${mode}) at ${SETTINGS_REL_PATH}`);
  log.info(`hook script: ${HOOK_REL_PATH}`);
  if (mode === 'advisory') {
    log.info('advisory mode: reminds agents to use `cdd-kit index query --with-source` before Read; does not block.');
    log.info('re-run with `--graph-first strict` to hard-block source Reads when a code-map exists.');
  } else {
    log.info('strict mode: blocks source-file Read when .cdd/code-map.yml exists, steering to graph/index queries.');
    log.info('re-run with `--graph-first advisory` to downgrade to reminders only.');
  }
}
