import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { computeDesignHash } from '../../src/utils/design-hash.js';

// Mirrors test/cli/accept-relock.test.ts, but for `cdd-kit design confirm`
// (ADR 0012 §5) -- the sole sanctioned writer of .cdd/design-lock.json.

function designDoc(confirmed: string): string {
  return [
    '# Interaction Design: my-change',
    '',
    '## Open Decisions',
    '- [x] resolved — answer recorded',
    '',
    '## Confirmed',
    confirmed,
  ].join('\n');
}

describe('cdd-kit design confirm (ADR 0012 §5, human-only lock command)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-design-confirm-repo-');
    tmpHome = makeTempDir('cdd-design-confirm-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error('Setup init failed: ' + r.stderr);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  function writeDesign(changeId: string, confirmed: string): string {
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'interaction-design.md'), designDoc(confirmed), 'utf8');
    return changeDir;
  }

  it('records a new baseline matching the current interaction-design.md hash', () => {
    writeDesign('my-change', 'The empty-state copy is "No orders yet."');

    const r = runCli(['design', 'confirm', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/recorded a new baseline/i);

    const lockPath = join(tmpRepo, '.cdd', 'design-lock.json');
    expect(existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lock['my-change'].hash).toBe(computeDesignHash(designDoc('The empty-state copy is "No orders yet."')));
  });

  it('re-running confirm after a legitimate human edit re-baselines (re-confirm path)', () => {
    writeDesign('my-change', 'Answer: yes.');
    runCli(['design', 'confirm', 'my-change'], { cwd: tmpRepo, home: tmpHome });

    writeDesign('my-change', 'Answer: no.');
    const r = runCli(['design', 'confirm', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/re-(baselined|confirmed)/i);

    const lock = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'design-lock.json'), 'utf8'));
    expect(lock['my-change'].hash).toBe(computeDesignHash(designDoc('Answer: no.')));
  });

  it('re-running confirm with no change reports the baseline already matches', () => {
    writeDesign('my-change', 'Answer: yes.');
    runCli(['design', 'confirm', 'my-change'], { cwd: tmpRepo, home: tmpHome });

    const r = runCli(['design', 'confirm', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/already matches/i);
  });

  it('a subsequent gate run with the confirmed baseline does not report tampering', () => {
    const changeDir = writeDesign('design-confirm-gate', 'Answer: yes.');
    writeFileSync(join(changeDir, 'change-request.md'), '# Change Request\n\nA meaningful description of the change. '.repeat(4), 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'), '# Change Classification\n\n**Tier:** Tier 2\n\nA meaningful description. '.repeat(6), 'utf8');
    writeFileSync(join(changeDir, 'implementation-plan.md'), '# Implementation Plan: design-confirm-gate\n\n## Objective\n' + 'A meaningful objective. '.repeat(6), 'utf8');
    writeFileSync(join(changeDir, 'test-plan.md'), '# Test Plan\n\n' + 'A meaningful test plan. '.repeat(6), 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), '# CI Gates\n\n' + 'A meaningful ci gate description. '.repeat(6), 'utf8');

    const confirm = runCli(['design', 'confirm', 'design-confirm-gate'], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    const r = runCli(['gate', 'design-confirm-gate'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/interaction design modified after confirmation/i);
  });

  it('fails clearly when interaction-design.md does not exist', () => {
    mkdirSync(join(tmpRepo, 'specs', 'changes', 'no-design'), { recursive: true });
    const r = runCli(['design', 'confirm', 'no-design'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing specs\/changes\/no-design\/interaction-design\.md/i);
  });

  it('fails clearly when the change does not exist', () => {
    const r = runCli(['design', 'confirm', 'no-such-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/change not found/i);
  });

  it('fails clearly when interaction-design.md has no ## Confirmed section', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'no-confirmed');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'interaction-design.md'), '# Interaction Design\n\n## Open Decisions\n- [ ] q\n', 'utf8');
    const r = runCli(['design', 'confirm', 'no-confirmed'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no.*## Confirmed|## Confirmed.*missing/i);
  });

  it('rejects an invalid change id', () => {
    const r = runCli(['design', 'confirm', '../../etc'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid change id/i);
  });
});
