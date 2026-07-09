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
    const r = runCli(['abandon', 'my-change', '--reason', 'scope changed'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/abandoned/i);

    const raw = readFileSync(join(tmpRepo, 'specs', 'changes', 'my-change', 'tasks.yml'), 'utf8');
    const data = yaml.load(raw) as Record<string, unknown>;
    expect(data['status']).toBe('abandoned');
    expect(data['abandoned-reason']).toBe('scope changed');
    expect(typeof data['abandoned-at']).toBe('string');
  });

  it('3: abandon creates specs/archive/INDEX.md with entry', () => {
    scaffoldChange(tmpRepo, 'my-change-2');
    const r = runCli(['abandon', 'my-change-2', '--reason', 'no longer needed'], { cwd: tmpRepo, home: tmpHome });
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
    runCli(['abandon', 'my-change-4', '--reason', 'no longer needed'], { cwd: tmpRepo, home: tmpHome });
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

  // Scope expansion 3 (change-request.md): abandon must never report success
  // unless the abandoned status was actually persisted, and a directory with no
  // tasks.yml (the normal state of a stale directory) must get a minimal one
  // rather than a silently-skipped write.

  it('7: abandon on a dir with no tasks.yml creates a minimal one carrying status: abandoned + reason, and reports what it did', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'stale-dir');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'plan.md'), '# Stale plan\n\nstatus: ready-to-execute\n', 'utf8');
    expect(existsSync(join(changeDir, 'tasks.yml'))).toBe(false);

    const r = runCli(['abandon', 'stale-dir', '--reason', 'superseded by shipped work'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/created/i);

    const tasksPath = join(changeDir, 'tasks.yml');
    expect(existsSync(tasksPath)).toBe(true);
    const data = yaml.load(readFileSync(tasksPath, 'utf8')) as Record<string, unknown>;
    expect(data['change-id']).toBe('stale-dir');
    expect(data['status']).toBe('abandoned');
    expect(data['abandoned-reason']).toBe('superseded by shipped work');
    expect(typeof data['abandoned-at']).toBe('string');
    expect(Array.isArray(data['tasks'])).toBe(true);
    expect((data['tasks'] as unknown[]).length).toBe(0);
  });

  it('8: abandon with an empty --reason hard-fails and writes nothing', () => {
    scaffoldChange(tmpRepo, 'empty-reason-change');
    const r = runCli(['abandon', 'empty-reason-change', '--reason', ''], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/marked as abandoned/i);

    const raw = readFileSync(join(tmpRepo, 'specs', 'changes', 'empty-reason-change', 'tasks.yml'), 'utf8');
    const data = yaml.load(raw) as Record<string, unknown>;
    expect(data['status']).toBe('in-progress');
    expect(existsSync(join(tmpRepo, 'specs', 'archive', 'INDEX.md'))).toBe(false);
  });

  it('9: abandon with a whitespace-only --reason hard-fails and writes nothing', () => {
    scaffoldChange(tmpRepo, 'whitespace-reason-change');
    const r = runCli(['abandon', 'whitespace-reason-change', '--reason', '   '], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);

    const raw = readFileSync(join(tmpRepo, 'specs', 'changes', 'whitespace-reason-change', 'tasks.yml'), 'utf8');
    const data = yaml.load(raw) as Record<string, unknown>;
    expect(data['status']).toBe('in-progress');
  });

  it('10: abandon with no --reason at all hard-fails and writes nothing', () => {
    scaffoldChange(tmpRepo, 'no-reason-change');
    const r = runCli(['abandon', 'no-reason-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/reason/i);

    const raw = readFileSync(join(tmpRepo, 'specs', 'changes', 'no-reason-change', 'tasks.yml'), 'utf8');
    const data = yaml.load(raw) as Record<string, unknown>;
    expect(data['status']).toBe('in-progress');
  });

  it('11: abandon on a dir WITH tasks.yml sets status and preserves existing task rows', () => {
    scaffoldChange(tmpRepo, 'has-tasks-change');
    const r = runCli(['abandon', 'has-tasks-change', '--reason', 'no longer needed'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);

    const raw = readFileSync(join(tmpRepo, 'specs', 'changes', 'has-tasks-change', 'tasks.yml'), 'utf8');
    const data = yaml.load(raw) as Record<string, unknown>;
    expect(data['status']).toBe('abandoned');
    expect(data['abandoned-reason']).toBe('no longer needed');
    const tasks = data['tasks'] as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]['id']).toBe('1.1');
    expect(tasks[0]['title']).toBe('Do something');
  });

  it('12: regression — abandon never prints a success line when an invalid change id blocks the write before anything is persisted', () => {
    // Path-traversal-shaped id: isSafeChangeId must reject it before any join()/
    // existsSync() call, so nothing is created and no success line is printed.
    const r = runCli(['abandon', '../../etc', '--reason', 'x'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/marked as abandoned/i);
    expect(existsSync(join(tmpRepo, 'specs', 'changes', '..', '..', 'etc'))).toBe(false);
  });
});
