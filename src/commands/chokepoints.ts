import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

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

/** Marker the install-agent-hooks command writes into settings.json commands. */
const GRAPH_FIRST_MARKER = 'pre-tool-use-graph-first';
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

/** graph-first PreToolUse hook armed in .claude/settings.json? */
function probeGraphFirst(cwd: string): ChokepointStatus {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  let live = false;
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(safeRead(settingsPath)) as {
        hooks?: { PreToolUse?: Array<{ command?: unknown }> };
      };
      const entries = settings.hooks?.PreToolUse;
      if (Array.isArray(entries)) {
        live = entries.some(e => typeof e?.command === 'string' && e.command.includes(GRAPH_FIRST_MARKER));
      }
    } catch {
      // Malformed settings.json — treat as dormant; install-agent-hooks reports
      // the JSON error itself when the user tries to arm it.
    }
  }
  return {
    id: 'graph-first-hook',
    name: 'graph-first exploration hook',
    live,
    detail: live
      ? 'PreToolUse hook steers agents to graph/index queries before Read'
      : 'dormant — run `cdd-kit install-agent-hooks --graph-first advisory` to stop agents defaulting to Read',
  };
}

/** cdd-kit gate armed as a git pre-commit hook? */
function probePreCommitGate(cwd: string): ChokepointStatus {
  const hookPath = join(cwd, '.git', 'hooks', 'pre-commit');
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
    probePreCommitGate(cwd),
    probeOpenApiGate(cwd),
  ];
}
