/**
 * Unit tests for code-map scanners.
 * Python tests are skipped when no Python interpreter is available.
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { pythonScanner } from '../../src/code-map/scanners/python.js';
import { jsScanner } from '../../src/code-map/scanners/javascript.js';
import { vueScanner } from '../../src/code-map/scanners/vue.js';

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

describe('javascript scanner', () => {
  it('extracts imports/exports/functions/classes', async () => {
    const e = await jsScanner.scan(fixturePath('sample.js'), fixtureRoot());
    expect(e).not.toBeNull();
    expect(e!.path).toBe('sample.js');
    expect(e!.imports.length).toBeGreaterThanOrEqual(3);
    expect(e!.classes.find(c => c.name === 'Bar')).toBeTruthy();
    expect(e!.functions.find(f => f.name === 'handler')?.async).toBe(true);
    expect(e!.functions.find(f => f.name === 'declared')).toBeTruthy();
  });

  it('returns null or empty for syntactically catastrophic JS but never throws', async () => {
    const tmp = writeTempFile('!!!@@##$$', '.js');
    const e = await jsScanner.scan(tmp, dirname(tmp));
    // With errorRecovery, Babel may still produce empty AST; either null or empty entry is acceptable
    expect(e === null || (e.classes.length === 0 && e.functions.length === 0)).toBe(true);
  });

  it('returns empty sections for comments-only file', async () => {
    const e = await jsScanner.scan(fixturePath('comments-only.js'), fixtureRoot());
    expect(e).not.toBeNull();
    expect(e!.imports).toHaveLength(0);
    expect(e!.functions).toHaveLength(0);
    expect(e!.classes).toHaveLength(0);
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
  it('offsets line numbers from <script setup> block start', async () => {
    const e = await vueScanner.scan(fixturePath('sample.vue'), fixtureRoot());
    expect(e).not.toBeNull();
    expect(e!.total_lines).toBe(40);
    const fn = e!.functions[0];
    expect(fn.lines[0]).toBeGreaterThanOrEqual(10);
    expect(fn.lines[1]).toBeLessThanOrEqual(30);
  });

  it('skips <script lang="ts"> with warning (returns empty functions)', async () => {
    const tmp = writeTempVue('<script lang="ts">export const x = 1;</script>');
    const e = await vueScanner.scan(tmp, dirname(tmp));
    expect(e).not.toBeNull();
    expect(e!.functions).toHaveLength(0);
  });

  it('returns empty entry for vue file with no script block', async () => {
    const tmp = writeTempVue('<template><div>Hello</div></template>\n<style>.x{}</style>');
    const e = await vueScanner.scan(tmp, dirname(tmp));
    expect(e).not.toBeNull();
    expect(e!.imports).toHaveLength(0);
    expect(e!.functions).toHaveLength(0);
    expect(e!.classes).toHaveLength(0);
  });
});
