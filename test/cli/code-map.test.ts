/**
 * CLI tests for `cdd-kit code-map`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

// ── helpers ────────────────────────────────────────────────────────────────

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'fixtures', 'code-map'
);

function copyFixtures(tmpRepo: string, ...names: string[]): void {
  for (const name of names) {
    copyFileSync(join(FIXTURE_ROOT, name), join(tmpRepo, name));
  }
}

// ── setup ──────────────────────────────────────────────────────────────────

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('code-map-cli-repo-');
  tmpHome = makeTempDir('code-map-cli-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('cdd-kit code-map', () => {
  it('1: scans a fixture repo and writes .cdd/code-map.yml with header', () => {
    copyFixtures(tmpRepo, 'sample.js', 'sample.vue');
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).toMatch(/^# generated: \d{4}-\d{2}-\d{2}T/);
    expect(out).toMatch(/^# files: \d+, src-lines: \d+, map-lines: \d+, compression: [\d.]+x/m);
    expect(out).toContain('sample.js:');
    expect(out).toContain('sample.vue:');
    expect(r.stdout).toMatch(/scanned \d+ files, \d+ src lines -> \.cdd\/code-map\.yml/);
  });

  it('2: --check exits 1 when source changed after map', () => {
    copyFixtures(tmpRepo, 'sample.js');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    // Modify source file (content change triggers different YAML)
    const existing = readFileSync(join(tmpRepo, 'sample.js'), 'utf8');
    writeFileSync(join(tmpRepo, 'sample.js'), existing + '\n// extra modification\n', 'utf8');
    const r = runCli(['code-map', '--check'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/code-map out of date/);
  });

  it('3: --check exits 0 when up-to-date', () => {
    copyFixtures(tmpRepo, 'sample.js');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['code-map', '--check'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
  });

  it('4: excludes node_modules by default', () => {
    copyFixtures(tmpRepo, 'sample.js');
    mkdirSync(join(tmpRepo, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(tmpRepo, 'node_modules', 'pkg', 'index.js'), 'export const X = 1;', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).not.toContain('node_modules');
  });

  it('5: parse error file does not abort the run', () => {
    writeFileSync(join(tmpRepo, 'broken.js'), '!!!@@@##$$', 'utf8');
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);  // exit 0 even with broken files
  });

  it.skipIf(!hasPython())('6: scans .py files end-to-end', () => {
    copyFixtures(tmpRepo, 'sample.py');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).toContain('sample.py:');
    expect(out).toMatch(/name: Foo/);
  });

  it.skipIf(!hasPython())('6b: chunked python batches accumulate every file (CDD_CODE_MAP_BATCH_SIZE=1)', () => {
    // Force one .py file per interpreter subprocess so the chunk loop runs
    // multiple times; all files must still land in the map. Regression for the
    // single-spawn timeout/buffer cliff that used to drop the whole batch.
    copyFixtures(tmpRepo, 'sample.py', 'empty.py');
    const r = runCli(['code-map'], {
      cwd: tmpRepo,
      home: tmpHome,
      env: { CDD_CODE_MAP_BATCH_SIZE: '1' },
    });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).toContain('sample.py:');
    expect(out).toContain('empty.py:');
  });

  it('9: --surface scopes the scan and names the map after the subtree', () => {
    mkdirSync(join(tmpRepo, 'packages', 'web', 'src'), { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'api', 'src'), { recursive: true });
    writeFileSync(join(tmpRepo, 'packages', 'web', 'src', 'app.js'), 'export function renderApp() {}', 'utf8');
    writeFileSync(join(tmpRepo, 'packages', 'api', 'src', 'server.js'), 'export function startServer() {}', 'utf8');

    const r = runCli(['code-map', '--surface', 'packages/web'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const surfaceMap = join(tmpRepo, '.cdd', 'code-map.packages-web.yml');
    expect(existsSync(surfaceMap)).toBe(true);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(false);
    const out = readFileSync(surfaceMap, 'utf8');
    expect(out).toContain('renderApp');
    expect(out).not.toContain('startServer');
  });

  it('10: --surface with a missing path exits non-zero', () => {
    const r = runCli(['code-map', '--surface', 'packages/nope'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/surface path not found/i);
  });

  it('11: --workers produces output identical to single-process scanning', () => {
    mkdirSync(join(tmpRepo, 'src'), { recursive: true });
    for (let i = 1; i <= 6; i++) {
      writeFileSync(
        join(tmpRepo, 'src', `mod${i}.js`),
        `export function f${i}() { return ${i}; }\nexport class C${i} { m${i}() {} }\n`,
        'utf8',
      );
    }

    const single = runCli(['code-map', '--out', 'single.yml'], { cwd: tmpRepo, home: tmpHome });
    expect(single.status, single.stderr).toBe(0);
    const parallel = runCli(['code-map', '--out', 'workers.yml', '--workers', '4'], { cwd: tmpRepo, home: tmpHome });
    expect(parallel.status, parallel.stderr).toBe(0);

    // The map body (minus the run-specific generated-timestamp line) must match,
    // so enabling --workers never changes what gets indexed.
    const strip = (p: string): string =>
      readFileSync(join(tmpRepo, p), 'utf8').replace(/^# generated:.*$/m, '# generated: <x>');
    expect(strip('workers.yml')).toBe(strip('single.yml'));
  });

  it('7: empty repo produces header-only YAML with files: 0', () => {
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).toMatch(/# files: 0/);
  });

  it('8: --out flag writes to a custom path', () => {
    copyFixtures(tmpRepo, 'sample.js');
    const r = runCli(['code-map', '--out', 'custom-map.yml'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(existsSync(join(tmpRepo, 'custom-map.yml'))).toBe(true);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(false);
  });
});
