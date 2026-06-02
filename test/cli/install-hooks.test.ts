import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

describe('cdd-kit install-hooks', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-hooks-repo-');
    tmpHome = makeTempDir('cdd-hooks-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('1: install-hooks in non-git repo exits 1 and reports not a git repository', () => {
    const r = runCli(['install-hooks'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/not a git repository/i);
  });

  it('2: install-hooks in fresh git repo writes pre-commit hook with cdd-kit block', () => {
    spawnSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore' });
    const r = runCli(['install-hooks'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const hookPath = join(tmpRepo, '.git', 'hooks', 'pre-commit');
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toMatch(/cdd-kit-managed-block-start/);
    expect(content).toMatch(/cdd-kit gate/);
  });

  it('3: install-hooks is idempotent (re-running does not duplicate the block)', () => {
    spawnSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore' });
    runCli(['install-hooks'], { cwd: tmpRepo, home: tmpHome });
    runCli(['install-hooks'], { cwd: tmpRepo, home: tmpHome });

    const content = readFileSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'), 'utf8');
    const occurrences = (content.match(/cdd-kit-managed-block-start/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('4: install-hooks preserves existing non-cdd-kit hook content', () => {
    spawnSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore' });

    const existingHook = '#!/bin/sh\necho "user hook content"\nexit 0\n';
    mkdirSync(join(tmpRepo, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'), existingHook, 'utf8');

    runCli(['install-hooks'], { cwd: tmpRepo, home: tmpHome });

    const final = readFileSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(final).toMatch(/cdd-kit-managed-block-start/);
    expect(final).toMatch(/echo "user hook content"/);
  });

  it('5: install-hooks resolves the hooks dir in a git worktree (.git is a file)', () => {
    // Main repo with one commit so a worktree can be added.
    spawnSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 't@t.com'], { cwd: tmpRepo, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: tmpRepo, stdio: 'ignore' });
    writeFileSync(join(tmpRepo, 'README.md'), '# x\n', 'utf8');
    spawnSync('git', ['add', '-A'], { cwd: tmpRepo, stdio: 'ignore' });
    const commit = spawnSync('git', ['commit', '-m', 'init'], { cwd: tmpRepo, stdio: 'ignore' });
    // If commit signing is unavailable in this environment, skip rather than fail.
    if (commit.status !== 0) return;

    const wt = makeTempDir('cdd-hooks-wt-');
    try {
      const add = spawnSync('git', ['worktree', 'add', wt], { cwd: tmpRepo, encoding: 'utf8' });
      expect(add.status, add.stderr).toBe(0);

      // In a worktree, .git is a FILE, not a directory.
      expect(existsSync(join(wt, '.git'))).toBe(true);

      const r = runCli(['install-hooks'], { cwd: wt, home: tmpHome });
      expect(r.status, `stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout + r.stderr).not.toMatch(/ENOTDIR/);
    } finally {
      cleanupDir(wt);
    }
  });

  it('6: install-hooks honors core.hooksPath when set on a normal repo', () => {
    spawnSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore' });
    spawnSync('git', ['config', 'core.hooksPath', 'myhooks'], { cwd: tmpRepo, stdio: 'ignore' });

    const r = runCli(['install-hooks'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    // The hook must land in the git-resolved path, not the default .git/hooks.
    const customHook = join(tmpRepo, 'myhooks', 'pre-commit');
    expect(existsSync(customHook)).toBe(true);
    expect(readFileSync(customHook, 'utf8')).toMatch(/cdd-kit-managed-block-start/);
    expect(existsSync(join(tmpRepo, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });
});
