/**
 * Tests for cdd-kit init --hooks flag (code-map pre-commit hook).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// ── setup ──────────────────────────────────────────────────────────────────

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('init-hooks-repo-');
  tmpHome = makeTempDir('init-hooks-home-');
  // Initialize a git repo in tmpRepo
  spawnSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore' });
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('cdd-kit init --hooks', () => {
  it('1: init --hooks installs code-map hook block', () => {
    const r = runCli(['init', '--local-only', '--hooks'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const hookPath = join(tmpRepo, '.git', 'hooks', 'pre-commit');
    expect(existsSync(hookPath), 'pre-commit hook not created').toBe(true);
    const hook = readFileSync(hookPath, 'utf8');
    expect(hook).toMatch(/cdd-kit-code-map-block-start/);
    expect(hook).toMatch(/cdd-kit code-map/);
  });

  it('2: init --hooks is idempotent (re-run does not duplicate block)', () => {
    runCli(['init', '--local-only', '--hooks'], { cwd: tmpRepo, home: tmpHome });
    runCli(['init', '--local-only', '--hooks', '--force'], { cwd: tmpRepo, home: tmpHome });
    const hook = readFileSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'), 'utf8');
    const matches = hook.match(/cdd-kit-code-map-block-start/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('3: init --no-arm and without --hooks does NOT create any pre-commit hook', () => {
    runCli(['init', '--local-only', '--no-arm'], { cwd: tmpRepo, home: tmpHome });
    expect(existsSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('3b: init arms the gate hook by default, but not the code-map hook', () => {
    runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    const hookPath = join(tmpRepo, '.git', 'hooks', 'pre-commit');
    expect(existsSync(hookPath)).toBe(true);
    const hook = readFileSync(hookPath, 'utf8');
    expect(hook).toMatch(/cdd-kit-managed-block-start/);      // gate block (armed)
    expect(hook).not.toMatch(/cdd-kit-code-map-block-start/); // code-map hook still needs --hooks
  });

  it('3c: init --no-arm leaves the graph-first chokepoint dormant', () => {
    runCli(['init', '--local-only', '--no-arm'], { cwd: tmpRepo, home: tmpHome });
    expect(existsSync(join(tmpRepo, '.claude', 'settings.json'))).toBe(false);
  });

  it('4: install-hooks (gate hook) and init --hooks (code-map hook) coexist', () => {
    runCli(['install-hooks'], { cwd: tmpRepo, home: tmpHome });
    runCli(['init', '--local-only', '--hooks'], { cwd: tmpRepo, home: tmpHome });
    const hook = readFileSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook).toMatch(/cdd-kit-managed-block-start/);     // gate block
    expect(hook).toMatch(/cdd-kit-code-map-block-start/);    // code-map block
  });
});
