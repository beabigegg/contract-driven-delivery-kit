/**
 * Tests for the tier-floor path sources.
 *
 *  - getTouchedPaths: full worktree (staged + unstaged + untracked) — the scope
 *    classify-check needs while a change is still uncommitted.
 *  - getStagedPaths: the git index only — the scope the pre-commit gate needs so
 *    an unrelated unstaged edit can't trip the floor.
 *
 * Both must return BOTH sides of a rename, so moving code OUT of a sensitive
 * directory still surfaces the critical source path to the floor.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getTouchedPaths, getStagedPaths } from '../../src/utils/git-paths.js';
import { makeTempDir, cleanupDir } from '../helpers.js';

let repo: string;

/**
 * Run git in the test repo with a deterministic identity, FAILING LOUDLY when
 * the command itself fails (P1-13). The previous `stdio: 'ignore'` + unchecked
 * exit status let a host-environment failure masquerade as a product bug: on a
 * machine whose global config enforced commit signing, `git commit` here failed
 * silently, the subsequent `git mv` then renamed a never-committed index entry,
 * and the rename tests reported "old path missing" — misdiagnosed as a git
 * rename-detection difference. (test/setup-git-env.ts now isolates the suite
 * from such config; this assert is the second line of defense that points at
 * the real failing command if isolation ever regresses.)
 */
function git(...args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`test setup: \`git ${args.join(' ')}\` failed (exit ${r.status}): ${r.stderr}`);
  }
}

beforeEach(() => {
  repo = makeTempDir('cdd-gitpaths-');
  git('init');
});

afterEach(() => {
  cleanupDir(repo);
});

describe('getTouchedPaths (worktree scope)', () => {
  it('returns [] when not a git repo', () => {
    const bare = makeTempDir('cdd-nogit-');
    try {
      expect(getTouchedPaths(bare)).toEqual([]);
    } finally {
      cleanupDir(bare);
    }
  });

  it('includes staged, unstaged, and untracked paths', () => {
    writeFileSync(join(repo, 'committed.ts'), 'export const a = 1;\n');
    git('add', 'committed.ts');
    git('commit', '-m', 'init');

    writeFileSync(join(repo, 'committed.ts'), 'export const a = 2;\n'); // unstaged edit
    writeFileSync(join(repo, 'untracked.ts'), 'export const b = 1;\n'); // untracked

    const paths = getTouchedPaths(repo);
    expect(paths).toContain('committed.ts');
    expect(paths).toContain('untracked.ts');
  });

  it('returns BOTH sides of a rename out of a sensitive directory', () => {
    mkdirSync(join(repo, 'src', 'auth'), { recursive: true });
    writeFileSync(join(repo, 'src', 'auth', 'middleware.ts'), 'export const mw = 1;\n');
    git('add', '.');
    git('commit', '-m', 'init');

    git('mv', 'src/auth/middleware.ts', 'src/middleware.ts');

    const paths = getTouchedPaths(repo);
    expect(paths).toContain('src/auth/middleware.ts'); // sensitive source, kept
    expect(paths).toContain('src/middleware.ts');      // destination
  });
});

describe('getStagedPaths (index scope)', () => {
  it('returns [] when nothing is staged', () => {
    writeFileSync(join(repo, 'untracked.ts'), 'export const b = 1;\n');
    expect(getStagedPaths(repo)).toEqual([]);
  });

  it('returns only staged paths, not unstaged worktree noise', () => {
    writeFileSync(join(repo, 'staged.ts'), 'export const a = 1;\n');
    git('add', 'staged.ts');
    writeFileSync(join(repo, 'unstaged.ts'), 'export const b = 1;\n'); // never added

    const paths = getStagedPaths(repo);
    expect(paths).toContain('staged.ts');
    expect(paths).not.toContain('unstaged.ts');
  });

  it('returns BOTH sides of a staged rename out of a sensitive directory', () => {
    mkdirSync(join(repo, 'src', 'auth'), { recursive: true });
    writeFileSync(join(repo, 'src', 'auth', 'middleware.ts'), 'export const mw = 1;\n');
    git('add', '.');
    git('commit', '-m', 'init');

    git('mv', 'src/auth/middleware.ts', 'src/middleware.ts'); // staged rename

    const paths = getStagedPaths(repo);
    expect(paths).toContain('src/auth/middleware.ts');
    expect(paths).toContain('src/middleware.ts');
  });
});
