import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { resolve } from 'path';
import { codeMapWatch, generatedArtifactSet, makeWatchExcludeFilter } from '../../src/commands/code-map-watch.js';
import { DEFAULT_EXCLUDE } from '../../src/code-map/include-exclude.js';

describe('generatedArtifactSet (watch self-write filter)', () => {
  const cwd = '/repo';

  it('covers the map, its JSON sidecar, and the code-graph index for the default out', () => {
    const set = generatedArtifactSet('.cdd/code-map.yml', cwd);
    expect(set.has(resolve(cwd, '.cdd/code-map.yml'))).toBe(true);
    expect(set.has(resolve(cwd, '.cdd/code-map.index.json'))).toBe(true);
    expect(set.has(resolve(cwd, '.cdd/code-graph.index.json'))).toBe(true);
  });

  it('covers cache siblings of a custom --out outside .cdd/', () => {
    const set = generatedArtifactSet('code-map.yml', cwd);
    expect(set.has(resolve(cwd, 'code-map.yml'))).toBe(true);
    expect(set.has(resolve(cwd, 'code-map.index.json'))).toBe(true);   // sidecar
    expect(set.has(resolve(cwd, 'code-graph.index.json'))).toBe(true); // graph
  });

  it('does NOT suppress user config edits under .cdd/', () => {
    const set = generatedArtifactSet('.cdd/code-map.yml', cwd);
    expect(set.has(resolve(cwd, '.cdd/code-map-config.yml'))).toBe(false);
    expect(set.has(resolve(cwd, '.cdd/tier-policy.json'))).toBe(false);
  });
});

describe('makeWatchExcludeFilter (skip rebuilds for irrelevant events)', () => {
  const isExcluded = makeWatchExcludeFilter([...DEFAULT_EXCLUDE]);

  it('skips churn under ignored trees (no needless rescan)', () => {
    expect(isExcluded('node_modules/react/index.js')).toBe(true);
    expect(isExcluded('dist/bundle.js')).toBe(true);
    expect(isExcluded('.git/objects/ab/cd')).toBe(true);
    expect(isExcluded('.next/cache/x')).toBe(true);
    expect(isExcluded('coverage/lcov.info')).toBe(true);
    expect(isExcluded('node_modules')).toBe(true); // directory event form
  });

  it('does NOT skip real source edits', () => {
    expect(isExcluded('src/index.ts')).toBe(false);
    expect(isExcluded('src/auth/middleware.ts')).toBe(false);
  });

  it('ALWAYS lets the code-map config through (codeMap reloads it each build)', () => {
    // It lives under the excluded `.cdd/**`, but editing include/exclude rules
    // must still trigger a rebuild or the map goes stale.
    expect(isExcluded('.cdd/code-map-config.yml')).toBe(false);
    // Other .cdd files (not reloaded by the scan) stay suppressed.
    expect(isExcluded('.cdd/tier-policy.json')).toBe(true);
  });

  it('returns an always-false filter when there are no excludes', () => {
    const none = makeWatchExcludeFilter([]);
    expect(none('node_modules/x.js')).toBe(false);
  });
});

describe('codeMapWatch', () => {
  it('stops cleanly and resolves 0 when the AbortSignal fires', async () => {
    const dir = makeTempDir('cdd-watch-');
    const prevCwd = process.cwd();
    try {
      writeFileSync(join(dir, 'a.js'), 'export const x = 1;\n');
      process.chdir(dir);
      const controller = new AbortController();
      const p = codeMapWatch({
        path: '.', include: [], exclude: [], maxLines: 100000,
        debounceMs: 30, signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 120);
      const code = await p;
      expect(code).toBe(0);
    } finally {
      process.chdir(prevCwd);
      cleanupDir(dir);
    }
  });

  it('returns nonzero and does not start watching when the initial build fails', async () => {
    const dir = makeTempDir('cdd-watch-');
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      // A surface that does not exist makes codeMap() return nonzero; --watch
      // must propagate that instead of watching an unbuilt path.
      const code = await codeMapWatch({
        path: '.', surface: 'definitely-missing-surface', include: [], exclude: [],
        maxLines: 100000, debounceMs: 30,
        // no signal: if it (wrongly) started watching, the test would hang
      });
      expect(code).not.toBe(0);
    } finally {
      process.chdir(prevCwd);
      cleanupDir(dir);
    }
  });

  it('resolves immediately when the signal is already aborted', async () => {
    const dir = makeTempDir('cdd-watch-');
    const prevCwd = process.cwd();
    try {
      writeFileSync(join(dir, 'a.js'), 'export const x = 1;\n');
      process.chdir(dir);
      const code = await codeMapWatch({
        path: '.', include: [], exclude: [], maxLines: 100000,
        debounceMs: 30, signal: AbortSignal.abort(),
      });
      expect(code).toBe(0);
    } finally {
      process.chdir(prevCwd);
      cleanupDir(dir);
    }
  });
});
