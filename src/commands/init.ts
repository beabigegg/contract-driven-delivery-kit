import { join } from 'path';
import { rmSync } from 'fs';
import { ASSET, AGENTS_HOME, SKILLS_HOME } from '../utils/paths.js';
import { copyDirTracked, copyFileTracked } from '../utils/copy.js';
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
  const createdPaths: string[] = [];

  function track(paths: string[]): void {
    createdPaths.push(...paths);
  }

  function rollback(): void {
    log.warn('Rolling back created paths due to error…');
    // Remove in reverse order so files are deleted before their parent dirs
    for (const p of [...createdPaths].reverse()) {
      try {
        rmSync(p, { recursive: true, force: true });
        log.dim(`rolled back: ${p}`);
      } catch {
        log.warn(`could not remove: ${p}`);
      }
    }
  }

  log.blank();
  log.info('Initialising contract-driven-delivery kit…');
  log.blank();

  try {
    // ── Global: install agents + skill into ~/.claude ───────────────────────
    if (!opts.localOnly) {
      log.info(`Installing agents → ${AGENTS_HOME}`);
      const { count: agentCount, created: agentCreated } = copyDirTracked(ASSET.agents, AGENTS_HOME, { overwrite: true });
      track(agentCreated);
      log.ok(`${agentCount} agent file(s) installed.`);

      const skillDest = join(SKILLS_HOME, 'contract-driven-delivery');
      log.info(`Installing skill  → ${skillDest}`);
      const { count: skillCount, created: skillCreated } = copyDirTracked(ASSET.skill, skillDest, { overwrite: true });
      track(skillCreated);
      log.ok(`${skillCount} skill file(s) installed.`);

      log.blank();
    }

    // ── Local: copy project scaffolding into cwd ────────────────────────────
    if (!opts.globalOnly) {
      log.info(`Scaffolding project files in ${cwd}`);

      const { count: contractsCount, created: contractsCreated } = copyDirTracked(
        ASSET.contracts,
        join(cwd, 'contracts'),
        { overwrite: opts.force, label: 'contracts' },
      );
      track(contractsCreated);
      log.ok(`contracts/ — ${contractsCount} file(s) written.`);

      const { count: specsCount, created: specsCreated } = copyDirTracked(
        ASSET.specsTemplates,
        join(cwd, 'specs', 'templates'),
        { overwrite: opts.force, label: 'specs/templates' },
      );
      track(specsCreated);
      log.ok(`specs/templates/ — ${specsCount} file(s) written.`);

      const { count: testsCount, created: testsCreated } = copyDirTracked(
        ASSET.testsTemplates,
        join(cwd, 'tests', 'templates'),
        { overwrite: opts.force, label: 'tests/templates' },
      );
      track(testsCreated);
      log.ok(`tests/templates/ — ${testsCount} file(s) written.`);

      const { count: ciCount, created: ciCreated } = copyDirTracked(
        ASSET.ci,
        join(cwd, 'ci'),
        { overwrite: opts.force, label: 'ci' },
      );
      track(ciCreated);
      log.ok(`ci/ — ${ciCount} file(s) written.`);

      // CLAUDE.md — never overwrite
      const { written: claudeWritten, created: claudeCreated } = copyFileTracked(
        ASSET.claudeTemplate,
        join(cwd, 'CLAUDE.md'),
        { overwrite: false, label: 'CLAUDE.md' },
      );
      if (claudeCreated) track([join(cwd, 'CLAUDE.md')]);
      if (claudeWritten) log.ok('CLAUDE.md created.');

      // AGENTS.md — never overwrite
      const { written: agentsWritten, created: agentsCreated } = copyFileTracked(
        ASSET.agentsTemplate,
        join(cwd, 'AGENTS.md'),
        { overwrite: false, label: 'AGENTS.md' },
      );
      if (agentsCreated) track([join(cwd, 'AGENTS.md')]);
      if (agentsWritten) log.ok('AGENTS.md created.');

      log.blank();
    }
  } catch (err) {
    log.error(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
    rollback();
    process.exit(1);
  }

  log.ok('Done.');
  log.blank();
  log.info('Use the contract-driven-delivery skill in Claude Code to scan this repo.');
  log.blank();
}
