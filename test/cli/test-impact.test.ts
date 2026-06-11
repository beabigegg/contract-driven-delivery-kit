/**
 * CLI tests for `cdd-kit test impact`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

function write(rel: string, body: string): void {
  const full = join(tmpRepo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

// Dependency chain: repo.ts ← service.ts ← controller.ts.
// Tests: repo.test.ts imports repo directly (1 hop); tests/service.test.ts
// imports service (so it is 2 hops from repo → transitive at depth 2).
function writeImpactFixture(): void {
  write('src/repo.ts', 'export function loadUser(id: string) { return { id }; }\n');
  write('src/service.ts', "import { loadUser } from './repo.js';\nexport class UserService { get(id: string) { return loadUser(id); } }\n");
  write('src/controller.ts', "import { UserService } from './service.js';\nexport function getUser(id: string) { return new UserService().get(id); }\n");
  write('src/repo.test.ts', "import { loadUser } from './repo.js';\ntest('loadUser', () => { loadUser('x'); });\n");
  write('tests/service.test.ts', "import { UserService } from '../src/service.js';\ntest('svc', () => { new UserService().get('y'); });\n");
}

beforeEach(() => {
  tmpRepo = makeTempDir('test-impact-repo-');
  tmpHome = makeTempDir('test-impact-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit test impact', () => {
  it('auto-refreshes a missing code-map and finds direct + transitive test dependents', () => {
    writeImpactFixture();
    const r = runCli(['test', 'impact', 'src/repo.ts', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(true);

    const payload = JSON.parse(r.stdout) as {
      target: string;
      affected_tests: { path: string; reason: string }[];
      impacted_sources: string[];
    };
    expect(payload.target).toBe('src/repo.ts');
    const byPath = Object.fromEntries(payload.affected_tests.map(t => [t.path, t.reason]));
    // Directly imports repo.ts → imports-target.
    expect(byPath['src/repo.test.ts']).toBe('imports-target');
    // Imports service → repo, 2 hops within depth 2: transitive.
    expect(byPath['tests/service.test.ts']).toBe('transitive');
    // The intermediate sources are reported as impacted sources.
    expect(payload.impacted_sources).toContain('src/service.ts');
    expect(payload.impacted_sources).toContain('src/controller.ts');
  });

  it('falls back to a mirror-path test when the dependency is beyond --depth', () => {
    writeImpactFixture();
    // depth 1: tests/service.test.ts is NOT a direct importer of repo.ts, but
    // src/service.ts IS an impacted source at this depth, so its mirror test
    // (tests/service.test.ts) is surfaced with reason `mirror`.
    const r = runCli(['test', 'impact', 'src/repo.ts', '--depth', '1', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { affected_tests: { path: string; reason: string; via?: string }[] };
    const mirror = payload.affected_tests.find(t => t.path === 'tests/service.test.ts');
    expect(mirror?.reason).toBe('mirror');
    expect(mirror?.via).toBe('src/service.ts');
  });

  it('exits 1 with a helpful error when the target is unknown', () => {
    writeImpactFixture();
    const r = runCli(['test', 'impact', 'src/nope.ts', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toMatch(/No code-map path or unique symbol matched/);
  });

  it('marks the result truncated when more tests are affected than --limit allows', () => {
    writeImpactFixture();
    const r = runCli(['test', 'impact', 'src/repo.ts', '--limit', '1', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { affected_tests: unknown[]; truncated: boolean };
    expect(payload.affected_tests).toHaveLength(1);
    expect(payload.truncated).toBe(true);
  });

  it('renders a readable text report by default', () => {
    writeImpactFixture();
    const r = runCli(['test', 'impact', 'src/repo.ts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('target: src/repo.ts');
    expect(r.stdout).toMatch(/src\/repo\.test\.ts \[imports-target\]/);
  });
});
