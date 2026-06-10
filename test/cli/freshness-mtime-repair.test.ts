/**
 * P1-8: the query path repairs the code-map's mtime after a digest-confirmed
 * "mtime lied" verdict, so subsequent queries skip the full-tree SHA recompute.
 *
 * Scenario reproduced here: a git clone/checkout leaves every source file with
 * an mtime newer than the committed map, even though the content is unchanged.
 * The first refreshing query confirms freshness by digest and bumps the map's
 * mtime forward; later queries then pass the cheap mtime check.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { appendFileSync, copyFileSync, statSync, utimesSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'code-map');

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-freshness-repo-');
  tmpHome = makeTempDir('cdd-freshness-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

/** Simulate a clone: sources mtime newer than the map, but content unchanged. */
function simulateCloneSkew(): { map: string; source: string } {
  const map = join(tmpRepo, '.cdd', 'code-map.yml');
  const source = join(tmpRepo, 'sample.ts');
  const mapTime = new Date(Date.now() - 60_000);     // map looks oldest
  const sourceTime = new Date(Date.now() - 30_000);  // source newer by mtime, both in the past
  utimesSync(map, mapTime, mapTime);
  utimesSync(source, sourceTime, sourceTime);
  return { map, source };
}

describe('code-map mtime repair (P1-8)', () => {
  it('bumps the map mtime forward when a refreshing query confirms freshness by digest', () => {
    copyFileSync(join(FIXTURE_ROOT, 'sample.ts'), join(tmpRepo, 'sample.ts'));
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const { map, source } = simulateCloneSkew();

    const before = statSync(map).mtimeMs;
    const sourceMtime = statSync(source).mtimeMs;
    expect(sourceMtime).toBeGreaterThan(before);  // precondition: mtime says "stale"

    const r = runCli(['index', 'query', 'User'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('interface: User');  // results still correct

    const after = statSync(map).mtimeMs;
    expect(after).toBeGreaterThan(before);          // mtime was repaired forward
    expect(after).toBeGreaterThan(sourceMtime);     // now newest → future queries take the fast path
  });

  it('does not touch the map under --no-refresh', () => {
    copyFileSync(join(FIXTURE_ROOT, 'sample.ts'), join(tmpRepo, 'sample.ts'));
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const { map } = simulateCloneSkew();

    const before = statSync(map).mtimeMs;
    const r = runCli(['index', 'query', 'User', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(statSync(map).mtimeMs).toBe(before);     // verification skipped → no repair
  });

  it('still regenerates (not just repairs) when content genuinely changed', () => {
    copyFileSync(join(FIXTURE_ROOT, 'sample.ts'), join(tmpRepo, 'sample.ts'));
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    // Genuine edit: digest will differ, so this is a real refresh, not a repair.
    const samplePath = join(tmpRepo, 'sample.ts');
    copyFileSync(join(FIXTURE_ROOT, 'sample.ts'), samplePath);
    // Append a new symbol so the digest changes.
    appendFileSync(samplePath, '\nexport function brandNewFn() { return 1; }\n', 'utf8');
    utimesSync(samplePath, new Date(), new Date());

    const r = runCli(['index', 'query', 'brandNewFn'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('index: .cdd/code-map.yml (refreshed)');
    expect(r.stdout).toContain('function: brandNewFn');
  });
});
