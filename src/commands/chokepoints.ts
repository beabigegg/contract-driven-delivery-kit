import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import {
  GRAPH_FIRST_MARKER,
  CONTRACT_WRITE_MARKER,
  TEST_RUNNER_MARKER,
} from './install-agent-hooks.js';

/**
 * Chokepoint liveness probe for `cdd-kit doctor`.
 *
 * The kit accretes opt-in enforcement mechanisms (graph-first hook, pre-commit
 * gate, OpenAPI sync gate). Each is dormant until explicitly armed, so a repo
 * can carry all the machinery yet enforce none of it. This probe makes that
 * observable: for each chokepoint it reports `live` (armed) or `dormant` (the
 * machinery exists but nothing triggers it), plus the one command to arm it.
 *
 * Detection is mechanical and read-only — it looks for the exact markers each
 * installer writes, never executes anything. Findings are advisory: dormant is
 * a nudge, not a failure, because not every project wants every chokepoint.
 */

export interface ChokepointStatus {
  /** Stable short id, e.g. 'graph-first-hook'. */
  id: string;
  /** Human label shown in the dashboard. */
  name: string;
  live: boolean;
  /** When live: how it is armed. When dormant: how to arm it. */
  detail: string;
}

// The three agent-hook markers (graph-first, contract-write, test-runner) are
// imported from install-agent-hooks above — that command is their producer, so a
// single definition keeps arming and this detection in lockstep.
/** Marker the install-hooks command writes into .git/hooks/pre-commit. */
const PRECOMMIT_MARKER = '# cdd-kit-managed-block-start';
/** Substring identifying the OpenAPI sync gate in a script or CI step. */
const OPENAPI_CHECK_MARKER = 'openapi export --check';

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Every command string nested under a PreToolUse handler (the shape Claude Code
 * actually executes). A legacy top-level `command` is intentionally excluded: it
 * never fires, so a chokepoint that relied on it must read as dormant — that
 * nudges the user to re-run install-agent-hooks, which rewrites it correctly. A
 * malformed/absent settings.json yields no commands (install-agent-hooks reports
 * the JSON error itself when the user tries to arm it).
 */
function nestedPreToolUseCommands(cwd: string): string[] {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return [];
  try {
    const settings = JSON.parse(safeRead(settingsPath)) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: unknown }> }> };
    };
    const entries = settings.hooks?.PreToolUse;
    if (!Array.isArray(entries)) return [];
    const commands: string[] = [];
    for (const entry of entries) {
      if (!Array.isArray(entry?.hooks)) continue;
      for (const handler of entry.hooks) {
        if (typeof handler?.command === 'string') commands.push(handler.command);
      }
    }
    return commands;
  } catch {
    return [];
  }
}

/** graph-first PreToolUse hook armed in .claude/settings.json? */
function probeGraphFirst(cwd: string): ChokepointStatus {
  const live = nestedPreToolUseCommands(cwd).some(c => c.includes(GRAPH_FIRST_MARKER));
  return {
    id: 'graph-first-hook',
    name: 'graph-first exploration hook',
    live,
    detail: live
      ? 'PreToolUse hook steers agents to graph/index queries before Read'
      : 'dormant — run `cdd-kit install-agent-hooks --graph-first advisory` to stop agents defaulting to Read',
  };
}

/** contract-write PreToolUse hook armed in .claude/settings.json? (ADR 0004 §6) */
function probeContractWrite(cwd: string): ChokepointStatus {
  const live = nestedPreToolUseCommands(cwd).some(c => c.includes(CONTRACT_WRITE_MARKER));
  return {
    id: 'contract-write-hook',
    name: 'contract-write hook',
    live,
    detail: live
      ? 'PreToolUse hook routes agent edits of the API contract through `cdd-kit contract set`'
      : 'dormant — run `cdd-kit install-agent-hooks --contract-write strict` to route agent contract edits through `cdd-kit contract set`',
  };
}

/** test-runner PreToolUse hook armed in .claude/settings.json? (ADR 0005 §10) */
function probeTestRunner(cwd: string): ChokepointStatus {
  const live = nestedPreToolUseCommands(cwd).some(c => c.includes(TEST_RUNNER_MARKER));
  return {
    id: 'test-runner-hook',
    name: 'test-runner hook',
    live,
    detail: live
      ? 'PreToolUse hook steers broad whole-suite test runs to the bounded `cdd-kit test run` ladder'
      : 'dormant — run `cdd-kit install-agent-hooks --test-runner advisory` to steer agents off broad whole-suite test commands',
  };
}

/**
 * Resolve the directory git uses for hooks, honoring `core.hooksPath`,
 * worktrees, and submodules — mirroring how `cdd-kit install-hooks` arms the
 * gate. Read-only: falls back to `.git/hooks` when git is unavailable rather
 * than exiting, so probing a custom-hooksPath repo doesn't report a live gate
 * as dormant. */
function resolveHooksDir(cwd: string): string {
  try {
    const res = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd, encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) return resolve(cwd, res.stdout.trim());
  } catch {
    // git unavailable — fall back to the plain-directory default below.
  }
  return join(cwd, '.git', 'hooks');
}

/** cdd-kit gate armed as a git pre-commit hook? */
function probePreCommitGate(cwd: string): ChokepointStatus {
  const hookPath = join(resolveHooksDir(cwd), 'pre-commit');
  const live = existsSync(hookPath) && safeRead(hookPath).includes(PRECOMMIT_MARKER);
  return {
    id: 'pre-commit-gate',
    name: 'pre-commit gate hook',
    live,
    detail: live
      ? '`cdd-kit gate` runs before each commit touching specs/contracts'
      : 'dormant — run `cdd-kit install-hooks` to block commits that fail the gate',
  };
}

/** OpenAPI sync gate wired into a package.json script or a CI workflow? */
function probeOpenApiGate(cwd: string): ChokepointStatus {
  let where = '';

  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(safeRead(pkgPath)) as { scripts?: Record<string, unknown> };
      const scripts = pkg.scripts ?? {};
      for (const [name, cmd] of Object.entries(scripts)) {
        if (typeof cmd === 'string' && cmd.includes(OPENAPI_CHECK_MARKER)) {
          where = `package.json script \`${name}\``;
          break;
        }
      }
    } catch {
      // ignore malformed package.json for this read-only probe
    }
  }

  if (!where) {
    const wfDir = join(cwd, '.github', 'workflows');
    if (existsSync(wfDir)) {
      try {
        for (const entry of readdirSync(wfDir)) {
          if (!/\.ya?ml$/.test(entry)) continue;
          if (safeRead(join(wfDir, entry)).includes(OPENAPI_CHECK_MARKER)) {
            where = `CI workflow ${entry}`;
            break;
          }
        }
      } catch {
        // ignore unreadable workflows dir
      }
    }
  }

  const live = where !== '';
  return {
    id: 'openapi-sync-gate',
    name: 'OpenAPI sync gate',
    live,
    detail: live
      ? `\`cdd-kit openapi export --check\` runs in ${where}`
      : 'dormant — wire `cdd-kit openapi export --check --out <artifact>` into CI or a package.json script (or run `cdd-kit init`)',
  };
}

export function detectChokepoints(cwd: string): ChokepointStatus[] {
  return [
    probeGraphFirst(cwd),
    probeContractWrite(cwd),
    probeTestRunner(cwd),
    probePreCommitGate(cwd),
    probeOpenApiGate(cwd),
  ];
}
