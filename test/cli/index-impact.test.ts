/**
 * CLI tests for `cdd-kit index impact`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

function writeImpactFixture(): void {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(
    join(tmpRepo, 'src', 'repo.ts'),
    [
      'export function loadUser(id: string) {',
      '  return { id };',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(tmpRepo, 'src', 'service.ts'),
    [
      "import { loadUser } from './repo.js';",
      '',
      'export class UserService {',
      '  get(id: string) {',
      '    return loadUser(id);',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(tmpRepo, 'src', 'controller.ts'),
    [
      "import { UserService } from './service.js';",
      '',
      'export function getUser(id: string) {',
      '  return new UserService().get(id);',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

beforeEach(() => {
  tmpRepo = makeTempDir('index-impact-repo-');
  tmpHome = makeTempDir('index-impact-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit index impact', () => {
  it('auto-refreshes a missing code-map and reports imports plus dependents', () => {
    writeImpactFixture();

    const r = runCli(['index', 'impact', 'src/service.ts'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(true);
    expect(r.stdout).toContain('index: .cdd/code-map.yml (refreshed)');
    expect(r.stdout).toContain('target: src/service.ts');
    expect(r.stdout).toContain('class: UserService');
    expect(r.stdout).toContain("./repo.js {loadUser} line 1 -> src/repo.ts");
    expect(r.stdout).toContain('src/controller.ts');
    expect(r.stdout).toContain("./service.js {UserService} line 1");
  });

  it('can target a unique symbol and emit parseable JSON', () => {
    writeImpactFixture();

    const r = runCli(['index', 'impact', 'UserService', '--json'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      target: { path: string; symbols: Array<{ kind: string; name: string }> };
      imports: Array<{ module: string; resolved?: string }>;
      dependents: Array<{ path: string }>;
    };
    expect(payload.target.path).toBe('src/service.ts');
    expect(payload.target.symbols.some(s => s.kind === 'class' && s.name === 'UserService')).toBe(true);
    expect(payload.imports.some(imp => imp.module === './repo.js' && imp.resolved === 'src/repo.ts')).toBe(true);
    expect(payload.dependents.some(dep => dep.path === 'src/controller.ts')).toBe(true);
  });

  it('honors --no-refresh and fails when the map is missing', () => {
    writeImpactFixture();

    const r = runCli(['index', 'impact', 'src/service.ts', '--no-refresh'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('.cdd/code-map.yml is missing');
    expect(existsSync(join(tmpRepo, '.cdd', 'code-map.yml'))).toBe(false);
  });
});
