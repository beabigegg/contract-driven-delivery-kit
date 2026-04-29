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

  it('warns when contracts-index is older than contracts', async () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);
    const scan = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(scan.status, scan.stderr).toBe(0);

    await new Promise(resolve => setTimeout(resolve, 20));
    writeFileSync(join(tmpRepo, 'contracts', 'api', 'new-contract.md'), [
      '---',
      'summary: New API behavior.',
      '---',
      '',
      '# New API Contract',
    ].join('\n'), 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contracts-index\.md is older than contracts/i);
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
