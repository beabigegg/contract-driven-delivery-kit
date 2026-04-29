import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { ASSET, AGENTS_HOME, SKILLS_HOME } from '../utils/paths.js';
import { log } from '../utils/logger.js';
import { homedir } from 'os';
import { inferProvider, validateProviderOption, type Provider, type ProviderOption } from '../utils/provider.js';

export interface UpdateOptions {
  yes: boolean;
  provider?: ProviderOption;
}

function fileHash(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

interface DiffEntry {
  src: string;
  dest: string;
  action: 'add' | 'overwrite' | 'skip';
}

function diffDir(src: string, dest: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  if (!existsSync(src)) return entries;

  function walk(currentSrc: string, currentDest: string): void {
    const items = readdirSync(currentSrc, { withFileTypes: true });
    for (const item of items) {
      const srcPath  = join(currentSrc, item.name);
      const destPath = join(currentDest, item.name);
      if (item.isDirectory()) {
        walk(srcPath, destPath);
      } else {
        if (!existsSync(destPath)) {
          entries.push({ src: srcPath, dest: destPath, action: 'add' });
        } else if (fileHash(srcPath) !== fileHash(destPath)) {
          entries.push({ src: srcPath, dest: destPath, action: 'overwrite' });
        } else {
          entries.push({ src: srcPath, dest: destPath, action: 'skip' });
        }
      }
    }
  }

  walk(src, dest);
  return entries;
}

function applyDir(entries: DiffEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.action === 'skip') continue;
    mkdirSync(join(e.dest, '..'), { recursive: true });
    copyFileSync(e.src, e.dest);
    count += 1;
  }
  return count;
}

function backupDir(dir: string, backupDest: string): void {
  if (!existsSync(dir)) return;
  mkdirSync(backupDest, { recursive: true });
  function walk(src: string, dst: string): void {
    const items = readdirSync(src, { withFileTypes: true });
    for (const item of items) {
      const s = join(src, item.name);
      const d = join(dst, item.name);
      if (item.isDirectory()) { mkdirSync(d, { recursive: true }); walk(s, d); }
      else copyFileSync(s, d);
    }
  }
  walk(dir, backupDest);
}

export async function update(opts: UpdateOptions): Promise<void> {
  log.blank();

  const cwd = process.cwd();
  const requestedProvider = opts.provider ?? 'auto';
  if (!validateProviderOption(requestedProvider)) {
    log.error(`Invalid provider: ${requestedProvider}. Use auto, claude, codex, or both.`);
    process.exit(1);
  }

  const provider = inferProvider(cwd, requestedProvider);
  const updateClaudeAssets = provider === 'claude' || provider === 'both';
  const skillDest = join(SKILLS_HOME, 'contract-driven-delivery');

  const agentDiff = updateClaudeAssets ? diffDir(ASSET.agents, AGENTS_HOME) : [];
  const skillDiff = updateClaudeAssets ? diffDir(ASSET.skill, skillDest) : [];

  const toWrite = [...agentDiff, ...skillDiff].filter((e) => e.action !== 'skip');
  const toAdd   = toWrite.filter((e) => e.action === 'add');
  const toOver  = toWrite.filter((e) => e.action === 'overwrite');
  const toSkip  = [...agentDiff, ...skillDiff].filter((e) => e.action === 'skip');

  log.info(`Provider: ${provider}`);
  if (updateClaudeAssets) {
    log.info(`Dry-run diff — agents: ${AGENTS_HOME}`);
    log.info(`Dry-run diff — skill:  ${skillDest}`);
  } else {
    log.info('Codex provider has no global cdd-kit assets to update.');
    log.info('Project files are preserved; run cdd-kit init --local-only --provider codex to add missing local guidance.');
  }
  log.blank();
  if (toAdd.length)  log.info(`  + ${toAdd.length} file(s) would be added`);
  if (toOver.length) log.warn(`  ~ ${toOver.length} file(s) would be overwritten (user edits lost without backup)`);
  if (toSkip.length) log.dim(`    ${toSkip.length} file(s) unchanged (skipped)`);

  if (toWrite.length === 0) {
    log.blank();
    log.ok('Already up to date — nothing to write.');
    log.blank();
    return;
  }

  if (!opts.yes) {
    log.blank();
    log.info('Run with --yes to apply changes. Example:');
    log.dim('  cdd-kit update --yes');
    log.blank();
    return;
  }

  // Backup existing dirs before writing
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = join(homedir(), '.claude', '.cdd-kit-backup', timestamp);

  log.blank();
  log.info(`Backing up to ${backupRoot} …`);
  backupDir(AGENTS_HOME, join(backupRoot, 'agents'));
  backupDir(skillDest,   join(backupRoot, 'skill'));
  log.ok(`Backup complete: ${backupRoot}`);

  log.blank();
  if (updateClaudeAssets) {
    log.info(`Updating agents → ${AGENTS_HOME}`);
    const agentCount = applyDir(agentDiff);
    log.ok(`${agentCount} agent file(s) updated.`);

    log.info(`Updating skill  → ${skillDest}`);
    const skillCount = applyDir(skillDiff);
    log.ok(`${skillCount} skill file(s) updated.`);
  }

  log.blank();
  log.info('Project files (contracts/, specs/, tests/, ci/) were not changed.');
  log.ok('Update complete.');
  log.info(`Backup saved to: ${backupRoot}`);
  log.blank();
}
