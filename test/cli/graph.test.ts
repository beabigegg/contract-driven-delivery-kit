/**
 * CLI tests for `cdd-kit graph`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'fixtures', 'code-map'
);

function copyFixture(tmpRepo: string, name: string): void {
  copyFileSync(join(FIXTURE_ROOT, name), join(tmpRepo, name));
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('graph-repo-');
  tmpHome = makeTempDir('graph-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit graph', () => {
  it('falls back to code-map query and auto-refreshes the map', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const r = runCli(['graph', 'query', 'User', '--engine', 'codemap'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(true);
    expect(r.stdout).toContain('index: .cdd/code-map.yml (refreshed)');
    expect(r.stdout).toContain('interface: User');
  });

  it('builds fallback context from code-map candidates', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const r = runCli(['graph', 'context', 'User', '--engine', 'codemap', '--json'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      engine: string;
      warning: string;
      candidates: Array<{ path: string }>;
    };
    expect(payload.engine).toBe('codemap');
    expect(payload.warning).toMatch(/CodeGraph is not active/);
    expect(payload.candidates.some(c => c.path === 'sample.ts')).toBe(true);
  });

  it('uses the native cdd-kit code graph by default', () => {
    copyFixture(tmpRepo, 'sample.ts');

    const r = runCli(['graph', 'query', 'Service', '--json'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-graph.index.json'))).toBe(true);
    const payload = JSON.parse(r.stdout) as {
      engine: string;
      graph: string;
      results: Array<{ node: { kind: string; name: string; qualified_name: string } }>;
    };
    expect(payload.engine).toBe('native');
    expect(payload.graph).toBe('.cdd/code-graph.index.json');
    expect(payload.results.some(r => r.node.kind === 'class' && r.node.name === 'Service')).toBe(true);
  });

  it('reports native-query truncation so --limit cannot silently hide matches (P1-7)', () => {
    copyFixture(tmpRepo, 'sample.ts');

    // Full set first: total_matches must equal what is returned, untruncated.
    const all = JSON.parse(
      runCli(['graph', 'query', 'User', '--limit', '50', '--json'], { cwd: tmpRepo, home: tmpHome }).stdout,
    ) as { total_matches: number; returned: number; truncated: boolean; results: unknown[] };
    expect(all.total_matches).toBeGreaterThanOrEqual(2);
    expect(all.truncated).toBe(false);
    expect(all.returned).toBe(all.results.length);

    // Same query, limit 1: must surface that the rest were hidden.
    const r = runCli(['graph', 'query', 'User', '--limit', '1', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const lim = JSON.parse(r.stdout) as { total_matches: number; returned: number; truncated: boolean; results: unknown[] };
    expect(lim.returned).toBe(1);
    expect(lim.results.length).toBe(1);
    expect(lim.total_matches).toBe(all.total_matches);
    expect(lim.truncated).toBe(true);

    const text = runCli(['graph', 'query', 'User', '--limit', '1'], { cwd: tmpRepo, home: tmpHome });
    expect(text.stdout).toMatch(/results: 1 \(of \d+; raise --limit/);
  });

  it('native impact follows call edges', () => {
    writeFileSync(join(tmpRepo, 'a.ts'), `
import { target } from './b';
export function caller() {
  return target();
}
`, 'utf8');
    writeFileSync(join(tmpRepo, 'b.ts'), `
export function target() {
  return 1;
}
`, 'utf8');

    const r = runCli(['graph', 'impact', 'target', '--json'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      engine: string;
      nodes: Array<{ qualified_name: string }>;
      edges: Array<{ kind: string }>;
    };
    expect(payload.engine).toBe('native');
    expect(payload.nodes.some(n => n.qualified_name === 'a.ts::caller')).toBe(true);
    expect(payload.edges.some(e => e.kind === 'calls')).toBe(true);
  });

  it('graph context resolves a multi-word task and --with-source inlines entry-point code (P0+P1)', () => {
    writeFileSync(join(tmpRepo, 'orders.ts'), [
      'export function exportOrders() {',
      '  return buildReport();',
      '}',
      'function buildReport() { return []; }',
      '',
    ].join('\n'), 'utf8');

    const r = runCli(['graph', 'context', 'order export', '--with-source', '--json'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      engine: string;
      entry_points: Array<{ node: { name: string }; source?: string }>;
    };
    expect(payload.engine).toBe('native');
    const ep = payload.entry_points.find(e => e.node.name === 'exportOrders');
    expect(ep).toBeDefined();
    // Source is inlined, so the agent needs no follow-up Read for this entry point.
    expect(ep!.source).toContain('exportOrders');
  });

  it('reports a clear error when CodeGraph is requested but unavailable', () => {
    const r = runCli(['graph', 'status', '--engine', 'codegraph', '--json'], {
      cwd: tmpRepo,
      home: tmpHome,
      env: { CDD_CODEGRAPH_BIN: join(tmpRepo, 'missing-codegraph.js') },
    });

    expect(r.status).toBe(1);
    const payload = JSON.parse(r.stdout) as { error: string };
    expect(payload.error).toMatch(/CodeGraph is not available/);
  });

  it('uses CodeGraph when explicitly requested and the adapter is available', () => {
    mkdirSync(join(tmpRepo, '.codegraph'));
    const fake = join(tmpRepo, 'fake-codegraph.js');
    writeFileSync(fake, `
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('0.9.5');
  process.exit(0);
}
if (args[0] === 'query') {
  console.log(JSON.stringify({ engine: 'fake-codegraph', args }));
  process.exit(0);
}
console.error('unexpected args: ' + args.join(' '));
process.exit(2);
`, 'utf8');

    const r = runCli(['graph', 'query', 'User', '--json', '--engine', 'codegraph'], {
      cwd: tmpRepo,
      home: tmpHome,
      env: { CDD_CODEGRAPH_BIN: fake },
    });

    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { engine: string; args: string[] };
    expect(payload.engine).toBe('fake-codegraph');
    expect(payload.args).toEqual(['query', 'User', '--limit', '10', '--json']);
  });
});
