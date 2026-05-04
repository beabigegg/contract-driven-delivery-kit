/**
 * CLI tests for `cdd-kit code-map`:
 *   - end-to-end TS / TSX scanning
 *   - .cdd/code-map-config.yml replacement semantics
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'code-map',
);

function copyFixtures(tmpRepo: string, ...names: string[]): void {
  for (const name of names) {
    copyFileSync(join(FIXTURE_ROOT, name), join(tmpRepo, name));
  }
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('code-map-ts-cli-');
  tmpHome = makeTempDir('code-map-ts-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit code-map — TS / TSX', () => {
  it('1: scans .ts and .tsx end-to-end and renders interfaces/types/enums', () => {
    copyFixtures(tmpRepo, 'sample.ts', 'sample.tsx', 'types-only.ts');
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');

    // file-level entries present
    expect(out).toContain('sample.ts:');
    expect(out).toContain('sample.tsx:');
    expect(out).toContain('types-only.ts:');

    // schema-extension sections present
    expect(out).toMatch(/^  interfaces:$/m);
    expect(out).toMatch(/^  types:$/m);
    expect(out).toMatch(/^  enums:$/m);

    // a known interface, a known type alias, a known enum
    expect(out).toMatch(/name: User\b/);
    expect(out).toMatch(/name: UserId\b/);
    expect(out).toMatch(/name: Status\b/);

    // exported flag — `# local` annotation only on non-exported
    expect(out).toMatch(/name: InternalState.*# local/);
    expect(out).not.toMatch(/name: User,.*# local/);
  });

  it('2: forwardRef-wrapped components are captured as functions', () => {
    copyFixtures(tmpRepo, 'sample.tsx');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).toMatch(/name: Button\b/);
    expect(out).toMatch(/name: Card\b/);
  });
});

describe('cdd-kit code-map — .cdd/code-map-config.yml', () => {
  it('3: user config replacing include narrows the scan', () => {
    copyFixtures(tmpRepo, 'sample.ts', 'sample.tsx');
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    // Only scan .ts (not .tsx). Replacement semantics — built-in include is fully
    // replaced by this single-pattern list.
    writeFileSync(
      join(tmpRepo, '.cdd', 'code-map-config.yml'),
      'include:\n  - "**/*.ts"\nexclude:\n  - "**/*.tsx"\n',
      'utf8',
    );
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).toContain('sample.ts:');
    expect(out).not.toContain('sample.tsx:');
  });

  it('4: malformed config produces clear error and non-zero exit', () => {
    copyFixtures(tmpRepo, 'sample.ts');
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(
      join(tmpRepo, '.cdd', 'code-map-config.yml'),
      'include: "not-a-list"\n',
      'utf8',
    );
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/include.*list/);
  });

  it('5: missing config file falls back to built-in defaults', () => {
    copyFixtures(tmpRepo, 'sample.ts');
    const r = runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'utf8');
    expect(out).toContain('sample.ts:');
  });
});
