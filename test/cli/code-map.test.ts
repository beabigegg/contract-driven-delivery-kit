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
