import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { log } from '../utils/logger.js';

export async function abandon(changeId: string, opts: { reason?: string }): Promise<void> {
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);
  const tasksPath = join(changeDir, 'tasks.md');

  if (!existsSync(changeDir)) {
    log.error(`Change not found: specs/changes/${changeId}`);
    process.exit(1);
  }

  // Update tasks.md status to abandoned
  if (existsSync(tasksPath)) {
    let content = readFileSync(tasksPath, 'utf8');
    if (content.match(/^status:/m)) {
      content = content.replace(/^status: .*/m, 'status: abandoned');
    } else {
      // frontmatter might not exist yet — prepend it
      content = `---\nchange-id: ${changeId}\nstatus: abandoned\n---\n\n` + content;
    }
    writeFileSync(tasksPath, content, 'utf8');
  }

  // Append to INDEX.md
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
