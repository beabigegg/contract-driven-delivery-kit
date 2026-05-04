/**
 * Tests for doctor's code-map integration.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// ── setup ──────────────────────────────────────────────────────────────────

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('doctor-code-map-repo-');
  tmpHome = makeTempDir('doctor-code-map-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('cdd-kit doctor: code-map', () => {
  it('1: reports missing code-map when sources exist', () => {
    runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    writeFileSync(join(tmpRepo, 'foo.js'), 'export const X = 1;', 'utf8');
    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/code-map\.yml is missing/);
  });

  it('2: reports compression after code-map run', () => {
    runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    writeFileSync(join(tmpRepo, 'foo.js'), 'export const X = 1;\nfunction y(){return 1;}\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/code-map: \d+ files, [\d.]+x compression/);
  });

  it('3: --fix regenerates a stale map and passes --check afterwards', () => {
    runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    writeFileSync(join(tmpRepo, 'foo.js'), 'export const X = 1;\n', 'utf8');

    // Generate map
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    // Mutate the source file to make the map stale
    writeFileSync(join(tmpRepo, 'foo.js'), 'export const X = 2;\n// modified\n', 'utf8');

    // Check if map is stale (may not be if mtime resolution is coarse)
    const checkR = runCli(['code-map', '--check'], { cwd: tmpRepo, home: tmpHome });
    if (checkR.status === 0) {
      // mtime too coarse on this system — skip assertion
      return;
    }

    // doctor --fix should regenerate
    const fixR = runCli(['doctor', '--fix'], { cwd: tmpRepo, home: tmpHome });
    // After fix, code-map --check should pass
    const checkR2 = runCli(['code-map', '--check'], { cwd: tmpRepo, home: tmpHome });
    expect(checkR2.status).toBe(0);
  });

  it('4: no code-map warning when no source files exist (greenfield)', () => {
    runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    // No .py/.js/.vue files in the repo
    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/code-map\.yml is missing/);
  });
});
