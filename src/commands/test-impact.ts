import { existsSync } from 'fs';
import { posix } from 'path';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import { resolveLocalModule } from '../code-map/resolve.js';
import type { FileEntry } from '../code-map/types.js';
import { findTarget } from './index-impact.js';

/**
 * `cdd-kit test impact <file>` — answer "if I change this file, which tests are
 * affected?" without a manual grep. It is a COMPOSITION of existing code-map
 * facts, not a new analysis: it walks the import graph the code-map already
 * records (the same importer relation `index impact` uses) to find the tests
 * that transitively depend on the target, and adds mirror-path test files
 * (src/foo.ts ↔ tests/foo.test.ts, foo_test.py …) that exist in the map. Every
 * affected test carries a `reason` so the result is honest about WHY it was
 * flagged — never inference.
 */

export interface TestImpactOptions {
  map: string;
  depth: number;
  limit: number;
  json: boolean;
  refresh: boolean;
}

export type AffectedReason = 'is-target' | 'imports-target' | 'transitive' | 'mirror';

export interface AffectedTest {
  path: string;
  reason: AffectedReason;
  /** For `mirror`: the source file whose mirror this test is. */
  via?: string;
}

export interface TestImpactPayload {
  index: string;
  target: string;
  depth: number;
  refreshed: boolean;
  affected_tests: AffectedTest[];
  impacted_sources: string[];
  truncated: boolean;
}

/**
 * Whether a repo-relative path is a test file by convention: pytest
 * (`test_*.py` / `*_test.py`), JS/TS (`*.test.*` / `*.spec.*`), or living under
 * a `tests/`, `test/`, or `__tests__/` directory.
 */
export function isTestFilePath(p: string): boolean {
  const lower = p.toLowerCase();
  const base = posix.basename(lower);
  if (/^test_.+\.py$/.test(base) || /_test\.py$/.test(base)) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  const segs = lower.split('/');
  return segs.includes('tests') || segs.includes('test') || segs.includes('__tests__');
}

/**
 * Candidate mirror-path test files for a source file. Bounded, deterministic
 * guesses — only those that actually exist in the code-map are reported.
 */
function mirrorCandidates(srcPath: string): string[] {
  const ext = posix.extname(srcPath);
  const base = posix.basename(srcPath, ext);
  const dir = posix.dirname(srcPath);
  const dirAsTests = dir.replace(/(^|\/)src(\/|$)/, '$1tests$2');
  const out: string[] = [];

  if (/^\.[cm]?[jt]sx?$/.test(ext)) {
    for (const suffix of ['.test', '.spec']) {
      out.push(`${dir}/${base}${suffix}${ext}`);
      out.push(`${dir}/__tests__/${base}${suffix}${ext}`);
      if (dirAsTests !== dir) out.push(`${dirAsTests}/${base}${suffix}${ext}`);
    }
  } else if (ext === '.py') {
    out.push(`${dir}/test_${base}.py`);
    out.push(`${dir}/${base}_test.py`);
    if (dirAsTests !== dir) {
      out.push(`${dirAsTests}/test_${base}.py`);
      out.push(`${dirAsTests}/${base}_test.py`);
    }
    out.push(`tests/test_${base}.py`);
  }
  // Normalize accidental leading "./" or doubled slashes.
  return out.map(p => p.replace(/^\.\//, '').replace(/\/{2,}/g, '/'));
}

export async function testImpact(term: string, opts: TestImpactOptions): Promise<number> {
  const mapPath = opts.map || '.cdd/code-map.yml';
  const depth = Number.isFinite(opts.depth) && opts.depth > 0 ? Math.floor(opts.depth) : 2;
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : 50;

  const freshness = await ensureCodeMapFresh(mapPath, opts.refresh);
  if (freshness.error) return printFailure(freshness.error, opts.json);
  if (!existsSync(mapPath)) {
    return printFailure(`${mapPath} is missing; run \`cdd-kit code-map\` first.`, opts.json);
  }

  let entries: FileEntry[];
  try {
    entries = loadCodeMapEntries(mapPath);
  } catch (err) {
    return printFailure(`${mapPath} is not readable YAML: ${(err as Error).message}`, opts.json);
  }

  const targetResult = findTarget(entries, term);
  if ('error' in targetResult) return printFailure(targetResult.error, opts.json);
  const target = targetResult.entry;

  const pathSet = new Set(entries.map(e => e.path));

  // Reverse import index: resolved-path → the files that import it. Built once,
  // reused for the bounded BFS so the whole walk is a single map pass.
  const importersOf = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const imp of entry.imports) {
      const resolved = resolveLocalModule(entry.path, imp.module, pathSet);
      if (!resolved) continue;
      let set = importersOf.get(resolved);
      if (!set) { set = new Set(); importersOf.set(resolved, set); }
      set.add(entry.path);
    }
  }

  // BFS over importers up to `depth` hops, recording each dependent's distance.
  const distance = new Map<string, number>();
  const seen = new Set<string>([target.path]);
  let frontier = [target.path];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const importer of importersOf.get(f) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        distance.set(importer, d);
        next.push(importer);
      }
    }
    frontier = next;
  }

  const dependents = [...distance.keys()];
  const affected = new Map<string, AffectedTest>();

  // (0) The target itself may be a test.
  if (isTestFilePath(target.path)) {
    affected.set(target.path, { path: target.path, reason: 'is-target' });
  }

  // (a) Dependents that are themselves test files.
  for (const dep of dependents) {
    if (!isTestFilePath(dep)) continue;
    if (affected.has(dep)) continue;
    affected.set(dep, { path: dep, reason: distance.get(dep) === 1 ? 'imports-target' : 'transitive' });
  }

  // (b) Mirror-path test files for the target and each impacted non-test source.
  const impactedSources = dependents.filter(d => !isTestFilePath(d)).sort();
  for (const src of [target.path, ...impactedSources]) {
    for (const cand of mirrorCandidates(src)) {
      if (!pathSet.has(cand) || affected.has(cand)) continue;
      affected.set(cand, { path: cand, reason: 'mirror', via: src });
    }
  }

  const REASON_ORDER: Record<AffectedReason, number> = { 'is-target': 0, 'imports-target': 1, 'transitive': 2, 'mirror': 3 };
  const all = [...affected.values()].sort(
    (a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || a.path.localeCompare(b.path),
  );
  const truncated = all.length > limit;

  const payload: TestImpactPayload = {
    index: mapPath,
    target: target.path,
    depth,
    refreshed: freshness.refreshed,
    affected_tests: all.slice(0, limit),
    impacted_sources: impactedSources,
    truncated,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printText(payload);
  }
  return 0;
}

function printText(payload: TestImpactPayload): void {
  console.log(`index: ${payload.index}${payload.refreshed ? ' (refreshed)' : ''}`);
  console.log(`target: ${payload.target} (depth ${payload.depth})`);
  console.log(`affected tests: ${payload.affected_tests.length}${payload.truncated ? ' (truncated; raise --limit)' : ''}`);
  if (payload.affected_tests.length === 0) {
    console.log('- none found (no test imports this file, and no mirror-path test exists)');
  } else {
    for (const t of payload.affected_tests) {
      const via = t.via ? ` (mirror of ${t.via})` : '';
      console.log(`- ${t.path} [${t.reason}]${via}`);
    }
  }
  if (payload.impacted_sources.length > 0) {
    console.log(`impacted sources: ${payload.impacted_sources.length}`);
    for (const s of payload.impacted_sources) console.log(`- ${s}`);
  }
  console.log('Next: run these tests with `cdd-kit test run`, or treat them as the changed-area scope.');
}

function printFailure(message: string, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  } else {
    console.error(message);
  }
  return 1;
}
