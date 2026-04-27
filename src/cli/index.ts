import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';
import { init }      from '../commands/init.js';
import { update }    from '../commands/update.js';
import { newChange } from '../commands/new-change.js';
import { validate }  from '../commands/validate.js';
import { gate }      from '../commands/gate.js';
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
  .action((opts) =>
    init({
      globalOnly: opts.globalOnly,
      localOnly:  opts.localOnly,
      force:      opts.force,
    }),
  );

// ── cdd update ────────────────────────────────────────────────────────────────
program
  .command('update')
  .description('Update ~/.claude agents and skill (does not touch project files)')
  .option('--yes', 'Apply changes (default is dry-run)', false)
  .action((opts) => update({ yes: opts.yes }));

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
  .action(async (id: string) => { await gate(id); });

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

program.parse();
