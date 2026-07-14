import { readFileSync } from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';
import { init }      from '../commands/init.js';
import { update }    from '../commands/update.js';
import { newChange } from '../commands/new-change.js';
import { validate }  from '../commands/validate.js';
import { gate } from '../commands/gate.js';
import { installHooks } from '../commands/install-hooks.js';
import { installAgentHooks } from '../commands/install-agent-hooks.js';
import { openapiExport } from '../commands/openapi-export.js';
import { DEFAULT_CONTRACT_PATH, DEFAULT_INVENTORY_PATH } from '../contracts/parser.js';
import { detectStack } from '../utils/stack-detect.js';
import { log } from '../utils/logger.js';
import type { ProviderOption } from '../utils/provider.js';
import type { WorkflowProfile } from '../runtime/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };

const program = new Command();

program
  .name('cdd-kit')
  .description('Contract-Driven Delivery Kit CLI')
  .version(pkg.version);

// ── cdd init ──────────────────────────────────────────────────────────────────
program
  .command('init')
  .description(
    'Install agents/skill into ~/.claude and scaffold project files in cwd',
  )
  .option('--global-only', 'Only install into ~/.claude, skip project files', false)
  .option('--local-only',  'Only scaffold project files, skip ~/.claude',    false)
  .option('--force',       'Overwrite existing project files',               false)
  .option('--provider <provider>', 'Provider adapter to scaffold: claude, codex, or both', 'claude')
  .option('--hooks', 'Also install the pre-commit hook that auto-regenerates .cdd/code-map.yml', false)
  .option('--no-arm', 'Skip arming enforcement chokepoints (graph-first hook + pre-commit gate)')
  .option('--no-test-runner', 'When arming agent hooks, skip the advisory test-runner hook (graph-first still armed)')
  .action((opts) =>
    init({
      globalOnly: opts.globalOnly,
      localOnly:  opts.localOnly,
      force:      opts.force,
      provider:   opts.provider,
      hooks:      opts.hooks,
      arm:        opts.arm !== false,
      testRunner: opts.testRunner !== false,
    }),
  );

// ── cdd setup ─────────────────────────────────────────────────────────────────
// One command from zero to a fully wired, enforcement-armed project. Detects
// fresh vs upgrade, scaffolds, arms chokepoints, registers MCP (best-effort),
// builds context indexes, and prints a per-step summary. See setup.ts.
program
  .command('setup')
  .description('One-command onboarding: scaffold, arm chokepoints, register MCP, and build context indexes (idempotent; fresh or upgrade)')
  .option('--provider <provider>', 'Provider adapter: claude, codex, or both (default: claude for fresh, detected for upgrade)')
  .option('--force', 'Fresh install only: overwrite existing project files', false)
  .option('--no-arm', 'Skip arming the pre-commit gate and agent hooks')
  .option('--no-mcp', 'Skip the best-effort `claude mcp add` MCP registration')
  .action(async (opts: { provider?: ProviderOption; force?: boolean; arm?: boolean; mcp?: boolean }) => {
    if (opts.provider !== undefined && !['claude', 'codex', 'both'].includes(opts.provider)) {
      console.error(`Invalid provider: ${opts.provider}. Use claude, codex, or both.`);
      process.exit(1);
    }
    const { setup } = await import('../commands/setup.js');
    await setup({
      provider: opts.provider as 'claude' | 'codex' | 'both' | undefined,
      force: opts.force,
      noArm: opts.arm === false,
      noMcp: opts.mcp === false,
    });
  });

// ── cdd update ────────────────────────────────────────────────────────────────
program
  .command('update')
  .description('Update provider assets for the current project (does not overwrite project guidance files)')
  .option('--yes', 'Apply changes (default is dry-run)', false)
  .option('--provider <provider>', 'Provider adapter to update: auto, claude, codex, or both', 'auto')
  .option('--postinstall', 'Internal: invoked by npm postinstall; no-op if cdd has not been init-ed', false)
  .action((opts) => update({ yes: opts.yes, provider: opts.provider, postinstall: opts.postinstall }));

// ── cdd refresh ───────────────────────────────────────────────────────────────
// One-shot complete upgrade. Composes update + upgrade + force-refresh of
// kit-shipped templates with backup. See src/commands/refresh.ts for the
// full boundary list.
program
  .command('refresh')
  .description('Complete upgrade: refresh agents, skills, templates, hooks, model-policy, and code-map in one command')
  .option('--yes', 'Apply changes (default is dry-run)', false)
  .option('--no-templates', 'Skip force-refresh of specs/templates, tests/templates, ci-templates, .github/workflows')
  .option('--no-hooks', 'Skip pre-commit hook re-installation')
  .option('--no-code-map', 'Skip code-map regeneration')
  .option('--no-update', 'Skip ~/.claude update step')
  .option('--no-upgrade', 'Skip project add-missing step')
  .option('--provider <provider>', 'Provider adapter: auto, claude, codex, or both', 'auto')
  .action(async (opts: {
    yes?: boolean;
    templates?: boolean;
    hooks?: boolean;
    codeMap?: boolean;
    update?: boolean;
    upgrade?: boolean;
    provider?: ProviderOption;
  }) => {
    // Commander represents `--no-X` as `opts.X === false`. Normalise to our flags.
    const { refresh } = await import('../commands/refresh.js');
    await refresh({
      yes: opts.yes,
      noTemplates: opts.templates === false,
      noHooks: opts.hooks === false,
      noCodeMap: opts.codeMap === false,
      noUpdate: opts.update === false,
      noUpgrade: opts.upgrade === false,
      provider: opts.provider,
    });
  });

program
  .command('doctor')
  .description('Inspect cdd-kit repo health, provider guidance, and context index freshness')
  .option('--strict', 'Treat warnings as errors', false)
  .option('--json', 'Print a machine-readable health report', false)
  .option('--simple', 'Plain-language ✅/⚠️ summary with a single next step (for non-engineers)', false)
  .option('--provider <provider>', 'Provider adapter to inspect: auto, claude, codex, or both', 'auto')
  .option('--fix', 'Auto-resolve safe warnings (stale context indexes, missing role bindings, API conformance)', false)
  .action(async (opts: { strict?: boolean; json?: boolean; simple?: boolean; provider?: ProviderOption; fix?: boolean }) => {
    const { doctor } = await import('../commands/doctor.js');
    await doctor({ strict: opts.strict, json: opts.json, simple: opts.simple, provider: opts.provider, fix: opts.fix });
  });

program
  .command('upgrade')
  .description('Add missing cdd-kit repo-level files without overwriting existing project files')
  .option('--yes', 'Apply changes (default is dry-run)', false)
  .option('--migrate-changes', 'Also migrate existing specs/changes/* directories', false)
  .option('--enable-context-governance', 'When migrating changes, opt them into context-governance: v1', false)
  .option('--provider <provider>', 'Provider adapter to scaffold: auto, claude, codex, or both', 'auto')
  .action(async (opts: { yes?: boolean; migrateChanges?: boolean; enableContextGovernance?: boolean; provider?: ProviderOption }) => {
    const { upgrade } = await import('../commands/upgrade.js');
    await upgrade({
      yes: opts.yes,
      migrateChanges: opts.migrateChanges,
      enableContextGovernance: opts.enableContextGovernance,
      provider: opts.provider,
    });
  });

// ── cdd new <name> ────────────────────────────────────────────────────────────
program
  .command('new <name>')
  .description('Scaffold a new change directory under specs/changes/<name>')
  .option('--all', 'Include optional templates in addition to required ones', false)
  .option('--force', 'Overwrite existing template files in the change folder', false)
  .option('--depends-on <change-ids>', 'Comma-separated upstream change ids that must complete first')
  .option('--skip-scan', 'Skip the auto context-scan when indexes are stale (advanced)', false)
  .action((name: string, opts) =>
    newChange(name, { all: opts.all, force: opts.force, dependsOn: opts.dependsOn, skipScan: opts.skipScan }),
  );

// ── cdd validate ──────────────────────────────────────────────────────────────
program
  .command('validate')
  .description('Run validation scripts (defaults to all)')
  .option('--contracts', 'Validate API/data/CSS contracts (use --env separately for env)', false)
  .option('--env',       'Validate env contract',               false)
  .option('--ci',        'Validate CI gate policy',             false)
  .option('--spec',      'Validate spec traceability',          false)
  .option('--versions',  'Validate contract frontmatter and version bumps', false)
  .action((opts) =>
    validate({
      contracts: opts.contracts,
      env:       opts.env,
      ci:        opts.ci,
      spec:      opts.spec,
      versions:  opts.versions,
    }),
  );

// ── cdd boundary ─────────────────────────────────────────────────────────────
const boundary = program.command('boundary').description('Inspect and enforce API/data-shape boundary coverage');

boundary
  .command('init')
  .description('Generate a fail-closed Boundary Guard manifest scaffold from the canonical API contract')
  .option('--contract <path>', 'Canonical API contract path', DEFAULT_CONTRACT_PATH)
  .option('--out <path>', 'Boundary manifest output path', '.cdd/boundary-manifest.yml')
  .option('--force', 'Replace an existing generated scaffold', false)
  .action(async (opts: { contract?: string; out?: string; force?: boolean }) => {
    const { boundaryInit } = await import('../commands/boundary.js');
    process.exitCode = boundaryInit(opts);
  });

boundary
  .command('check')
  .description('Run changed-operation and non-vacuous Boundary Guard checks')
  .option('--contract <path>', 'Canonical API contract path', DEFAULT_CONTRACT_PATH)
  .option('--policy <path>', 'CDD project policy path', '.cdd/policy.yml')
  .option('--manifest <path>', 'Boundary manifest path', '.cdd/boundary-manifest.yml')
  .option('--base <revision>', 'Git base revision for changed-operation detection')
  .option('--head <revision>', 'Git head revision', 'HEAD')
  .option('--all', 'Check every contracted operation', false)
  .option('--operation <method-path...>', 'Check one or more explicit operations, e.g. "GET /health"')
  .option('--verify-generated', 'Replay registered generators and compare their output with committed artifacts', false)
  .option('--verify-captures', 'Replay registered framework adapters and compare observed serialized boundaries', false)
  .option('--enforce', 'Fail on any error-level finding even under .cdd/policy.yml shadow_mode', false)
  .option('--json', 'Emit machine-readable Boundary Guard result', false)
  .action(async (opts: { contract?: string; policy?: string; manifest?: string; base?: string; head?: string; all?: boolean; operation?: string[]; verifyGenerated?: boolean; verifyCaptures?: boolean; enforce?: boolean; json?: boolean }) => {
    const { boundaryCheck } = await import('../commands/boundary.js');
    process.exitCode = boundaryCheck({ ...opts, operations: opts.operation });
  });
boundary.command('capture <operation>')
  .description('Run configured framework-test-client capture adapters and refresh digest provenance')
  .option('--variant <id>', 'Capture one variant; defaults to all required variants')
  .option('--manifest <path>', 'Boundary manifest path', '.cdd/boundary-manifest.yml')
  .option('--timeout <ms>', 'Per-capture timeout', '300000')
  .option('--verify', 'Replay the registered adapter and compare with the committed capture/provenance', false)
  .option('--json', 'Emit JSON', false)
  .action(async (operation: string, opts: { variant?: string; manifest?: string; timeout?: string; verify?: boolean; json?: boolean }) => {
    const { boundaryCapture } = await import('../commands/boundary.js');
    process.exitCode = boundaryCapture({ operation, variant: opts.variant, manifest: opts.manifest, timeout: Number(opts.timeout), verify: opts.verify, json: opts.json });
  });

// ── cdd work/runtime ─────────────────────────────────────────────────────────
program
  .command('work <change-id> <objective...>')
  .description('Create a deterministic profile, execution capsule, and resumable runtime plan')
  .option('--provider <provider>', 'Execution provider: claude, codex, or both')
  .option('--profile <profile>', 'Minimum requested profile: lightweight, balanced, controlled, or strict')
  .option('--require-acceptance', 'Add the human-authored acceptance oracle to required runtime evidence', false)
  .option('--base <revision>', 'Git base revision for impact detection')
  .option('--json', 'Emit runtime state as JSON', false)
  .action(async (changeId: string, objective: string[], opts: { provider?: string; profile?: string; base?: string; requireAcceptance?: boolean; json?: boolean }) => {
    if (opts.provider && !['claude', 'codex', 'both'].includes(opts.provider)) {
      console.error(`Invalid provider: ${opts.provider}`); process.exitCode = 2; return;
    }
    if (opts.profile && !['lightweight', 'balanced', 'controlled', 'strict'].includes(opts.profile)) {
      console.error(`Invalid profile: ${opts.profile}`); process.exitCode = 2; return;
    }
    const { runtimePlan } = await import('../commands/runtime.js');
    process.exitCode = runtimePlan({ changeId, objective: objective.join(' '), provider: opts.provider as any, profile: opts.profile as any, base: opts.base, requireAcceptance: opts.requireAcceptance, json: opts.json });
  });

const runtime = program.command('runtime').description('Inspect, resume, and verify agent-native runtime runs');
runtime.command('status [run-id]').option('--json', 'Emit JSON', false).action(async (runId: string | undefined, opts: { json?: boolean }) => {
  const { runtimeShow } = await import('../commands/runtime.js'); process.exitCode = runtimeShow({ runId, json: opts.json });
});
runtime.command('resume [run-id]').option('--json', 'Emit JSON', false).action(async (runId: string | undefined, opts: { json?: boolean }) => {
  const { runtimeResume } = await import('../commands/runtime.js'); process.exitCode = runtimeResume({ runId, json: opts.json });
});
runtime.command('verify [run-id]').option('--json', 'Emit JSON', false).action(async (runId: string | undefined, opts: { json?: boolean }) => {
  const { runtimeVerify } = await import('../commands/runtime.js'); process.exitCode = runtimeVerify({ runId, json: opts.json });
});
runtime.command('parity [run-id]').description('Dual-run runtime verification and the strict compatibility gate')
  .option('--mutations <path>', 'Mutation detection matrix JSON for category-level parity')
  .option('--json', 'Emit JSON', false).action(async (runId: string | undefined, opts: { mutations?: string; json?: boolean }) => {
    const { runtimeParity } = await import('../commands/runtime.js'); process.exitCode = runtimeParity({ runId, mutations: opts.mutations, json: opts.json });
  });
runtime.command('review [run-id]')
  .requiredOption('--verdict <verdict>', 'Review verdict: passed or failed')
  .requiredOption('--actor <actor>', 'Reviewer identity')
  .requiredOption('--summary <summary>', 'Review rationale (at least 10 characters)')
  .option('--json', 'Emit JSON', false)
  .action(async (runId: string | undefined, opts: { verdict: string; actor: string; summary: string; json?: boolean }) => {
    if (!['passed', 'failed'].includes(opts.verdict)) {
      console.error(`Invalid review verdict: ${opts.verdict}. Use passed or failed.`); process.exitCode = 2; return;
    }
    const { runtimeReview } = await import('../commands/runtime.js');
    process.exitCode = runtimeReview({ runId, actor: opts.actor, summary: opts.summary, verdict: opts.verdict as 'passed' | 'failed', json: opts.json });
  });
const runtimeApproval = runtime.command('approval').description('Import externally signed high-risk approval decisions');
runtimeApproval.command('import <file> [run-id]')
  .option('--json', 'Emit JSON', false)
  .action(async (file: string, runId: string | undefined, opts: { json?: boolean }) => {
    const { runtimeApprovalImport } = await import('../commands/runtime.js');
    process.exitCode = runtimeApprovalImport({ runId, file, json: opts.json });
  });
const runtimeAgent = runtime.command('agent').description('Build and record doctrine-selected dynamic agent work');
runtimeAgent.command('prompt [run-id]')
  .option('--role <role>', 'Agent role: implementer or reviewer', 'implementer')
  .option('--json', 'Emit prompt envelope as JSON', false)
  .action(async (runId: string | undefined, opts: { role: string; json?: boolean }) => {
    if (!['implementer', 'reviewer'].includes(opts.role)) {
      console.error(`Invalid agent role: ${opts.role}. Use implementer or reviewer.`); process.exitCode = 2; return;
    }
    const { runtimeAgentPrompt } = await import('../commands/runtime.js');
    process.exitCode = runtimeAgentPrompt({ runId, role: opts.role as 'implementer' | 'reviewer', json: opts.json });
  });
runtimeAgent.command('complete [run-id]')
  .requiredOption('--status <status>', 'Result: passed, failed, or blocked')
  .requiredOption('--actor <actor>', 'Agent identity')
  .requiredOption('--summary <summary>', 'Result summary (at least 10 characters)')
  .option('--file <paths...>', 'Files changed by the agent', [])
  .option('--json', 'Emit JSON', false)
  .action(async (runId: string | undefined, opts: { status: string; actor: string; summary: string; file?: string[]; json?: boolean }) => {
    if (!['passed', 'failed', 'blocked'].includes(opts.status)) {
      console.error(`Invalid agent status: ${opts.status}. Use passed, failed, or blocked.`); process.exitCode = 2; return;
    }
    const { runtimeAgentComplete } = await import('../commands/runtime.js');
    process.exitCode = runtimeAgentComplete({
      runId, actor: opts.actor, summary: opts.summary, status: opts.status as 'passed' | 'failed' | 'blocked', files: opts.file ?? [], json: opts.json,
    });
  });
const runtimeCheck = runtime.command('check').description('Plan and execute runtime-native test/quality evidence');
runtimeCheck.command('plan [run-id]').option('--json', 'Emit JSON', false).action(async (runId: string | undefined, opts: { json?: boolean }) => {
  const { runtimeChecksPlan } = await import('../commands/runtime.js'); process.exitCode = runtimeChecksPlan({ runId, json: opts.json });
});
runtimeCheck.command('run [run-id]')
  .option('--check <id>', 'Run one check id from the capsule')
  .option('--all', 'Run every selected check in order', false)
  .option('--timeout <ms>', 'Per-check timeout', '300000')
  .option('--json', 'Emit JSON', false)
  .action(async (runId: string | undefined, opts: { check?: string; all?: boolean; timeout?: string; json?: boolean }) => {
    const { runtimeChecksRun } = await import('../commands/runtime.js');
    process.exitCode = runtimeChecksRun({ runId, check: opts.check, all: opts.all, timeout: Number(opts.timeout), json: opts.json });
  });
runtime.command('migrate')
  .description('Dry-run or apply the reversible project/user migration to the agent-native runtime')
  .option('--yes', 'Apply missing project assets and provider updates', false)
  .option('--provider <provider>', 'Provider: auto, claude, codex, or both', 'auto')
  .option('--import-active', 'Import active legacy changes as strict runtime capsules without rewriting them', false)
  .option('--json', 'Emit JSON', false)
  .action(async (opts: { yes?: boolean; provider?: ProviderOption; importActive?: boolean; json?: boolean }) => {
    const { agentNativeMigrate } = await import('../commands/agent-native-migrate.js');
    process.exitCode = await agentNativeMigrate(opts);
  });

const policyCommand = program.command('policy').description('Validate agent-native project policy and compatibility invariants');
policyCommand.command('check')
  .option('--path <path>', 'Policy path', '.cdd/policy.yml')
  .option('--json', 'Emit JSON', false)
  .action(async (opts: { path?: string; json?: boolean }) => {
    const { policyCheck } = await import('../commands/policy.js');
    process.exitCode = policyCheck(opts);
  });

const guidance = program.command('guidance').description('Measure and safely migrate recurring provider guidance');
guidance.command('audit').option('--json', 'Emit JSON', false).action(async (opts: { json?: boolean }) => {
  const { guidanceAuditCommand } = await import('../commands/guidance.js'); process.exitCode = guidanceAuditCommand(opts);
});
guidance.command('migrate')
  .option('--apply', 'Write migration proposals and audit record', false)
  .option('--replace', 'Replace project guidance after creating rollback copies', false)
  .option('--json', 'Emit JSON', false)
  .action(async (opts: { apply?: boolean; replace?: boolean; json?: boolean }) => {
    const { guidanceMigrateCommand } = await import('../commands/guidance.js'); process.exitCode = guidanceMigrateCommand(opts);
  });

// ── cdd lint-agents ───────────────────────────────────────────────────────────
program
  .command('lint-agents')
  .description('Lint .claude/agents/*.md for required-artifacts format and read-scope hygiene')
  .option('--strict', 'Fail on warnings (e.g. missing protocol pointer)', false)
  .action(async (opts: { strict?: boolean }) => {
    const { lintAgents } = await import('../commands/lint-agents.js');
    const exitCode = await lintAgents({ strict: opts.strict });
    process.exit(exitCode);
  });

// ── cdd code-map [path] ───────────────────────────────────────────────────────
function collectRepeatable(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

interface CodeMapCliOpts {
  out?: string;
  surface?: string;
  workers?: string | boolean;
  include: string[];
  exclude: string[];
  check: boolean;
  maxLines: string;
}

/** Resolve `--workers [n]` into a worker count (0 = disabled). */
function resolveWorkers(value: string | boolean | undefined): number {
  if (value === undefined) return 0;
  const cpus = Math.max(1, (os.cpus()?.length ?? 2) - 1);
  if (value === true) return Math.min(cpus, 16);
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 16);
}

program
  .command('code-map [path]')
  .description('Scan source files and emit a structural index at .cdd/code-map.yml')
  .option('--out <path>', 'Output YAML path (default .cdd/code-map.yml; with --surface, .cdd/code-map.<surface>.yml)')
  .option('--surface <subpath>', 'Scope the scan to a monorepo subtree and name the map after it')
  .option('--workers [n]', 'Parallelize JS/TS/Vue scanning across N child processes (default: CPU count - 1)')
  .option('--include <glob>', 'Additional include glob (repeatable)', collectRepeatable, [])
  .option('--exclude <glob>', 'Additional exclude glob (repeatable)', collectRepeatable, [])
  .option('--check', 'Exit 1 if regenerating would change the file (no write)', false)
  .option('--watch', 'Keep the map fresh in the background, rebuilding on file changes (debounced)', false)
  .option('--debounce <ms>', 'With --watch: coalesce change bursts within this window (default 500)', '500')
  .option('--max-lines <n>', 'Warn for files exceeding this line count (default 100000)', '100000')
  .action(async (path: string | undefined, opts: CodeMapCliOpts & { watch?: boolean; debounce?: string }) => {
    if (opts.watch) {
      const { codeMapWatch } = await import('../commands/code-map-watch.js');
      // Own process-signal wiring here, at the top level, and hand the watcher a
      // plain AbortSignal — so the library function stays composable.
      const controller = new AbortController();
      const onSignal = (): void => controller.abort();
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
      const exit = await codeMapWatch({
        path: path ?? '.',
        out: opts.out,
        surface: opts.surface,
        workers: resolveWorkers(opts.workers),
        include: opts.include,
        exclude: opts.exclude,
        maxLines: parseInt(opts.maxLines, 10),
        debounceMs: parseInt(opts.debounce ?? '500', 10),
        signal: controller.signal,
      });
      process.exit(exit);
    }
    const { codeMap } = await import('../commands/code-map.js');
    const exit = await codeMap({
      path: path ?? '.',
      out: opts.out,
      surface: opts.surface,
      workers: resolveWorkers(opts.workers),
      include: opts.include,
      exclude: opts.exclude,
      check: opts.check,
      maxLines: parseInt(opts.maxLines, 10),
    });
    process.exit(exit);
  });

// Hidden worker invoked by `code-map --workers`. Not for direct use.
program
  .command('__code-map-scan', { hidden: true })
  .requiredOption('--lang <lang>', 'js | ts | vue')
  .requiredOption('--batch-file <path>', 'File listing absolute source paths, one per line')
  .requiredOption('--repo-root <path>', 'Repo root the scanned paths are relative to')
  .action(async (opts: { lang: string; batchFile: string; repoRoot: string }) => {
    const { runScanWorker } = await import('../commands/code-map-scan-worker.js');
    const exit = await runScanWorker({ lang: opts.lang, batchFile: opts.batchFile, repoRoot: opts.repoRoot });
    process.exit(exit);
  });

// ── cdd index query <term> ────────────────────────────────────────────────────
const index = program
  .command('index')
  .description('Query machine-readable project indexes before opening source files');

index
  .command('query <term>')
  .description('Search .cdd/code-map.yml for files, symbols, imports, and line ranges')
  .option('--map <path>', 'Code-map YAML path', '.cdd/code-map.yml')
  .option('--limit <n>', 'Maximum result files to print', '10')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--with-source', 'Include the matched source slices inline so no separate Read is needed', false)
  .option('--source-budget <n>', 'Max total source lines to emit with --with-source', '400')
  .option('--no-refresh', 'Do not auto-regenerate stale or missing code-map before querying')
  .action(async (term: string, opts: { map: string; limit: string; json?: boolean; refresh?: boolean; withSource?: boolean; sourceBudget?: string }) => {
    const { indexQuery } = await import('../commands/index-query.js');
    const exit = await indexQuery(term, {
      map: opts.map,
      limit: parseInt(opts.limit, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
      withSource: opts.withSource === true,
      sourceBudget: parseInt(opts.sourceBudget ?? '400', 10),
    });
    process.exit(exit);
  });

index
  .command('impact <path-or-symbol>')
  .description('Show indexed local imports and dependents for a source file')
  .option('--map <path>', 'Code-map YAML path', '.cdd/code-map.yml')
  .option('--limit <n>', 'Maximum dependent files to print', '20')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--no-refresh', 'Do not auto-regenerate stale or missing code-map before querying')
  .action(async (term: string, opts: { map: string; limit: string; json?: boolean; refresh?: boolean }) => {
    const { indexImpact } = await import('../commands/index-impact.js');
    const exit = await indexImpact(term, {
      map: opts.map,
      limit: parseInt(opts.limit, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
    });
    process.exit(exit);
  });

const graph = program
  .command('graph')
  .description('Query native cdd-kit code graph context with optional CodeGraph adapter and code-map fallback');

graph
  .command('status [path]')
  .description('Show active graph engine and index health')
  .option('--engine <engine>', 'Graph engine: auto, native, codegraph, or codemap', 'auto')
  .option('--map <path>', 'Code-map YAML path for fallback status', '.cdd/code-map.yml')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (path: string | undefined, opts: { engine?: 'auto' | 'native' | 'codegraph' | 'codemap'; map?: string; json?: boolean }) => {
    const { graphStatus } = await import('../commands/graph.js');
    const exit = await graphStatus({ path, engine: opts.engine, map: opts.map, json: opts.json === true });
    process.exit(exit);
  });

graph
  .command('sync [path]')
  .description('Run CodeGraph incremental sync (requires CodeGraph)')
  .option('--engine <engine>', 'Graph engine: codegraph', 'codegraph')
  .option('--json', 'Print machine-readable JSON on errors', false)
  .action(async (path: string | undefined, opts: { engine?: 'auto' | 'native' | 'codegraph' | 'codemap'; json?: boolean }) => {
    const { graphSync } = await import('../commands/graph.js');
    const exit = await graphSync({ path, engine: opts.engine, json: opts.json === true });
    process.exit(exit);
  });

graph
  .command('query <term>')
  .description('Search native graph symbols, optionally delegating to CodeGraph or code-map')
  .option('--engine <engine>', 'Graph engine: auto, native, codegraph, or codemap', 'auto')
  .option('--map <path>', 'Code-map YAML path for fallback', '.cdd/code-map.yml')
  .option('--limit <n>', 'Maximum results to print', '10')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--with-source', 'Include matched source slices inline so no separate Read is needed (native/codemap engines)', false)
  .option('--source-budget <n>', 'Max total source lines to emit with --with-source', '400')
  .option('--no-refresh', 'Do not auto-regenerate stale or missing fallback code-map')
  .action(async (term: string, opts: { engine?: 'auto' | 'native' | 'codegraph' | 'codemap'; map?: string; limit: string; json?: boolean; refresh?: boolean; withSource?: boolean; sourceBudget?: string }) => {
    const { graphQuery } = await import('../commands/graph.js');
    const exit = await graphQuery(term, {
      engine: opts.engine,
      map: opts.map,
      limit: parseInt(opts.limit, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
      withSource: opts.withSource === true,
      sourceBudget: parseInt(opts.sourceBudget ?? '400', 10),
    });
    process.exit(exit);
  });

graph
  .command('impact <path-or-symbol>')
  .description('Analyze impact radius with native graph calls/imports, CodeGraph, or code-map fallback')
  .option('--engine <engine>', 'Graph engine: auto, native, codegraph, or codemap', 'auto')
  .option('--map <path>', 'Code-map YAML path for fallback', '.cdd/code-map.yml')
  .option('--limit <n>', 'Maximum fallback dependent files to print', '20')
  .option('--depth <n>', 'CodeGraph traversal depth (fallback is direct only)', '2')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--no-refresh', 'Do not auto-regenerate stale or missing fallback code-map')
  .action(async (term: string, opts: { engine?: 'auto' | 'native' | 'codegraph' | 'codemap'; map?: string; limit: string; depth: string; json?: boolean; refresh?: boolean }) => {
    const { graphImpact } = await import('../commands/graph.js');
    const exit = await graphImpact(term, {
      engine: opts.engine,
      map: opts.map,
      limit: parseInt(opts.limit, 10),
      depth: parseInt(opts.depth, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
    });
    process.exit(exit);
  });

graph
  .command('context <task>')
  .description('Build task context with native graph, CodeGraph, or code-map candidates')
  .option('--engine <engine>', 'Graph engine: auto, native, codegraph, or codemap', 'auto')
  .option('--map <path>', 'Code-map YAML path for fallback', '.cdd/code-map.yml')
  .option('--max-nodes <n>', 'Maximum context candidates/nodes', '20')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--with-source', 'Include matched entry-point source slices inline so no separate Read is needed (native engine)', false)
  .option('--source-budget <n>', 'Max total source lines to emit with --with-source', '400')
  .option('--no-refresh', 'Do not auto-regenerate stale or missing fallback code-map')
  .action(async (task: string, opts: { engine?: 'auto' | 'native' | 'codegraph' | 'codemap'; map?: string; maxNodes: string; json?: boolean; refresh?: boolean; withSource?: boolean; sourceBudget?: string }) => {
    const { graphContext } = await import('../commands/graph.js');
    const exit = await graphContext(task, {
      engine: opts.engine,
      map: opts.map,
      maxNodes: parseInt(opts.maxNodes, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
      withSource: opts.withSource === true,
      sourceBudget: parseInt(opts.sourceBudget ?? '400', 10),
    });
    process.exit(exit);
  });

graph
  .command('unresolved [path-or-symbol]')
  .description('List references the graph could not resolve (external/dynamic/DI calls, ambiguous names) — the blast radius impact analysis silently drops')
  .option('--engine <engine>', 'Graph engine: auto or native (unresolved data lives in the native index)', 'auto')
  .option('--map <path>', 'Code-map YAML path', '.cdd/code-map.yml')
  .option('--kind <kind>', 'Filter by reference kind: calls, extends, implements, references, or imports')
  .option('--limit <n>', 'Maximum unresolved references to print', '50')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--no-refresh', 'Do not auto-regenerate stale or missing code-map/graph')
  .action(async (term: string | undefined, opts: { engine?: 'auto' | 'native' | 'codegraph' | 'codemap'; map?: string; kind?: string; limit: string; json?: boolean; refresh?: boolean }) => {
    const { graphUnresolved } = await import('../commands/graph.js');
    const exit = await graphUnresolved(term, {
      engine: opts.engine,
      map: opts.map,
      kind: opts.kind,
      limit: parseInt(opts.limit, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
    });
    process.exit(exit);
  });

// ── cdd classify-check [change-id] ────────────────────────────────────────────
program
  .command('classify-check [change-id]')
  .description('Show the mechanical risk-tier floor for a change before classification (advisory; gate enforces it)')
  .option('--text <text>', 'Scan this inline intent text instead of a change directory')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string | undefined, opts: { text?: string; json?: boolean }) => {
    const { classifyCheck } = await import('../commands/classify-check.js');
    const exit = await classifyCheck(changeId, { text: opts.text, json: opts.json });
    process.exit(exit);
  });

// ── cdd manifest <change-id> ──────────────────────────────────────────────────
program
  .command('manifest <change-id>')
  .description('Auto-generate a minimal context-manifest.md for a low-risk tier 4-5 micro-change (Allowed Paths = change dir + touched files)')
  .option('--force', 'Overwrite an existing context-manifest.md', false)
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string, opts: { force?: boolean; json?: boolean }) => {
    const { manifest } = await import('../commands/manifest.js');
    process.exit(manifest(changeId, { force: opts.force, json: opts.json }));
  });

// ── cdd gate <change-id> ──────────────────────────────────────────────────────
program
  .command('mcp')
  .description('Run the cdd-kit MCP stdio server exposing graph and code-map tools')
  .action(async () => {
    const { runMcpServer } = await import('../mcp/server.js');
    await runMcpServer({ version: pkg.version });
  });

program
  .command('gate <change-id>')
  .description('Run delivery-quality gate for a change (required artifacts, tasks, tier, contracts)')
  .option('--strict', 'Treat pending tasks (except section 7) as errors', false)
  .option('--profile <profile>', 'Agent-native profile: lightweight, balanced, controlled, or strict')
  .option('--require-acceptance', 'Require the human-authored acceptance oracle for this invocation', false)
  .option('--run-id <run-id>', 'Use a specific runtime run; otherwise the newest valid run for this change is selected')
  .option('--explain', 'On failure, add a plain-language reason and a "say this to Claude" hint for each problem', false)
  .action(async (id: string, opts: { strict?: boolean; profile?: string; requireAcceptance?: boolean; runId?: string; explain?: boolean }) => {
    if (opts.profile && !['lightweight', 'balanced', 'controlled', 'strict'].includes(opts.profile)) {
      console.error(`Invalid profile: ${opts.profile}`); process.exitCode = 2; return;
    }
    await gate(id, { strict: opts.strict, profile: opts.profile as WorkflowProfile | undefined, requireAcceptance: opts.requireAcceptance, runId: opts.runId, explain: opts.explain });
  });

// ── cdd archive <change-id> ───────────────────────────────────────────────────
program
  .command('archive <change-id>')
  .description('Move a completed change from specs/changes/ to specs/archive/<year>/')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string, opts: { json?: boolean }) => {
    const { archive } = await import('../commands/archive.js');
    await archive(changeId, opts);
  });

// ── cdd abandon <change-id> ───────────────────────────────────────────────────
program
  .command('abandon <change-id>')
  .description('Mark a change as abandoned (updates tasks.yml status, records in INDEX.md)')
  .option('--reason <text>', 'reason for abandonment (required)')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string, opts: { reason?: string; json?: boolean }) => {
    const { abandon } = await import('../commands/abandon.js');
    const result = await abandon(changeId, { reason: opts.reason });

    if (result.status === 'error') {
      if (opts.json) {
        console.log(JSON.stringify({ changeId, error: result.message }, null, 2));
      } else {
        log.error(result.message);
      }
      process.exit(1);
    }

    // Print what actually happened — never a fixed success sentence — so a
    // freshly-created tasks.yml is distinguishable from an updated one.
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    log.ok(result.tasksFileCreated
      ? `Change ${changeId} marked as abandoned (created tasks.yml — none existed).`
      : `Change ${changeId} marked as abandoned (tasks.yml updated).`);
    log.info(`specs/changes/${changeId}/ remains on disk (git history preserved).`);
    log.info(`Run \`cdd-kit archive ${changeId}\` to physically move it, or leave it for git history.`);
  });

// ── cdd migrate ───────────────────────────────────────────────────────────────
program
  .command('migrate [change-id]')
  .description('Upgrade existing change directories to the current cdd-kit YAML format (tasks.yml + agent-log/*.yml)')
  .option('--all', 'Migrate all changes in specs/changes/', false)
  .option('--dry-run', 'Show what would change without writing files', false)
  .option('--enable-context-governance', 'Opt legacy changes into context-governance: v1 hard gate behavior', false)
  .option('--no-backup', 'Skip the per-session backup at .cdd/migrate-backup/<stamp>/ (not recommended)')
  .action(async (changeId?: string, opts: { all?: boolean; dryRun?: boolean; enableContextGovernance?: boolean; backup?: boolean } = {}) => {
    const { migrate } = await import('../commands/migrate.js');
    await migrate(changeId, {
      all: opts.all,
      dryRun: opts.dryRun,
      enableContextGovernance: opts.enableContextGovernance,
      noBackup: opts.backup === false,
    });
  });

// ── cdd list ──────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List active changes in specs/changes/')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (opts: { json?: boolean }) => {
    const { listChanges } = await import('../commands/list-changes.js');
    await listChanges(opts.json);
  });

// ── cdd metadata ──────────────────────────────────────────────────────────────
program
  .command('metadata [change-id]')
  .description('Generate machine-readable change.yml + trace.yml from a change\'s artifacts (a derived index for agents/MCP; never authoritative for the gate)')
  .option('--check', 'Exit 1 if regenerating would change the files (no write)', false)
  .option('--all', 'Process every active (in-progress) change', false)
  .option('--json', 'Print a machine-readable result', false)
  .action(async (changeId: string | undefined, opts: { check?: boolean; all?: boolean; json?: boolean }) => {
    const { metadata } = await import('../commands/metadata.js');
    await metadata(changeId, opts);
  });

// ── cdd install-hooks ─────────────────────────────────────────────────────────
program
  .command('install-hooks')
  .description('Install pre-commit hook that runs cdd-kit gate on staged changes')
  .action(async () => { await installHooks(); });

// ── cdd install-agent-hooks ───────────────────────────────────────────────────
program
  .command('install-agent-hooks')
  .description('Install Claude Code agent hooks into .claude/settings.json (graph-first exploration; contract-write routing; test-runner ladder; acceptance-write block; design-write block)')
  .option('--graph-first <mode>', "Arm the graph-first PreToolUse hook: 'advisory' or 'strict' (default when no hook flag is given)")
  .option('--contract-write <mode>', "Arm the contract-write PreToolUse hook (ADR 0004 §6): 'advisory' or 'strict'")
  .option('--test-runner <mode>', "Arm the test-runner PreToolUse hook (ADR 0005 §10): 'advisory' or 'strict'")
  .option('--acceptance-write <mode>', "Arm the acceptance-write PreToolUse hook (ADR 0010 §3.2): 'advisory' or 'strict'")
  .option('--design-write <mode>', "Arm the design-write PreToolUse hook (ADR 0012 §5): 'advisory' or 'strict'")
  .action(async (opts: { graphFirst?: string; contractWrite?: string; testRunner?: string; acceptanceWrite?: string; designWrite?: string }) => {
    await installAgentHooks({
      graphFirst: opts.graphFirst as 'advisory' | 'strict' | undefined,
      contractWrite: opts.contractWrite as 'advisory' | 'strict' | undefined,
      testRunner: opts.testRunner as 'advisory' | 'strict' | undefined,
      acceptanceWrite: opts.acceptanceWrite as 'advisory' | 'strict' | undefined,
      designWrite: opts.designWrite as 'advisory' | 'strict' | undefined,
    });
  });

// ── cdd accept relock ─────────────────────────────────────────────────────────
const accept = program
  .command('accept')
  .description('Human-only acceptance-oracle baseline commands (ADR 0010)');

accept
  .command('relock <change-id>')
  .description('Recompute the acceptance-oracle hash from acceptance.yml and rewrite .cdd/acceptance-lock.json (the only sanctioned way to re-baseline after a human edit)')
  .action(async (changeId: string) => {
    const { acceptRelock } = await import('../commands/accept.js');
    await acceptRelock(changeId);
  });

accept
  .command('confirm <change-id>')
  .description('Show the acceptance criteria and record confirmation. Interactive by default (a human types the change id to approve); --autonomous records an explicitly delegated loop-mode acceptance the gate surfaces as un-reviewed.')
  .option('--autonomous', 'Record an agent-delegated acceptance without human review (loop mode)', false)
  .option('--reason <reason>', 'Why this run is autonomous (recorded with the acceptance)')
  .action(async (changeId: string, opts: { autonomous?: boolean; reason?: string }) => {
    const { acceptConfirm } = await import('../commands/accept.js');
    await acceptConfirm(changeId, { autonomous: opts.autonomous, reason: opts.reason });
  });

// ── cdd design confirm ────────────────────────────────────────────────────────
const design = program
  .command('design')
  .description('Human-only interaction-design lock commands (ADR 0012)');

design
  .command('confirm <change-id>')
  .description('Compute the interaction-design hash from interaction-design.md\'s ## Confirmed section and write .cdd/design-lock.json (the only sanctioned way to lock/re-lock after a human confirms)')
  .action(async (changeId: string) => {
    const { designConfirm } = await import('../commands/design.js');
    await designConfirm(changeId);
  });

// ── cdd openapi export ────────────────────────────────────────────────────────
const openapi = program
  .command('openapi')
  .description('Project the API contract into tooling artifacts (see docs/adr/0001-contract-to-openapi-export.md)');

openapi
  .command('export')
  .description('Export contracts/api/api-contract.md as a minimal OpenAPI 3.1 skeleton')
  .option('--contract <path>', 'API contract markdown path', DEFAULT_CONTRACT_PATH)
  .option('--out <path>', 'Write to a file instead of stdout')
  .option('--yaml', 'Emit YAML instead of JSON', false)
  .option('--check', 'Verify the artifact at --out is in sync with the contract (exits 1 on drift); does not write', false)
  .action(async (opts: { contract?: string; out?: string; yaml?: boolean; check?: boolean }) => {
    const exit = await openapiExport({
      contract: opts.contract,
      out: opts.out,
      format: opts.yaml ? 'yaml' : 'json',
      check: opts.check,
    });
    process.exit(exit);
  });

// ── cdd contract query ────────────────────────────────────────────────────────
const contract = program
  .command('contract')
  .description('Query the API contract by key instead of reading the whole file (see docs/adr/0004-queryable-and-writable-contracts.md)');

contract
  .command('query [term]')
  .description('Return only the matching slice of the API contract (endpoint, schema, path, or column filter)')
  .option('--contract <path>', 'API contract markdown path', DEFAULT_CONTRACT_PATH)
  .option('--inventory <path>', 'API inventory markdown path', DEFAULT_INVENTORY_PATH)
  .option('--endpoint <method-and-path>', 'Exact endpoint, e.g. "POST /api/orders" — returns the row plus the schemas it references and shared prose')
  .option('--path <prefix-or-glob>', 'Endpoints under a path prefix, or a glob where * matches within one segment, across the contract and inventory')
  .option('--schema <name>', 'A schema definition plus the endpoints that reference it')
  .option('--auth <value>', 'Filter endpoints by the auth column')
  .option('--category <value>', 'Filter inventory endpoints by category')
  .option('--owner <value>', 'Filter inventory endpoints by owner')
  .option('--limit <n>', 'Maximum endpoints/schemas to print', '20')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (term: string | undefined, opts: { contract: string; inventory: string; endpoint?: string; path?: string; schema?: string; auth?: string; category?: string; owner?: string; limit: string; json?: boolean }) => {
    const { contractQuery } = await import('../commands/contract-query.js');
    const exit = await contractQuery(term, {
      contract: opts.contract,
      inventory: opts.inventory,
      endpoint: opts.endpoint,
      path: opts.path,
      schema: opts.schema,
      auth: opts.auth,
      category: opts.category,
      owner: opts.owner,
      limit: parseInt(opts.limit, 10),
      json: opts.json === true,
    });
    process.exit(exit);
  });

contract
  .command('locate <symbol>')
  .description('Find the API-contract slices related to a code symbol/file by name overlap (saves the graph-query → read → guess-schema → contract-query round-trip)')
  .option('--contract <path>', 'API contract markdown path', DEFAULT_CONTRACT_PATH)
  .option('--inventory <path>', 'API inventory markdown path', DEFAULT_INVENTORY_PATH)
  .option('--map <path>', 'Code-map YAML path (used to harvest the symbol\'s declared names)', '.cdd/code-map.yml')
  .option('--limit <n>', 'Maximum endpoints/schemas to print', '20')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--no-refresh', 'Do not auto-regenerate a stale or missing code-map first')
  .action(async (symbol: string, opts: { contract: string; inventory: string; map: string; limit: string; json?: boolean; refresh?: boolean }) => {
    const { contractLocate } = await import('../commands/contract-locate.js');
    const exit = await contractLocate(symbol, {
      contract: opts.contract,
      inventory: opts.inventory,
      map: opts.map,
      limit: parseInt(opts.limit, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
    });
    process.exit(exit);
  });

contract
  .command('endpoint')
  .description('Mutate endpoint rows by key')
  .command('set')
  .description('Upsert an endpoint row by (method, path) — valid by construction, touches only that row')
  .requiredOption('--method <method>', 'HTTP method, e.g. POST')
  .requiredOption('--path <path>', 'Endpoint path, e.g. /api/orders')
  .option('--contract <path>', 'API contract markdown path', DEFAULT_CONTRACT_PATH)
  .option('--auth <value>', 'auth cell value')
  .option('--request <schema>', 'request schema cell (a defined schema name, Name[], or -)')
  .option('--response <schema>', 'response schema cell (a defined schema name, Name[], or -)')
  .option('--errors <value>', 'errors cell, e.g. "400, 409"')
  .option('--tests <value>', 'tests cell, e.g. yes')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (opts: { contract: string; method: string; path: string; auth?: string; request?: string; response?: string; errors?: string; tests?: string; json?: boolean }) => {
    const { contractEndpointSet } = await import('../commands/contract-set.js');
    const exit = await contractEndpointSet({
      contract: opts.contract,
      method: opts.method,
      path: opts.path,
      auth: opts.auth,
      request: opts.request,
      response: opts.response,
      errors: opts.errors,
      tests: opts.tests,
      json: opts.json === true,
    });
    process.exit(exit);
  });

contract
  .command('schema')
  .description('Mutate schema sections by name')
  .command('set <name>')
  .description('Upsert a `### Name` schema section from --field specs')
  .option('--contract <path>', 'API contract markdown path', DEFAULT_CONTRACT_PATH)
  .option('--field <spec>', 'repeatable field "name:type:required[:format[:notes]]"', (value: string, acc: string[]) => { acc.push(value); return acc; }, [] as string[])
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (name: string, opts: { contract: string; field: string[]; json?: boolean }) => {
    const { contractSchemaSet } = await import('../commands/contract-set.js');
    const exit = await contractSchemaSet({
      contract: opts.contract,
      name,
      fields: opts.field ?? [],
      json: opts.json === true,
    });
    process.exit(exit);
  });

// ── cdd test run ──────────────────────────────────────────────────────────────
const test = program
  .command('test')
  .description('Bounded test execution and structured evidence (see docs/adr/0005-bounded-test-execution-and-structured-evidence.md)');

test
  .command('run <change-id>')
  .description('Run one bounded test phase, capture artifacts under test-runs/<run-id>/, and update test-evidence.yml')
  .requiredOption('--phase <phase>', 'ladder phase: collect, targeted, changed-area, contract, quality, full, or acceptance')
  .option('--command <cmd>', 'the test command to run; pytest commands get bounded defaults (-q --maxfail=1 --tb=short -ra) plus JUnit XML. Required until cdd-kit test select lands')
  .option('--run-id <id>', 'override the generated run id (timestamp by default)')
  .option('--timeout <ms>', 'kill the command after this many milliseconds', '300000')
  .option('--cwd <dir>', 'working directory for the command (default: current directory)')
  .option('--required-phases <csv>', 'required phases used when first creating test-evidence.yml (default: collect,targeted,changed-area)')
  .option('--json', 'print the run summary as JSON', false)
  .action(async (changeId: string, opts: { phase: string; command?: string; runId?: string; timeout: string; cwd?: string; requiredPhases?: string; json?: boolean }) => {
    const { testRun } = await import('../commands/test-run.js');
    const timeoutMs = parseInt(opts.timeout, 10);
    const exit = await testRun(changeId, {
      phase: opts.phase,
      command: opts.command,
      runId: opts.runId,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000,
      cwd: opts.cwd,
      requiredPhases: opts.requiredPhases ? opts.requiredPhases.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      json: opts.json === true,
    });
    process.exit(exit);
  });

test
  .command('select <change-id>')
  .description('Select bounded test commands for each ladder phase from test-plan.md (deterministic; emits needs-test-plan-update when no bounded target is safe)')
  .option('--json', 'print the selection as JSON', false)
  .action(async (changeId: string, opts: { json?: boolean }) => {
    const { testSelect } = await import('../commands/test-select.js');
    const exit = await testSelect(changeId, { json: opts.json === true });
    process.exit(exit);
  });

test
  .command('impact <file>')
  .description('List the tests affected by changing a file: transitive importers that are test files, plus mirror-path test files (saves a manual grep)')
  .option('--map <path>', 'Code-map YAML path', '.cdd/code-map.yml')
  .option('--depth <n>', 'How many import hops to follow when finding dependent tests', '2')
  .option('--limit <n>', 'Maximum affected tests to print', '50')
  .option('--json', 'Print machine-readable JSON', false)
  .option('--no-refresh', 'Do not auto-regenerate a stale or missing code-map before querying')
  .action(async (file: string, opts: { map: string; depth: string; limit: string; json?: boolean; refresh?: boolean }) => {
    const { testImpact } = await import('../commands/test-impact.js');
    const exit = await testImpact(file, {
      map: opts.map,
      depth: parseInt(opts.depth, 10),
      limit: parseInt(opts.limit, 10),
      json: opts.json === true,
      refresh: opts.refresh !== false,
    });
    process.exit(exit);
  });

// ── cdd bug suspects ──────────────────────────────────────────────────────────
const bug = program
  .command('bug')
  .description('Bug-fix lane helpers (ADR 0006)');

bug
  .command('suspects [change-id]')
  .description('Map a symptom to candidate source files using the code-graph / code-map index')
  .option('--symptom <text>', 'Symptom text to map (use with a change-id)')
  .option('--text <text>', 'Symptom text to map (text-only mode, no change-id required)')
  .option('--limit <n>', 'Max candidates to return', '20')
  .option('--map <path>', 'Path to code-map YAML (default: .cdd/code-map.yml)')
  .option('--refresh', 'Regenerate the code-map if stale before querying (off by default)', false)
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string | undefined, opts: { symptom?: string; text?: string; limit: string; map?: string; refresh?: boolean; json?: boolean }) => {
    const { bugSuspects } = await import('../commands/bug-suspects.js');
    const exit = await bugSuspects(changeId, {
      symptom: opts.symptom,
      text: opts.text,
      json: opts.json === true,
      limit: parseInt(opts.limit, 10) || 20,
      map: opts.map,
      refresh: opts.refresh === true,
    });
    process.exit(exit);
  });

// ── cdd detect-stack ──────────────────────────────────────────────────────────
program
  .command('detect-stack')
  .description('Detect the project tech stack and print the result')
  .action(() => {
    const cwd    = process.cwd();
    const result = detectStack(cwd);

    console.log(`Detected stack: ${result.primary}`);

    if (result.candidates.length > 1) {
      console.log(`Candidates (in order): ${result.candidates.join(', ')}`);
    }

    if (result.polyglot) {
      console.log(
        `Polyglot: yes (config will be generated for ${result.primary})`,
      );
    }
  });

program
  .command('context-scan')
  .description('Deterministically scan project context and generate specs/context maps')
  .option('--surface <path>', 'Limit project-map tree to a sub-directory (e.g. --surface src/server)')
  .action(async (opts: { surface?: string }) => {
    const { contextScan } = await import('../commands/context-scan.js');
    await contextScan({ surface: opts.surface });
  });

const context = program
  .command('context')
  .description('Manage context governance manifests');

context
  .command('request <change-id> <request-id>')
  .description('Record a new pending Context Expansion Request')
  .requiredOption('--path <paths...>', 'Repo-relative path(s) requested by the agent')
  .option('--reason <text>', 'Reason the extra context is required')
  .action(async (changeId: string, requestId: string, opts: { path: string[]; reason?: string }) => {
    const { requestContextExpansion } = await import('../commands/context.js');
    await requestContextExpansion(changeId, requestId, opts.path, opts.reason);
  });

context
  .command('approve <change-id> [request-id]')
  .description('Approve a pending Context Expansion Request (or all with --all-pending)')
  .option('--all-pending', 'Approve every pending Context Expansion Request for this change', false)
  .action(async (changeId: string, requestId: string | undefined, opts: { allPending?: boolean }) => {
    const { approveContextExpansion, approveAllPending } = await import('../commands/context.js');
    if (opts.allPending) {
      if (requestId) {
        console.error('--all-pending cannot be combined with a request-id');
        process.exit(1);
      }
      await approveAllPending(changeId);
    } else {
      if (!requestId) {
        console.error('request-id is required (or pass --all-pending)');
        process.exit(1);
      }
      await approveContextExpansion(changeId, requestId);
    }
  });

context
  .command('reject <change-id> [request-id]')
  .description('Reject a pending Context Expansion Request (or all with --all-pending)')
  .option('--all-pending', 'Reject every pending Context Expansion Request for this change', false)
  .action(async (changeId: string, requestId: string | undefined, opts: { allPending?: boolean }) => {
    const { rejectContextExpansion, rejectAllPending } = await import('../commands/context.js');
    if (opts.allPending) {
      if (requestId) {
        console.error('--all-pending cannot be combined with a request-id');
        process.exit(1);
      }
      await rejectAllPending(changeId);
    } else {
      if (!requestId) {
        console.error('request-id is required (or pass --all-pending)');
        process.exit(1);
      }
      await rejectContextExpansion(changeId, requestId);
    }
  });

context
  .command('auto-approve <change-id>')
  .description('Resolve pending Context Expansion Requests against the auto-safe policy (unblocks safe-zone reads without manual review)')
  .action(async (changeId: string) => {
    const { autoApproveContextExpansions } = await import('../commands/context.js');
    await autoApproveContextExpansions(changeId);
  });

context
  .command('approve-interactive <change-id>')
  .description('Walk each pending Context Expansion Request with a plain-language explanation and a y/n prompt')
  .action(async (changeId: string) => {
    const { approveContextExpansionsInteractive } = await import('../commands/context.js');
    await approveContextExpansionsInteractive(changeId);
  });

context
  .command('list <change-id>')
  .description('List Context Expansion Requests for a change')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string, opts: { json?: boolean }) => {
    const { listContextExpansions } = await import('../commands/context.js');
    await listContextExpansions(changeId, opts.json);
  });

context
  .command('check <change-id>')
  .description('Preflight-check repo-relative read paths against context-manifest Allowed Paths')
  .requiredOption('--path <paths...>', 'Repo-relative path(s) an agent is expected to read')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string, opts: { path: string[]; json?: boolean }) => {
    const { checkContextPaths } = await import('../commands/context.js');
    await checkContextPaths(changeId, opts.path, opts.json);
  });

// ── cdd reserve ───────────────────────────────────────────────────────────────
// Parallel-change fan-out: reserve a distinct contract version lane before
// branching so concurrent worktrees never collide on a contract's version line
// (see docs/adr/0009-parallel-change-integration.md).
program
  .command('reserve <change-id>')
  .description('Reserve a contract version lane for a change before parallel worktree development (ADR 0009)')
  .requiredOption('--contract <key>', 'Contract to reserve: api, css, env, data, business, or ci')
  .option('--bump <kind>', 'Version bump: major, minor, or patch', 'minor')
  .option('--surface <surfaces...>', 'Named sub-surface(s) the change edits, e.g. endpoints/export')
  .option('--branch <branch>', 'Worktree branch that will develop this change')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (changeId: string, opts: { contract: string; bump: string; surface?: string[]; branch?: string; json?: boolean }) => {
    const { reserve } = await import('../commands/reserve.js');
    await reserve({
      changeId,
      contract: opts.contract as never,
      bump: opts.bump as never,
      surfaces: opts.surface ?? [],
      branch: opts.branch,
      json: opts.json,
    });
  });

// ── cdd integrate ─────────────────────────────────────────────────────────────
// Parallel-change fan-in: read the reservation ledger and print a contention
// matrix + deterministic merge order. Exit 3 on surface collisions that need a
// human (ADR 0009).
program
  .command('integrate')
  .description('Compute the contention matrix + safe merge order for parallel changes from .cdd/reservations.yml (ADR 0009)')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (opts: { json?: boolean }) => {
    const { integrate } = await import('../commands/integrate.js');
    await integrate({ json: opts.json });
  });

// ── cdd report ────────────────────────────────────────────────────────────────
// File a problem about the CDD kit ITSELF as a GitHub issue on the kit's
// upstream repo. Drafts by default; only posts with --confirm (outward-facing).
program
  .command('report')
  .description('Report a cdd-kit problem to GitHub. Drafts by default; add --confirm to file it after the maintainer approves.')
  .option('--title <title>', 'Short issue title (required)')
  .option('--body <body>', 'What went wrong / how to reproduce (required)')
  .option('--category <category>', 'One of: bug, gate-false-positive, crash, docs, other', 'bug')
  .option('--repo <owner/name>', 'Target repo (default: the kit upstream repo or $CDD_REPORT_REPO)')
  .option('--label <label...>', 'Optional existing GitHub labels to apply')
  .option('--change-id <id>', 'Optional CDD change id for context')
  .option('--run-id <id>', 'Optional runtime run id for context')
  .option('--confirm', 'Actually file the issue (default is a dry-run draft)', false)
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (opts: {
    title?: string; body?: string; category?: string; repo?: string; label?: string[];
    changeId?: string; runId?: string; confirm?: boolean; json?: boolean;
  }) => {
    const { report } = await import('../commands/report.js');
    process.exitCode = await report(opts);
  });

// ── cdd changelog build ───────────────────────────────────────────────────────
const changelog = program
  .command('changelog')
  .description('Assemble per-change changelog fragments into contracts/CHANGELOG.md (news-fragment pattern, ADR 0009)');

changelog
  .command('build')
  .description('Assemble contracts/changelog.d/*.md into the ## Unreleased section of contracts/CHANGELOG.md')
  .option('--check', 'Exit 3 if the changelog is out of sync with the fragments (no write)', false)
  .action(async (opts: { check?: boolean }) => {
    const { changelogBuild } = await import('../commands/changelog-build.js');
    await changelogBuild({ check: opts.check });
  });

// ── cdd parallel arm ──────────────────────────────────────────────────────────
const parallel = program
  .command('parallel')
  .description('Parallel-change worktree helpers (ADR 0009)');

parallel
  .command('arm')
  .description('Register the local git merge drivers the parallel .gitattributes entries need (idempotent)')
  .option('--json', 'Print machine-readable JSON', false)
  .action(async (opts: { json?: boolean }) => {
    const { parallelArm } = await import('../commands/parallel-arm.js');
    await parallelArm({ json: opts.json });
  });

program.parse();
