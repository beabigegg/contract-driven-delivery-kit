import { join } from 'path';
import { ASSET, AGENTS_HOME, SKILLS_HOME } from '../utils/paths.js';
import { copyDir, copyFile } from '../utils/copy.js';
import { log } from '../utils/logger.js';

export interface InitOptions {
  globalOnly: boolean;
  localOnly: boolean;
  force: boolean;
}

export async function init(opts: InitOptions): Promise<void> {
  if (opts.globalOnly && opts.localOnly) {
    log.error('--global-only and --local-only are mutually exclusive.');
    process.exit(1);
  }

  const cwd = process.cwd();

  log.blank();
  log.info('Initialising contract-driven-delivery kit…');
  log.blank();

  // ── Global: install agents + skill into ~/.claude ─────────────────────────
  if (!opts.localOnly) {
    log.info(`Installing agents → ${AGENTS_HOME}`);
    const agentCount = copyDir(ASSET.agents, AGENTS_HOME, { overwrite: true });
    log.ok(`${agentCount} agent file(s) installed.`);

    const skillDest = join(SKILLS_HOME, 'contract-driven-delivery');
    log.info(`Installing skill  → ${skillDest}`);
    const skillCount = copyDir(ASSET.skill, skillDest, { overwrite: true });
    log.ok(`${skillCount} skill file(s) installed.`);

    log.blank();
  }

  // ── Local: copy project scaffolding into cwd ──────────────────────────────
  if (!opts.globalOnly) {
    log.info(`Scaffolding project files in ${cwd}`);

    const contractsCount = copyDir(
      ASSET.contracts,
      join(cwd, 'contracts'),
      { overwrite: opts.force, label: 'contracts' },
    );
    log.ok(`contracts/ — ${contractsCount} file(s) written.`);

    const specsCount = copyDir(
      ASSET.specsTemplates,
      join(cwd, 'specs', 'templates'),
      { overwrite: opts.force, label: 'specs/templates' },
    );
    log.ok(`specs/templates/ — ${specsCount} file(s) written.`);

    const testsCount = copyDir(
      ASSET.testsTemplates,
      join(cwd, 'tests', 'templates'),
      { overwrite: opts.force, label: 'tests/templates' },
    );
    log.ok(`tests/templates/ — ${testsCount} file(s) written.`);

    const ciCount = copyDir(
      ASSET.ci,
      join(cwd, 'ci'),
      { overwrite: opts.force, label: 'ci' },
    );
    log.ok(`ci/ — ${ciCount} file(s) written.`);

    // CLAUDE.md — never overwrite
    const claudeWritten = copyFile(
      ASSET.claudeTemplate,
      join(cwd, 'CLAUDE.md'),
      { overwrite: false, label: 'CLAUDE.md' },
    );
    if (claudeWritten) log.ok('CLAUDE.md created.');

    // AGENTS.md — never overwrite
    const agentsWritten = copyFile(
      ASSET.agentsTemplate,
      join(cwd, 'AGENTS.md'),
      { overwrite: false, label: 'AGENTS.md' },
    );
    if (agentsWritten) log.ok('AGENTS.md created.');

    log.blank();
  }

  log.ok('Done.');
  log.blank();
  log.info('Use the contract-driven-delivery skill in Claude Code to scan this repo.');
  log.blank();
}
