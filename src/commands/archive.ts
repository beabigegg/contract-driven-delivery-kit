import { join } from 'path';
import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync, appendFileSync, cpSync, rmSync } from 'fs';
import yaml from 'js-yaml';
import { log } from '../utils/logger.js';

export async function archive(changeId: string, opts: { json?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const json = opts.json ?? false;
  const changeDir = join(cwd, 'specs', 'changes', changeId);
  const archiveYear = new Date().getFullYear().toString();
  const archiveBase = join(cwd, 'specs', 'archive', archiveYear);
  const archiveDir = join(archiveBase, changeId);
  const indexPath = join(cwd, 'specs', 'archive', 'INDEX.md');

  const fail = (error: string): never => {
    if (json) console.log(JSON.stringify({ changeId, error }, null, 2));
    else log.error(error);
    process.exit(1);
  };

  // Validate change exists
  if (!existsSync(changeDir)) {
    fail(`Change not found: specs/changes/${changeId}`);
  }

  // Check if already archived
  if (existsSync(archiveDir)) {
    fail(`Already archived: specs/archive/${archiveYear}/${changeId}`);
  }

  // Check tasks.yml for gate-blocked status (warn but don't block)
  const warnings: string[] = [];
  const tasksPath = join(changeDir, 'tasks.yml');
  if (existsSync(tasksPath)) {
    try {
      const raw = readFileSync(tasksPath, 'utf8');
      const data = yaml.load(raw) as { status?: string; tasks?: Array<{ status?: string }> } | null;
      if (data?.status === 'gate-blocked') {
        warnings.push('tasks.yml has status: gate-blocked — archiving anyway (change was paused).');
      }
      const pending = (data?.tasks ?? []).filter(t => t.status === 'pending').length;
      if (pending > 0) {
        warnings.push(`${pending} task(s) still pending. Archive anyway.`);
      }
    } catch {
      warnings.push('tasks.yml could not be parsed — archiving anyway.');
    }
  }
  if (!json) for (const w of warnings) log.warn(w);

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
  if (!json) log.ok(`Archived: specs/changes/${changeId} → specs/archive/${archiveYear}/${changeId}`);

  // Append to INDEX.md
  const today = new Date().toISOString().split('T')[0];
  const indexLine = `| ${changeId} | ${archiveYear} | ${today} | specs/archive/${archiveYear}/${changeId}/ |\n`;

  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `# Archive Index\n\n| change-id | year | archived-date | path |\n|---|---|---|---|\n${indexLine}`, 'utf8');
  } else {
    appendFileSync(indexPath, indexLine, 'utf8');
  }

  if (json) {
    console.log(JSON.stringify({
      changeId,
      archivedTo: `specs/archive/${archiveYear}/${changeId}/`,
      year: archiveYear,
      date: today,
      warnings,
    }, null, 2));
    return;
  }

  log.ok(`Index updated: specs/archive/INDEX.md`);
  log.blank();
  log.info(`Next: promote durable learnings from archive.md to contracts/ or CLAUDE.md`);
}
