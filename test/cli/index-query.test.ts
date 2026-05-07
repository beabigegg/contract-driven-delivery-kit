/**
 * CLI tests for `cdd-kit index query`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
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
});
