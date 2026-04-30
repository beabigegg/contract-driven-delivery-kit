import { join } from 'path';
import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync, appendFileSync, cpSync, rmSync } from 'fs';
import yaml from 'js-yaml';
import { log } from '../utils/logger.js';

export async function archive(changeId: string): Promise<void> {
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);
  const archiveYear = new Date().getFullYear().toString();
  const archiveBase = join(cwd, 'specs', 'archive', archiveYear);
  const archiveDir = join(archiveBase, changeId);
  const indexPath = join(cwd, 'specs', 'archive', 'INDEX.md');

  // Validate change exists
  if (!existsSync(changeDir)) {
    log.error(`Change not found: specs/changes/${changeId}`);
    process.exit(1);
  }

  // Check if already archived
  if (existsSync(archiveDir)) {
    log.error(`Already archived: specs/archive/${archiveYear}/${changeId}`);
    process.exit(1);
  }

  // Check tasks.yml for gate-blocked status (warn but don't block)
  const tasksPath = join(changeDir, 'tasks.yml');
  if (existsSync(tasksPath)) {
    try {
      const raw = readFileSync(tasksPath, 'utf8');
      const data = yaml.load(raw) as { status?: string; tasks?: Array<{ status?: string }> } | null;
      if (data?.status === 'gate-blocked') {
        log.warn('tasks.yml has status: gate-blocked — archiving anyway (change was paused).');
      }
      const pending = (data?.tasks ?? []).filter(t => t.status === 'pending').length;
      if (pending > 0) {
        log.warn(`${pending} task(s) still pending. Archive anyway.`);
      }
    } catch {
      log.warn('tasks.yml could not be parsed — archiving anyway.');
    }
  }

  // Create archive year directory
  if (!existsSync(archiveBase)) {
    mkdirSync(archiveBase, { recursive: true });
  }

  // Move the change directory (Fix 3: cross-volume fallback)
  try {
    renameSync(changeDir, archiveDir);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      // Cross-device move: copy then delete
      cpSync(changeDir, archiveDir, { recursive: true });
      rmSync(changeDir, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  log.ok(`Archived: specs/changes/${changeId} → specs/archive/${archiveYear}/${changeId}`);

  // Append to INDEX.md
  const today = new Date().toISOString().split('T')[0];
  const indexLine = `| ${changeId} | ${archiveYear} | ${today} | specs/archive/${archiveYear}/${changeId}/ |\n`;

  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `# Archive Index\n\n| change-id | year | archived-date | path |\n|---|---|---|---|\n${indexLine}`, 'utf8');
  } else {
    appendFileSync(indexPath, indexLine, 'utf8');
  }

  log.ok(`Index updated: specs/archive/INDEX.md`);
  log.blank();
  log.info(`Next: promote durable learnings from archive.md to contracts/ or CLAUDE.md`);
}
