import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import {
  resolveChangeSutFiles,
  sutMatchTokens,
  scanDriverForMockOfSut,
  scanDriverForHardcodedExpect,
  findAcceptanceDriverFiles,
  scanAcceptanceDrivers,
  driverBelongsToChange,
  findUnboundRules,
} from '../../src/utils/mock-of-sut-scan.js';

describe('scanDriverForMockOfSut', () => {
  const sutTokens = sutMatchTokens(['src/orders/service.py']);

  it('flags a pytest unittest.mock.patch of the resolved SUT', () => {
    const content = [
      'import unittest.mock',
      '',
      'def test_over_limit():',
      '    with unittest.mock.patch("src.orders.service.reject_order") as mocked:',
      '        pass',
    ].join('\n');
    const violations = scanDriverForMockOfSut(content, sutTokens);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a pytest mocker.patch of the resolved SUT (pytest-mock)', () => {
    const content = 'def test_x(mocker):\n    mocker.patch("src.orders.service.reject_order")\n';
    const violations = scanDriverForMockOfSut(content, sutTokens);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a monkeypatch.setattr of the resolved SUT', () => {
    const content = 'def test_x(monkeypatch):\n    monkeypatch.setattr("src.orders.service.reject_order", lambda *a: None)\n';
    const violations = scanDriverForMockOfSut(content, sutTokens);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('does NOT flag faking an external network client (requests)', () => {
    const content = 'def test_x(mocker):\n    mocker.patch("requests.get")\n';
    const violations = scanDriverForMockOfSut(content, sutTokens);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag faking the system clock (freezegun)', () => {
    const content = 'from freezegun import freeze_time\n\n@freeze_time("2026-01-01")\ndef test_x():\n    pass\n';
    const violations = scanDriverForMockOfSut(content, sutTokens);
    expect(violations).toHaveLength(0);
  });

  it('flags a vitest vi.mock of the resolved SUT (JS/TS)', () => {
    const jsTokens = sutMatchTokens(['src/orders/service.ts']);
    const content = "import { reject } from '../../src/orders/service';\nvi.mock('../../src/orders/service');\n";
    const violations = scanDriverForMockOfSut(content, jsTokens);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a vitest vi.spyOn resolved via an import of the SUT module', () => {
    const jsTokens = sutMatchTokens(['src/orders/service.ts']);
    const content = [
      "import * as orderService from '../../src/orders/service';",
      "vi.spyOn(orderService, 'rejectOrder');",
    ].join('\n');
    const violations = scanDriverForMockOfSut(content, jsTokens);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('does NOT flag faking an external network client (vitest, fetch)', () => {
    const jsTokens = sutMatchTokens(['src/orders/service.ts']);
    const content = "vi.mock('node-fetch');\n";
    const violations = scanDriverForMockOfSut(content, jsTokens);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag faking the system clock (vitest, vi.useFakeTimers)', () => {
    const jsTokens = sutMatchTokens(['src/orders/service.ts']);
    const content = 'vi.useFakeTimers();\n';
    const violations = scanDriverForMockOfSut(content, jsTokens);
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag a vi.spyOn whose import source cannot be resolved (unresolved -> no false-fail)', () => {
    const jsTokens = sutMatchTokens(['src/orders/service.ts']);
    const content = "vi.spyOn(someUnresolvedThing, 'method');\n";
    const violations = scanDriverForMockOfSut(content, jsTokens);
    expect(violations).toHaveLength(0);
  });

  it('unresolved SUT (empty token set) never false-fails, even with a mock present', () => {
    const content = 'def test_x(mocker):\n    mocker.patch("anything.at.all")\n';
    const violations = scanDriverForMockOfSut(content, []);
    expect(violations).toHaveLength(0);
  });

  it('does not flag a mock of an unrelated module', () => {
    const content = 'def test_x(mocker):\n    mocker.patch("src.billing.invoices.send_invoice")\n';
    const violations = scanDriverForMockOfSut(content, sutTokens);
    expect(violations).toHaveLength(0);
  });
});

describe('scanDriverForHardcodedExpect', () => {
  const cases = [
    { id: 'over-limit', expect: { status: 'rejected', reason: 'credit-limit-exceeded' } },
  ];

  it('flags a Python driver that hardcodes the expect literal instead of reading it from the loader', () => {
    const content = [
      'def test_over_limit():',
      '    actual = real_system_under_test({"customer_limit": 1000})',
      '    assert actual["reason"] == "credit-limit-exceeded"',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, cases);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].caseId).toBe('over-limit');
  });

  it('flags a JS/TS driver that hardcodes the expect literal instead of reading it from the loader', () => {
    const content = [
      "it('over-limit', () => {",
      "  const actual = realSystemUnderTest({ customerLimit: 1000 });",
      "  expect(actual.reason).toBe('credit-limit-exceeded');",
      '});',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, cases);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('does NOT flag a driver that reads expect from the loader (no literal occurrence)', () => {
    const content = [
      'def test_over_limit():',
      '    case = load_case("my-change", "over-limit")',
      '    actual = real_system_under_test(case["input"])',
      '    assert actual == case["expect"]',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, cases);
    expect(violations).toHaveLength(0);
  });

  it('does not flag a short/generic leaf value (below the meaningful-length floor)', () => {
    const shortCases = [{ id: 'ok-case', expect: { status: 'ok' } }];
    const content = 'assert True  # status is ok in this driver too, coincidentally\n';
    const violations = scanDriverForHardcodedExpect(content, shortCases);
    expect(violations).toHaveLength(0);
  });

  it('does not flag a generic status word (gate: fail/pass) even though it is 4+ chars', () => {
    const gateCases = [{ id: 'gate-outcome', expect: { gate: 'fail', reason_contains: 'domain-specific-answer' } }];
    const content = [
      'it("gate-outcome", () => {',
      '  const errors: string[] = [];',
      '  const gateFailed = errors.length > 0;',
      "  expect(gateFailed).toBe(true);",
      '});',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, gateCases);
    expect(violations).toHaveLength(0);
  });

  it('does not flag a leaf literal that only appears inside the case id itself', () => {
    // "placeholder" is a leaf of reason_contains, and also a substring of the
    // case id used to name the test -- referencing the case by name must not
    // trip the scan.
    const placeholderCases = [
      { id: 'placeholder-oracle-blocks-gate', expect: { gate: 'fail', reason_contains: 'placeholder' } },
    ];
    const content = [
      "it('placeholder-oracle-blocks-gate', () => {",
      '  const reasonContains = loadedCase.expect.reason_contains;',
      '  expect(errors.some((e) => e.includes(reasonContains))).toBe(true);',
      '});',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, placeholderCases);
    expect(violations).toHaveLength(0);
  });

  it('still flags a genuine standalone hardcode even when the case id shares a word with it', () => {
    const placeholderCases = [
      { id: 'placeholder-oracle-blocks-gate', expect: { gate: 'fail', reason_contains: 'placeholder' } },
    ];
    const content = [
      "it('placeholder-oracle-blocks-gate', () => {",
      '  const answer = "placeholder"; // hardcoded, not read from the loader',
      '  expect(errors.some((e) => e.includes(answer))).toBe(true);',
      '});',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, placeholderCases);
    expect(violations.length).toBeGreaterThan(0);
  });

  // ── #67: per-case scoping ──────────────────────────────────────────────────

  it('a short numeric leaf is below the meaningful-length floor, like a short string (#67 sibling)', () => {
    // `exit_code: 0` / `count: 1` leaves collide with `version: 1` and
    // `schema-version: 1.0.0` in ANY fixture — a check that fires on every
    // fixture discriminates nothing. `1500` (4+ digits) keeps full protection.
    const shortNum = [{ id: 'exit-code-case', expect: { exit_code: 0 } }];
    const content = "it('exit-code-case', () => { const contract = 'schema-version: 1.0.0'; run(contract); });";
    expect(scanDriverForHardcodedExpect(content, shortNum)).toHaveLength(0);
    const longNum = [{ id: 'exit-code-case', expect: { threshold: 1500 } }];
    const hardcoded = "it('exit-code-case', () => { expect(r.threshold).toBe(1500); });";
    expect(scanDriverForHardcodedExpect(hardcoded, longNum).length).toBeGreaterThan(0);
  });

  it('does NOT flag an UNDRIVEN case whose expect leaf coincides with unrelated driver text (#67)', () => {
    // The issue's exact repro: the driver exercises only case-a via the loader;
    // case-b (expect.count: 0) is never referenced, yet a plain `== 0` in an
    // unrelated assertion was flagged as "hardcodes case case-b". A case's
    // answer key can only be hardcoded in a file that exercises that case.
    const twoCases = [
      { id: 'case-a-merge', expect: { merged_group: 'SOME-VALUE' } },
      { id: 'case-b-empty', expect: { count: 0 } },
    ];
    const content = [
      'def test_case_a_merge():',
      '    case = load_case("my-change", "case-a-merge")',
      '    actual = real_system(case["input"])',
      '    assert actual["merged_group"] == case["expect"]["merged_group"]',
      '    assert len(warnings) == 0  # unrelated bookkeeping, not an answer key',
    ].join('\n');
    expect(scanDriverForHardcodedExpect(content, twoCases)).toHaveLength(0);
  });

  it('a loadAllCases driver keeps EVERY case in scope — scoping never blinds a load-all file (#67)', () => {
    const twoCases = [
      { id: 'case-a-merge', expect: { merged_group: 'SOME-VALUE' } },
      { id: 'case-b-empty', expect: { threshold: 1500 } },
    ];
    const content = [
      'for (const c of loadAllCases("my-change")) run(c);',
      'expect(result.threshold).toBe(1500); // hardcoded answer for a case never named',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, twoCases);
    expect(violations.map((v) => v.caseId)).toContain('case-b-empty');
  });

  it('a leaf that is a fragment of the CHANGE ID is API vocabulary, not an answer key', () => {
    // An oracle answering "reconcile" for the reconcile-framework change: every
    // legitimate driver must spell `src/reconcile/...` in an import and the
    // `reconcile` CLI verb — both word-boundary hits. Naming the thing under
    // test is not typing its answer key.
    const vocabCases = [
      { id: 'new-key-fails-open', expect: { classification: 'reconcile', bucket: 'keep' } },
    ];
    const content = [
      "import { classifyPolicyKey } from '../../src/reconcile/classifier.js';",
      "it('new-key-fails-open', () => {",
      "  const r = runCli(['reconcile', '--plan']);",
      '  expect(actual).toEqual(loaded.expect);',
      '});',
    ].join('\n');
    expect(scanDriverForHardcodedExpect(content, vocabCases, 'reconcile-framework')).toHaveLength(0);
    // A leaf NOT contained in the change id keeps full protection: typing it
    // standalone is still flagged in the very same file.
    const hardcoding = content + "\nexpect(d.bucket).toBe('keep');\n";
    const flagged = scanDriverForHardcodedExpect(hardcoding, vocabCases, 'reconcile-framework');
    expect(flagged.map((v) => v.literal)).toContain('keep');
    // And without a changeId (direct unit callers), nothing is excused.
    expect(scanDriverForHardcodedExpect(content, vocabCases).map((v) => v.literal)).toContain('reconcile');
  });

  it('a snake_case Python function name keeps the kebab-case case in scope (#67)', () => {
    // `def test_over-limit` is a Python syntax error, so the separator-swapped
    // spelling IS how a Python driver references the case. Skipping it would
    // un-scan the canonical pytest driver shape — a loosening, not a fix.
    const kebabCases = [
      { id: 'over-limit', expect: { reason: 'credit-limit-exceeded' } },
    ];
    const content = [
      'def test_over_limit():',
      '    actual = real_system_under_test({"customer_limit": 1000})',
      '    assert actual["reason"] == "credit-limit-exceeded"',
    ].join('\n');
    expect(scanDriverForHardcodedExpect(content, kebabCases).length).toBeGreaterThan(0);
  });
});

describe('sutMatchTokens', () => {
  it('derives path, dotted, and basename tokens for a long-enough basename', () => {
    const tokens = sutMatchTokens(['src/orders/service.py']);
    expect(tokens).toContain('src/orders/service');
    expect(tokens).toContain('src.orders.service');
    expect(tokens).toContain('service');
  });

  it('does NOT add an overly generic short basename token', () => {
    const tokens = sutMatchTokens(['src/db.ts']);
    expect(tokens).not.toContain('db');
    expect(tokens).toContain('src/db');
  });
});

describe('resolveChangeSutFiles (code-map + implementation-plan.md cross-reference)', () => {
  let tmpRepo: string;
  let changeDir: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-sut-resolve-');
    changeDir = join(tmpRepo, 'specs', 'changes', 'my-change');
    mkdirSync(changeDir, { recursive: true });
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
  });

  function writePlan(rows: string[]): void {
    writeFileSync(join(changeDir, 'implementation-plan.md'), [
      '# Implementation Plan: my-change',
      '',
      '## File-Level Plan',
      '| path or glob | action | notes |',
      '|---|---|---|',
      ...rows,
    ].join('\n'), 'utf8');
  }

  function writeCodeMap(paths: string[]): void {
    const body = paths.map((p) => `${p}:\n  total_lines: 10\n`).join('');
    writeFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), body, 'utf8');
  }

  it('resolves a declared path that the code-map also indexes', () => {
    writePlan(['| src/orders/service.py | update | reject orders |']);
    writeCodeMap(['src/orders/service.py', 'src/billing/invoices.py']);
    const sut = resolveChangeSutFiles(tmpRepo, changeDir);
    expect(sut).toEqual(['src/orders/service.py']);
  });

  it('drops a glob entry (never resolved as a concrete SUT file)', () => {
    writePlan(['| src/orders/**/*.py | update | reject orders |']);
    writeCodeMap(['src/orders/service.py']);
    const sut = resolveChangeSutFiles(tmpRepo, changeDir);
    expect(sut).toHaveLength(0);
  });

  it('unresolved SUT: a declared path the code-map does not index yields no SUT files (no false-fail)', () => {
    writePlan(['| src/orders/service.py | update | reject orders |']);
    writeCodeMap(['src/billing/invoices.py']);
    const sut = resolveChangeSutFiles(tmpRepo, changeDir);
    expect(sut).toHaveLength(0);
  });

  it('missing code-map.yml yields no SUT files (no false-fail)', () => {
    writePlan(['| src/orders/service.py | update | reject orders |']);
    const sut = resolveChangeSutFiles(tmpRepo, changeDir);
    expect(sut).toHaveLength(0);
  });

  it('missing implementation-plan.md yields no SUT files', () => {
    writeCodeMap(['src/orders/service.py']);
    const sut = resolveChangeSutFiles(tmpRepo, changeDir);
    expect(sut).toHaveLength(0);
  });
});

describe('findAcceptanceDriverFiles + scanAcceptanceDrivers (end-to-end)', () => {
  let tmpRepo: string;
  let changeDir: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-sut-drivers-');
    changeDir = join(tmpRepo, 'specs', 'changes', 'my-change');
    mkdirSync(changeDir, { recursive: true });
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(changeDir, 'implementation-plan.md'), [
      '# Implementation Plan: my-change',
      '',
      '## File-Level Plan',
      '| path or glob | action | notes |',
      '|---|---|---|',
      '| src/orders/service.py | update | reject orders |',
    ].join('\n'), 'utf8');
    writeFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'src/orders/service.py:\n  total_lines: 10\n', 'utf8');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
  });

  it('finds driver files under tests/acceptance/ (pytest convention)', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'test_over_limit.py'), 'def test_x():\n    pass\n', 'utf8');
    const drivers = findAcceptanceDriverFiles(tmpRepo);
    expect(drivers).toHaveLength(1);
  });

  it('finds driver files under test/acceptance/ (vitest convention)', () => {
    mkdirSync(join(tmpRepo, 'test', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'test', 'acceptance', 'over-limit.spec.ts'), "it('x', () => {});\n", 'utf8');
    const drivers = findAcceptanceDriverFiles(tmpRepo);
    expect(drivers).toHaveLength(1);
  });

  it('returns no findings when no driver files exist', () => {
    const cases = [{ id: 'c1', expect: { status: 'rejected' } }];
    const findings = scanAcceptanceDrivers(tmpRepo, changeDir, 'my-change', cases);
    expect(findings).toHaveLength(0);
  });

  it('flags a pytest driver mocking the resolved SUT end-to-end', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    // Named per the `<change-id>.driver.*` convention so the cross-change
    // isolation filter (BUG 1) recognizes it as belonging to 'my-change'.
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'my-change.driver.py'), [
      'def test_over_limit(mocker):',
      '    mocker.patch("src.orders.service.reject_order")',
    ].join('\n'), 'utf8');
    const cases = [{ id: 'over-limit', expect: { status: 'rejected' } }];
    const findings = scanAcceptanceDrivers(tmpRepo, changeDir, 'my-change', cases);
    expect(findings.some((f) => f.kind === 'mock-of-sut')).toBe(true);
  });

  it('flags a driver hardcoding the expect literal end-to-end', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'my-change.driver.py'), [
      'def test_over_limit():',
      '    assert real_sut() == "credit-limit-exceeded"',
    ].join('\n'), 'utf8');
    const cases = [{ id: 'over-limit', expect: 'credit-limit-exceeded' }];
    const findings = scanAcceptanceDrivers(tmpRepo, changeDir, 'my-change', cases);
    expect(findings.some((f) => f.kind === 'hardcoded-expect')).toBe(true);
  });

  it('a clean driver (reads from loader, exercises the real SUT) has no findings', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'test_over_limit.py'), [
      'from acceptance_loader import load_case',
      'from src.orders.service import reject_order',
      '',
      'def test_over_limit():',
      '    case = load_case("my-change", "over-limit")',
      '    assert reject_order(case["input"]) == case["expect"]',
    ].join('\n'), 'utf8');
    const cases = [{ id: 'over-limit', expect: { status: 'rejected', reason: 'credit-limit-exceeded' } }];
    const findings = scanAcceptanceDrivers(tmpRepo, changeDir, 'my-change', cases);
    expect(findings).toHaveLength(0);
  });

  // ── BUG 1: cross-change isolation ───────────────────────────────────────────
  it('does not scan a driver written for a DIFFERENT change against this change\'s cases (cross-change isolation)', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    // A driver for an unrelated change ('other-change') that both mocks a
    // module named the same as THIS change's SUT and hardcodes THIS change's
    // expect literal -- neither should be attributed to 'my-change' because
    // this driver is not for 'my-change' (different filename convention, and
    // its loader call resolves to a different change id).
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'other-change.driver.py'), [
      'from acceptance_loader import load_case',
      '',
      'def test_unrelated(mocker):',
      '    mocker.patch("src.orders.service.reject_order")',
      '    case = load_case("other-change", "some-case")',
      '    assert real_sut() == "credit-limit-exceeded"',
    ].join('\n'), 'utf8');
    const cases = [{ id: 'over-limit', expect: 'credit-limit-exceeded' }];
    const findings = scanAcceptanceDrivers(tmpRepo, changeDir, 'my-change', cases);
    expect(findings).toHaveLength(0);
  });

  it('driverBelongsToChange recognizes the filename convention and the loader content-reference, and rejects neither', () => {
    expect(driverBelongsToChange('', 'test/acceptance/my-change.driver.ts', 'my-change')).toBe(true);
    expect(driverBelongsToChange(
      "const CHANGE_ID = 'my-change';\nloadCase(CHANGE_ID, 'x');\n",
      'test/acceptance/whatever.test.ts',
      'my-change',
    )).toBe(true);
    expect(driverBelongsToChange(
      'load_case("my-change", "x")',
      'tests/acceptance/test_whatever.py',
      'my-change',
    )).toBe(true);
    expect(driverBelongsToChange(
      "const CHANGE_ID = 'some-other-change';\nloadCase(CHANGE_ID, 'x');\n",
      'test/acceptance/whatever.test.ts',
      'my-change',
    )).toBe(false);
  });
});

// ── rules[] invariant-binding scan (ADR 0010 §4; ci-gate-contract.md
// enforceAcceptanceOracle condition 6; interaction-design-loop scope
// expansion 2) -- reuses driverBelongsToChange (BUG 1 fix) and
// isWordBoundaryOccurrence (BUG 2 fix), unit-level coverage complementing the
// CLI end-to-end coverage in test/cli/gate-acceptance-rules.test.ts.
describe('findUnboundRules', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-sut-rules-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
  });

  it('returns an empty array (nothing to bind) when there are zero rule ids', () => {
    expect(findUnboundRules(tmpRepo, 'my-change', [])).toEqual([]);
  });

  it('returns every rule id unbound when no driver files exist at all', () => {
    expect(findUnboundRules(tmpRepo, 'my-change', ['refund-never-exceeds-payment'])).toEqual([
      'refund-never-exceeds-payment',
    ]);
  });

  it('a rule id present in a same-change driver test title is bound', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'my-change.driver.py'), [
      'def test_rule_refund_never_exceeds_payment():',
      '    """rule refund-never-exceeds-payment: a refund can never exceed the payment."""',
      '    pass',
    ].join('\n'), 'utf8');
    expect(findUnboundRules(tmpRepo, 'my-change', ['refund-never-exceeds-payment'])).toEqual([]);
  });

  // ── BUG 1 reuse: cross-change contamination guard ─────────────────────────
  it('a rule id present only in a DIFFERENT change\'s driver is still unbound (cross-change guard)', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'other-change.driver.py'), [
      'def test_rule():',
      '    """rule shared-rule-id: bound here, but for the wrong change."""',
      '    pass',
    ].join('\n'), 'utf8');
    expect(findUnboundRules(tmpRepo, 'my-change', ['shared-rule-id'])).toEqual(['shared-rule-id']);
  });

  // ── BUG 2 reuse: whole-token / word-boundary guard ────────────────────────
  it('a rule id that only occurs as a substring of a longer token is still unbound (word-boundary guard)', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'my-change.driver.py'), [
      'def test_rule():',
      '    """rule refund-never-exceeds-payment-cap: an unrelated, longer rule id."""',
      '    pass',
    ].join('\n'), 'utf8');
    expect(findUnboundRules(tmpRepo, 'my-change', ['refund-never-exceeds'])).toEqual(['refund-never-exceeds']);
  });

  it('reports only the unbound subset when some rules are bound and others are not', () => {
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'my-change.driver.py'), [
      'def test_rule():',
      '    """rule bound-rule: this one is bound."""',
      '    pass',
    ].join('\n'), 'utf8');
    expect(findUnboundRules(tmpRepo, 'my-change', ['bound-rule', 'unbound-rule'])).toEqual(['unbound-rule']);
  });
});

// ── BUG 2: generic-word substring false positive (word-boundary matching) ────
describe('scanDriverForHardcodedExpect -- word-boundary substring safety', () => {
  const cases = [
    { id: 'marker-without-reason-is-rejected', expect: { validation: 'hard-fail', reason_contains: 'reason' } },
  ];

  it('does NOT flag the leaf "reason" merely because it is a substring of the SUT\'s own field name', () => {
    const content = [
      "it('marker-without-reason-is-rejected', () => {",
      "  const fixture = buildContract(['applicability-reason: no CSS/UI surface']);",
      '  const r = runReal(fixture);',
      "  expect(r.status).not.toBe(0);",
      '});',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, cases);
    expect(violations).toHaveLength(0);
  });

  it('STILL flags a genuine standalone hardcode of that same leaf value', () => {
    const content = [
      "it('marker-without-reason-is-rejected', () => {",
      "  const needle = 'reason'; // hardcoded, not read from the loader",
      '  expect(realOutput.toLowerCase()).toContain(needle);',
      '});',
    ].join('\n');
    const violations = scanDriverForHardcodedExpect(content, cases);
    expect(violations.length).toBeGreaterThan(0);
  });

  // A boolean `expect` leaf must not forbid the tokens `true` / `false` in the driver.
  // The stopword comment always claimed booleans were excluded; the boolean branch of
  // `collectLeafLiterals` bypassed the stopword set, so ONE boolean in an oracle made
  // both tokens unusable anywhere in that change's driver — assertions, identifiers,
  // even prose comments. A boolean is never a domain answer key.
  //
  // Mutation: restore `out.add(String(value))` in the boolean branch -> both of the
  // first two expectations below go red.
  it('a boolean expect leaf is not a hardcoded answer key', () => {
    const cases = [{ id: 'gate-halts-case', expect: { 'the-gate-halts': true, 'names-it': false } }];

    const driverTypingBooleans = [
      "it('gate-halts-case', () => {",
      "  const c = loadCase('gate-halts-case');",
      '  const halted = run().status !== 0;',
      "  expect(halted).toBe(c.expect['the-gate-halts']);",
      '});',
      '// this holds true for every armed hook, and false for none',
      'expect(x).toBe(true);',
    ].join('\n');

    expect(scanDriverForHardcodedExpect(driverTypingBooleans, cases)).toEqual([]);

    // A prose comment containing the word must not trip it either.
    expect(scanDriverForHardcodedExpect('// always true\n', cases)).toEqual([]);

    // But a NUMBER in expect is a real answer key, and typing it is still a
    // violation. The fixture names the case, as any driver that exercises it
    // does — per-case scoping (#67) skips files with zero trace of the case,
    // and a bare one-liner was exactly that.
    const numericCases = [{ id: 'over-limit-case', expect: { refund: 1500 } }];
    const numericDriver = "it('over-limit-case', () => { expect(r.refund).toBe(1500); });";
    expect(scanDriverForHardcodedExpect(numericDriver, numericCases).length)
      .toBeGreaterThan(0);
    // …while reading it from the case at runtime is clean.
    const cleanDriver = "it('over-limit-case', () => { expect(r.refund).toBe(c.expect.refund); });";
    expect(scanDriverForHardcodedExpect(cleanDriver, numericCases))
      .toEqual([]);
  });
});
