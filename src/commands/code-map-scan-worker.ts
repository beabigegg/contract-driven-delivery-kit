import { readFileSync } from 'fs';
import { scanInProcess } from '../code-map/orchestrator.js';
import type { Scanner } from '../code-map/types.js';

export interface ScanWorkerOptions {
  lang: string;
  batchFile: string;
  repoRoot: string;
}

/**
 * Hidden `__code-map-scan` worker. `cdd-kit code-map --workers N` forks the CLI
 * with this subcommand once per file chunk so JS/TS/Vue parsing (synchronous
 * Babel work) runs across several processes instead of one. It scans the chunk
 * in-process and writes a single ScannerResult JSON to stdout; the parent merges
 * and re-sorts, so output is identical to a single-process run.
 */
export async function runScanWorker(opts: ScanWorkerOptions): Promise<number> {
  let scanner: Scanner;
  switch (opts.lang) {
    case 'js':
      scanner = (await import('../code-map/scanners/javascript.js')).jsScanner;
      break;
    case 'ts':
      scanner = (await import('../code-map/scanners/typescript.js')).tsScanner;
      break;
    case 'vue':
      scanner = (await import('../code-map/scanners/vue.js')).vueScanner;
      break;
    default:
      process.stderr.write(`__code-map-scan: unknown --lang "${opts.lang}"\n`);
      return 1;
  }

  let files: string[];
  try {
    files = readFileSync(opts.batchFile, 'utf8')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  } catch (err) {
    process.stderr.write(`__code-map-scan: cannot read --batch-file: ${(err as Error).message}\n`);
    return 1;
  }

  const result = await scanInProcess(scanner, files, opts.repoRoot);
  process.stdout.write(JSON.stringify(result));
  return 0;
}
