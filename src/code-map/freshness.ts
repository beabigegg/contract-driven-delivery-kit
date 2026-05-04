import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { walkRepo } from './include-exclude.js';
import { loadCodeMapConfig } from './config.js';

export interface FreshnessResult {
  status: 'ok' | 'stale' | 'missing-with-sources' | 'missing-greenfield';
  staleFiles: string[];   // up to 5
  staleCount: number;     // total
  mapPath: string;
}

/**
 * Check whether .cdd/code-map.yml is fresh relative to source files.
 *
 * Uses the resolved code-map config (built-in defaults, optionally replaced by
 * .cdd/code-map-config.yml). Caller-supplied include/exclude are appended on
 * top — passed through for callers (e.g. tests) that want to narrow further.
 */
export function checkCodeMapFreshness(
  cwd: string,
  mapRel: string = '.cdd/code-map.yml',
  include?: string[],
  exclude?: string[],
): FreshnessResult {
  const mapPath = join(cwd, mapRel);

  let cfg;
  try {
    cfg = loadCodeMapConfig(cwd);
  } catch {
    // On config error, fall back to empty (treat as if no source files match —
    // gate's main config-validation path will surface the error elsewhere).
    cfg = { include: [] as string[], exclude: [] as string[], source: 'builtin' as const };
  }
  const includeFinal = [...cfg.include, ...(include ?? [])];
  const excludeFinal = [...cfg.exclude, ...(exclude ?? [])];

  const sourceFiles = walkRepo(cwd, { include: includeFinal, exclude: excludeFinal });

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
