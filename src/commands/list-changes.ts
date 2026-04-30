import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
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
      const tasksPath = join(changesDir, id, 'tasks.yml');
      let status = 'in-progress';
      let pending = 0;
      if (existsSync(tasksPath)) {
        try {
          const raw = readFileSync(tasksPath, 'utf8');
          const data = yaml.load(raw) as { status?: string; tasks?: Array<{ status?: string }> } | null;
          if (data?.status) status = data.status;
          pending = (data?.tasks ?? []).filter(t => t.status === 'pending').length;
        } catch { /* leave defaults */ }
      }
      const pendingStr = pending > 0 ? ` (${pending} pending)` : '';
      log.info(`  ${id}  [${status}]${pendingStr}`);
    }
  }

  log.blank();
}
