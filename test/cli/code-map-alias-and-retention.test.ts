/**
 * CLI tests for two code-map robustness fixes:
 *
 *  #1 tsconfig `paths`/`baseUrl` alias resolution — non-relative imports like
 *     `@/foo` now produce real `imports` edges instead of being dropped as
 *     third-party (the dominant source of unresolved refs in alias-heavy
 *     Vue/React repos).
 *
 *  #2 last-good retention — a file that fails to parse this run keeps its
 *     previous map entry (marked STALE) instead of vanishing from the index,
 *     so a mid-edit syntax error does not blind agents to the file.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('code-map-alias-repo-');
  tmpHome = makeTempDir('code-map-alias-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('tsconfig path-alias resolution (#1)', () => {
  it('resolves `@/x` aliased imports into real graph edges', () => {
    writeFileSync(join(tmpRepo, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    }), 'utf8');
    mkdirSync(join(tmpRepo, 'src'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src', 'foo.ts'), 'export function helper() { return 1; }\n', 'utf8');
    writeFileSync(join(tmpRepo, 'src', 'bar.ts'), [
      "import { helper } from '@/foo';",
      'export function useIt() { return helper(); }',
      '',
    ].join('\n'), 'utf8');

    const r = runCli(['graph', 'impact', 'src/foo.ts', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      nodes: { file_path: string }[];
      edges: { kind: string; metadata?: { module?: string } }[];
    };

    // bar.ts depends on foo.ts only if the `@/foo` alias resolved.
    expect(payload.nodes.some(n => n.file_path === 'src/bar.ts')).toBe(true);
    const aliasEdge = payload.edges.find(e => e.kind === 'imports' && e.metadata?.module === '@/foo');
    expect(aliasEdge, 'expected an imports edge for the @/foo alias').toBeTruthy();
  });

  it('leaves genuine third-party imports unresolved (no false edges)', () => {
    writeFileSync(join(tmpRepo, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    }), 'utf8');
    mkdirSync(join(tmpRepo, 'src'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src', 'bar.ts'), [
      "import { readFileSync } from 'fs';",
      "import lodash from 'lodash';",
      'export function useIt() { return readFileSync && lodash; }',
      '',
    ].join('\n'), 'utf8');

    const r = runCli(['graph', 'impact', 'src/bar.ts', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { edges: { kind: string; metadata?: { module?: string } }[] };
    // `fs` and `lodash` must NOT resolve to local files.
    expect(payload.edges.some(e => e.kind === 'imports' && e.metadata?.module === 'lodash')).toBe(false);
    expect(payload.edges.some(e => e.kind === 'imports' && e.metadata?.module === 'fs')).toBe(false);
  });
});

describe('last-good retention on parse failure (#2)', () => {
  const mapPath = () => join(tmpRepo, '.cdd', 'code-map.yml');

  it('retains the previous entry (marked STALE) when a file stops parsing', () => {
    const good = 'export function alpha() { return 1; }\nexport function beta() { return 2; }\n';
    writeFileSync(join(tmpRepo, 'mod.ts'), good, 'utf8');

    const first = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(mapPath(), 'utf8')).toMatch(/alpha/);

    // Break the file so the parser rejects it.
    writeFileSync(join(tmpRepo, 'mod.ts'), 'export function alpha( { ] [ ) {{{\n', 'utf8');
    const second = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(second.status, second.stderr).toBe(0);

    const map = readFileSync(mapPath(), 'utf8');
    // The entry must NOT vanish — symbols retained from the last good parse…
    expect(map).toMatch(/mod\.ts:/);
    expect(map).toMatch(/alpha/);
    expect(map).toMatch(/beta/);
    // …and it must be clearly flagged as stale so consumers do not trust it.
    expect(map).toMatch(/mod\.ts:.*STALE/);
  });

  it('does NOT fabricate an entry for a brand-new unparseable file', () => {
    writeFileSync(join(tmpRepo, 'ok.ts'), 'export const X = 1;\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    // A new file that never had a good parse should still drop (nothing to retain).
    writeFileSync(join(tmpRepo, 'broken.ts'), 'function ( { ] [ )))\n', 'utf8');
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const map = readFileSync(mapPath(), 'utf8');
    expect(map).toMatch(/ok\.ts:/);
    expect(map).not.toMatch(/broken\.ts:/);
  });
});
