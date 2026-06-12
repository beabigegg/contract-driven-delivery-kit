/**
 * Runtime tests for the graph-first PreToolUse hook
 * (`hooks/pre-tool-use-graph-first.sh`).
 *
 * Installation is covered by install-agent-hooks.test.ts; this file exercises
 * the hook's actual decision logic when Claude Code pipes a Read tool-call to
 * it on stdin. The staleness guard (P1-7/P1-9) is the key behavior: when the
 * file about to be read is newer than the code-map, steering to a stale index
 * would point the agent at wrong data, so the hook must skip the advisory,
 * nudge a map refresh, and never block — even under strict mode.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, utimesSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'pre-tool-use-graph-first.sh');

let cwd: string;

beforeEach(() => {
  cwd = makeTempDir('cdd-graph-hook-');
});

afterEach(() => {
  cleanupDir(cwd);
});

function runHook(filePath: string, env: Record<string, string> = {}): { status: number | null; stderr: string } {
  const r = spawnSync('sh', [HOOK], {
    cwd,
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stderr: (r.stderr ?? '').trim() };
}

/** Write a source file and the code-map with controlled mtimes (file vs map). */
function seed(opts: { fileNewerThanMap: boolean }): void {
  mkdirSync(join(cwd, '.cdd'), { recursive: true });
  writeFileSync(join(cwd, 'foo.ts'), 'export function foo() { return 1; }\n', 'utf8');
  writeFileSync(join(cwd, '.cdd', 'code-map.yml'), '# sources-digest: abc123\nfoo.ts:  # 1 lines\n', 'utf8');
  const base = Date.now();
  const older = new Date(base - 10_000);
  const newer = new Date(base + 10_000);
  const fileTime = opts.fileNewerThanMap ? newer : older;
  const mapTime = opts.fileNewerThanMap ? older : newer;
  utimesSync(join(cwd, 'foo.ts'), fileTime, fileTime);
  utimesSync(join(cwd, '.cdd', 'code-map.yml'), mapTime, mapTime);
}

// POSIX-sh only — the hook is a shell script spawned via `sh`, which is not on
// PATH in a default Windows shell (PowerShell/cmd). Skip on win32, matching the
// sibling hook tests (contract-write-hook, test-runner-hook, install-agent-hooks).
describe.skipIf(process.platform === 'win32')('graph-first hook runtime', () => {
  it('allows silently when no code-map exists', () => {
    writeFileSync(join(cwd, 'foo.ts'), 'export function foo() {}\n', 'utf8');
    const r = runHook('foo.ts');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('prints the graph-first advisory for a fresh map (file older than map)', () => {
    seed({ fileNewerThanMap: false });
    const r = runHook('foo.ts');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/prefer `cdd-kit index query/);
    expect(r.stderr).not.toMatch(/is older than/);
  });

  it('skips the advisory and nudges a refresh when the target file is newer than the map', () => {
    seed({ fileNewerThanMap: true });
    const r = runHook('foo.ts');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/\.cdd\/code-map\.yml is older than foo\.ts/);
    expect(r.stderr).toMatch(/run `cdd-kit code-map`/);
    expect(r.stderr).not.toMatch(/prefer `cdd-kit index query/);
  });

  it('does NOT block a stale-map read even under strict mode', () => {
    seed({ fileNewerThanMap: true });
    const r = runHook('foo.ts', { CDD_GRAPH_FIRST_STRICT: '1' });
    // Strict normally exits 2 to block; a stale index must never force that.
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/is older than/);
  });

  it('blocks (exit 2) under strict mode when the map is fresh', () => {
    seed({ fileNewerThanMap: false });
    const r = runHook('foo.ts', { CDD_GRAPH_FIRST_STRICT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/prefer `cdd-kit index query/);
  });

  it('ignores non-source files', () => {
    seed({ fileNewerThanMap: true });
    const r = runHook('README.md', { CDD_GRAPH_FIRST_STRICT: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});
