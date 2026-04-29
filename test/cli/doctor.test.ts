import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

describe('cdd-kit doctor', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-doctor-repo-');
    tmpHome = makeTempDir('cdd-doctor-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('reports missing repo-level files and fails in strict mode', () => {
    const r = runCli(['doctor', '--strict'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contracts is missing/i);
    expect(r.stdout + r.stderr).toMatch(/doctor failed in strict mode/i);
  });

  it('passes after init and context-scan when default contracts have deterministic summaries', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const scan = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(scan.status, scan.stderr).toBe(0);

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/doctor passed/i);
  });

  it('warns when contracts/* changes after context-scan (hash drift)', async () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);
    const scan = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(scan.status, scan.stderr).toBe(0);

    // Hash-based check is mtime-independent (works even on git-clone where mtime resets)
    writeFileSync(join(tmpRepo, 'contracts', 'api', 'new-contract.md'), [
      '---',
      'summary: New API behavior.',
      '---',
      '',
      '# New API Contract',
    ].join('\n'), 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contracts-index\.md inputs changed/i);
  });

  it('B5: hash-based freshness ignores mtime resets (regression)', async () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);
    const scan = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(scan.status, scan.stderr).toBe(0);

    // Simulate a git clone: touch every input but keep content unchanged.
    const { utimesSync } = await import('fs');
    const future = new Date(Date.now() + 10_000);
    for (const f of ['contracts/api/api-contract.md', '.cdd/context-policy.json']) {
      const p = join(tmpRepo, f);
      if (existsSync(p)) utimesSync(p, future, future);
    }

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/inputs changed/i);
    expect(r.stdout + r.stderr).toMatch(/doctor passed/i);
  });

  it('auto-detects codex provider and checks CODEX.md', () => {
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), JSON.stringify({ provider: 'codex' }), 'utf8');
    writeFileSync(join(tmpRepo, 'CODEX.md'), '# Codex\n', 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Doctor provider: codex/i);
    expect(r.stdout + r.stderr).not.toMatch(/CLAUDE\.md is missing/i);
  });

  it('writes no files during doctor', () => {
    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd'))).toBe(false);
  });

  it('PR3-5.1: --fix auto-runs context-scan when indexes are missing', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    // Indexes don't exist yet.
    expect(existsSync(join(tmpRepo, 'specs', 'context', 'project-map.md'))).toBe(false);

    const r = runCli(['doctor', '--fix'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/fixed: ran context-scan/i);
    expect(existsSync(join(tmpRepo, 'specs', 'context', 'project-map.md'))).toBe(true);
  });

  it('PR3-5.2: --fix populates empty model-policy roles', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    // Reset model-policy to empty roles.
    writeFileSync(join(tmpRepo, '.cdd', 'model-policy.json'),
      JSON.stringify({ provider: 'claude', generated_at: null, roles: {} }, null, 2) + '\n', 'utf8');

    const r = runCli(['doctor', '--fix'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/fixed: populated.*model-policy/i);

    const policy = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), 'utf8'));
    expect(Object.keys(policy.roles).length).toBeGreaterThan(10);
    expect(policy.roles['change-classifier']).toMatch(/claude-opus-4-7/);
  });

  it('can emit machine-readable json for CI', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const r = runCli(['doctor', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const report = JSON.parse(r.stdout);
    expect(report.provider).toBe('claude');
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.warnings).toBeGreaterThan(0);
  });
});
