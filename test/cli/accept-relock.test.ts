import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { computeAcceptanceHash, type AcceptanceFile } from '../../src/utils/acceptance-hash.js';

function realOracle(): AcceptanceFile {
  return {
    'oracle-version': '0.1.0',
    'authored-by': 'human',
    cases: [
      {
        id: 'over-limit-order-rejected',
        given: 'g',
        when: 'w',
        then: 't',
        input: { customer_limit: 1000, order_amount: 1500 },
        expect: { status: 'rejected', reason: 'credit-limit-exceeded' },
      },
    ],
  };
}

describe('cdd-kit accept relock (ADR 0010, human-only baseline command)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-accept-relock-repo-');
    tmpHome = makeTempDir('cdd-accept-relock-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error('Setup init failed: ' + r.stderr);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  function writeOracle(changeId: string, oracle: unknown): string {
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump(oracle, { lineWidth: -1, noRefs: true }), 'utf8');
    return changeDir;
  }

  it('records a new baseline matching the current acceptance.yml hash', () => {
    const oracle = realOracle();
    writeOracle('my-change', oracle);

    const r = runCli(['accept', 'relock', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/recorded a new baseline/i);

    const manifestPath = join(tmpRepo, '.cdd', 'acceptance-lock.json');
    expect(existsSync(manifestPath)).toBe(true);
    const lock = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(lock['my-change'].hash).toBe(computeAcceptanceHash(oracle as AcceptanceFile));
  });

  it('re-running relock after editing acceptance.yml updates the baseline (re-baseline path)', () => {
    const oracle = realOracle();
    writeOracle('my-change', oracle);
    runCli(['accept', 'relock', 'my-change'], { cwd: tmpRepo, home: tmpHome });

    const edited = realOracle();
    (edited.cases ?? [])[0].expect = { status: 'accepted' };
    writeOracle('my-change', edited);

    const r = runCli(['accept', 'relock', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/re-baselined my-change/i);

    const lock = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'acceptance-lock.json'), 'utf8'));
    expect(lock['my-change'].hash).toBe(computeAcceptanceHash(edited));
  });

  it('re-running relock with no change reports the baseline already matches', () => {
    const oracle = realOracle();
    writeOracle('my-change', oracle);
    runCli(['accept', 'relock', 'my-change'], { cwd: tmpRepo, home: tmpHome });

    const r = runCli(['accept', 'relock', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/already matches/i);
  });

  it('a subsequent gate run with the relocked baseline does not report tampering', () => {
    const oracle = realOracle();
    const changeDir = writeOracle('acc-relock-gate', oracle);
    writeFileSync(join(changeDir, 'change-request.md'), '# Change Request\n\nA meaningful description of the change. '.repeat(4), 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'), '# Change Classification\n\n**Tier:** Tier 2\n\nA meaningful description. '.repeat(6), 'utf8');
    writeFileSync(join(changeDir, 'implementation-plan.md'), '# Implementation Plan: acc-relock-gate\n\n## Objective\n' + 'A meaningful objective. '.repeat(6), 'utf8');
    writeFileSync(join(changeDir, 'test-plan.md'), '# Test Plan\n\n' + 'A meaningful test plan. '.repeat(6), 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), '# CI Gates\n\n' + 'A meaningful ci gate description. '.repeat(6), 'utf8');
    writeFileSync(join(changeDir, 'tasks.yml'), yaml.dump({ 'change-id': 'acc-relock-gate', status: 'in-progress', tasks: [] }), 'utf8');

    const relock = runCli(['accept', 'relock', 'acc-relock-gate'], { cwd: tmpRepo, home: tmpHome });
    expect(relock.status, relock.stdout + relock.stderr).toBe(0);

    const r = runCli(['gate', 'acc-relock-gate'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/acceptance oracle modified after authoring/i);
  });

  it('fails clearly when acceptance.yml does not exist', () => {
    mkdirSync(join(tmpRepo, 'specs', 'changes', 'no-oracle'), { recursive: true });
    const r = runCli(['accept', 'relock', 'no-oracle'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing specs\/changes\/no-oracle\/acceptance\.yml/i);
  });

  it('fails clearly when the change does not exist', () => {
    const r = runCli(['accept', 'relock', 'no-such-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/change not found/i);
  });

  it('fails clearly when acceptance.yml does not match the schema', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'bad-oracle');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'acceptance.yml'), 'oracle-version: 0.1.0\nauthored-by: human\ncases: []\n', 'utf8');
    const r = runCli(['accept', 'relock', 'bad-oracle'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/does not match the schema/i);
  });

  it('rejects an invalid change id', () => {
    const r = runCli(['accept', 'relock', '../../etc'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid change id/i);
  });
});
