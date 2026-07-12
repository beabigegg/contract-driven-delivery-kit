/**
 * `cdd-kit setup` — one command that takes a repo from zero to a fully wired,
 * enforcement-armed cdd-kit project.
 *
 * Onboarding previously required running 7–10 distinct commands across sessions
 * (`init` → `claude mcp add` → `install-hooks` → `install-agent-hooks
 * --graph-first` → `install-agent-hooks --test-runner` → `context-scan` →
 * `code-map`, plus `refresh`/`migrate` on upgrade) and understanding the
 * semantic difference between update/upgrade/refresh/migrate. For a non-engineer
 * that is the single biggest break in "extreme automation": the target user has
 * no basis to decide which of those they need.
 *
 * `setup` collapses the whole sequence into one idempotent command. It detects
 * whether the project is fresh or already initialised, runs the right scaffold
 * (`init` vs `refresh --yes`), arms the enforcement chokepoints, best-effort
 * registers the MCP server, builds the context indexes, and prints a per-step
 * success/failure summary ending with the one thing to do next. Every step is
 * best-effort: a recoverable failure (no git repo, no `claude` CLI) downgrades
 * to a warning and the run continues, so the user always gets a complete report
 * instead of a mid-sequence abort. The fine-grained commands remain available as
 * the advanced interface.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { log } from '../utils/logger.js';
import { detectStack } from '../utils/stack-detect.js';
import { logRecommendedMcpSetup } from '../utils/mcp-hint.js';
import { inferProvider, type Provider } from '../utils/provider.js';
import { providerAdapters } from '../providers/registry.js';

export interface SetupOptions {
  /** Provider adapter. Defaults to claude (fresh) or the detected provider (upgrade). */
  provider?: Provider;
  /** Fresh install only: overwrite existing project files. */
  force?: boolean;
  /** Skip arming the pre-commit gate and agent PreToolUse hooks. */
  noArm?: boolean;
  /** Skip the best-effort `claude mcp add` registration. */
  noMcp?: boolean;
}

type StepStatus = 'ok' | 'skip' | 'warn' | 'fail';
interface StepResult {
  label: string;
  status: StepStatus;
  detail?: string;
}

/**
 * Best-effort registration of the cdd-kit MCP server with the Claude Code CLI.
 * Never throws and never blocks: if `claude` is absent or `claude mcp add`
 * fails, it prints the manual instruction and reports a skip/warn so the user
 * still ends up with a usable project (agents fall back to the slower CLI path).
 */
function registerMcp(provider: Provider): StepResult {
  const label = 'MCP server registration';
  const outcomes: StepStatus[] = [];
  const details: string[] = [];
  for (const adapter of providerAdapters(provider)) {
    const ver = spawnSync(adapter.mcpCommand, ['--version'], { encoding: 'utf8' });
    if (ver.error || ver.status !== 0) {
      log.warn(`${adapter.displayName} CLI (${adapter.mcpCommand}) not found — skipping MCP registration.`);
      outcomes.push('skip');
      details.push(`${adapter.id}: CLI not found`);
      continue;
    }
    const list = spawnSync(adapter.mcpCommand, ['mcp', 'list'], { encoding: 'utf8' });
    if (list.status === 0 && /\bcdd-kit\b/.test(`${list.stdout ?? ''}${list.stderr ?? ''}`)) {
      log.ok(`cdd-kit MCP server already registered for ${adapter.displayName}.`);
      outcomes.push('ok');
      details.push(`${adapter.id}: already registered`);
      continue;
    }
    const add = spawnSync(adapter.mcpCommand, adapter.mcpArgs, { encoding: 'utf8' });
    if (add.status === 0) {
      log.ok(`Registered cdd-kit MCP server for ${adapter.displayName}.`);
      outcomes.push('ok');
      details.push(`${adapter.id}: registered`);
    } else {
      log.warn(`${adapter.displayName} MCP registration failed (exit ${add.status ?? '?'}).`);
      outcomes.push('warn');
      details.push(`${adapter.id}: registration failed`);
    }
  }
  if (outcomes.includes('warn')) return { label, status: 'warn', detail: details.join('; ') };
  if (outcomes.includes('ok')) return { label, status: 'ok', detail: details.join('; ') };
  logRecommendedMcpSetup();
  return { label, status: 'skip', detail: details.join('; ') || 'no provider adapter' };
}

/**
 * Is code-vs-contract API conformance relevant here (API contract + real source)
 * yet still switched off? `setup` only *recommends* enabling it — never flips it
 * silently on a fresh project — and points at the one-command enabler (P1-5).
 */
function conformanceOffButRelevant(cwd: string): boolean {
  if (!existsSync(join(cwd, 'contracts', 'api', 'api-contract.md'))) return false;
  try {
    if (detectStack(cwd).primary === 'unknown') return false;
  } catch {
    return false;
  }
  const confPath = join(cwd, '.cdd', 'conformance.json');
  if (!existsSync(confPath)) return true;
  try {
    return JSON.parse(readFileSync(confPath, 'utf8')).enabled !== true;
  } catch {
    return false; // malformed config is doctor's problem to report, not setup's
  }
}

/** Echo one summary row through the logger so it carries the right colour/icon. */
function printSummaryRow(r: StepResult): void {
  const text = r.detail ? `${r.label} — ${r.detail}` : r.label;
  if (r.status === 'ok') log.ok(text);
  else if (r.status === 'warn') log.warn(text);
  else if (r.status === 'fail') log.error(text);
  else log.dim(text);
}

export async function setup(opts: SetupOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const results: StepResult[] = [];

  // `.cdd/` is written by `init` and never by the user, so its presence is the
  // signal that this repo has already been initialised — fresh vs upgrade.
  const initialized = existsSync(join(cwd, '.cdd'));
  const mode: 'fresh' | 'upgrade' = initialized ? 'upgrade' : 'fresh';
  const provider: Provider = opts.provider ?? (mode === 'fresh' ? 'claude' : inferProvider(cwd, 'auto'));
  const wantsClaude = provider !== 'codex';

  log.blank();
  log.info(`cdd-kit setup — one-command ${mode} (idempotent; safe to re-run)`);
  log.dim(initialized
    ? '  detected an existing cdd-kit project (.cdd/ present) → upgrading'
    : '  no .cdd/ found → fresh install');
  log.blank();

  // ── 1. Scaffold project + global assets ──────────────────────────────────
  log.info('[1/6] scaffold project + global assets');
  try {
    if (mode === 'fresh') {
      const { init } = await import('./init.js');
      // arm:false — setup owns arming uniformly in step 3 so the fresh and
      // upgrade paths converge on the same chokepoint state.
      await init({ globalOnly: false, localOnly: false, force: !!opts.force, provider, hooks: false, arm: false });
    } else {
      const { refresh } = await import('./refresh.js');
      await refresh({ yes: true, provider });
    }
    results.push({ label: `Scaffold (${mode})`, status: 'ok' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`scaffold failed: ${msg}`);
    results.push({ label: `Scaffold (${mode})`, status: 'fail', detail: msg });
  }
  log.blank();

  // ── 2. Detect tech stack ─────────────────────────────────────────────────
  log.info('[2/6] detect tech stack');
  try {
    const det = detectStack(cwd);
    if (det.primary === 'unknown') {
      log.warn('could not detect a tech stack — CI placeholder left in place');
      results.push({ label: 'Detect stack', status: 'warn', detail: 'unknown' });
    } else {
      log.ok(`detected stack: ${det.primary}${det.polyglot ? ' (polyglot)' : ''}`);
      results.push({ label: 'Detect stack', status: 'ok', detail: det.primary });
    }
  } catch (err) {
    results.push({ label: 'Detect stack', status: 'warn', detail: err instanceof Error ? err.message : String(err) });
  }
  log.blank();

  // ── 3. Arm enforcement chokepoints ───────────────────────────────────────
  log.info('[3/6] arm enforcement chokepoints (pre-commit gate + agent hooks)');
  if (opts.noArm) {
    log.dim('  skipped (--no-arm)');
    results.push({ label: 'Pre-commit gate', status: 'skip', detail: '--no-arm' });
    results.push({ label: 'Agent hooks', status: 'skip', detail: '--no-arm' });
  } else {
    // Pre-commit gate. fromInit:true makes a missing .git a soft warn+return
    // rather than a process.exit, so setup never aborts here.
    try {
      const { installHooks } = await import('./install-hooks.js');
      const hookResult = await installHooks({ fromInit: true });
      if (hookResult.status === 'installed') {
        results.push({ label: 'Pre-commit gate', status: 'ok' });
      } else {
        // Soft-skipped (e.g. not a git repo yet) — do NOT report success, or the
        // user believes local gate enforcement is active when no hook was written.
        results.push({ label: 'Pre-commit gate', status: 'warn', detail: `not armed — ${hookResult.reason}` });
      }
    } catch (err) {
      log.warn(`  pre-commit gate not armed: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ label: 'Pre-commit gate', status: 'warn', detail: 'not armed' });
    }

    // Agent PreToolUse hooks (Claude only): graph-first + test-runner, both
    // advisory so they steer without blocking a non-engineer.
    if (wantsClaude) {
      try {
        const { installAgentHooks } = await import('./install-agent-hooks.js');
        await installAgentHooks({ graphFirst: 'advisory', testRunner: 'advisory', fromInit: true });
        results.push({ label: 'Agent hooks (graph-first + test-runner, advisory)', status: 'ok' });
      } catch (err) {
        log.warn(`  agent hooks not armed: ${err instanceof Error ? err.message : String(err)}`);
        results.push({ label: 'Agent hooks', status: 'warn', detail: 'not armed' });
      }
    } else {
      log.dim('  agent hooks skipped (codex provider has no .claude/ harness)');
      results.push({ label: 'Agent hooks', status: 'skip', detail: 'codex provider' });
    }
  }
  log.blank();

  // ── 4. Register MCP server (best-effort) ─────────────────────────────────
  log.info('[4/6] register cdd-kit MCP server');
  if (opts.noMcp) {
    log.dim('  skipped (--no-mcp)');
    results.push({ label: 'MCP server registration', status: 'skip', detail: '--no-mcp' });
  } else {
    results.push(registerMcp(provider));
  }
  log.blank();

  // ── 5. context-scan ──────────────────────────────────────────────────────
  log.info('[5/6] scan project context (specs/context/project-map.md)');
  try {
    const { contextScan } = await import('./context-scan.js');
    await contextScan({});
    results.push({ label: 'Context scan', status: 'ok' });
  } catch (err) {
    log.warn(`  context-scan skipped: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ label: 'Context scan', status: 'warn', detail: 'skipped' });
  }
  log.blank();

  // ── 6. code-map ──────────────────────────────────────────────────────────
  log.info('[6/6] build code map (.cdd/code-map.yml)');
  try {
    const { codeMap } = await import('./code-map.js');
    const exit = await codeMap({ path: '.', out: '.cdd/code-map.yml', include: [], exclude: [], check: false, maxLines: 600 });
    if (exit === 0) {
      results.push({ label: 'Code map', status: 'ok' });
    } else {
      log.warn(`  code-map returned a non-zero status (${exit})`);
      results.push({ label: 'Code map', status: 'warn', detail: `exit ${exit}` });
    }
  } catch (err) {
    log.warn(`  code-map skipped: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ label: 'Code map', status: 'warn', detail: 'skipped' });
  }
  log.blank();

  // ── Summary + next step ──────────────────────────────────────────────────
  log.info('Setup summary:');
  for (const r of results) printSummaryRow(r);
  log.blank();

  const failed = results.some(r => r.status === 'fail');
  if (failed) {
    log.error('Setup did not complete cleanly — see the failed step(s) above.');
    log.blank();
    process.exit(1);
  }

  log.ok('Setup complete.');
  log.info('Next: open Claude Code in this repo and run `/cdd-new <describe your change>` to start your first task.');
  log.dim('  e.g.  /cdd-new add JWT authentication to the login API');
  if (conformanceOffButRelevant(cwd)) {
    log.dim('  Tip: this repo has an API contract + code — enable drift detection with `cdd-kit doctor --fix`.');
  }
  log.dim('  Advanced: cdd-kit doctor (health), cdd-kit refresh (re-sync), cdd-kit gate <id> (quality gate).');
  log.blank();
}
