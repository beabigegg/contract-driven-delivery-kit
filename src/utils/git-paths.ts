import { spawnSync } from 'child_process';

/** Strip git's optional surrounding quotes (core.quotePath) from a path field. */
function unquote(raw: string): string {
  return raw.trim().replace(/^"(.*)"$/, '$1');
}

/**
 * Repo-relative paths with uncommitted changes (staged + unstaged + untracked).
 * Used by `cdd-kit classify-check`, which runs *mid-change* before anything is
 * committed — the work being classified normally lives in the unstaged/untracked
 * worktree, so the full `git status` view is the right scope there.
 *
 * For a staged rename (`R  src/auth/middleware.ts -> src/middleware.ts`) BOTH
 * sides are returned: moving code out of a critical directory still touches that
 * critical surface, so dropping the source path would let a rename slip under
 * the tier-0 floor.
 *
 * Returns [] when this is not a git repo or git is unavailable — the floor then
 * relies on the request text alone. Best-effort and never throws.
 */
export function getTouchedPaths(cwd: string): string[] {
  let res;
  try {
    res = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' });
  } catch {
    return [];
  }
  if (res.status !== 0 || !res.stdout) return [];

  const paths: string[] = [];
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    // Porcelain v1: "XY <path>", or a rename "XY <old> -> <new>".
    const body = line.slice(3);
    const arrow = body.indexOf(' -> ');
    if (arrow >= 0) {
      // Scan both sides of the rename: the source may be the sensitive surface.
      for (const part of [body.slice(0, arrow), body.slice(arrow + 4)]) {
        const clean = unquote(part);
        if (clean) paths.push(clean);
      }
    } else {
      const clean = unquote(body);
      if (clean) paths.push(clean);
    }
  }
  return paths;
}

/**
 * Repo-relative paths in the *staged* change only (the git index), rename-aware
 * (both old and new path are returned). This is the scope the pre-commit gate
 * wants: only the files about to be committed should set the tier floor, so an
 * unrelated unstaged `auth/` edit sitting in the worktree cannot trip the floor
 * and reject a low-risk staged commit.
 *
 * Returns [] when this is not a git repo, git is unavailable, or nothing is
 * staged. Best-effort and never throws.
 */
export function getStagedPaths(cwd: string): string[] {
  let res;
  try {
    res = spawnSync('git', ['diff', '--cached', '--name-status', '--no-color'], { cwd, encoding: 'utf8' });
  } catch {
    return [];
  }
  if (res.status !== 0 || !res.stdout) return [];

  const paths: string[] = [];
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    // Tab-separated: "M\tpath", "A\tpath", "D\tpath", or for rename/copy
    // "R100\told\tnew" / "C100\told\tnew" — carry both old and new paths.
    const parts = line.split('\t');
    const status = parts[0] ?? '';
    if (/^[RC]/.test(status) && parts.length >= 3) {
      for (const part of [parts[1], parts[2]]) {
        const clean = unquote(part ?? '');
        if (clean) paths.push(clean);
      }
    } else if (parts[1]) {
      const clean = unquote(parts[1]);
      if (clean) paths.push(clean);
    }
  }
  return paths;
}
