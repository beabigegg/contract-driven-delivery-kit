/**
 * CLI tests for `cdd-kit index query --with-source`.
 *
 * The point of --with-source is that the index query becomes a drop-in
 * replacement for opening the file: it returns the real code slice for each
 * matched line range, so an agent never needs a separate Read just to see the
 * symbol it already located.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'code-map');

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('index-src-repo-');
  tmpHome = makeTempDir('index-src-home-');
  copyFileSync(join(FIXTURE_ROOT, 'sample.ts'), join(tmpRepo, 'sample.ts'));
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit index query --with-source', () => {
  it('inlines the matched source slice in text output', () => {
    const r = runCli(['index', 'query', 'Service', '--with-source'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    // The class body (lines 35-45 in the fixture) should be inlined behind the | prefix.
    expect(r.stdout).toContain('class: Service lines 35-45');
    expect(r.stdout).toContain('| export class Service {');
    // Source lines keep their original indentation behind the "| " prefix.
    expect(r.stdout).toContain('async fetch(id: UserId): Promise<User | null> {');
    expect(r.stdout).toContain('Source included above — no separate Read needed for these ranges.');
  });

  it('returns the source in JSON for the matched range', () => {
    const r = runCli(['index', 'query', 'User', '--with-source', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout);
    const file = payload.results.find((res: { path: string }) => res.path === 'sample.ts');
    expect(file).toBeTruthy();
    const iface = file.matches.find((m: { kind: string; name: string }) => m.kind === 'interface' && m.name === 'User');
    expect(iface).toBeTruthy();
    expect(iface.source).toContain('export interface User {');
    expect(iface.source).toContain('email?: string;');
  });

  it('omits source by default (no --with-source) so behavior is opt-in', () => {
    const r = runCli(['index', 'query', 'Service', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout);
    const file = payload.results.find((res: { path: string }) => res.path === 'sample.ts');
    const klass = file.matches.find((m: { kind: string }) => m.kind === 'class');
    expect(klass.source).toBeUndefined();
  });

  it('respects a tiny source budget and flags truncation', () => {
    const r = runCli(
      ['index', 'query', 'Service', '--with-source', '--source-budget', '2', '--json'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout);
    const file = payload.results.find((res: { path: string }) => res.path === 'sample.ts');
    // Some match must report truncation once the 2-line budget is exhausted.
    const truncated = file.matches.some((m: { source_truncated?: boolean }) => m.source_truncated === true);
    expect(truncated).toBe(true);
  });

  it('emits the human-readable truncation notice in text mode', () => {
    const r = runCli(
      ['index', 'query', 'Service', '--with-source', '--source-budget', '2'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('source budget reached');
  });

  it('falls back to the default budget when --source-budget is non-numeric', () => {
    const r = runCli(
      ['index', 'query', 'Service', '--with-source', '--source-budget', 'abc', '--json'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout);
    const file = payload.results.find((res: { path: string }) => res.path === 'sample.ts');
    const klass = file.matches.find((m: { kind: string }) => m.kind === 'class');
    // With the default 400-line budget the small fixture class is returned whole.
    expect(klass.source).toContain('export class Service {');
    expect(klass.source_truncated).toBeUndefined();
  });
});
