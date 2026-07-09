/**
 * `cdd-kit validate --spec` (validate_spec_traceability.py) coverage for the
 * tasks.yml `status: abandoned` marker (change-request.md Scope expansion 3).
 * Mirrors the ADR 0011 applicability-marker test conventions already applied
 * to contracts/*.md in test/cli/validate-applicability.test.ts: SKIP + info
 * note when marked with a non-empty reason, HARD-FAIL when the reason is
 * missing/empty, and the regression guard — an unmarked incomplete directory
 * (or one with no tasks.yml at all) must still HARD-FAIL exactly as before.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

function scaffoldIncompleteChange(repo: string, changeId: string, tasksYaml: Record<string, unknown> | null): void {
  const changeDir = join(repo, 'specs', 'changes', changeId);
  mkdirSync(changeDir, { recursive: true });
  if (tasksYaml !== null) {
    writeFileSync(join(changeDir, 'tasks.yml'), yaml.dump(tasksYaml, { lineWidth: -1 }), 'utf8');
  }
}

describe.skipIf(!hasPython())('validate --spec — tasks.yml abandoned marker (Scope expansion 3)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-spec-traceability-repo-');
    tmpHome = makeTempDir('cdd-spec-traceability-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error(`Setup init failed: ${r.stderr}`);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('skips an abandoned dir with a non-empty reason and prints an informational note', () => {
    scaffoldIncompleteChange(tmpRepo, 'stale-1', {
      'change-id': 'stale-1',
      status: 'abandoned',
      'abandoned-reason': 'superseded by shipped work',
      'abandoned-at': '2026-07-09',
      tasks: [],
    });
    const r = runCli(['validate', '--spec'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/stale-1 marked tasks\.yml status: abandoned \(superseded by shipped work\)/);
    expect(r.stdout).toMatch(/required-artifact check skipped/i);
  });

  it('hard-fails an abandoned dir whose abandoned-reason is empty', () => {
    scaffoldIncompleteChange(tmpRepo, 'stale-2', {
      'change-id': 'stale-2',
      status: 'abandoned',
      'abandoned-reason': '',
      tasks: [],
    });
    const r = runCli(['validate', '--spec'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/stale-2.*abandoned.*non-empty.*abandoned-reason/i);
  });

  it('hard-fails an abandoned dir with no abandoned-reason field at all', () => {
    scaffoldIncompleteChange(tmpRepo, 'stale-3', {
      'change-id': 'stale-3',
      status: 'abandoned',
      tasks: [],
    });
    const r = runCli(['validate', '--spec'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/stale-3.*abandoned-reason/i);
  });

  it('hard-fails an unmarked incomplete directory (regression guard — unchanged behavior)', () => {
    scaffoldIncompleteChange(tmpRepo, 'unmarked-incomplete', {
      'change-id': 'unmarked-incomplete',
      status: 'in-progress',
      tasks: [{ id: '1.1', title: 'Do something', status: 'pending' }],
    });
    const r = runCli(['validate', '--spec'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/unmarked-incomplete: missing required artifacts/);
  });

  it('hard-fails a directory with no tasks.yml at all and no marker (unchanged behavior)', () => {
    scaffoldIncompleteChange(tmpRepo, 'no-tasks-yml', null);
    const r = runCli(['validate', '--spec'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no-tasks-yml: missing required artifacts/);
  });

  it('end-to-end: abandoning a change dir with no tasks.yml makes validate --spec pass', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'e2e-stale');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'plan.md'), '# Old plan\n', 'utf8');
    expect(existsSync(join(changeDir, 'tasks.yml'))).toBe(false);

    const abandonResult = runCli(
      ['abandon', 'e2e-stale', '--reason', 'superseded by shipped work'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(abandonResult.status, `stdout: ${abandonResult.stdout}\nstderr: ${abandonResult.stderr}`).toBe(0);
    expect(existsSync(join(changeDir, 'tasks.yml'))).toBe(true);

    const r = runCli(['validate', '--spec'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/e2e-stale marked tasks\.yml status: abandoned/);
  });
});
