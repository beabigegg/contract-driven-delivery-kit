import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const REQUIRED_TEMPLATES = [
  'change-request.md',
  'change-classification.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.md',
];

describe('cdd-kit new', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-new-repo-');
    tmpHome = makeTempDir('cdd-new-home-');
    // Each test needs a local-only init first
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('new feat-001 creates all 5 required templates', () => {
    const r = runCli(['new', 'feat-001'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-001');
    expect(existsSync(changeDir), 'change dir missing').toBe(true);

    for (const tmpl of REQUIRED_TEMPLATES) {
      expect(existsSync(join(changeDir, tmpl)), `${tmpl} missing`).toBe(true);
    }
  });

  it('new feat-002 --all creates required + at least 1 optional template', () => {
    const r = runCli(['new', 'feat-002', '--all'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-002');
    const files = readdirSync(changeDir).filter((f) => f.endsWith('.md'));
    // Must have all required
    for (const tmpl of REQUIRED_TEMPLATES) {
      expect(files).toContain(tmpl);
    }
    // Must have at least 1 optional (more than just required)
    expect(files.length).toBeGreaterThan(REQUIRED_TEMPLATES.length);
  });

  it('new "bad name" exits non-zero with "Invalid" in stderr', () => {
    const r = runCli(['new', 'bad name'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid/i);
  });

  it('new feat-003 twice does not error and preserves first run content', () => {
    // First run
    const r1 = runCli(['new', 'feat-003'], { cwd: tmpRepo, home: tmpHome });
    expect(r1.status, `first run stderr: ${r1.stderr}`).toBe(0);

    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-003');
    const filesBefore = readdirSync(changeDir).slice().sort();

    // Second run (no --force)
    const r2 = runCli(['new', 'feat-003'], { cwd: tmpRepo, home: tmpHome });
    // Should not error (exits 0 with abort message)
    expect(r2.status, `second run stderr: ${r2.stderr}`).toBe(0);
    // The abort message should appear
    expect(r2.stdout + r2.stderr).toMatch(/abort|already exist/i);

    // Files from first run are preserved
    const filesAfter = readdirSync(changeDir).slice().sort();
    expect(filesAfter).toEqual(filesBefore);
  });

  it('new feat-004 --force overwrites change-request.md', () => {
    // First run
    runCli(['new', 'feat-004'], { cwd: tmpRepo, home: tmpHome });

    const crPath = join(tmpRepo, 'specs', 'changes', 'feat-004', 'change-request.md');
    const originalContent = readFileSync(crPath, 'utf8');

    // User modifies the file
    writeFileSync(crPath, 'MY CUSTOM CONTENT THAT SHOULD BE REPLACED');

    // Run with --force
    const r = runCli(['new', 'feat-004', '--force'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    // File should be restored to template content
    const afterContent = readFileSync(crPath, 'utf8');
    expect(afterContent).toBe(originalContent);
    expect(afterContent).not.toContain('MY CUSTOM CONTENT THAT SHOULD BE REPLACED');
  });

  it('new with no name argument exits non-zero', () => {
    const r = runCli(['new'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
  });
});
