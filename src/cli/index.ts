import { Command } from 'commander';
import { init }      from '../commands/init.js';
import { update }    from '../commands/update.js';
import { newChange } from '../commands/new-change.js';
import { validate }  from '../commands/validate.js';

const program = new Command();

program
  .name('cdd-kit')
  .description('Contract-Driven Delivery Kit CLI')
  .version('1.0.0');

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
  .action(() => update());

// ── cdd new <name> ────────────────────────────────────────────────────────────
program
  .command('new <name>')
  .description('Scaffold a new change directory under specs/changes/<name>')
  .option('--all', 'Include optional templates in addition to required ones', false)
  .action((name: string, opts) =>
    newChange(name, { all: opts.all }),
  );

// ── cdd validate ──────────────────────────────────────────────────────────────
program
  .command('validate')
  .description('Run validation scripts (defaults to all)')
  .option('--contracts', 'Validate API/data/CSS contracts (use --env separately for env)', false)
  .option('--env',       'Validate env contract',               false)
  .option('--ci',        'Validate CI gate policy',             false)
  .option('--spec',      'Validate spec traceability',          false)
  .action((opts) =>
    validate({
      contracts: opts.contracts,
      env:       opts.env,
      ci:        opts.ci,
      spec:      opts.spec,
    }),
  );

program.parse();
