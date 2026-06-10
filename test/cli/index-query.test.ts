/**
 * CLI tests for `cdd-kit index query`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'fixtures', 'code-map'
);

function copyFixture(tmpRepo: string, name: string): void {
  copyFileSync(join(FIXTURE_ROOT, name), join(tmpRepo, name));
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('index-query-repo-');
  tmpHome = makeTempDir('index-query-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit index query', () => {
  it('auto-refreshes a missing code-map and returns targeted symbol matches', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const r = runCli(['index', 'query', 'User'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(true);
    expect(r.stdout).toContain('index: .cdd/code-map.yml (refreshed)');
    expect(r.stdout).toContain('- sample.ts');
    expect(r.stdout).toContain('interface: User');
    expect(r.stdout).toContain('type: UserId');
    expect(r.stdout).toContain('Next: read only the listed file/ranges first.');
  });

  it('writes a gitignored JSON sidecar and returns identical results with or without it', () => {
    copyFixture(tmpRepo, 'sample.ts');

    // Generate the map + sidecar up front so both queries can use --no-refresh
    // (a refreshing query would only differ in the `refreshed` flag).
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const sidecar = join(tmpRepo, '.cdd', 'code-map.index.json');
    expect(existsSync(sidecar)).toBe(true);
    expect(readFileSync(join(tmpRepo, '.gitignore'), 'utf8')).toMatch(/\.cdd\/code-map\.index\.json/);

    const withSidecar = runCli(['index', 'query', 'User', '--json', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(withSidecar.status, withSidecar.stderr).toBe(0);

    // The YAML path (sidecar removed) must produce byte-identical output, so
    // the cache can never diverge from the authoritative map.
    rmSync(sidecar);
    const withoutSidecar = runCli(['index', 'query', 'User', '--json', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(withoutSidecar.status, withoutSidecar.stderr).toBe(0);
    expect(withoutSidecar.stdout).toBe(withSidecar.stdout);
  });

  it('ignores a stale sidecar whose digest does not match the map', () => {
    copyFixture(tmpRepo, 'sample.ts');
    runCli(['index', 'query', 'User'], { cwd: tmpRepo, home: tmpHome });

    // Corrupt the sidecar with a wrong digest + bogus entries. The loader must
    // detect the digest mismatch and fall back to the YAML rather than trust it.
    const sidecar = join(tmpRepo, '.cdd', 'code-map.index.json');
    writeFileSync(sidecar, JSON.stringify({ sourcesDigest: 'deadbeef', entries: [] }), 'utf8');

    const r = runCli(['index', 'query', 'User', '--json', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { results: Array<{ path: string }> };
    expect(payload.results.some(res => res.path === 'sample.ts')).toBe(true);
  });

  it('prints clean JSON that agents can parse', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const r = runCli(['index', 'query', 'Status', '--json'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      index: string;
      query: string;
      refreshed: boolean;
      results: Array<{ path: string; matches: Array<{ kind: string; name: string }> }>;
    };
    expect(payload.index).toBe('.cdd/code-map.yml');
    expect(payload.query).toBe('Status');
    expect(payload.refreshed).toBe(true);
    expect(payload.results[0].path).toBe('sample.ts');
    expect(payload.results[0].matches.some(m => m.kind === 'enum' && m.name === 'Status')).toBe(true);
  });

  it('auto-refreshes a stale code-map before querying', () => {
    copyFixture(tmpRepo, 'sample.js');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const samplePath = join(tmpRepo, 'sample.js');
    const existing = readFileSync(samplePath, 'utf8');
    writeFileSync(samplePath, `${existing}\nexport function addedTarget() { return true; }\n`, 'utf8');

    const r = runCli(['index', 'query', 'addedTarget'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('index: .cdd/code-map.yml (refreshed)');
    expect(r.stdout).toContain('function: addedTarget');
  });

  it('honors --no-refresh and fails when the map is missing', () => {
    copyFixture(tmpRepo, 'sample.js');

    const r = runCli(['index', 'query', 'handler', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('.cdd/code-map.yml is missing');
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(false);
  });

  it('reports top-level truncation when --limit hides matching files (P1-7)', () => {
    // Two files both match "alpha"; --limit 1 must report that one was hidden so
    // the agent knows to raise --limit instead of assuming it saw everything.
    writeFileSync(join(tmpRepo, 'a.ts'), 'export function alpha() { return 1; }\n', 'utf8');
    writeFileSync(join(tmpRepo, 'b.ts'), 'export function alphaTwo() { return 2; }\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    const r = runCli(['index', 'query', 'alpha', '--limit', '1', '--json', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { total_matches: number; returned: number; truncated: boolean; results: unknown[] };
    expect(payload.total_matches).toBeGreaterThanOrEqual(2);
    expect(payload.returned).toBe(1);
    expect(payload.truncated).toBe(true);
    expect(payload.results.length).toBe(1);

    const text = runCli(['index', 'query', 'alpha', '--limit', '1', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(text.stdout).toMatch(/results: 1 \(of \d+; raise --limit/);
  });

  it('marks a full result set as not truncated and exposes the count fields (P1-7)', () => {
    writeFileSync(join(tmpRepo, 'solo.ts'), 'export function loneSymbol() { return 1; }\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    const r = runCli(['index', 'query', 'loneSymbol', '--json', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { total_matches: number; returned: number; truncated: boolean };
    expect(payload.truncated).toBe(false);
    expect(payload.total_matches).toBe(payload.returned);
  });

  it('flags per-file match truncation when a file exceeds the per-file cap (P1-7)', () => {
    // 10 functions all match "handler"; the per-file cap keeps 8 and the result
    // must say so (matches_truncated + match_count) rather than silently drop 2.
    const fns = Array.from({ length: 10 }, (_, i) => `export function handler${i}() { return ${i}; }`).join('\n');
    writeFileSync(join(tmpRepo, 'h.ts'), `${fns}\n`, 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    const r = runCli(['index', 'query', 'handler', '--json', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      results: Array<{ path: string; matches: unknown[]; match_count?: number; matches_truncated?: boolean }>;
    };
    const file = payload.results.find(res => res.path === 'h.ts');
    expect(file).toBeDefined();
    expect(file!.matches.length).toBe(8);
    expect(file!.matches_truncated).toBe(true);
    expect(file!.match_count).toBeGreaterThanOrEqual(10);
  });
});
