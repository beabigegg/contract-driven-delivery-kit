import { join } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { log } from '../utils/logger.js';

interface MigrateOptions {
  all?: boolean;
  dryRun?: boolean;
}

interface MigrateResult {
  changed: string[];
  warnings: string[];
}

function migrateOne(changeId: string, changeDir: string, dryRun: boolean): MigrateResult {
  const changed: string[] = [];
  const warnings: string[] = [];

  // ── tasks.md: add YAML frontmatter + legend ──────────────────────────────
  const tasksPath = join(changeDir, 'tasks.md');
  if (existsSync(tasksPath)) {
    let content = readFileSync(tasksPath, 'utf8');
    // Normalize line endings for comparison
    const norm = content.replace(/\r\n/g, '\n');
    let modified = false;

    if (!norm.startsWith('---')) {
      // Detect a bare "status: <value>" line in the body (pre-v1.10 gate-blocked terminal state)
      const bareStatusMatch = norm.match(/^status:\s*(\S+)/m);
      const inferredStatus = bareStatusMatch ? bareStatusMatch[1] : 'in-progress';

      // Remove the bare status line so it doesn't conflict with the new frontmatter
      if (bareStatusMatch) {
        content = content.replace(/^status:\s*\S+[ \t]*\n?/m, '');
      }

      // Prepend frontmatter with the inferred status
      content = `---\nchange-id: ${changeId}\nstatus: ${inferredStatus}\n---\n\n` + content;
      modified = true;
    }

    // Add legend if missing (after frontmatter block)
    if (!content.includes('[x]=done')) {
      // Insert the legend after the closing --- of the frontmatter
      content = content.replace(
        /^(---\n[\s\S]*?---\n)/,
        `$1\n<!-- [x]=done [-]=N/A [ ]=pending -->\n`,
      );
      modified = true;
    }

    if (modified) {
      changed.push('tasks.md: added YAML frontmatter (status: in-progress) + legend comment');
      if (!dryRun) writeFileSync(tasksPath, content, 'utf8');
    }
  } else {
    warnings.push('tasks.md not found — skipping frontmatter migration');
  }

  // ── change-classification.md: report tier format status ──────────────────
  const classifPath = join(changeDir, 'change-classification.md');
  if (existsSync(classifPath)) {
    const content = readFileSync(classifPath, 'utf8');
    const hasNewTierFormat = /^## Tier\s*\n\s*-\s*\d\s*$/m.test(content);

    if (!hasNewTierFormat) {
      // Detect old-format tier for reporting
      const oldMatch = content.match(/\*\*Tier[:\*]+\s*(?:Tier\s*)?(\d)/i)
        ?? content.match(/^-?\s*Tier:\s*(?:Tier\s*)?(\d)/mi);
      const detectedTier = oldMatch ? oldMatch[1] : null;

      if (detectedTier) {
        // Upgrade: append new ## Tier section
        const addition = `\n## Tier\n- ${detectedTier}\n`;
        if (!content.includes('\n## Tier\n')) {
          changed.push(
            `change-classification.md: appended "## Tier\\n- ${detectedTier}" (converted from old format)`,
          );
          if (!dryRun) writeFileSync(classifPath, content + addition, 'utf8');
        }
      } else {
        warnings.push(
          'change-classification.md: could not detect tier (no **Tier:** N or ## Tier N found). ' +
          'gate tier-based agent-log checks will be skipped for this change.',
        );
      }
    }
  }

  return { changed, warnings };
}

export async function migrate(changeId?: string, opts: MigrateOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const dryRun = opts.dryRun ?? false;

  const idsToMigrate: string[] = [];

  if (opts.all) {
    const changesDir = join(cwd, 'specs', 'changes');
    if (!existsSync(changesDir)) {
      log.info('No specs/changes/ directory found — nothing to migrate.');
      return;
    }
    idsToMigrate.push(
      ...readdirSync(changesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name),
    );
  } else if (changeId) {
    // Validate specific change exists before proceeding
    const specificDir = join(cwd, 'specs', 'changes', changeId);
    if (!existsSync(specificDir)) {
      log.error(`Change not found: specs/changes/${changeId}`);
      process.exit(1);
    }
    idsToMigrate.push(changeId);
  } else {
    log.error('Usage: cdd-kit migrate <change-id>  |  cdd-kit migrate --all  [--dry-run]');
    process.exit(1);
  }

  if (idsToMigrate.length === 0) {
    log.info('No changes found to migrate.');
    return;
  }

  if (dryRun) {
    log.info('Dry run — no files will be written.');
    log.blank();
  }

  let migratedCount = 0;
  let upToDateCount = 0;

  for (const id of idsToMigrate) {
    const changeDir = join(cwd, 'specs', 'changes', id);
    if (!existsSync(changeDir)) {
      log.warn(`  ${id}: directory not found — skipping`);
      continue;
    }

    const { changed, warnings } = migrateOne(id, changeDir, dryRun);

    if (changed.length > 0) {
      log.ok(`  ${id}: migrated`);
      for (const c of changed) log.info(`    + ${c}`);
      migratedCount++;
    } else {
      log.info(`  ${id}: already up to date`);
      upToDateCount++;
    }

    for (const w of warnings) {
      log.warn(`  ${id}: ${w}`);
    }
  }

  log.blank();
  if (dryRun) {
    log.info(`Dry run complete: ${migratedCount} change(s) would be updated, ${upToDateCount} already up to date.`);
  } else {
    log.ok(`Migration complete: ${migratedCount} updated, ${upToDateCount} already up to date.`);
    if (migratedCount > 0) {
      log.info('Next: git add specs/changes/ && git commit -m "chore: migrate changes to v1.11.0 format"');
    }
  }
}
