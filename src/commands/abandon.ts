import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
import { log } from '../utils/logger.js';

export async function abandon(changeId: string, opts: { reason?: string }): Promise<void> {
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);
  const tasksPath = join(changeDir, 'tasks.yml');

  if (!existsSync(changeDir)) {
    log.error(`Change not found: specs/changes/${changeId}`);
    process.exit(1);
  }

  if (existsSync(tasksPath)) {
    const raw = readFileSync(tasksPath, 'utf8');
    const data = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    data['status'] = 'abandoned';
    if (!data['change-id']) {
      data['change-id'] = changeId;
    }
    writeFileSync(tasksPath, yaml.dump(data, { lineWidth: -1, noRefs: true }), 'utf8');
  }

  const today = new Date().toISOString().split('T')[0];
  const archiveDir = join(cwd, 'specs', 'archive');
  const indexPath = join(archiveDir, 'INDEX.md');
  const reason = opts.reason ?? 'no reason given';
  const indexLine = `| ${changeId} | abandoned | ${today} | ${reason} |\n`;

  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }

  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `# Archive Index\n\n| change-id | status | date | notes |\n|---|---|---|---|\n${indexLine}`, 'utf8');
  } else {
    appendFileSync(indexPath, indexLine, 'utf8');
  }

  log.ok(`Change ${changeId} marked as abandoned.`);
  log.info(`specs/changes/${changeId}/ remains on disk (git history preserved).`);
  log.info(`Run \`cdd-kit archive ${changeId}\` to physically move it, or leave it for git history.`);
}
