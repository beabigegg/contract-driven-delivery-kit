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

// ── P1-4: advisory test-runner hook is armed by default ──────────────────────

/** Every nested PreToolUse command armed in .claude/settings.json. */
function preToolUseCommands(repo: string): string {
  const settingsPath = join(repo, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return '';
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  return (settings.hooks?.PreToolUse ?? [])
    .flatMap((e: { hooks?: { command?: string }[] }) => e.hooks ?? [])
    .map((h: { command?: string }) => h.command ?? '')
    .join(' ');
}

describe('cdd-kit init — default-armed agent hooks (P1-4)', () => {
  it('5: arms BOTH graph-first and test-runner advisory hooks by default', () => {
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const cmds = preToolUseCommands(tmpRepo);
    expect(cmds).toMatch(/pre-tool-use-graph-first/);
    expect(cmds).toMatch(/pre-tool-use-test-runner/);
    // Advisory, not strict (no STRICT env prefix on the test-runner command).
    expect(cmds).not.toMatch(/CDD_TEST_RUNNER_STRICT=1/);
  });

  it('6: --no-test-runner keeps graph-first but leaves the test-runner hook dormant', () => {
    const r = runCli(['init', '--local-only', '--no-test-runner'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const cmds = preToolUseCommands(tmpRepo);
    expect(cmds).toMatch(/pre-tool-use-graph-first/);
    expect(cmds).not.toMatch(/pre-tool-use-test-runner/);
  });

  it('7: --no-arm leaves both hooks dormant (no settings.json)', () => {
    runCli(['init', '--local-only', '--no-arm'], { cwd: tmpRepo, home: tmpHome });
    expect(existsSync(join(tmpRepo, '.claude', 'settings.json'))).toBe(false);
  });
});
