import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';

const TEMPLATE_DIR = join(process.cwd(), 'specs', 'templates', 'acceptance-driver');

describe('acceptance-driver loader templates (IP-10, block 6)', () => {
  it('ships a pytest loader, a vitest loader, and a README', () => {
    expect(existsSync(join(TEMPLATE_DIR, 'acceptance_loader.py'))).toBe(true);
    expect(existsSync(join(TEMPLATE_DIR, 'acceptance.loader.ts'))).toBe(true);
    expect(existsSync(join(TEMPLATE_DIR, 'README.md'))).toBe(true);
  });

  it('the pytest loader defines load_case and load_all_cases', () => {
    const content = readFileSync(join(TEMPLATE_DIR, 'acceptance_loader.py'), 'utf8');
    expect(content).toContain('def load_case');
    expect(content).toContain('def load_all_cases');
  });

  it('the vitest loader exports loadCase and loadAllCases', () => {
    const content = readFileSync(join(TEMPLATE_DIR, 'acceptance.loader.ts'), 'utf8');
    expect(content).toContain('export function loadCase');
    expect(content).toContain('export function loadAllCases');
  });

  it('the README documents the tests/acceptance and test/acceptance driver directories', () => {
    const content = readFileSync(join(TEMPLATE_DIR, 'README.md'), 'utf8');
    expect(content).toContain('tests/acceptance/');
    expect(content).toContain('test/acceptance/');
  });

  // Regression: `cdd-kit archive` moves specs/changes/<id>/ to
  // specs/archive/<year>/<id>/. Both loaders hardcoded the active path, so every
  // acceptance driver silently broke the moment its change was closed -- the
  // oracle rotted exactly when it became history. Caught by this repo's own
  // archive commit (05fcc0b) breaking test/acceptance/*.driver.test.ts.
  it('both loaders resolve an archived change, not just an active one', () => {
    const ts = readFileSync(join(TEMPLATE_DIR, 'acceptance.loader.ts'), 'utf8');
    expect(ts).toContain('export function resolveAcceptancePath');
    expect(ts).toContain(`join('specs', 'archive')`);
    expect(ts).not.toMatch(/const path = join\('specs', 'changes', changeId/);

    const py = readFileSync(join(TEMPLATE_DIR, 'acceptance_loader.py'), 'utf8');
    expect(py).toContain('def resolve_acceptance_path');
    expect(py).toContain('Path("specs") / "archive"');
  });
});

describe.skipIf(!hasPython())('acceptance_loader.py (functional smoke test)', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-py-loader-smoke-');
    mkdirSync(join(tmpRepo, 'specs', 'changes', 'my-change'), { recursive: true });
    writeFileSync(join(tmpRepo, 'specs', 'changes', 'my-change', 'acceptance.yml'), [
      'oracle-version: 0.1.0',
      'authored-by: human',
      'cases:',
      '  - id: over-limit',
      '    given: g',
      '    when: w',
      '    then: t',
      '    input:',
      '      customer_limit: 1000',
      '    expect:',
      '      status: rejected',
    ].join('\n'), 'utf8');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
  });

  it('load_case reads input/expect for a real case from acceptance.yml', () => {
    const script = [
      'import sys',
      "sys.path.insert(0, '" + TEMPLATE_DIR.replace(/\\/g, '/') + "')",
      'from acceptance_loader import load_case',
      "case = load_case('my-change', 'over-limit')",
      "assert case['input'] == {'customer_limit': 1000}, case",
      "assert case['expect'] == {'status': 'rejected'}, case",
      "print('OK')",
    ].join('\n');
    const r = spawnSync('python', ['-c', script], { cwd: tmpRepo, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it('load_case raises a clear error for an unknown case id', () => {
    const script = [
      'import sys',
      "sys.path.insert(0, '" + TEMPLATE_DIR.replace(/\\/g, '/') + "')",
      'from acceptance_loader import load_case',
      'try:',
      "    load_case('my-change', 'no-such-case')",
      "    print('DID_NOT_RAISE')",
      'except KeyError as e:',
      "    print('OK:' + str(e))",
    ].join('\n');
    const r = spawnSync('python', ['-c', script], { cwd: tmpRepo, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('OK:');
  });
});
