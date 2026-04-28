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
  .action((opts) => update({ yes: opts.yes, provider: opts.provider }));

// ── cdd new <name> ────────────────────────────────────────────────────────────
program
  .command('new <name>')
  .description('Scaffold a new change directory under specs/changes/<name>')
  .option('--all', 'Include optional templates in addition to required ones', false)
  .option('--force', 'Overwrite existing template files in the change folder', false)
  .action((name: string, opts) =>
    newChange(name, { all: opts.all, force: opts.force }),
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
  .option('--strict', 'Treat pending tasks (except section 7) as errors, and validate artifact pointers', false)
  .action(async (id: string, opts: { strict?: boolean }) => { await gate(id, { strict: opts.strict }); });

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
  .description('Mark a change as abandoned (updates tasks.md status, records in INDEX.md)')
  .option('--reason <text>', 'reason for abandonment')
  .action(async (changeId: string, opts: { reason?: string }) => {
    const { abandon } = await import('../commands/abandon.js');
    await abandon(changeId, opts);
  });

// ── cdd migrate ───────────────────────────────────────────────────────────────
program
  .command('migrate [change-id]')
  .description('Upgrade existing change directories to v1.11.0 format (tasks.md frontmatter + tier format)')
  .option('--all', 'Migrate all changes in specs/changes/', false)
  .option('--dry-run', 'Show what would change without writing files', false)
  .option('--enable-context-governance', 'Opt legacy changes into context-governance: v1 hard gate behavior', false)
  .action(async (changeId?: string, opts: { all?: boolean; dryRun?: boolean; enableContextGovernance?: boolean } = {}) => {
    const { migrate } = await import('../commands/migrate.js');
    await migrate(changeId, opts);
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
  .action(async () => {
    const { contextScan } = await import('../commands/context-scan.js');
    await contextScan();
  });

program.parse();
