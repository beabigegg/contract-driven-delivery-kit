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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { v2PlanSectionFinding } from '../../src/commands/gate-artifacts.js';
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
