import { spawnSync, SpawnSyncReturns } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join, resolve, dirname } from 'path';
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

/**
 * On Windows, whether `sh` resolves depends on which terminal launched the
 * suite: Git Bash puts <Git>/usr/bin on PATH, PowerShell/cmd do not — and
 * `bash` there resolves to WSL's C:\Windows\system32\bash.exe, a different
 * root filesystem entirely. `npm publish` runs prepublishOnly under cmd.exe
 * with the invoking shell's PATH, so the same gate passed from Git Bash and
 * false-failed ~40 hook tests from PowerShell. A verdict that depends on the
 * invoking shell is not a gate; resolve Git for Windows' own usr/bin from
 * `git --exec-path` instead of trusting PATH.
 */
let gitPosixBinCache: string | null | undefined;

function gitPosixBinDir(): string | null {
  if (gitPosixBinCache !== undefined) return gitPosixBinCache;
  gitPosixBinCache = null;
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout) {
    // e.g. C:/Program Files/Git/mingw64/libexec/git-core — walk up to the
    // install root that owns usr/bin/sh.exe (depth varies across installs).
    let dir = resolve(r.stdout.trim());
    for (let i = 0; i < 5; i += 1) {
      const candidate = join(dir, 'usr', 'bin');
      if (existsSync(join(candidate, 'sh.exe'))) {
        gitPosixBinCache = candidate;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return gitPosixBinCache;
}

/** Absolute path to Git's sh/bash on Windows; the plain name elsewhere. */
export function posixShell(shell: 'sh' | 'bash' = 'sh'): string {
  if (process.platform !== 'win32') return shell;
  const bin = gitPosixBinDir();
  if (!bin) {
    throw new Error(
      `hook tests need Git for Windows' ${shell}.exe, and usr/bin was not found ` +
        'walking up from `git --exec-path` — install Git for Windows',
    );
  }
  return join(bin, `${shell}.exe`);
}

/**
 * Child env for posixShell() spawns. Git's sh.exe spawned by absolute path
 * does NOT bring grep/sed/… into the child's PATH (measured: `command -v grep`
 * finds nothing), and the hook scripts use them — so prepend Git's usr/bin.
 */
export function posixShellEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return { ...env };
  const bin = gitPosixBinDir();
  if (!bin) return { ...env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const current = env[pathKey];
  return { ...env, [pathKey]: current ? `${bin}${delimiter}${current}` : bin };
}
