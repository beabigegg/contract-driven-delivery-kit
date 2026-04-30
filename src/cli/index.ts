import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';
import { init }      from '../commands/init.js';
import { update }    from '../commands/update.js';
import { newChange } from '../commands/new-change.js';
import { validate }  from '../commands/validate.js';
import { gate } from '../commands/gate.js';
import { installHooks } from '../commands/install-hooks.js';
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
  .action((opts) =>
    init({
      globalOnly: opts.globalOnly,
      localOnly:  opts.localOnly,
      force:      opts.force,
      provider:   opts.provider,
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

// ── cdd gate <change-id> ──────────────────────────────────────────────────────
program
  .command('gate <change-id>')
  .description('Run full orchestration gate for a change (required artifacts, content, tier, contracts)')
  .option('--strict', 'Treat pending tasks (except section 7) as errors, and treat runtime/declared files-read drift as errors', false)
  .option('--lax', 'Skip artifact-pointer existence check (for legacy repos with stale logs)', false)
  .action(async (id: string, opts: { strict?: boolean; lax?: boolean }) => { await gate(id, { strict: opts.strict, lax: opts.lax }); });

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

program.parse();
