import { readdirSync, statSync, type Dirent } from 'fs';
import { join } from 'path';
import picomatch from 'picomatch';

// Re-export built-in defaults from config.ts so any external caller still finds them
// at the include-exclude module path. The single source of truth is config.ts.
export { BUILTIN_INCLUDE as DEFAULT_INCLUDE, BUILTIN_EXCLUDE as DEFAULT_EXCLUDE } from './config.js';

export interface WalkOptions {
  /**
   * Full include glob list — caller is responsible for combining built-ins
   * with user/CLI additions before calling. Empty list means "no files match".
   */
  include?: string[];
  /**
   * Full exclude glob list — same caller-resolved-set semantics as include.
   */
  exclude?: string[];
}

/**
 * Walk a repo root and return absolute paths of files matching include and not
 * matching exclude. NO defaults are prepended — callers must pass the full
 * resolved list (typically via loadCodeMapConfig).
 */
export function walkRepo(root: string, opts: WalkOptions = {}): string[] {
  const includes = opts.include ?? [];
  const excludes = opts.exclude ?? [];

  if (includes.length === 0) return [];

  const isIncluded = picomatch(includes, { dot: true });
  const isExcluded = excludes.length > 0
    ? picomatch(excludes, { dot: true })
    : () => false;

  const results: string[] = [];

  function walk(dir: string, relDir: string): void {
    let entries: Dirent[];
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
