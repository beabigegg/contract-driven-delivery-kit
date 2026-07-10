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
 *
 * `CI` is forced empty by default, and a test that wants CI behaviour must ask
 * for it: `env: { CI: 'true' }`. Since `enforceConfirmationHookInstallation`
 * became `ci-or-strict` (contracts/ci 0.7.0), a truthy `CI` turns an unarmed
 * project's hook-presence warning into a hard error. Every CI provider sets
 * `CI=true`, and this helper used to spread `process.env` straight through — so
 * a test asserting `validate` exits 0 on a bare temp repo passed on a laptop and
 * failed on a runner. Measured before the fix: `npx vitest run` was 1416 passed
 * / 0 failed locally, and `CI=true npx vitest run` was 16 failed across 7 files.
 * A test whose meaning depends on where it runs is not a test.
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
        CI: '',
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
