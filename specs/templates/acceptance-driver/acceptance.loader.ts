/**
 * Read-only loader for a change's acceptance oracle (ADR 0010 section 2).
 *
 * Copy this file into your test tree (e.g. test/acceptance/acceptance.loader.ts)
 * next to your acceptance driver(s). It parses the change's acceptance.yml
 * and exposes id -> {input, expect} so the driver reads the answer key from
 * the artifact instead of hardcoding it -- the mechanical guarantee
 * cdd-kit gate checks for (AC-4; design.md Q2).
 *
 * Usage in a driver:
 *
 *   import { loadCase } from './acceptance.loader.js';
 *
 *   it('over-limit-order-rejected', () => {
 *     const { input, expect: expected } = loadCase('my-change', 'over-limit-order-rejected');
 *     const actual = realSystemUnderTest(input);   // exercise the REAL SUT
 *     expect(actual).toEqual(expected);             // never hardcode this value
 *   });
 *
 * Never vi.mock/vi.spyOn the real system under test in an acceptance driver
 * -- only fake external I/O boundaries (network, clock) if needed. cdd-kit
 * gate scans drivers under test/acceptance/ for both violations (AC-4).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

export interface AcceptanceCaseValue {
  input: unknown;
  expect: unknown;
}

interface AcceptanceCaseRow {
  id: string;
  input?: unknown;
  expect?: unknown;
}

export function loadAllCases(changeId: string): Record<string, AcceptanceCaseValue> {
  const path = join('specs', 'changes', changeId, 'acceptance.yml');
  const data = yaml.load(readFileSync(path, 'utf8')) as { cases?: AcceptanceCaseRow[] };
  const cases = data?.cases ?? [];
  const out: Record<string, AcceptanceCaseValue> = {};
  for (const c of cases) out[c.id] = { input: c.input, expect: c.expect };
  return out;
}

export function loadCase(changeId: string, caseId: string): AcceptanceCaseValue {
  const cases = loadAllCases(changeId);
  const found = cases[caseId];
  if (!found) throw new Error('no case ' + caseId + ' in specs/changes/' + changeId + '/acceptance.yml');
  return found;
}
