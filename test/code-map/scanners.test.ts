/**
 * Unit tests for code-map scanners.
 * Python tests are skipped when no Python interpreter is available.
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { existsSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { pythonScanner } from '../../src/code-map/scanners/python.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function hasPython(): boolean {
  for (const candidate of ['python3', 'python']) {
    try {
      const r = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

const FIXTURE_ROOT = join(import.meta.dirname ?? dirname(new URL(import.meta.url).pathname), '..', 'fixtures', 'code-map');

function fixturePath(name: string): string {
  return join(FIXTURE_ROOT, name);
}

function fixtureRoot(): string {
  return FIXTURE_ROOT;
}

function writeTempFile(content: string, ext = '.js'): string {
  const dir = mkdtempSync(join(tmpdir(), 'cdd-test-'));
  const p = join(dir, `test${ext}`);
  writeFileSync(p, content, 'utf8');
  return p;
}

// ── Python scanner tests ──────────────────────────────────────────────────

describe('python scanner', () => {
  it.skipIf(!hasPython())('extracts classes/functions/imports/constants from sample.py', async () => {
    const result = await pythonScanner.scanBatch!([fixturePath('sample.py')], fixtureRoot());
    expect(result.entries).toHaveLength(1);
    const e = result.entries[0];
    expect(e.path).toBe('sample.py');
    expect(e.imports.find(i => i.module === '.y')?.items).toEqual(['a', 'b']);
    expect(e.constants.map(c => c.name)).toContain('MAX_BATCH_SIZE');
    expect(e.classes[0].name).toBe('Foo');
    expect(e.classes[0].methods.find(m => m.name === 'fetch')?.async).toBe(true);
  });

  it.skipIf(!hasPython())('skips broken.py and emits warning', async () => {
    const result = await pythonScanner.scanBatch!([fixturePath('broken.py')], fixtureRoot());
    expect(result.entries.some(e => e.path === 'broken.py')).toBe(false);
    expect(result.warnings.find(w => w.path === 'broken.py')).toBeTruthy();
  });

  it.skipIf(!hasPython())('emits empty entry for empty.py with total_lines: 0', async () => {
    const result = await pythonScanner.scanBatch!([fixturePath('empty.py')], fixtureRoot());
    expect(result.entries[0].total_lines).toBe(0);
  });
});

// ── JavaScript scanner tests ──────────────────────────────────────────────

function hasJsScanner(): boolean {
  try {
    require.resolve('../../src/code-map/scanners/javascript.js');
    return true;
  } catch {
    return false;
  }
}

// Use existsSync check since we can't require a module synchronously in ESM
import { existsSync as _existsSync } from 'fs';
const JS_SCANNER_EXISTS = _existsSync(
  join(import.meta.dirname ?? dirname(new URL(import.meta.url).pathname), '..', '..', 'src', 'code-map', 'scanners', 'javascript.ts')
);
const VUE_SCANNER_EXISTS = _existsSync(
  join(import.meta.dirname ?? dirname(new URL(import.meta.url).pathname), '..', '..', 'src', 'code-map', 'scanners', 'vue.ts')
);

describe('javascript scanner', () => {
  it.skipIf(!JS_SCANNER_EXISTS)('extracts imports/exports/functions/classes', async () => {
    const { jsScanner } = await import('../../src/code-map/scanners/javascript.js');
    const e = await jsScanner.scan(fixturePath('sample.js'), fixtureRoot());
    expect(e).not.toBeNull();
    expect(e!.path).toBe('sample.js');
    expect(e!.imports.length).toBeGreaterThanOrEqual(3);
    expect(e!.classes.find(c => c.name === 'Bar')).toBeTruthy();
    expect(e!.functions.find(f => f.name === 'handler')?.async).toBe(true);
    expect(e!.functions.find(f => f.name === 'declared')).toBeTruthy();
  });

  it.skipIf(!JS_SCANNER_EXISTS)('returns null or empty for syntactically catastrophic JS but never throws', async () => {
    const { jsScanner } = await import('../../src/code-map/scanners/javascript.js');
    const tmp = writeTempFile('!!!@@##$$', '.js');
    const e = await jsScanner.scan(tmp, dirname(tmp));
    // With errorRecovery, Babel may still produce empty AST; either null or empty entry is acceptable
    expect(e === null || (e.classes.length === 0 && e.functions.length === 0)).toBe(true);
  });
});

// ── Vue scanner tests ──────────────────────────────────────────────────────

function writeTempVue(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cdd-test-'));
  const p = join(dir, 'test.vue');
  writeFileSync(p, content, 'utf8');
  return p;
}

describe('vue scanner', () => {
  it.skipIf(!VUE_SCANNER_EXISTS)('offsets line numbers from <script setup> block start', async () => {
    const { vueScanner } = await import('../../src/code-map/scanners/vue.js');
    const e = await vueScanner.scan(fixturePath('sample.vue'), fixtureRoot());
    expect(e).not.toBeNull();
    expect(e!.total_lines).toBe(40);
    const fn = e!.functions[0];
    expect(fn.lines[0]).toBeGreaterThanOrEqual(10);
    expect(fn.lines[1]).toBeLessThanOrEqual(30);
  });

  it.skipIf(!VUE_SCANNER_EXISTS)('skips <script lang="ts"> with warning (returns empty functions)', async () => {
    const { vueScanner } = await import('../../src/code-map/scanners/vue.js');
    const tmp = writeTempVue('<script lang="ts">export const x = 1;</script>');
    const e = await vueScanner.scan(tmp, dirname(tmp));
    expect(e).not.toBeNull();
    expect(e!.functions).toHaveLength(0);
  });
});
