import { execFile } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Scanner, ScannerResult } from './types.js';
import { scanInProcess } from './orchestrator.js';

const CHILD_TIMEOUT_MS = parseInt(process.env['CDD_CODE_MAP_WORKER_TIMEOUT_MS'] ?? '120000', 10);

// Only these language ids may ever reach the spawned worker. The value is an
// internal literal today; the allowlist makes that a hard guarantee so the
// child invocation can never be steered by an unexpected lang string.
const ALLOWED_LANGS = new Set(['js', 'ts', 'vue']);

function chunk<T>(arr: T[], parts: number): T[][] {
  const size = Math.ceil(arr.length / parts);
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function scanChunkInChild(
  cliEntry: string,
  lang: string,
  files: string[],
  repoRoot: string,
): Promise<ScannerResult> {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_LANGS.has(lang)) {
      return reject(new Error(`refusing to spawn worker for unknown lang: ${lang}`));
    }
    // Unpredictable temp filename + owner-only mode: avoids symlink/race attacks
    // on the shared tmp dir (CWE-377). `randomBytes` is used instead of
    // Math.random so the name cannot be guessed by a co-located process.
    const listFile = join(
      tmpdir(),
      `cdd-cm-worker-${process.pid}-${randomBytes(12).toString('hex')}.txt`,
    );
    writeFileSync(listFile, files.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    // execFile (not exec) with an explicit args array and no shell: arguments
    // are passed straight to execve, so there is no shell-interpolation /
    // command-injection surface even though some args are computed.
    execFile(
      process.execPath,
      [cliEntry, '__code-map-scan', '--lang', lang, '--batch-file', listFile, '--repo-root', repoRoot],
      { encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 100 * 1024 * 1024, shell: false, windowsHide: true },
      (err, stdout) => {
        try { unlinkSync(listFile); } catch { /* ok */ }
        if (err) return reject(err);
        try {
          const parsed = JSON.parse(stdout) as Partial<ScannerResult>;
          resolve({ entries: parsed.entries ?? [], warnings: parsed.warnings ?? [] });
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

/**
 * Scan one language's files across up to `workers` child processes. On ANY
 * child failure (crash, timeout, unparseable output) it falls back to a single
 * reliable in-process scan, so enabling workers can never make a run fail that
 * would otherwise succeed. The parent re-sorts merged entries, so the result is
 * identical to single-process scanning regardless of chunk distribution.
 */
export async function scanLangWithWorkers(
  scanner: Scanner,
  lang: string,
  files: string[],
  repoRoot: string,
  workers: number,
  cliEntry: string,
): Promise<ScannerResult> {
  if (files.length === 0) return { entries: [], warnings: [] };

  const chunks = chunk(files, Math.max(1, Math.min(workers, files.length)));
  try {
    const results = await Promise.all(
      chunks.map(c => scanChunkInChild(cliEntry, lang, c, repoRoot)),
    );
    return {
      entries: results.flatMap(r => r.entries),
      warnings: results.flatMap(r => r.warnings),
    };
  } catch {
    return scanInProcess(scanner, files, repoRoot);
  }
}
