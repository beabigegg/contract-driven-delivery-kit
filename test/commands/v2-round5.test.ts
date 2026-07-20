/**
 * Two defects from the fifth review round on PR #69, both about a fact stored
 * twice.
 *
 * 1. The gate re-typed the selector's column-header regexes instead of reusing
 *    them, and the `\b` escapes were mangled into literal backspace characters
 *    (0x08) — invisible in a normal read. Shorthand headers the selector accepts
 *    (`AC`, `target`, `path`) therefore made the GATE reject a Test Plan that
 *    `cdd-kit test select` could read perfectly well.
 * 2. `reconcile --yes` applies bucket 2 before the bucket-3 reconcilers, and
 *    that refresh re-stamps `.cdd/asset-manifest.json` at the CURRENT version.
 *    A behaviour-change report reading the manifest afterwards said
 *    `current -> current`, losing the exact delta it exists to explain (#64: an
 *    adopter jumped 3.6.0 → 3.13.1 and was never told the gate semantics moved).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';
import { v2PlanSectionFinding, governanceVersion } from '../../src/commands/gate-artifacts.js';
import { checkReconciliationInvariants } from '../../src/reconcile/invariants.js';
// From the shared leaf module, not from either consumer: `test-select.ts` and
// `gate-artifacts.ts` both read these, and having one import them from the other
// is what created a circular dependency between the selector and the gate.
import { findMappingTable, columnIndex, CRITERION_COLUMN, TARGET_COLUMN } from '../../src/utils/plan-tables.js';
import { behaviorReportReconciler, REPORT_REL, compareSemver, lastInstalledKitVersion } from '../../src/reconcile/reconcilers/behavior-report.js';
import { parseTestMapping } from '../../src/commands/metadata.js';
import { makeGuardedWrite } from '../../src/reconcile/guard.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKSPACE = String.fromCharCode(8);

let tmp: string;
beforeEach(() => { tmp = makeTempDir('cdd-v2-r5-'); mkdirSync(join(tmp, '.cdd'), { recursive: true }); });
afterEach(() => { cleanupDir(tmp); });

describe('gate and selector share ONE set of column matchers', () => {
  it('a shorthand-header mapping table satisfies the gate', () => {
    const plan = '## Test Plan\n\n| AC | target |\n|---|---|\n| AC-1 | test/unit/foo.test.ts |\n';
    expect(v2PlanSectionFinding(plan, 'Test Plan')).toBeNull();
  });

  it('the selector reads that same table — the two cannot disagree', () => {
    const table = findMappingTable('| AC | target |\n|---|---|\n| AC-1 | test/unit/foo.test.ts |\n');
    expect(table).not.toBeNull();
    expect(columnIndex(table!.headers, CRITERION_COLUMN)).toBeGreaterThanOrEqual(0);
    expect(columnIndex(table!.headers, TARGET_COLUMN)).toBeGreaterThanOrEqual(0);
  });

  it('`path` and `command` shorthands work too', () => {
    for (const header of ['| AC | path |', '| criterion | command |']) {
      const plan = `## Test Plan\n\n${header}\n|---|---|\n| AC-1 | tests/x.py |\n`;
      expect(v2PlanSectionFinding(plan, 'Test Plan'), header).toBeNull();
    }
  });

  it('no source file carries a literal control character from a mangled escape', () => {
    // The defect was invisible in a normal read: `\b` had become 0x08 on disk.
    // Checked here rather than trusted, because a regex that silently never
    // matches is the quietest possible failure.
    for (const f of ['src/commands/test-select.ts', 'src/commands/gate-artifacts.ts']) {
      expect(readFileSync(join(REPO_ROOT, f), 'utf8').includes(BACKSPACE), `${f} has a literal backspace`).toBe(false);
    }
  });
});

describe('behaviour-change report keeps the version delta', () => {
  it('renders the CAPTURED previous version, not the post-refresh stamp', () => {
    behaviorReportReconciler.apply({ cwd: tmp, previousKitVersion: '3.6.0' }, makeGuardedWrite(tmp));
    expect(existsSync(join(tmp, REPORT_REL))).toBe(true);
    expect(readFileSync(join(tmp, REPORT_REL), 'utf8')).toMatch(/last installed here: 3\.6\.0/);
  });

  it('plan mode reports the same delta', () => {
    expect(behaviorReportReconciler.planDescription({ cwd: tmp, previousKitVersion: '3.6.0' })).toMatch(/3\.6\.0 ->/);
  });

  it('falls back to the manifest when the caller captured nothing', () => {
    // Absent is not the same as wrong: with no captured value the report says
    // "unknown" rather than inventing a delta.
    writeFileSync(join(tmp, '.cdd', 'asset-manifest.json'), '{}', 'utf8');
    expect(behaviorReportReconciler.planDescription({ cwd: tmp })).toMatch(/last installed by unknown/);
  });
});

describe('no circular dependency between the gate and the selector', () => {
  // Round 5 fixed the duplicated regexes by having the gate import them FROM the
  // selector — while the selector already imported `readPlanSourceText` from the
  // gate. That cycle happened to work because the bundler ordered it favourably;
  // it is not something to depend on. The shared vocabulary now lives in a leaf
  // module that imports nothing local, so neither side can pull the other in.
  const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

  it('the shared table module imports nothing from src/commands', () => {
    expect(read('src/utils/plan-tables.ts')).not.toMatch(/from '\.\.\/commands\//);
  });

  it('neither the gate nor metadata imports from the selector', () => {
    for (const f of ['src/commands/gate-artifacts.ts', 'src/commands/metadata.ts']) {
      expect(read(f), `${f} must not import from test-select`).not.toMatch(/from '\.\/test-select\.js'/);
    }
  });
});

// ── codex round 6 ────────────────────────────────────────────────────────────

describe('previous-version lookup compares SEMANTICALLY (codex round 6)', () => {
  // My own round-5 verification could not have caught this: I set EVERY manifest
  // entry to 3.6.0, so a lexicographic sort returned the right answer by luck.
  // A partial upgrade — mixed stamps — is exactly when the report matters and
  // exactly when string order is wrong: ['3.6.0','3.13.1'].sort()[0] is '3.13.1'.
  it('picks the older version from a mixed manifest', () => {
    expect(['3.6.0', '3.13.1'].sort(compareSemver)[0]).toBe('3.6.0');
    expect(['3.13.1', '3.6.0', '3.9.2'].sort(compareSemver)[0]).toBe('3.6.0');
    expect(['2.2.1', '10.0.0'].sort(compareSemver)[0]).toBe('2.2.1');
  });

  it('lexicographic order would have been wrong — the discriminator, stated', () => {
    expect(['3.6.0', '3.13.1'].sort()[0]).toBe('3.13.1');
  });

  it('a malformed stamp degrades to a stable order rather than throwing', () => {
    expect(() => ['3.6.0', 'not-a-version', ''].sort(compareSemver)).not.toThrow();
  });

  it('lastInstalledKitVersion reports the older stamp from a real mixed manifest', () => {
    writeFileSync(join(tmp, '.cdd', 'asset-manifest.json'), JSON.stringify({
      'a.md': { version: '3.13.1', digest: 'x' },
      'b.md': { version: '3.6.0', digest: 'y' },
    }), 'utf8');
    expect(lastInstalledKitVersion(tmp)).toBe('3.6.0');
  });
});

describe('metadata reads the same shorthand headers the gate accepts (codex round 6)', () => {
  it('a shorthand mapping table produces linked criteria, not an empty trace', () => {
    const rows = parseTestMapping('| AC | target |\n|---|---|\n| AC-1 | tests/x.py |\n');
    expect(rows).toEqual([{ criterion: 'AC-1', family: '', path: 'tests/x.py' }]);
  });
});

// ── codex round 7 ────────────────────────────────────────────────────────────

describe('an inline YAML comment does not split the two readers of one fact (codex round 7)', () => {
  // `context-governance: v2 # folded scaffold` is ordinary YAML. The TypeScript
  // gate reads tasks.yml through a real YAML loader and saw `v2`; the Python
  // validator matched `key: value` with a regex and saw `v2 # folded scaffold`,
  // matched neither marker, and fell back to the v1 artifact list -- so
  // `cdd-kit validate` (which runs FIRST in CI) rejected a change the gate
  // accepts. Two readers of one fact, disagreeing on legal input.
  const SCRIPTS = join(REPO_ROOT, '.claude', 'skills', 'contract-driven-delivery', 'scripts');
  const py = () => (spawnSync('python3', ['--version'], { stdio: 'pipe' }).status === 0 ? 'python3' : 'python');

  function makeV2Change(governanceLine: string): string {
    const dir = join(tmp, 'specs', 'changes', 'c');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tasks.yml'), `${governanceLine}\ntier: 2\ntasks: []\n`, 'utf8');
    for (const f of ['change-request.md', 'implementation-plan.md']) {
      writeFileSync(join(dir, f), 'contract test ci gate\n', 'utf8');
    }
    return dir;
  }

  it.runIf(hasPython())('the python validator accepts a commented governance marker', () => {
    const dir = makeV2Change('context-governance: v2 # folded scaffold');
    const r = spawnSync(py(), [join(SCRIPTS, 'validate_spec_traceability.py'), dir], { encoding: 'utf8' });
    // The discriminator: before the fix this exited 1 with "missing required
    // artifacts: change-classification.md, test-plan.md, ci-gates.md".
    expect(r.stdout + r.stderr).not.toMatch(/missing required artifacts/);
    expect(r.status).toBe(0);
  });

  it('the TypeScript reader answers v2 for the identical file — the two agree', () => {
    expect(governanceVersion(makeV2Change('context-governance: v2 # folded scaffold'))).toBe('v2');
  });

  it.runIf(hasPython())('a quoted value keeps a legitimate hash rather than truncating it', () => {
    // `abandoned-reason: 'superseded by #12'` must survive: stripping comments
    // blindly would turn a valid reason into an empty one, and an empty reason
    // is a HARD error (ADR 0011). Verified through the real code path, since
    // that error is the observable difference.
    const dir = join(tmp, 'specs', 'changes', 'abandoned');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tasks.yml'), "status: abandoned # dropped\nabandoned-reason: 'superseded by #12'\n", 'utf8');
    const r = spawnSync(py(), [join(SCRIPTS, 'validate_spec_traceability.py'), dir], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/superseded by #12/);
  });

  it.runIf(hasPython())("a doubled-quote escape survives alongside a comment", () => {
    // The one case `_unquote` alone gets wrong, and therefore the only thing
    // that makes `_tasks_field`'s own comment-strip load-bearing: without it
    // the value reaches the quote branch still wearing its comment, misses it,
    // and falls through to a path that never un-escapes `''`. Found because a
    // first mutation of that line left the suite green — the line was untested,
    // not merely unbroken.
    const dir = join(tmp, 'specs', 'changes', 'escaped');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tasks.yml'), "status: abandoned\nabandoned-reason: 'it''s #12' # note\n", 'utf8');
    const r = spawnSync(py(), [join(SCRIPTS, 'validate_spec_traceability.py'), dir], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("it's #12");
    expect(r.stdout).not.toContain("it''s");
  });

  // The reported defect was one field in one reader. The sweep found THREE
  // hand-rolled scalar readers in this directory with the same blind spot, all
  // now sharing `strip_inline_comment`. Each gets its own discriminator: the
  // governance test above passes even with either single layer reverted,
  // because the two strips cover each other — so on its own it proves neither.
  it.runIf(hasPython())('every scalar reader in the scripts dir drops an inline comment', () => {
    const probe = `
import sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS.split('\\').join('/'))})
import applicability as A, validate_contract_versions as V
# 1. applicability: a commented marker used to read as an unrecognized value
#    and hard-fail the contract as "invalid" (fail-closed, ADR 0011).
a = A.classify(A.parse_frontmatter("---\\napplicability: not-applicable # CLI-only\\napplicability-reason: none\\n---\\n"))
print("applicability=[%s]" % a.status)
# 2. validate_contract_versions has its own parser; a commented schema-version
#    failed SEMVER_RE and hard-errored on a correctly-bumped contract.
f, _ = V.parse_frontmatter("---\\ncontract: ci\\nschema-version: 0.3.0  # bumped\\n---\\nbody\\n")
print("schema-version=[%s]" % f.get("schema-version"))
# 3. a legitimate hash inside a quoted scalar must NOT be truncated.
print("quoted=[%s]" % A._unquote("'keep #12 intact' # comment"))
`;
    const r = spawnSync(py(), ['-c', probe], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    // Bracketed and asserted whole: an unbracketed `toContain('0.3.0')` matched
    // the UNFIXED `0.3.0  # bumped` too, so the first version of this test could
    // not fail. Anchor the end of the value, not just its start.
    expect(r.stdout).toContain('applicability=[not-applicable]');
    expect(r.stdout).toContain('schema-version=[0.3.0]');
    expect(r.stdout).toContain('quoted=[keep #12 intact]');
  });
});

describe('the safe-default half of Mechanical Enforcement #4 is scanned (codex round 7)', () => {
  // Clause #4 has two halves: fail-open-to-keep for malformed input, AND a
  // non-enforcing default for a newly-added key. Only the first was scanned, so
  // deleting the safe-default evidence left the validator green — a validator
  // narrower than the clause it claims to enforce.
  function fixture(tests: string): string {
    const root = join(tmp, 'fake-kit');
    mkdirSync(join(root, 'src', 'reconcile'), { recursive: true });
    mkdirSync(join(root, 'test', 'cli'), { recursive: true });
    mkdirSync(join(root, 'contracts', 'upgrade'), { recursive: true });
    writeFileSync(join(root, 'src', 'reconcile', 'guard.ts'), '// stub\n', 'utf8');
    writeFileSync(
      join(root, 'contracts', 'upgrade', 'upgrade-reconciliation-contract.md'),
      readFileSync(join(REPO_ROOT, 'contracts', 'upgrade', 'upgrade-reconciliation-contract.md'), 'utf8'),
      'utf8',
    );
    writeFileSync(join(root, 'test', 'cli', 'reconcile-bucket3.test.ts'), tests, 'utf8');
    return root;
  }
  const hasSafeDefaultFinding = (root: string) =>
    checkReconciliationInvariants(root).some(f => f.message.includes('no recorded safe-default test'));

  const FAIL_OPEN_ONLY = `it('fail-open: malformed input classifies as keep', () => { expect(x).toBe('keep'); });\n`;
  const SAFE_DEFAULT = `it('safe-default: no key it would auto-add carries an enforcing default', () => { expect(c?.safeDefault).toBe(true); });\n`;

  it('a suite with fail-open evidence but NO safe-default evidence is flagged', () => {
    expect(hasSafeDefaultFinding(fixture(FAIL_OPEN_ONLY))).toBe(true);
  });

  it('adding the safe-default test clears it — the scan discriminates', () => {
    expect(hasSafeDefaultFinding(fixture(FAIL_OPEN_ONLY + SAFE_DEFAULT))).toBe(false);
  });

  it('a safe-default test that stops inspecting the default VALUE is flagged again', () => {
    // Bucket routing alone is not the evidence: a key routed to `reconcile` and
    // then added at an enforcing default still newly blocks the adopter.
    const routingOnly = `it('safe-default: new key reconciles', () => { expect(d.bucket).toBe('reconcile'); });\n`;
    expect(hasSafeDefaultFinding(fixture(FAIL_OPEN_ONLY + routingOnly))).toBe(true);
  });

  it("this repo's own suite satisfies both halves", () => {
    const findings = checkReconciliationInvariants(REPO_ROOT)
      .filter(f => f.message.includes('fail-open') || f.message.includes('safe-default'));
    expect(findings).toEqual([]);
  });
});
