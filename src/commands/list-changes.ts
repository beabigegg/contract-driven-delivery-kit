import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { log } from '../utils/logger.js';

export async function listChanges(): Promise<void> {
  const cwd = process.cwd();
  const changesDir = join(cwd, 'specs', 'changes');

  log.blank();

  // Active changes
  const active: string[] = [];
  if (existsSync(changesDir)) {
    active.push(...readdirSync(changesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name));
  }

  if (active.length === 0) {
    log.info('No active changes in specs/changes/');
  } else {
    log.info('Active changes:');
    for (const id of active) {
      const tasksPath = join(changesDir, id, 'tasks.md');
      let status = 'in-progress';
      let pending = 0;
      if (existsSync(tasksPath)) {
        const content = readFileSync(tasksPath, 'utf8');
        if (content.includes('status: gate-blocked')) status = 'gate-blocked';
        pending = (content.match(/^\s*-\s*\[ \]/gm) || []).length;
      }
      const pendingStr = pending > 0 ? ` (${pending} pending)` : '';
      log.info(`  ${id}  [${status}]${pendingStr}`);
    }
  }

  log.blank();
}
