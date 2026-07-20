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
import { findMappingTable, columnIndex, CRITERION_COLUMN, TARGET_COLUMN } from '../../src/commands/test-select.js';
import { behaviorReportReconciler, REPORT_REL } from '../../src/reconcile/reconcilers/behavior-report.js';
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
