import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { ASSET, AGENTS_HOME, SKILLS_HOME, CODEX_SKILLS_HOME, readKitVersion } from '../utils/paths.js';
import { log } from '../utils/logger.js';
import { homedir } from 'os';
import { inferProvider, validateProviderOption, type Provider, type ProviderOption } from '../utils/provider.js';
import { isOwnedAndUnmodified, loadUserAssetManifest, stampUserAssets, type UserAssetProvider } from '../utils/user-asset-manifest.js';

export interface UpdateOptions {
  yes: boolean;
  provider?: ProviderOption;
  postinstall?: boolean;
  /** Internal migration mode: add missing files and update only package-owned, unmodified files. */
  preserveModified?: boolean;
}

function fileHash(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

interface DiffEntry {
  src: string;
  dest: string;
  provider: UserAssetProvider;
  action: 'add' | 'overwrite' | 'skip';
}

function diffDir(src: string, dest: string, provider: UserAssetProvider): DiffEntry[] {
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
          entries.push({ src: srcPath, dest: destPath, provider, action: 'add' });
        } else if (fileHash(srcPath) !== fileHash(destPath)) {
          entries.push({ src: srcPath, dest: destPath, provider, action: 'overwrite' });
        } else {
          entries.push({ src: srcPath, dest: destPath, provider, action: 'skip' });
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
  if (opts.postinstall) {
    const manifest = loadUserAssetManifest();
    if (manifest.providers.length === 0) return;
    opts.yes = true;
    opts.provider = manifest.providers.length === 2 ? 'both' : manifest.providers[0];
  }

  const quiet = !!opts.postinstall;

  if (!quiet) log.blank();

  const cwd = process.cwd();
  const requestedProvider = opts.provider ?? 'auto';
  if (!validateProviderOption(requestedProvider)) {
    log.error(`Invalid provider: ${requestedProvider}. Use auto, claude, codex, or both.`);
    process.exit(1);
  }

  const provider = inferProvider(cwd, requestedProvider);
  const updateClaudeAssets = provider === 'claude' || provider === 'both';
  const updateCodexAssets = provider === 'codex' || provider === 'both';
  const selectedProviderIds: UserAssetProvider[] = [
    ...(updateClaudeAssets ? ['claude' as const] : []),
    ...(updateCodexAssets ? ['codex' as const] : []),
  ];

  const agentDiff = updateClaudeAssets ? diffDir(ASSET.agents, AGENTS_HOME, 'claude') : [];
  const skillDiff = updateClaudeAssets
    ? readdirSync(ASSET.skills, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .flatMap(d => diffDir(join(ASSET.skills, d.name), join(SKILLS_HOME, d.name), 'claude'))
    : [];
  const codexSkillDiff = updateCodexAssets
    ? readdirSync(ASSET.codexSkills, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .flatMap(d => diffDir(join(ASSET.codexSkills, d.name), join(CODEX_SKILLS_HOME, d.name), 'codex'))
    : [];

  const allDiff = [...agentDiff, ...skillDiff, ...codexSkillDiff];
  const plannedWrites = allDiff.filter((e) => e.action !== 'skip');
  // npm postinstall is intentionally conservative: it can update only files
  // previously stamped by cdd-kit and still byte-identical to that stamp.
  const conservative = !!opts.postinstall || !!opts.preserveModified;
  const toWrite = conservative
    ? plannedWrites.filter((e) => e.action === 'add' || (e.action === 'overwrite' && isOwnedAndUnmodified(e.dest)))
    : plannedWrites;
  const protectedUserAssets = conservative ? plannedWrites.filter(entry => !toWrite.includes(entry)) : [];
  const toAdd   = toWrite.filter((e) => e.action === 'add');
  const toOver  = toWrite.filter((e) => e.action === 'overwrite');
  const toSkip  = allDiff.filter((e) => e.action === 'skip');
  const writeSet = new Set(toWrite);

  if (!quiet) {
    log.info(`Provider: ${provider}`);
    if (updateClaudeAssets) {
      log.info(`Dry-run diff — agents: ${AGENTS_HOME}`);
      log.info(`Dry-run diff — skills: ${SKILLS_HOME}`);
    }
    if (updateCodexAssets) {
      log.info(`Dry-run diff — Codex skills: ${CODEX_SKILLS_HOME}`);
    }
    log.blank();
    if (toAdd.length)  log.info(`  + ${toAdd.length} file(s) would be added`);
    if (toOver.length) log.warn(`  ~ ${toOver.length} file(s) would be overwritten (user edits lost without backup)`);
    if (toSkip.length) log.dim(`    ${toSkip.length} file(s) unchanged (skipped)`);
    if (protectedUserAssets.length) log.warn(`  ! ${protectedUserAssets.length} customized or unowned file(s) preserved`);
  }

  if (toWrite.length === 0) {
    if (!opts.postinstall) {
      for (const providerId of selectedProviderIds) {
        stampUserAssets(
          providerId,
          allDiff.filter(entry => entry.provider === providerId && entry.action === 'skip').map(entry => entry.dest),
          readKitVersion(),
        );
      }
    }
    if (!quiet) {
      log.blank();
      log.ok('Already up to date — nothing to write.');
      log.blank();
    }
    return;
  }

  if (!quiet && !opts.yes) {
    log.blank();
    log.info('Run with --yes to apply changes. Example:');
    log.dim('  cdd-kit update --yes');
    log.blank();
    return;
  }

  // Backup existing dirs before writing
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = join(homedir(), '.cdd-kit', 'backups', timestamp);

  if (!quiet) {
    log.blank();
    log.info(`Backing up to ${backupRoot} …`);
  }
  backupDir(AGENTS_HOME, join(backupRoot, 'agents'));
  backupDir(SKILLS_HOME, join(backupRoot, 'skills'));
  backupDir(CODEX_SKILLS_HOME, join(backupRoot, 'codex-skills'));
  if (!quiet) log.ok(`Backup complete: ${backupRoot}`);

  if (!quiet) log.blank();
  let totalSynced = 0;
  if (updateClaudeAssets) {
    if (!quiet) log.info(`Updating agents → ${AGENTS_HOME}`);
    const agentCount = applyDir(agentDiff.filter(entry => writeSet.has(entry)));
    if (!quiet) log.ok(`${agentCount} agent file(s) updated.`);
    totalSynced += agentCount;

    if (!quiet) log.info(`Updating skills → ${SKILLS_HOME}`);
    const skillCount = applyDir(skillDiff.filter(entry => writeSet.has(entry)));
    if (!quiet) log.ok(`${skillCount} skill file(s) updated.`);
    totalSynced += skillCount;
  }
  if (updateCodexAssets) {
    if (!quiet) log.info(`Updating Codex skills → ${CODEX_SKILLS_HOME}`);
    const codexSkillCount = applyDir(codexSkillDiff.filter(entry => writeSet.has(entry)));
    if (!quiet) log.ok(`${codexSkillCount} Codex skill file(s) updated.`);
    totalSynced += codexSkillCount;
  }
  const writtenOrCurrent = allDiff
    .filter(entry => entry.action === 'skip' || toWrite.includes(entry))
    .filter(entry => existsSync(entry.dest));
  for (const providerId of selectedProviderIds) {
    stampUserAssets(providerId, writtenOrCurrent.filter(entry => entry.provider === providerId).map(entry => entry.dest), readKitVersion());
  }

  if (quiet) {
    if (totalSynced > 0) log.ok(`cdd-kit: synced ${totalSynced} user-level provider asset(s)`);
  } else {
    log.blank();
    log.info('Project files (contracts/, specs/, tests/, ci/) were not changed.');
    log.ok('Update complete.');
    log.info(`Backup saved to: ${backupRoot}`);
    log.blank();
  }
}
