import { join } from 'path';
import { ASSET, AGENTS_HOME, SKILLS_HOME } from '../utils/paths.js';
import { copyDir } from '../utils/copy.js';
import { log } from '../utils/logger.js';

export async function update(): Promise<void> {
  log.blank();
  log.info('Updating ~/.claude agents and skill…');
  log.blank();

  log.info(`Updating agents → ${AGENTS_HOME}`);
  const agentCount = copyDir(ASSET.agents, AGENTS_HOME, { overwrite: true });
  log.ok(`${agentCount} agent file(s) updated.`);

  const skillDest = join(SKILLS_HOME, 'contract-driven-delivery');
  log.info(`Updating skill  → ${skillDest}`);
  const skillCount = copyDir(ASSET.skill, skillDest, { overwrite: true });
  log.ok(`${skillCount} skill file(s) updated.`);

  log.blank();
  log.info('Project files (contracts/, specs/, tests/, ci/) were not changed.');
  log.ok('Update complete.');
  log.blank();
}
