/**
 * Tests for `cdd-kit setup` (P0-5) — the one-command onboarding orchestrator.
 *
 * Boundaries verified:
 *   - fresh install (no .cdd/) scaffolds, arms chokepoints, builds indexes
 *   - re-run is idempotent and detected as an "upgrade" (delegates to refresh)
 *   - every step is best-effort: a missing `claude` CLI never fails the run
 *   - --no-arm skips hook arming; --no-mcp skips MCP registration
 *   - --provider codex skips the Claude-only agent hooks
 *   - a per-step summary and a `/cdd-new` next-step line are always printed
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

function gitInit(dir: string): void {
  const r = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
}

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-setup-repo-');
  tmpHome = makeTempDir('cdd-setup-home-');
  gitInit(tmpRepo);
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit setup — fresh install', () => {
  it('1: scaffolds, arms chokepoints, and builds context indexes in one run', () => {
    const r = runCli(['setup', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const out = r.stdout + r.stderr;
    expect(out).toMatch(/one-command fresh/i);
    expect(out).toMatch(/no \.cdd\/ found/i);

    // Scaffold
    expect(existsSync(join(tmpRepo, '.cdd'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'contracts'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'specs', 'templates'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md'))).toBe(true);

    // Armed chokepoints
    expect(existsSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'))).toBe(true);
    const settings = JSON.parse(readFileSync(join(tmpRepo, '.claude', 'settings.json'), 'utf8'));
    const commands = (settings.hooks?.PreToolUse ?? [])
      .flatMap((e: { hooks?: { command?: string }[] }) => e.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? '');
    expect(commands.join(' ')).toMatch(/pre-tool-use-graph-first/);
    expect(commands.join(' ')).toMatch(/pre-tool-use-test-runner/);

    // Context indexes
    expect(existsSync(join(tmpRepo, 'specs', 'context', 'project-map.md'))).toBe(true);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(true);
  });

  it('2: prints a per-step summary and a /cdd-new next-step line', () => {
    const r = runCli(['setup', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/Setup summary:/);
    expect(out).toMatch(/Scaffold \(fresh\)/);
    expect(out).toMatch(/Pre-commit gate/);
    expect(out).toMatch(/Setup complete\./);
    expect(out).toMatch(/\/cdd-new <describe your change>/);
  });
});

describe('cdd-kit setup — idempotent upgrade', () => {
  it('3: a second run is detected as an upgrade and still exits 0', () => {
    const first = runCli(['setup', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(first.status, first.stderr).toBe(0);

    const second = runCli(['setup', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(second.status, second.stderr).toBe(0);
    const out = second.stdout + second.stderr;
    expect(out).toMatch(/one-command upgrade/i);
    expect(out).toMatch(/detected an existing cdd-kit project/i);
    expect(out).toMatch(/Scaffold \(upgrade\)/);
    // Project artifacts still present after the upgrade run.
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(true);
    expect(existsSync(join(tmpRepo, '.claude', 'settings.json'))).toBe(true);
  });
});

describe('cdd-kit setup — best-effort steps never fail the run', () => {
  it('4: a missing `claude` CLI downgrades MCP registration to a skip, not a failure', () => {
    // The test environment has no `claude` on PATH, so the default (no --no-mcp)
    // MCP step must report a skip and the overall run must still exit 0.
    const r = runCli(['setup'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/register cdd-kit MCP server/i);
    // Either it registered (claude present) or it skipped — but it never failed.
    expect(out).not.toMatch(/Setup did not complete cleanly/i);
    expect(out).toMatch(/Setup complete\./);
  });
});

describe('cdd-kit setup — flags', () => {
  it('5: --no-arm skips the pre-commit gate and agent hooks', () => {
    const r = runCli(['setup', '--no-arm', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    // No agent PreToolUse hooks armed → no settings.json (or no cdd hooks in it).
    const settingsPath = join(tmpRepo, '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      expect(readFileSync(settingsPath, 'utf8')).not.toMatch(/pre-tool-use-graph-first/);
    }
    expect(r.stdout + r.stderr).toMatch(/skipped \(--no-arm\)/);
  });

  it('6: --no-mcp skips MCP registration explicitly', () => {
    const r = runCli(['setup', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/skipped \(--no-mcp\)/);
  });

  it('7: --provider codex scaffolds CODEX.md and skips Claude-only agent hooks', () => {
    const r = runCli(['setup', '--provider', 'codex', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, 'CODEX.md'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(tmpHome, '.agents', 'skills', 'cdd-work', 'SKILL.md'))).toBe(true);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/agent hooks skipped \(codex provider/i);
    // The pre-commit gate is provider-agnostic and should still be armed.
    expect(existsSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'))).toBe(true);
  });

  it('8: an invalid --provider is rejected before any work is done', () => {
    const r = runCli(['setup', '--provider', 'bogus', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Invalid provider: bogus/);
    // Nothing scaffolded on a rejected invocation.
    expect(existsSync(join(tmpRepo, '.cdd'))).toBe(false);
  });
});

describe('cdd-kit setup — API conformance recommendation (P1-5)', () => {
  it('9: recommends enabling drift detection when an API contract + code exist', () => {
    // A detectable stack makes conformance applicable; setup scaffolds the API
    // contract + a disabled conformance.json, so the tip should fire — but setup
    // must only *recommend*, never silently enable it.
    writeFileSync(join(tmpRepo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
    const r = runCli(['setup', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/enable drift detection with `cdd-kit doctor --fix`/);
    // Not silently enabled.
    const cfg = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'conformance.json'), 'utf8'));
    expect(cfg.enabled).toBe(false);
  });

  it('10: prints no conformance tip when the stack is undetectable (bare repo)', () => {
    const r = runCli(['setup', '--no-mcp'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/enable drift detection with/);
  });
});
