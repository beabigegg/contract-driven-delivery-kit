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
import type { ProviderOption } from '../utils/provider.js';

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
  .action((opts) =>
    init({
      globalOnly: opts.globalOnly,
      localOnly:  opts.localOnly,
      force:      opts.force,
      provider:   opts.provider,
      hooks:      opts.hooks,
      arm:        opts.arm !== false,
    }),
  );

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
  .option('--provider <provider>', 'Provider adapter to inspect: auto, claude, codex, or both', 'auto')
  .option('--fix', 'Auto-resolve safe warnings (stale context indexes, missing role bindings)', false)
  .action(async (opts: { strict?: boolean; json?: boolean; provider?: ProviderOption; fix?: boolean }) => {
    const { doctor } = await import('../commands/doctor.js');
    await doctor({ strict: opts.strict, json: opts.json, provider: opts.provider, fix: opts.fix });
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
  .option('--no-refresh', 'Do not auto-regenerate stale or missing fallback code-map')
  .action(async (task: string, opts: { engine?: 'auto' | 'native' | 'codegraph' | 'codemap'; map?: string; maxNodes: string; json?: boolean; refresh?: boolean }) => {
    const { graphContext } = await import('../commands/graph.js');
    const exit = await graphContext(task, {
      engine: opts.engine,
      map: opts.map,
      maxNodes: parseInt(opts.maxNodes, 10),
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
  .action(async (id: string, opts: { strict?: boolean }) => {
    await gate(id, { strict: opts.strict });
  });

// ── cdd archive <change-id> ───────────────────────────────────────────────────
program
  .command('archive <change-id>')
  .description('Move a completed change from specs/changes/ to specs/archive/<year>/')
  .action(async (changeId: string) => {
    const { archive } = await import('../commands/archive.js');
    await archive(changeId);
  });

// ── cdd abandon <change-id> ───────────────────────────────────────────────────
program
  .command('abandon <change-id>')
  .description('Mark a change as abandoned (updates tasks.yml status, records in INDEX.md)')
  .option('--reason <text>', 'reason for abandonment')
  .action(async (changeId: string, opts: { reason?: string }) => {
    const { abandon } = await import('../commands/abandon.js');
    await abandon(changeId, opts);
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
  .action(async () => {
    const { listChanges } = await import('../commands/list-changes.js');
    await listChanges();
  });

// ── cdd install-hooks ─────────────────────────────────────────────────────────
program
  .command('install-hooks')
  .description('Install pre-commit hook that runs cdd-kit gate on staged changes')
  .action(async () => { await installHooks(); });

// ── cdd install-agent-hooks ───────────────────────────────────────────────────
program
  .command('install-agent-hooks')
  .description('Install Claude Code agent hooks into .claude/settings.json (graph-first exploration; contract-write routing)')
  .option('--graph-first <mode>', "Arm the graph-first PreToolUse hook: 'advisory' or 'strict' (default when no hook flag is given)")
  .option('--contract-write <mode>', "Arm the contract-write PreToolUse hook (ADR 0004 §6): 'advisory' or 'strict'")
  .action(async (opts: { graphFirst?: string; contractWrite?: string }) => {
    await installAgentHooks({
      graphFirst: opts.graphFirst as 'advisory' | 'strict' | undefined,
      contractWrite: opts.contractWrite as 'advisory' | 'strict' | undefined,
    });
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
  .requiredOption('--phase <phase>', 'ladder phase: collect, targeted, changed-area, contract, quality, or full')
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

program.parse();
