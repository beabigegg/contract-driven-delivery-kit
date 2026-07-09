import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { computeAcceptanceHash, writeAcceptanceLock, type AcceptanceFile } from '../../src/utils/acceptance-hash.js';

// Integration coverage for the `rules[]` invariant-binding scan
// (ADR 0010 §4; ci-gate-contract.md `enforceAcceptanceOracle` condition 6;
// src/utils/mock-of-sut-scan.ts `findUnboundRules`), added by
// interaction-design-loop scope expansion 2: "the contract documents a
// protection that does not exist" -- `rules` never appeared in
// gate-acceptance.ts before this change. Mirrors the fixture-building
// conventions of test/cli/acceptance-oracle.test.ts (that file documents
// carrying its own minimal copies of these helpers; this file does the same).

function buildTasksYaml(changeId: string): string {
  const data: Record<string, unknown> = {
    'change-id': changeId,
    status: 'in-progress',
  };
  data['tasks'] = [
    { id: '1.1', section: 'Preparation', title: 'Confirm classification', status: 'done' },
    { id: '7.1', section: 'Archive', title: 'Archive change', status: 'pending' },
    { id: '7.2', section: 'Archive', title: 'Promote learnings', status: 'pending' },
  ];
  return yaml.dump(data, { lineWidth: -1, noRefs: true });
}

// Deliberately the "legacy" flavor (no `context-governance: v1` frontmatter) --
// same as the majority of fixtures in test/cli/acceptance-oracle.test.ts.
// `--strict` forces every enforceAcceptanceOracle condition regardless of
// isNewChange, so this flavor is sufficient for every rules-binding case
// below except the dedicated "legacy dir not newly broken" case.
function writeValidChangeArtifacts(changeDir: string, changeId: string): void {
  const filler = 'This is a meaningful description of the change. '.repeat(4);

  writeFileSync(join(changeDir, 'change-request.md'), '# Change Request\n\n' + filler + '\n\nMotivation: We need to add this feature to support the new requirements from the product team. The change is scoped to the order module and will not affect other systems.\n', 'utf8');
  writeFileSync(join(changeDir, 'change-classification.md'), '# Change Classification\n\n**Risk Level:** medium\n**Tier:** Tier 1\n\n' + filler + '\n\nThis change is classified as low risk because it is additive only, with no breaking changes to existing APIs or data schemas. Rollback is straightforward by reverting the feature flag.\n', 'utf8');
  writeFileSync(join(changeDir, 'implementation-plan.md'), [
    '# Implementation Plan: ' + changeId,
    '',
    '## Objective',
    'Implementation agents receive a bounded execution packet with scope, non-goals, file-level actions, contract updates, tests, and constraints. '.repeat(2),
    '',
    '## Execution Scope',
    '### In Scope',
    '- Implement the classified behavior change within the approved surface.',
    '### Out of Scope',
    '- Do not refactor unrelated modules or infer requirements from chat history.',
    '',
    '## Required Changes',
    '| id | area | required action | owner agent |',
    '|---|---|---|---|',
    '| IP-1 | order management | Update implementation according to contracts and test plan | backend-engineer |',
    '',
    '## File-Level Plan',
    '| path or glob | action | notes |',
    '|---|---|---|',
    '| src/api/orders.ts | update | keep response contract stable |',
    '',
    '## Test Execution Plan',
    '| acceptance criterion | test file / command | expected signal |',
    '|---|---|---|',
    '| AC-1 | tests/api/orders.test.ts | failing test passes after implementation |',
    '',
    '## Handoff Constraints',
    '- Stop as blocked if the plan is incomplete.',
  ].join('\n'), 'utf8');
  writeFileSync(join(changeDir, 'test-plan.md'), '# Test Plan\n\n' + filler + '\n\nUnit tests will cover all new business logic. Integration tests will verify the API endpoints. E2E tests will cover the user flows affected by this change. Performance tests ensure no regression in response times.\n', 'utf8');
  writeFileSync(join(changeDir, 'ci-gates.md'), '# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n| 2 | unit-tests | PR | ci.yml | Unit tests |\n\n## Promotion Policy\nAll tier-1 gates must pass before merge.\n\n## Rollback Policy\nAutomatic rollback if error rate exceeds threshold within 10 minutes.\n\n' + filler + '\n', 'utf8');
  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml(changeId), 'utf8');
}

function writeAcceptanceYaml(changeDir: string, data: unknown): void {
  writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump(data, { lineWidth: -1, noRefs: true }), 'utf8');
}

/** A real (non-placeholder) oracle carrying the given `rules[]` entries. */
function oracleWithRules(rules: Array<{ id: string; statement: string }>): AcceptanceFile {
  return {
    'oracle-version': '0.1.0',
    'authored-by': 'human',
    cases: [
      {
        id: 'over-limit-order-rejected',
        given: 'a customer whose credit limit is 1000',
        when: 'they submit an order for 1500',
        then: 'the order is rejected with reason credit-limit-exceeded',
        input: { customer_limit: 1000, order_amount: 1500 },
        expect: { status: 'rejected', reason: 'credit-limit-exceeded' },
      },
    ],
    rules,
  };
}

/** Write a driver file under tests/acceptance/ named by the established
 * `<change-id>.driver.*` convention (src/utils/mock-of-sut-scan.ts
 * `driverBelongsToChange`), so it is recognized as belonging to `changeId`. */
function writeDriver(tmpRepo: string, changeId: string, testTitles: string[]): void {
  mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
  const body = [
    "import { describe, it, expect } from 'vitest';",
    "describe('driver', () => {",
    ...testTitles.map((t) => `  it(${JSON.stringify(t)}, () => { expect(true).toBe(true); });`),
    '});',
    '',
  ].join('\n');
  writeFileSync(join(tmpRepo, 'tests', 'acceptance', `${changeId}.driver.ts`), body, 'utf8');
}

describe('cdd-kit gate --strict -- rules[] invariant-binding scan (ADR 0010 §4, scope expansion 2)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-gate-rules-repo-');
    tmpHome = makeTempDir('cdd-gate-rules-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error('Setup init failed: ' + r.stderr);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('a rule bound by a driver for the SAME change passes --strict', () => {
    const changeId = 'rule-bound-same-change';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId);
    const oracle = oracleWithRules([
      { id: 'refund-never-exceeds-payment', statement: 'a refund amount can never exceed the original payment' },
    ]);
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(oracle));
    writeDriver(tmpRepo, changeId, [
      'rule refund-never-exceeds-payment: a refund amount can never exceed the original payment',
    ]);

    const r = runCli(['gate', changeId, '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/has no bound test/i);
  });

  it('a rule bound only by a driver for a DIFFERENT change FAILS (cross-change contamination guard)', () => {
    const changeId = 'rule-cross-change-under-test';
    const otherChangeId = 'rule-cross-change-other';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId);
    const oracle = oracleWithRules([{ id: 'shared-rule-id', statement: 'a cross-cutting invariant' }]);
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(oracle));

    // A driver for THIS change exists but never mentions the rule id.
    writeDriver(tmpRepo, changeId, ['case over-limit-order-rejected: the answer key is read from the loader']);

    // A driver for a DIFFERENT change binds the same rule id -- must not count
    // toward THIS change's binding (the exact BUG 1 dogfooding exposed in
    // ADR 0010; driverBelongsToChange is the fix being reused here).
    writeDriver(tmpRepo, otherChangeId, ['rule shared-rule-id: bound here, but for the wrong change']);

    const r = runCli(['gate', changeId, '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/acceptance rule "shared-rule-id" has no bound test/);
  });

  it('a rule id appearing only as a substring of a longer token FAILS (word-boundary guard)', () => {
    const changeId = 'rule-word-boundary';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId);
    const oracle = oracleWithRules([{ id: 'refund-never-exceeds', statement: 'refund invariant' }]);
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(oracle));

    // Only a longer token containing the rule id as a substring appears --
    // the exact BUG 2 dogfooding exposed in ADR 0010 (`isWordBoundaryOccurrence`
    // is the fix being reused here).
    writeDriver(tmpRepo, changeId, [
      'rule refund-never-exceeds-payment-cap: an unrelated, longer rule id that merely starts the same way',
    ]);

    const r = runCli(['gate', changeId, '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/acceptance rule "refund-never-exceeds" has no bound test/);
  });

  it('an unbound rule fails --strict with the rule id named in the message', () => {
    const changeId = 'rule-unbound';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId);
    const oracle = oracleWithRules([{ id: 'aesthetics-never-blocks', statement: 'aesthetics never fail the gate' }]);
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(oracle));
    // No driver files at all under tests/acceptance/ or test/acceptance/.

    const r = runCli(['gate', changeId, '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(
      /acceptance rule "aesthetics-never-blocks" has no bound test in test\/acceptance\/ \(--strict; ADR 0010 §4\)\./,
    );
  });

  it('an unbound rule PASSES the rules-binding check in non-strict mode', () => {
    const changeId = 'rule-unbound-nonstrict';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId);
    const oracle = oracleWithRules([{ id: 'aesthetics-never-blocks', statement: 'aesthetics never fail the gate' }]);
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(oracle));

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/has no bound test/i);
  });

  it('rules: [] passes trivially in both strict and non-strict mode', () => {
    const changeId = 'rule-empty-array';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId);
    const oracle = oracleWithRules([]);
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(oracle));

    const normal = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(normal.stdout + normal.stderr).not.toMatch(/has no bound test/i);

    const strict = runCli(['gate', changeId, '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.stdout + strict.stderr).not.toMatch(/has no bound test/i);
  });

  it('a legacy (non context-governance: v1) change dir with no rules[] declared is not newly broken by --strict', () => {
    // No `rules` key at all -- verified (grep across specs/changes/**/acceptance.yml)
    // to be the shape of every pre-existing change dir in this repo except this
    // change's own -- so this is the fixture that proves the new scan cannot
    // regress a legacy directory that never used `rules[]`.
    const changeId = 'rule-legacy-no-rules';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId); // legacy flavor: no context-governance: v1
    const oracle: AcceptanceFile = {
      'oracle-version': '0.1.0',
      'authored-by': 'human',
      cases: [
        {
          id: 'over-limit-order-rejected',
          given: 'a customer whose credit limit is 1000',
          when: 'they submit an order for 1500',
          then: 'the order is rejected',
          input: { customer_limit: 1000, order_amount: 1500 },
          expect: { status: 'rejected' },
        },
      ],
    };
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, changeId, computeAcceptanceHash(oracle));

    // --strict may still fail this fixture for pre-existing, unrelated reasons
    // (e.g. no recorded acceptance-phase test-evidence run) -- that behavior
    // predates this change. The assertion below isolates only the rules-
    // binding scan added here: it must never fire when `rules` is absent.
    const r = runCli(['gate', changeId, '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/has no bound test/i);
  });
});
