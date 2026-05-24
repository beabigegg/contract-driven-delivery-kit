import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Scanner, ScannerResult, FileEntry } from '../types.js';
import { ASSET } from '../../utils/paths.js';
import { canonicalRelPath } from './common.js';

const TIMEOUT_MS = parseInt(process.env['CDD_CODE_MAP_TIMEOUT_MS'] ?? '30000', 10);

/**
 * Max .py files handed to a single interpreter subprocess. The whole list used
 * to be scanned in one spawn sharing one timeout and one 50MB stdout buffer, so
 * a large Python repo could blow the timeout or buffer and silently drop EVERY
 * file. Chunking gives each batch its own timeout/buffer and preserves the
 * results of completed chunks even if a later one fails. Override with
 * CDD_CODE_MAP_BATCH_SIZE.
 */
const BATCH_SIZE = Math.max(
  1,
  parseInt(process.env['CDD_CODE_MAP_BATCH_SIZE'] ?? '400', 10) || 400,
);

interface PythonFileResult {
  path: string;
  ok: true;
  total_lines: number;
  imports: FileEntry['imports'];
  constants: FileEntry['constants'];
  classes: FileEntry['classes'];
  functions: FileEntry['functions'];
}

interface PythonFileError {
  path: string;
  ok: false;
  error: string;
}

type PythonLine = PythonFileResult | PythonFileError;

/**
 * Detect the Python interpreter once and cache the result.
 */
function detectPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    try {
      const result = spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      if (result.status === 0) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

class PythonScanner implements Scanner {
  readonly extensions = ['.py'] as const;

  private _interpreter: string | null | undefined = undefined;

  private getInterpreter(): string | null {
    if (this._interpreter === undefined) {
      this._interpreter = detectPython();
    }
    return this._interpreter;
  }

  async scan(absolutePath: string, repoRoot: string): Promise<FileEntry | null> {
    const result = await this.scanBatch!([absolutePath], repoRoot);
    return result.entries[0] ?? null;
  }

  async scanBatch(absolutePaths: string[], repoRoot: string): Promise<ScannerResult> {
    const interpreter = this.getInterpreter();
    const entries: FileEntry[] = [];
    const warnings: ScannerResult['warnings'] = [];

    if (!interpreter) {
      const count = absolutePaths.length;
      warnings.push({
        path: '',
        message: `python interpreter not found on PATH; skipping ${count} .py file${count === 1 ? '' : 's'}`,
      });
      return { entries, warnings };
    }

    // Scan in chunks so one timeout / buffer overflow cannot drop every file.
    for (let i = 0; i < absolutePaths.length; i += BATCH_SIZE) {
      const chunk = absolutePaths.slice(i, i + BATCH_SIZE);
      const result = this.scanChunk(interpreter, chunk, repoRoot);
      entries.push(...result.entries);
      warnings.push(...result.warnings);
      // An interpreter that is missing or too old fails identically for every
      // chunk, so stop after the first such verdict instead of repeating it.
      if (result.abortRemaining) {
        const remaining = absolutePaths.length - (i + chunk.length);
        if (remaining > 0) {
          warnings.push({
            path: '',
            message: `skipping ${remaining} more .py file(s) after fatal interpreter error`,
          });
        }
        break;
      }
    }

    return { entries, warnings };
  }

  private scanChunk(
    interpreter: string,
    absolutePaths: string[],
    repoRoot: string,
  ): ScannerResult & { abortRemaining?: boolean } {
    const entries: FileEntry[] = [];
    const warnings: ScannerResult['warnings'] = [];

    const scriptPath = ASSET.codeMapPython;
    const listFile = join(tmpdir(), `cdd-codemap-${process.pid}-${randomBytes(12).toString('hex')}.txt`);

    writeFileSync(listFile, absolutePaths.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });

    let stdout = '';
    let stderr = '';
    let exitCode: number | null = 0;

    try {
      const result = spawnSync(
        interpreter,
        [scriptPath, '--batch-file', listFile, '--repo-root', repoRoot],
        {
          encoding: 'utf8',
          timeout: TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,  // 50MB
        },
      );
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
      exitCode = result.status ?? -1;

      if (result.error) {
        const errMsg = result.error.message ?? String(result.error);
        if (errMsg.includes('ENOENT')) {
          warnings.push({
            path: '',
            message: `python interpreter not found (ENOENT); skipping ${absolutePaths.length} .py file(s)`,
          });
          return { entries, warnings, abortRemaining: true };
        }
        if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout')) {
          warnings.push({
            path: '',
            message: `python scanner timed out after ${TIMEOUT_MS}ms on a batch of ${absolutePaths.length} file(s); skipping this batch (raise CDD_CODE_MAP_TIMEOUT_MS or lower CDD_CODE_MAP_BATCH_SIZE)`,
          });
          return { entries, warnings };
        }
        warnings.push({
          path: '',
          message: `python scanner error: ${errMsg}; skipping this batch of ${absolutePaths.length} .py file(s)`,
        });
        return { entries, warnings };
      }
    } finally {
      try { unlinkSync(listFile); } catch { /* ok */ }
    }

    // Exit code 3 = Python < 3.9
    if (exitCode === 3) {
      warnings.push({
        path: '',
        message: 'python interpreter is < 3.9 (need ast.unparse); skipping .py files',
      });
      return { entries, warnings, abortRemaining: true };
    }

    // Parse NDJSON output
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: PythonLine;
      try {
        parsed = JSON.parse(trimmed) as PythonLine;
      } catch {
        // non-JSON line — skip
        continue;
      }

      if (!parsed.ok) {
        warnings.push({ path: parsed.path, message: (parsed as PythonFileError).error });
        continue;
      }

      const r = parsed as PythonFileResult;
      entries.push({
        path: canonicalRelPath(join(repoRoot, r.path), repoRoot),
        total_lines: r.total_lines,
        imports: r.imports ?? [],
        constants: r.constants ?? [],
        classes: (r.classes ?? []).map(c => ({
          name: c.name,
          lines: [c.lines[0], c.lines[1]] as [number, number],
          methods: (c.methods ?? []).map((m: { name: string; lines: [number, number]; async: boolean }) => ({
            name: m.name,
            lines: [m.lines[0], m.lines[1]] as [number, number],
            async: m.async,
          })),
        })),
        functions: (r.functions ?? []).map(f => ({
          name: f.name,
          lines: [f.lines[0], f.lines[1]] as [number, number],
          decorators: f.decorators ?? [],
          async: f.async,
        })),
      });
    }

    // Exit code 2 = fatal (but some entries may have been emitted before crash)
    if (exitCode === 2) {
      warnings.push({
        path: '',
        message: `python scanner exited with code 2 (fatal); partial results only. stderr: ${stderr.slice(0, 200)}`,
      });
    }

    return { entries, warnings };
  }
}

export const pythonScanner = new PythonScanner();
