import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

// One shared Ajv instance for every gate sub-module that compiles a schema
// (tasks, test-evidence, agent-log). A single instance keeps format registration
// and compilation behavior identical to the pre-split gate.
export const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);

export interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'done' | 'skipped';
  section?: string;
}

export interface TasksFile {
  'change-id': string;
  status: string;
  tier?: number | null;
  'context-governance'?: 'v1';
  'archive-tasks'?: string[];
  'depends-on'?: string[];
  'tier-floor-override'?: string;
  'test-evidence-not-applicable'?: string;
  tasks: TaskItem[];
}

export function loadYamlFile<T>(path: string): { data: T | null; parseError: string | null } {
  try {
    const raw = readFileSync(path, 'utf8');
    return { data: yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as T, parseError: null };
  } catch (err) {
    return { data: null, parseError: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// enforceConfirmationHookInstallation (ci-gate-contract.md
// `### enforceConfirmationHookInstallation`, added by enforce-human-confirmation).
//
// Verifies the two write-block PreToolUse hooks the human-confirmation guarantee
// depends on are actually armed in the PROJECT `.claude/settings.json`, rather than
// merely shipped as scripts nobody registered. Hosted by BOTH `cdd-kit gate` and
// `cdd-kit validate`: the workflow's gate step is skipped when a pull request
// touches no `specs/changes/<id>/` directory, so `validate` (which runs
// unconditionally in CI) is the second host that makes the `pull_request` trigger
// cell true without a workflow edit.
//
// This is NOT a prevention boundary: passing does not stop a `Bash`-holding agent
// from bypassing an installed hook (`cdd-kit design confirm` through Bash,
// `node -e` into the lock writer, a shell redirect). It only observes that the
// project *declares* the hook at a real, git-tracked path.
// ─────────────────────────────────────────────────────────────────────────────

interface WriteBlockHookSpec {
  /** Which of the two hooks — used verbatim in the "does not register the
   *  <design|acceptance>-write hook" message. */
  id: 'design' | 'acceptance';
  /** Marker substring identifying this hook's handler in a `command` string
   *  (`install-agent-hooks.ts` DESIGN_WRITE_MARKER / ACCEPTANCE_WRITE_MARKER). */
  marker: string;
  /** Script filename, used to extract the registered path from the command. */
  filename: string;
}

const WRITE_BLOCK_HOOKS: readonly WriteBlockHookSpec[] = [
  { id: 'design',     marker: 'pre-tool-use-design-write',     filename: 'pre-tool-use-design-write.sh' },
  { id: 'acceptance', marker: 'pre-tool-use-acceptance-write', filename: 'pre-tool-use-acceptance-write.sh' },
];

export interface HookInstallFinding {
  message: string;
  /**
   * `advisory` findings never harden into errors, not even in CI. Exactly one
   * situation qualifies: the project's agent provider is not Claude Code, so no
   * PreToolUse write-block mechanism exists for it to install. Failing a project
   * for not doing something it cannot do is the mirror image of announcing a
   * guarantee that does not hold — both tell the reader something untrue about
   * the mechanism. Human decision, 2026-07-10.
   */
  severity?: 'hard' | 'advisory';
}

/**
 * The agent provider this project is configured for, from `.cdd/model-policy.json`.
 * Absent or unreadable => assume `claude`: the write-block hooks are a Claude Code
 * mechanism, and a missing policy file must not become a way to opt out of the check.
 */
function projectProvider(cwd: string): string {
  const p = join(cwd, '.cdd', 'model-policy.json');
  if (!existsSync(p)) return 'claude';
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as { provider?: unknown };
    return typeof parsed.provider === 'string' && parsed.provider.trim() !== ''
      ? parsed.provider.trim().toLowerCase()
      : 'claude';
  } catch {
    return 'claude';
  }
}

/**
 * "Inside CI" per `contracts/env/env-contract.md` (0.4.0): the `CI` variable is
 * set to a non-empty value other than `0` or `false`. Every mainstream provider
 * sets `CI=true`, so no workflow edit is needed; a local run leaves it unset.
 */
export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CI;
  if (raw === undefined) return false;
  const v = raw.trim();
  if (v === '') return false;
  return v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Every `command` string an entry will actually EXECUTE.
 *
 * Only a nested `{ type: 'command', command }` handler qualifies. A `command`
 * written directly on the matcher group is the legacy shape that older
 * `install-agent-hooks` versions produced, and `install-agent-hooks.ts` says so in
 * its own comment: Claude Code never executes it. Counting it here would let the
 * gate certify a hook that cannot fire — a registered-looking no-op, which is the
 * one thing this check exists to detect. `entryDormantCommands` reports those
 * separately so the human is told what is wrong rather than that nothing is.
 */
function entryCommands(entry: unknown): string[] {
  const out: string[] = [];
  if (entry && typeof entry === 'object') {
    const e = entry as { hooks?: unknown };
    if (Array.isArray(e.hooks)) {
      for (const h of e.hooks) {
        const handler = h as { type?: unknown; command?: unknown };
        if (handler?.type === 'command' && typeof handler.command === 'string') {
          out.push(handler.command);
        }
      }
    }
  }
  return out;
}

/** Commands written in a shape Claude Code will not execute: a top-level
 *  `command` on the matcher group, or a nested handler missing `type: 'command'`. */
function entryDormantCommands(entry: unknown): string[] {
  const out: string[] = [];
  if (entry && typeof entry === 'object') {
    const e = entry as { command?: unknown; hooks?: unknown };
    if (typeof e.command === 'string') out.push(e.command);
    if (Array.isArray(e.hooks)) {
      for (const h of e.hooks) {
        const handler = h as { type?: unknown; command?: unknown };
        if (handler?.type !== 'command' && typeof handler?.command === 'string') {
          out.push(handler.command);
        }
      }
    }
  }
  return out;
}

/**
 * A hook entry counts only if its matcher covers `Write`, `Edit`, AND `MultiEdit`
 * — the three file-mutation tools an agent could use to fabricate a lock. The
 * installer writes the Claude Code matcher `Write|Edit|MultiEdit`; treat the
 * matcher as that regex-alternation and require all three to match.
 */
function matcherCoversWriteTools(matcher: unknown): boolean {
  if (typeof matcher !== 'string' || matcher.trim() === '') return false;
  const tools = ['Write', 'Edit', 'MultiEdit'];
  try {
    const re = new RegExp(`^(?:${matcher})$`);
    return tools.every(t => re.test(t));
  } catch {
    const set = new Set(matcher.split('|').map(s => s.trim()));
    return tools.every(t => set.has(t));
  }
}

/** Extract the hook script path from a `command` string, normalizing a leading
 *  `./`. Returns null when the filename is not present in the command. */
function extractScriptPath(command: string, filename: string): string | null {
  const re = new RegExp(`([^\\s"']*${filename.replace(/\./g, '\\.')})`);
  const m = command.match(re);
  if (!m) return null;
  return m[1].replace(/^\.\//, '');
}

/**
 * Whether `relPath` is tracked by git under `cwd`. Directory-agnostic: a tracked
 * `.claude/hooks/…` and a tracked repo-root `hooks/…` both pass.
 *
 * THREE outcomes, not two. `git ls-files` exiting non-zero does not mean "not
 * tracked" — it means git declined to answer. The most common cause in CI is
 * `fatal: detected dubious ownership`, when the checkout is owned by a different
 * uid than the process, or when `safe.directory` is unset because the global
 * config was replaced. Collapsing that into `untracked` makes the gate tell a
 * maintainer to register a hook that is already registered — two meanings sharing
 * one discriminator, which `interaction-design.md` `## Consistency Commitments`
 * forbids. It was found by running this repository's own suite under `CI=true`.
 */
type TrackedState = 'tracked' | 'untracked' | 'undeterminable';

function gitTrackedState(cwd: string, relPath: string): { state: TrackedState; detail?: string } {
  const r = spawnSync('git', ['ls-files', '--', relPath], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) return { state: 'undeterminable', detail: r.error.message };
  if (r.status !== 0) {
    const stderr = (r.stderr ?? '').trim().split('\n')[0] ?? '';
    return { state: 'undeterminable', detail: `git ls-files exited ${r.status}${stderr ? `: ${stderr}` : ''}` };
  }
  return { state: r.stdout.trim().length > 0 ? 'tracked' : 'untracked' };
}

/**
 * Compute the hook-installation findings for the project at `cwd`. Returns one
 * finding per unmet cause; an empty array means both write-block hooks are armed
 * at a git-tracked path. The two absence causes carry DISTINCT message text
 * (settings file absent vs. present-but-unregistered), because a human exits them
 * differently. Reads the PROJECT `.claude/settings.json` only, never
 * `.claude/settings.local.json` (a personal override is not project arming).
 */
export function checkConfirmationHookInstallation(cwd: string): HookInstallFinding[] {
  // The write-block hooks are a Claude Code PreToolUse mechanism. A project whose
  // provider is something else has no `.claude/settings.json` and no way to acquire
  // one that means anything. Say what is true — the implementation-layer guarantee
  // does not exist here — rather than failing the project for it.
  const provider = projectProvider(cwd);
  if (provider !== 'claude') {
    return [{
      severity: 'advisory',
      message: `agent provider is \`${provider}\`, not \`claude\` — the design/acceptance write-block hooks are a Claude Code PreToolUse mechanism and do not exist for this provider. Human confirmation here rests on the hash-lock and the gate alone; nothing prevents an agent's editor from writing a lock sidecar.`,
    }];
  }

  const settingsPath = join(cwd, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    return [{
      message: '.claude/settings.json not found — the design/acceptance write-block hooks cannot be verified because no project settings file exists',
    }];
  }

  // The settings file itself must be tracked. A bare CI checkout contains only
  // tracked files, so an untracked settings.json registers nothing there, however
  // well-armed the developer's working copy looks under a local `--strict`.
  {
    const { state, detail } = gitTrackedState(cwd, '.claude/settings.json');
    if (state === 'untracked') {
      return [{
        message: '.claude/settings.json exists but is not git-tracked — a bare CI checkout would not contain it, so no hook is registered there. `git add .claude/settings.json`',
      }];
    }
    if (state === 'undeterminable') {
      return [{
        message: `.claude/settings.json exists, but whether it is git-tracked could not be determined (${detail}). Resolve the git error, then re-run.`,
      }];
    }
  }

  let settings: unknown = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    // A present-but-unparseable settings file registers no hook — fall through to
    // the per-hook "does not register" findings rather than the not-found text,
    // which is reserved for the truly absent file (they exit differently).
    settings = {};
  }

  const preTool = (() => {
    const s = settings as { hooks?: { PreToolUse?: unknown } };
    return Array.isArray(s?.hooks?.PreToolUse) ? (s.hooks!.PreToolUse as unknown[]) : [];
  })();

  const findings: HookInstallFinding[] = [];
  for (const spec of WRITE_BLOCK_HOOKS) {
    // Registration and tracking are separate questions with separate answers.
    let registeredPath: string | null = null;
    for (const entry of preTool) {
      const e = entry as { matcher?: unknown };
      if (!matcherCoversWriteTools(e.matcher)) continue;
      for (const cmd of entryCommands(entry)) {
        if (!cmd.includes(spec.marker)) continue;
        const path = extractScriptPath(cmd, spec.filename);
        if (path !== null) { registeredPath = path; break; }
      }
      if (registeredPath) break;
    }

    if (registeredPath === null) {
      // Before saying "does not register", check whether it registers the hook in a
      // shape Claude Code will not execute. The installer's own comment calls the
      // top-level `command` form dormant; a settings file carrying it looks armed to
      // a reader and fires never. Telling that reader "not registered" would send
      // them to add an entry that is already there.
      const dormant = preTool.some(entry => {
        const e = entry as { matcher?: unknown };
        if (!matcherCoversWriteTools(e.matcher)) return false;
        return entryDormantCommands(entry).some(cmd => cmd.includes(spec.marker));
      });
      findings.push({
        message: dormant
          ? `.claude/settings.json registers the ${spec.id}-write hook in a shape Claude Code never executes (a top-level \`command\`, or a handler without \`"type": "command"\`) — it looks armed and fires never. Re-run \`cdd-kit install-agent-hooks --${spec.id}-write\` to rewrite it as a nested command handler.`
          : `.claude/settings.json exists but does not register the ${spec.id}-write hook`,
      });
      continue;
    }

    const { state, detail } = gitTrackedState(cwd, registeredPath);
    if (state === 'tracked') continue;

    if (state === 'undeterminable') {
      // A third situation, with its own exit: git could not answer, so the
      // premise is unverifiable. Saying "does not register" here would be false,
      // and would send the reader to fix the one thing that is not broken.
      findings.push({
        message: `.claude/settings.json registers the ${spec.id}-write hook at ${registeredPath}, but whether that path is git-tracked could not be determined (${detail}). A hook script CI cannot see is a hook CI cannot run — resolve the git error, then re-run.`,
      });
      continue;
    }

    findings.push({
      message: `.claude/settings.json registers the ${spec.id}-write hook at ${registeredPath}, but that path is not git-tracked — a bare CI checkout contains only tracked files, so the hook would be absent there. \`git add ${registeredPath}\``,
    });
  }
  return findings;
}

/**
 * Gate/validate wrapper: run the hook-installation check and route each finding by
 * severity. `ci-or-strict` — a HARD failure (stderr, via `errors`) inside CI or
 * under `--strict`; a WARNING (stdout, via `warnings`) in a default local run.
 * NOT gated on `isNewChange`: hook installation is a project property, so a legacy
 * change directory and a brand-new one see the identical shape.
 */
export function enforceConfirmationHookInstallation(
  cwd: string,
  strict: boolean,
  errors: string[],
  warnings: string[],
): void {
  const hard = isCiEnvironment() || strict;
  for (const f of checkConfirmationHookInstallation(cwd)) {
    const escalate = hard && f.severity !== 'advisory';
    (escalate ? errors : warnings).push(f.message);
  }
}

export function ajvErrorsToMessages(
  errors: ErrorObject[] | null | undefined,
  prefix: string,
  knownKeys?: string[],
): { errors: string[]; warnings: string[] } {
  const out = { errors: [] as string[], warnings: [] as string[] };
  for (const e of errors ?? []) {
    if (e.keyword === 'additionalProperties') {
      const key = (e.params as { additionalProperty: string }).additionalProperty;
      const lower = key.toLowerCase();
      const suggestion = knownKeys?.includes(lower) ? ` (did you mean \`${lower}\`?)` : '';
      out.warnings.push(`${prefix}: unknown key \`${key}\`${suggestion}`);
      continue;
    }
    if (e.keyword === 'required') {
      const missing = (e.params as { missingProperty: string }).missingProperty;
      out.errors.push(`${prefix}: missing required \`${missing}\``);
      continue;
    }
    if (e.keyword === 'enum') {
      const allowed = (e.params as { allowedValues: string[] }).allowedValues.join(', ');
      out.errors.push(`${prefix}: invalid value at ${e.instancePath || '/'} (expected one of: ${allowed})`);
      continue;
    }
    out.errors.push(`${prefix}: ${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
  }
  return out;
}
