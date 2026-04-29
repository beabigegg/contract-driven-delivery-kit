import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

describe('cdd-kit upgrade', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-upgrade-repo-');
    tmpHome = makeTempDir('cdd-upgrade-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('defaults to dry-run and does not write files', () => {
    const r = runCli(['upgrade'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Dry run only/i);
    expect(existsSync(join(tmpRepo, '.cdd'))).toBe(false);
  });

  it('adds missing repo-level files with --yes', () => {
    const r = runCli(['upgrade', '--yes'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd', 'context-policy.json'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'contracts'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'specs', 'templates'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'AGENTS.md'))).toBe(true);
  });

  it('preserves existing guidance files', () => {
    writeFileSync(join(tmpRepo, 'CLAUDE.md'), 'USER GUIDANCE\n', 'utf8');

    const r = runCli(['upgrade', '--yes'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(tmpRepo, 'CLAUDE.md'), 'utf8')).toBe('USER GUIDANCE\n');
  });

  it('can add Codex guidance without adding Claude guidance', () => {
    const r = runCli(['upgrade', '--yes', '--provider', 'codex'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, 'CODEX.md'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(tmpRepo, 'AGENTS.md'))).toBe(false);

    const policy = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), 'utf8'));
    expect(policy.provider).toBe('codex');
  });

  it('only fills missing files in an old partial repo', () => {
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(tmpRepo, '.cdd', 'context-policy.json'), '{"custom": true}\n', 'utf8');

    const r = runCli(['upgrade', '--yes'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(tmpRepo, '.cdd', 'context-policy.json'), 'utf8')).toBe('{"custom": true}\n');
    expect(existsSync(join(tmpRepo, '.cdd', 'model-policy.json'))).toBe(true);
  });

  it('can migrate existing change directories as part of upgrade', () => {
    mkdirSync(join(tmpRepo, 'specs', 'changes', 'legacy-001'), { recursive: true });
    writeFileSync(join(tmpRepo, 'specs', 'changes', 'legacy-001', 'tasks.md'), '# Tasks: legacy-001\n', 'utf8');
    writeFileSync(join(tmpRepo, 'specs', 'changes', 'legacy-001', 'change-classification.md'), '**Tier:** Tier 2\n', 'utf8');

    const r = runCli(['upgrade', '--yes', '--migrate-changes'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Running change migration flow/i);
    expect(readFileSync(join(tmpRepo, 'specs', 'changes', 'legacy-001', 'tasks.md'), 'utf8')).toMatch(/^---/);
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'legacy-001', 'context-manifest.md'))).toBe(true);
  });
});
