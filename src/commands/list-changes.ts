import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { log } from '../utils/logger.js';

interface ChangeListEntry {
  id: string;
  status: string;
  pendingTasks: number;
}

function collectChanges(changesDir: string): ChangeListEntry[] {
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const tasksPath = join(changesDir, d.name, 'tasks.yml');
      let status = 'in-progress';
      let pendingTasks = 0;
      if (existsSync(tasksPath)) {
        try {
          const raw = readFileSync(tasksPath, 'utf8');
          const data = yaml.load(raw) as { status?: string; tasks?: Array<{ status?: string }> } | null;
          if (data?.status) status = data.status;
          pendingTasks = (data?.tasks ?? []).filter(t => t.status === 'pending').length;
        } catch { /* leave defaults */ }
      }
      return { id: d.name, status, pendingTasks };
    });
}

export async function listChanges(json = false): Promise<void> {
  const cwd = process.cwd();
  const changes = collectChanges(join(cwd, 'specs', 'changes'));

  if (json) {
    console.log(JSON.stringify({ changes }, null, 2));
    return;
  }

  log.blank();

  if (changes.length === 0) {
    log.info('No active changes in specs/changes/');
  } else {
    log.info('Active changes:');
    for (const { id, status, pendingTasks } of changes) {
      const pendingStr = pendingTasks > 0 ? ` (${pendingTasks} pending)` : '';
      log.info(`  ${id}  [${status}]${pendingStr}`);
    }
  }

  log.blank();
}
