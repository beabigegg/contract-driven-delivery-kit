import { spawnSync } from 'child_process';

/**
 * Repo-relative paths with uncommitted changes (staged + unstaged + untracked).
 * Used by the tier-floor's path-based critical-surface detection, so a change
 * whose request is phrased generically ("refactor middleware") but whose staged
 * work lives under `auth/` or `payments/` still trips the floor.
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
    const raw = arrow >= 0 ? body.slice(arrow + 4) : body;
    const clean = raw.trim().replace(/^"(.*)"$/, '$1');
    if (clean) paths.push(clean);
  }
  return paths;
}
