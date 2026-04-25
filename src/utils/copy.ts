import {
  mkdirSync,
  cpSync,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
  constants as fsConstants,
} from 'fs';
import { join, dirname, relative } from 'path';
import { log } from './logger.js';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function copyDir(
  src: string,
  dest: string,
  opts: { overwrite?: boolean; label?: string } = {},
): number {
  const { overwrite = true, label } = opts;
  if (!existsSync(src)) {
    log.warn(`source not found, skipping: ${label ?? src}`);
    return 0;
  }
  ensureDir(dest);

  let count = 0;

  function walk(currentSrc: string, currentDest: string): void {
    const entries = readdirSync(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath  = join(currentSrc, entry.name);
      const destPath = join(currentDest, entry.name);

      if (entry.isDirectory()) {
        ensureDir(destPath);
        walk(srcPath, destPath);
      } else {
        if (!overwrite && existsSync(destPath)) {
          const relPath = label
            ? join(label, relative(dest, destPath))
            : relative(dest, destPath);
          log.dim(`skip ${relPath}`);
          continue;
        }
        ensureDir(dirname(destPath));
        copyFileSync(srcPath, destPath);
        count += 1;
      }
    }
  }

  walk(src, dest);
  return count;
}

/**
 * Like copyDir but returns the list of destination paths that were newly created
 * (did not exist before the call). Used by init for rollback tracking.
 */
export function copyDirTracked(
  src: string,
  dest: string,
  opts: { overwrite?: boolean; label?: string } = {},
): { count: number; created: string[] } {
  const { overwrite = true, label } = opts;
  if (!existsSync(src)) {
    log.warn(`source not found, skipping: ${label ?? src}`);
    return { count: 0, created: [] };
  }
  ensureDir(dest);

  let count = 0;
  const created: string[] = [];

  function walk(currentSrc: string, currentDest: string): void {
    const entries = readdirSync(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath  = join(currentSrc, entry.name);
      const destPath = join(currentDest, entry.name);

      if (entry.isDirectory()) {
        const isNew = !existsSync(destPath);
        ensureDir(destPath);
        if (isNew) created.push(destPath);
        walk(srcPath, destPath);
      } else {
        if (!overwrite && existsSync(destPath)) {
          const relPath = label
            ? join(label, relative(dest, destPath))
            : relative(dest, destPath);
          log.dim(`skip ${relPath}`);
          continue;
        }
        const isNew = !existsSync(destPath);
        ensureDir(dirname(destPath));
        copyFileSync(srcPath, destPath);
        if (isNew) created.push(destPath);
        count += 1;
      }
    }
  }

  walk(src, dest);
  return { count, created };
}

export function copyFile(
  src: string,
  dest: string,
  opts: { overwrite?: boolean; label?: string } = {},
): boolean {
  const { overwrite = true, label } = opts;

  if (!existsSync(src)) {
    log.warn(`source not found, skipping: ${label ?? src}`);
    return false;
  }

  if (!overwrite && existsSync(dest)) {
    log.dim(`skip ${label ?? dest}`);
    return false;
  }

  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  return true;
}

/**
 * Like copyFile but tracks whether the destination was newly created.
 */
export function copyFileTracked(
  src: string,
  dest: string,
  opts: { overwrite?: boolean; label?: string } = {},
): { written: boolean; created: boolean } {
  const { overwrite = true, label } = opts;

  if (!existsSync(src)) {
    log.warn(`source not found, skipping: ${label ?? src}`);
    return { written: false, created: false };
  }

  if (!overwrite && existsSync(dest)) {
    log.dim(`skip ${label ?? dest}`);
    return { written: false, created: false };
  }

  const isNew = !existsSync(dest);
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  return { written: true, created: isNew };
}
