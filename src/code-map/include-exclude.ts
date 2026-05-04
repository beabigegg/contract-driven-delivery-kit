import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import picomatch from 'picomatch';

export const DEFAULT_INCLUDE = ['**/*.py', '**/*.js', '**/*.vue'];
export const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/__pycache__/**',
  '**/.git/**',
  '**/.cdd/**',
  '**/.venv/**',
  '**/venv/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/out/**',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  'specs/archive/**',
  '**/*.min.js',
];

export interface WalkOptions {
  include?: string[];
  exclude?: string[];
}

/**
 * Walk a repo root and return absolute paths of all matching source files.
 * Applies include/exclude globs via picomatch.
 */
export function walkRepo(root: string, opts: WalkOptions = {}): string[] {
  const includes = [...DEFAULT_INCLUDE, ...(opts.include ?? [])];
  const excludes = [...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])];

  const isIncluded = picomatch(includes, { dot: true });
  const isExcluded = picomatch(excludes, { dot: true });

  const results: string[] = [];

  function walk(dir: string, relDir: string): void {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absPath = join(dir, entry.name);

      if (entry.isDirectory() || entry.isSymbolicLink()) {
        // Fast-path: skip directories that match exclude patterns
        const dirPattern = `${relPath}/**`;
        if (isExcluded(relPath) || isExcluded(dirPattern)) continue;

        try {
          const stat = statSync(absPath);
          if (stat.isDirectory()) {
            walk(absPath, relPath);
          }
        } catch {
          // skip unreadable symlinks / vanished dirs
        }
        continue;
      }

      if (!entry.isFile()) continue;

      // Check exclude first, then include
      if (isExcluded(relPath)) continue;
      if (!isIncluded(relPath)) continue;

      results.push(absPath);
    }
  }

  walk(root, '');
  return results;
}
