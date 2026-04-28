import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

describe('cdd-kit archive', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-archive-repo-');
    tmpHome = makeTempDir('cdd-archive-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('1: archive on non-existent change exits 1 and reports not found', () => {
    const r = runCli(['archive', 'no-such-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/change not found/i);
  });

  it('2: archive moves change directory to specs/archive/<year>/<id>', () => {
    runCli(['new', 'arch-test'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'arch-test');
    expect(existsSync(changeDir)).toBe(true);

    const r = runCli(['archive', 'arch-test'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);

    // Source directory should be gone
    expect(existsSync(changeDir)).toBe(false);

    // Archived directory should exist under current year
    const year = new Date().getFullYear().toString();
    const archiveDir = join(tmpRepo, 'specs', 'archive', year, 'arch-test');
    expect(existsSync(archiveDir)).toBe(true);
  });

  it('3: archive creates INDEX.md with entry', () => {
    runCli(['new', 'arch-indexed'], { cwd: tmpRepo, home: tmpHome });
    runCli(['archive', 'arch-indexed'], { cwd: tmpRepo, home: tmpHome });

    const indexPath = join(tmpRepo, 'specs', 'archive', 'INDEX.md');
    expect(existsSync(indexPath)).toBe(true);

    const content = readFileSync(indexPath, 'utf8');
    expect(content).toMatch(/arch-indexed/);
  });

  it('4: archive on already-archived change exits 1 and reports already archived', () => {
    runCli(['new', 'arch-double'], { cwd: tmpRepo, home: tmpHome });
    runCli(['archive', 'arch-double'], { cwd: tmpRepo, home: tmpHome });

    // Recreate a source dir to simulate retrying archive on same id
    mkdirSync(join(tmpRepo, 'specs', 'changes', 'arch-double'), { recursive: true });

    const r = runCli(['archive', 'arch-double'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/already archived/i);
  });

  it('5: archive warns on pending tasks but still succeeds', () => {
    runCli(['new', 'arch-pending'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'arch-pending');

    // Write a tasks.md with a pending item alongside a done item
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Something pending\n- [x] 1.2 Done item\n', 'utf8');

    const r = runCli(['archive', 'arch-pending'], { cwd: tmpRepo, home: tmpHome });
    // Should still succeed (warnings only)
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    // Should warn about pending tasks
    expect(r.stdout + r.stderr).toMatch(/pending/i);
  });
});
