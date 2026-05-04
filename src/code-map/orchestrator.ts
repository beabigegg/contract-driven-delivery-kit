import type { Scanner, ScannerResult, FileEntry } from './types.js';
import { walkRepo, type WalkOptions } from './include-exclude.js';

export interface OrchestratorOptions extends WalkOptions {
  maxLines?: number;
}

/**
 * Run a scanner on a list of files sequentially (in-process scanners).
 * Returns a merged ScannerResult.
 */
export async function scanInProcess(
  scanner: Scanner,
  absolutePaths: string[],
  repoRoot: string,
): Promise<ScannerResult> {
  const entries: FileEntry[] = [];
  const warnings: ScannerResult['warnings'] = [];

  for (const absPath of absolutePaths) {
    try {
      const entry = await scanner.scan(absPath, repoRoot);
      if (entry === null) {
        // null means unparseable — warning already emitted by caller convention
        const rel = absPath.replace(/\\/g, '/').replace(repoRoot.replace(/\\/g, '/') + '/', '');
        warnings.push({ path: rel, message: 'parse error (scanner returned null)' });
      } else {
        entries.push(entry);
      }
    } catch (err) {
      const rel = absPath.replace(/\\/g, '/').replace(repoRoot.replace(/\\/g, '/') + '/', '');
      warnings.push({ path: rel, message: `IO error: ${(err as Error).message}` });
    }
  }

  return { entries, warnings };
}

/**
 * Group absolute paths by their lowercase extension.
 */
export function bucketByExtension(files: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of files) {
    const dot = f.lastIndexOf('.');
    const ext = dot >= 0 ? f.slice(dot).toLowerCase() : '';
    if (!out[ext]) out[ext] = [];
    out[ext].push(f);
  }
  return out;
}

/**
 * Walk the repo and return all source files.
 * Re-exports walkRepo for use by the command layer.
 */
export { walkRepo };
