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
});
