import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { walkRepo } from './include-exclude.js';

export interface FreshnessResult {
  status: 'ok' | 'stale' | 'missing-with-sources' | 'missing-greenfield';
  staleFiles: string[];   // up to 5
  staleCount: number;     // total
  mapPath: string;
}

/**
 * Check whether .cdd/code-map.yml is fresh relative to source files.
 */
export function checkCodeMapFreshness(
  cwd: string,
  mapRel: string = '.cdd/code-map.yml',
  include?: string[],
  exclude?: string[],
): FreshnessResult {
  const mapPath = join(cwd, mapRel);

  const sourceFiles = walkRepo(cwd, { include, exclude });

  if (!existsSync(mapPath)) {
    if (sourceFiles.length === 0) {
      return { status: 'missing-greenfield', staleFiles: [], staleCount: 0, mapPath };
    }
    return { status: 'missing-with-sources', staleFiles: [], staleCount: 0, mapPath };
  }

  const mapMtime = statSync(mapPath).mtimeMs;

  const staleAll: string[] = [];
  for (const absPath of sourceFiles) {
    try {
      const mtime = statSync(absPath).mtimeMs;
      if (mtime > mapMtime) {
        // Compute repo-relative path
        const rel = absPath.replace(/\\/g, '/').replace(cwd.replace(/\\/g, '/') + '/', '');
        staleAll.push(rel);
      }
    } catch {
      // file vanished between walk and stat — ignore
    }
  }

  if (staleAll.length === 0) {
    return { status: 'ok', staleFiles: [], staleCount: 0, mapPath };
  }

  return {
    status: 'stale',
    staleFiles: staleAll.slice(0, 5),
    staleCount: staleAll.length,
    mapPath,
  };
}
