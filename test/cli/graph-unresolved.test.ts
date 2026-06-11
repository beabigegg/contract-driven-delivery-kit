/**
 * CLI tests for `cdd-kit graph unresolved` (P2-4).
 *
 * The native graph builder records references it could not link to a target
 * node (external/dynamic/DI calls, ambiguous names) in the index `unresolved`
 * array. This command exposes them — and `graph impact` now carries the subset
 * emanating from the impact set — so impact analysis no longer silently drops
 * the blast radius it could not resolve.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

/** Repo where `save()` is ambiguous (2 globals) and `externalThing()` is external. */
function writeMixedRepo(): void {
  writeFileSync(join(tmpRepo, 'a.ts'), [
    'export function handler() {',
    '  return save() + externalThing();',
    '}',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(tmpRepo, 'b.ts'), 'export function save() { return 1; }\n', 'utf8');
  writeFileSync(join(tmpRepo, 'c.ts'), 'export class Repo { save() { return 2; } }\n', 'utf8');
}

beforeEach(() => {
  tmpRepo = makeTempDir('graph-unresolved-repo-');
  tmpHome = makeTempDir('graph-unresolved-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit graph unresolved', () => {
  it('lists unresolved references and distinguishes ambiguous from external (--json)', () => {
    writeMixedRepo();

    const r = runCli(['graph', 'unresolved', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      engine: string;
      scope: string;
      total: number;
      unresolved: { name: string; kind: string; from_qualified_name: string; candidates: { qualified_name: string }[] }[];
    };

    expect(payload.engine).toBe('native');
    expect(payload.scope).toBe('all');

    // `save` is ambiguous: a function and a method share the leaf name.
    const save = payload.unresolved.find(u => u.name === 'save');
    expect(save?.kind).toBe('calls');
    expect(save?.from_qualified_name).toBe('a.ts::handler');
    const cands = save?.candidates.map(c => c.qualified_name).sort();
    expect(cands).toEqual(['b.ts::save', 'c.ts::Repo.save']);

    // `externalThing` resolves to nothing in the graph → truly external.
    const ext = payload.unresolved.find(u => u.name === 'externalThing');
    expect(ext?.candidates).toEqual([]);
  });

  it('scopes to a single file and reports the resolved scope', () => {
    writeMixedRepo();

    const r = runCli(['graph', 'unresolved', 'a.ts', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      scope: string;
      filter: { resolved: string };
      unresolved: { file_path: string }[];
    };
    expect(payload.scope).toBe('file');
    expect(payload.filter.resolved).toBe('a.ts');
    expect(payload.unresolved.every(u => u.file_path === 'a.ts')).toBe(true);
    expect(payload.unresolved.length).toBeGreaterThan(0);
  });

  it('filters by reference kind', () => {
    writeMixedRepo();

    const calls = runCli(['graph', 'unresolved', '--kind', 'calls', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(calls.status, calls.stderr).toBe(0);
    const callsPayload = JSON.parse(calls.stdout) as { unresolved: { kind: string }[] };
    expect(callsPayload.unresolved.length).toBeGreaterThan(0);
    expect(callsPayload.unresolved.every(u => u.kind === 'calls')).toBe(true);

    // No unresolved `extends` edges exist in this repo → empty but successful.
    const ext = runCli(['graph', 'unresolved', '--kind', 'extends', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(ext.status, ext.stderr).toBe(0);
    expect((JSON.parse(ext.stdout) as { unresolved: unknown[] }).unresolved).toEqual([]);
  });

  it('rejects an invalid --kind', () => {
    writeMixedRepo();
    const r = runCli(['graph', 'unresolved', '--kind', 'bogus', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect((JSON.parse(r.stdout) as { error: string }).error).toMatch(/Invalid --kind/);
  });

  it('returns an empty (but successful) result when everything resolves', () => {
    writeFileSync(join(tmpRepo, 'a.ts'), [
      "import { helper } from './b';",
      'export function handler() { return helper(); }',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(join(tmpRepo, 'b.ts'), 'export function helper() { return 1; }\n', 'utf8');

    const r = runCli(['graph', 'unresolved', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { total: number; unresolved: unknown[] };
    expect(payload.total).toBe(0);
    expect(payload.unresolved).toEqual([]);

    const text = runCli(['graph', 'unresolved'], { cwd: tmpRepo, home: tmpHome });
    expect(text.stdout).toMatch(/No unresolved references in scope/);
  });

  it('graph impact carries the unresolved refs originating from the impact set', () => {
    writeMixedRepo();

    const r = runCli(['graph', 'impact', 'handler', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      unresolved: { name: string; from: string }[];
    };
    const names = payload.unresolved.map(u => u.name).sort();
    expect(names).toContain('save');
    expect(names).toContain('externalThing');
  });
});
