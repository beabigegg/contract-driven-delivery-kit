import { spawnSync, SpawnSyncReturns } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the built CLI entry point */
export const CLI_PATH = resolve(__dirname, '..', 'dist', 'cli', 'index.js');

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

/**
 * Spawn the CLI with the given args.
 * HOME and USERPROFILE are both forced to `home` so os.homedir() resolves
 * there on both Windows (USERPROFILE) and Unix (HOME).
 */
export function runCli(
  args: string[],
  opts: { cwd: string; home: string; env?: Record<string, string> },
): RunResult {
  const result: SpawnSyncReturns<Buffer> = spawnSync(
    process.execPath,
    [CLI_PATH, ...args],
    {
      cwd: opts.cwd,
      env: {
        ...process.env,
        HOME: opts.home,
        USERPROFILE: opts.home,
        ...(opts.env ?? {}),
      },
      encoding: 'buffer',
      // Collect stdout/stderr separately so we can inspect both
    },
  );

  return {
    stdout: result.stdout?.toString('utf8') ?? '',
    stderr: result.stderr?.toString('utf8') ?? '',
    status: result.status,
  };
}

/** Create a unique temporary directory with the given prefix */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Remove a temporary directory tree */
export function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Return true if a usable Python interpreter is on PATH */
export function hasPython(): boolean {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'pipe' });
    if (r.status === 0) return true;
  }
  return false;
}
