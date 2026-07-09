/**
 * Acceptance driver for specs/changes/acceptance-oracle/acceptance.yml
 * (ADR 0010). This file lives under test/acceptance/, the conventional
 * driver directory `enforceAcceptanceOracle`'s AC-4 scan discovers, so it is
 * itself subject to the mock-of-SUT and hardcoded-expect checks it exercises.
 *
 * Every case's input/expect is read from the emitted loader template
 * (specs/templates/acceptance-driver/acceptance.loader.ts) -- never
 * hardcoded here -- and every scenario is proven against the REAL,
 * unmocked implementation this change ships: enforceAcceptanceOracle,
 * scanAcceptanceDrivers, and computeAcceptanceHash. No vi.mock/vi.spyOn of
 * any kind appears in this file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { loadAllCases, loadCase } from '../../specs/templates/acceptance-driver/acceptance.loader.js';
import { enforceAcceptanceOracle } from '../../src/commands/gate-acceptance.js';
import { scanAcceptanceDrivers } from '../../src/utils/mock-of-sut-scan.js';
import { computeAcceptanceHash, writeAcceptanceLock, type AcceptanceFile } from '../../src/utils/acceptance-hash.js';

const CHANGE_ID = 'acceptance-oracle';

interface CaseAnswer {
  gate: string;
  reason_contains: string;
}

let tmpRepo: string;

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-acceptance-oracle-driver-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
});

function makeChangeDir(id: string): string {
  const dir = join(tmpRepo, 'specs', 'changes', id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function outcomeOf(errors: string[]): string {
  return errors.length > 0 ? 'fail' : 'pass';
}

describe('acceptance-oracle change driver (specs/changes/acceptance-oracle/acceptance.yml)', () => {
  it('loader exposes the 3 real cases the maintainer authored', () => {
    const cases = loadAllCases(CHANGE_ID);
    expect(Object.keys(cases).sort()).toEqual([
      'mock-of-sut-driver-blocks-gate',
      'placeholder-oracle-blocks-gate',
      'tampered-answer-key-blocks-gate',
    ]);
  });

  it('placeholder-oracle-blocks-gate', () => {
    const answer = loadCase(CHANGE_ID, 'placeholder-oracle-blocks-gate').expect as unknown as CaseAnswer;

    const changeDir = makeChangeDir('scaffold-stub-demo');
    writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump({
      'oracle-version': '0.1.0',
      'authored-by': 'human',
      cases: [
        { id: '<case-id>', given: 'g', when: 'w', then: 't', input: '<input-value>', expect: '<expect-value>' },
      ],
    }), 'utf8');

    const errors: string[] = [];
    const warnings: string[] = [];
    enforceAcceptanceOracle(tmpRepo, changeDir, 'scaffold-stub-demo', false, false, errors, warnings);

    expect(outcomeOf(errors)).toBe(answer.gate);
    expect(errors.some((e) => e.toLowerCase().includes(answer.reason_contains.toLowerCase()))).toBe(true);
  });

  it('tampered-answer-key-blocks-gate', () => {
    const answer = loadCase(CHANGE_ID, 'tampered-answer-key-blocks-gate').expect as unknown as CaseAnswer;

    const changeId = 'tampered-demo';
    const changeDir = makeChangeDir(changeId);
    const authoredOracle: AcceptanceFile = {
      'oracle-version': '0.1.0',
      'authored-by': 'human',
      cases: [{ id: 'real-case', given: 'g', when: 'w', then: 't', input: { a: 1 }, expect: { b: 2 } }],
    };
    writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump(authoredOracle), 'utf8');
    // The recorded baseline was taken against a DIFFERENT payload than what is
    // on disk now -- the described scenario where the answer key changed
    // after the baseline was recorded.
    const laterEditedOracle: AcceptanceFile = {
      ...authoredOracle,
      cases: [{ id: 'real-case', given: 'g', when: 'w', then: 't', input: { a: 1 }, expect: { b: 999 } }],
    };
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(laterEditedOracle));

    const errors: string[] = [];
    const warnings: string[] = [];
    enforceAcceptanceOracle(tmpRepo, changeDir, changeId, false, false, errors, warnings);

    expect(outcomeOf(errors)).toBe(answer.gate);
    expect(errors.some((e) => e.toLowerCase().includes(answer.reason_contains.toLowerCase()))).toBe(true);
  });

  it('mock-of-sut-driver-blocks-gate', () => {
    const answer = loadCase(CHANGE_ID, 'mock-of-sut-driver-blocks-gate').expect as unknown as CaseAnswer;

    const changeId = 'mock-sut-demo';
    const changeDir = makeChangeDir(changeId);
    writeFileSync(join(changeDir, 'implementation-plan.md'), [
      '# Implementation Plan: mock-sut-demo',
      '',
      '## File-Level Plan',
      '| path or glob | action | notes |',
      '|---|---|---|',
      '| src/orders/service.py | update | reject orders |',
    ].join('\n'), 'utf8');
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'src/orders/service.py:\n  total_lines: 10\n', 'utf8');
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    // A fixture driver that mocks the very module the fixture change declares
    // as its own system under test. Named per the `<change-id>.driver.*`
    // convention so the cross-change isolation filter (BUG 1) recognizes it
    // as belonging to this fixture change.
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'mock-sut-demo.driver.py'), [
      'def test_demo(mocker):',
      '    mocker.patch("src.orders.service.reject_order")',
    ].join('\n'), 'utf8');

    const fixtureCases = [{ id: 'demo-case', expect: { status: 'no-answer-key-needed-for-this-scan' } }];
    const findings = scanAcceptanceDrivers(tmpRepo, changeDir, changeId, fixtureCases);
    const mockFinding = findings.find((f) => f.kind === 'mock-of-sut');

    expect(outcomeOf(mockFinding ? ['found'] : [])).toBe(answer.gate);
    expect(mockFinding).toBeDefined();
    expect(mockFinding!.detail.toLowerCase().includes(answer.reason_contains.toLowerCase())).toBe(true);
  });
});
