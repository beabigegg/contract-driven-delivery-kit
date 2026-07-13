import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';
import { enforceAcceptanceOracle } from '../../src/commands/gate-acceptance.js';
import { computeAcceptanceHash, readAcceptanceLock, writeAcceptanceLock } from '../../src/utils/acceptance-hash.js';

const CHANGE = 'auto-accept-flow';
const ORACLE = {
  'oracle-version': '1.0.0',
  'authored-by': 'test',
  cases: [{ id: 'c1', given: 'g', when: 'w', then: 't', input: { a: 1 }, expect: { ok: true } }],
};

let repo: string;
let home: string;

function scaffold(): string {
  const changeDir = join(repo, 'specs', 'changes', CHANGE);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump(ORACLE), 'utf8');
  return changeDir;
}

beforeEach(() => { repo = makeTempDir('cdd-auto-'); home = makeTempDir('cdd-auto-home-'); });
afterEach(() => { cleanupDir(repo); cleanupDir(home); });

describe('cdd-kit accept confirm --autonomous', () => {
  it('records an autonomous acceptance receipt with a reason', () => {
    scaffold();
    const r = runCli(['accept', 'confirm', CHANGE, '--autonomous', '--reason', 'loop mode: user delegated the whole run'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const entry = readAcceptanceLock(repo)[CHANGE];
    expect(entry?.mode).toBe('autonomous');
    expect(entry?.reason).toBe('loop mode: user delegated the whole run');
    expect(entry?.hash).toBe(computeAcceptanceHash(ORACLE));
  });

  it('refuses to confirm interactively when there is no terminal (an agent cannot silently sign off)', () => {
    scaffold();
    const r = runCli(['accept', 'confirm', CHANGE], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(existsSync(join(repo, '.cdd', 'acceptance-lock.json'))).toBe(false);
    expect(r.stderr + r.stdout).toMatch(/interactive terminal|autonomous/i);
  });
});

describe('gate acceptance: autonomous receipt', () => {
  function withEvidence(changeDir: string, phase: 'full' | 'acceptance'): void {
    writeFileSync(join(changeDir, 'test-evidence.yml'),
      yaml.dump({ 'final-status': 'passed', runs: [{ phase, status: 'passed' }] }), 'utf8');
  }

  it('passes a non-strict change and surfaces it as agent-delegated (not a human sign-off)', () => {
    const changeDir = scaffold();
    withEvidence(changeDir, 'full');
    writeAcceptanceLock(repo, CHANGE, computeAcceptanceHash(ORACLE), { mode: 'autonomous', reason: 'loop' });
    const errors: string[] = [];
    const warnings: string[] = [];
    enforceAcceptanceOracle(repo, changeDir, CHANGE, false, false, errors, warnings);
    expect(errors).toEqual([]);
    expect(warnings.join(' ')).toMatch(/AUTONOMOUS/);
  });

  it('does NOT let an autonomous receipt satisfy --strict (strict requires human confirmation)', () => {
    const changeDir = scaffold();
    withEvidence(changeDir, 'acceptance');
    writeAcceptanceLock(repo, CHANGE, computeAcceptanceHash(ORACLE), { mode: 'autonomous', reason: 'loop' });
    const errors: string[] = [];
    const warnings: string[] = [];
    enforceAcceptanceOracle(repo, changeDir, CHANGE, true, true, errors, warnings);
    expect(errors.join(' ')).toMatch(/no recorded baseline/);
    expect(warnings.join(' ')).toMatch(/autonomous acceptance is not honored under --strict/);
  });
});
