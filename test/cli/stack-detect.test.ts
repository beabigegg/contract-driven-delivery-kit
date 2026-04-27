import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// ── Unit-level tests via the detect-stack subcommand ─────────────────────────

describe('cdd-kit detect-stack', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-detect-repo-');
    tmpHome = makeTempDir('cdd-detect-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('detects conda when environment.yml is present', () => {
    writeFileSync(join(tmpRepo, 'environment.yml'), 'name: myenv\ndependencies:\n  - python=3.11\n');
    const r = runCli(['detect-stack'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/Detected stack: conda/);
  });

  it('detects pnpm when package.json + pnpm-lock.yaml are present', () => {
    writeFileSync(join(tmpRepo, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tmpRepo, 'pnpm-lock.yaml'), 'lockfileVersion: 6.0\n');
    const r = runCli(['detect-stack'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/Detected stack: pnpm/);
  });

  it('falls back to npm when only package.json is present (no lockfile)', () => {
    writeFileSync(join(tmpRepo, 'package.json'), JSON.stringify({ name: 'test' }));
    const r = runCli(['detect-stack'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/Detected stack: npm/);
  });

  it('reports unknown when no recognisable files are present', () => {
    // Empty dir — no package.json, no environment.yml, etc.
    const r = runCli(['detect-stack'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/Detected stack: unknown/);
  });

  it('detects polyglot and reports warning when Python + JS files coexist', () => {
    // Conda + pnpm → polyglot
    writeFileSync(join(tmpRepo, 'environment.yml'), 'name: myenv\ndependencies:\n  - python=3.11\n');
    writeFileSync(join(tmpRepo, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(join(tmpRepo, 'pnpm-lock.yaml'), 'lockfileVersion: 6.0\n');
    const r = runCli(['detect-stack'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    // Primary is conda (Python wins — comes first in detection order)
    expect(r.stdout).toMatch(/Detected stack: conda/);
    // Polyglot notice must mention both stacks
    expect(r.stdout).toMatch(/Polyglot/i);
    expect(r.stdout).toMatch(/pnpm/);
    // Candidates line must list at least both
    expect(r.stdout).toMatch(/Candidates.*conda.*pnpm/);
  });

  it('detects poetry when pyproject.toml contains [tool.poetry]', () => {
    const pyproject = `[tool.poetry]\nname = "myapp"\nversion = "0.1.0"\n`;
    writeFileSync(join(tmpRepo, 'pyproject.toml'), pyproject);
    const r = runCli(['detect-stack'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/Detected stack: poetry/);
  });
});

// ── Integration test: init patches CI yml with stack-specific content ─────────

describe('cdd-kit init + stack detection integration', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-stack-init-repo-');
    tmpHome = makeTempDir('cdd-stack-init-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('init with environment.yml patches CI yml to use setup-miniconda and removes placeholder echo', () => {
    // Write a conda environment file so the detector picks up conda
    writeFileSync(
      join(tmpRepo, 'environment.yml'),
      'name: myenv\ndependencies:\n  - python=3.11\n',
    );

    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const ciYmlPath = join(tmpRepo, '.github', 'workflows', 'contract-driven-gates.yml');
    const content = readFileSync(ciYmlPath, 'utf8');

    // Must contain the conda miniconda action
    expect(content).toMatch(/setup-miniconda/);
    // Must have the critical conda footgun fix
    expect(content).toMatch(/bash -el \{0\}/);
    // Conda env name must be resolved from environment.yml (not left as placeholder)
    expect(content).toMatch(/activate-environment:\s*["']?myenv["']?/);
    expect(content).not.toMatch(/\{\{conda-env-name\}\}/);
    // Must NOT still contain the old placeholder echo
    expect(content).not.toMatch(/No stack-specific fast gate configured/);
    expect(content).not.toMatch(/No stack detected/);
    // The other jobs must still be intact
    expect(content).toMatch(/e2e-critical:/);
    expect(content).toMatch(/scheduled-stress-soak:/);
  });
});
