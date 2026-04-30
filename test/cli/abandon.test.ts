import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// Helper: create a minimal change directory
function scaffoldChange(repo: string, changeId: string): void {
  const changeDir = join(repo, 'specs', 'changes', changeId);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'tasks.yml'), yaml.dump({
    'change-id': changeId,
    status: 'in-progress',
    tasks: [{ id: '1.1', title: 'Do something', status: 'pending' }],
  }, { lineWidth: -1 }), 'utf8');
}

describe('cdd-kit abandon', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-abandon-repo-');
    tmpHome = makeTempDir('cdd-abandon-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('1: abandon on non-existent change exits 1 and reports change not found', () => {
    const r = runCli(['abandon', 'nonexistent-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/change not found/i);
  });

  it('2: abandon on existing change exits 0 and marks tasks.yml as abandoned', () => {
    scaffoldChange(tmpRepo, 'my-change');
    const r = runCli(['abandon', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/abandoned/i);

    const raw = readFileSync(join(tmpRepo, 'specs', 'changes', 'my-change', 'tasks.yml'), 'utf8');
    const data = yaml.load(raw) as Record<string, unknown>;
    expect(data['status']).toBe('abandoned');
  });

  it('3: abandon creates specs/archive/INDEX.md with entry', () => {
    scaffoldChange(tmpRepo, 'my-change-2');
    const r = runCli(['abandon', 'my-change-2'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);

    const indexPath = join(tmpRepo, 'specs', 'archive', 'INDEX.md');
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, 'utf8');
    expect(index).toMatch(/my-change-2/);
    expect(index).toMatch(/abandoned/);
  });

  it('4: abandon with --reason writes reason into INDEX.md', () => {
    scaffoldChange(tmpRepo, 'my-change-3');
    const r = runCli(['abandon', 'my-change-3', '--reason', 'scope changed'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);

    const indexPath = join(tmpRepo, 'specs', 'archive', 'INDEX.md');
    const index = readFileSync(indexPath, 'utf8');
    expect(index).toMatch(/scope changed/);
  });

  it('5: abandon leaves change directory on disk (does not delete)', () => {
    scaffoldChange(tmpRepo, 'my-change-4');
    runCli(['abandon', 'my-change-4'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'my-change-4');
    expect(existsSync(changeDir)).toBe(true);
  });

  it('6: second abandon appends to existing INDEX.md', () => {
    scaffoldChange(tmpRepo, 'change-a');
    scaffoldChange(tmpRepo, 'change-b');
    runCli(['abandon', 'change-a', '--reason', 'first reason'], { cwd: tmpRepo, home: tmpHome });
    runCli(['abandon', 'change-b', '--reason', 'second reason'], { cwd: tmpRepo, home: tmpHome });

    const indexPath = join(tmpRepo, 'specs', 'archive', 'INDEX.md');
    const index = readFileSync(indexPath, 'utf8');
    expect(index).toMatch(/change-a/);
    expect(index).toMatch(/change-b/);
    expect(index).toMatch(/first reason/);
    expect(index).toMatch(/second reason/);
  });
});
