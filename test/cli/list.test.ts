import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

describe('cdd-kit list', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-list-repo-');
    tmpHome = makeTempDir('cdd-list-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('1: list with no active changes prints "No active changes"', () => {
    const r = runCli(['list'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no active changes/i);
  });

  it('2: list shows the change id after cdd-kit new', () => {
    runCli(['new', 'my-feature'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['list'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/my-feature/);
  });

  it('3: list shows gate-blocked status when tasks.md contains status: gate-blocked', () => {
    runCli(['new', 'blocked-change'], { cwd: tmpRepo, home: tmpHome });
    const tasksPath = join(tmpRepo, 'specs', 'changes', 'blocked-change', 'tasks.md');
    writeFileSync(tasksPath, '---\nchange-id: blocked-change\nstatus: gate-blocked\n---\n\n# Tasks\n', 'utf8');

    const r = runCli(['list'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/gate-blocked/);
  });

  it('4: list shows pending count when tasks.md has unchecked items', () => {
    runCli(['new', 'pending-change'], { cwd: tmpRepo, home: tmpHome });
    const tasksPath = join(tmpRepo, 'specs', 'changes', 'pending-change', 'tasks.md');
    writeFileSync(tasksPath, '# Tasks\n\n- [ ] 1.1 Pending\n- [ ] 1.2 Also pending\n', 'utf8');

    const r = runCli(['list'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/2 pending/i);
  });
});
