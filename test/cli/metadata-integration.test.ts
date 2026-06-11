import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

/**
 * Integration tests for the P2-1 freshness wiring: gate emits a warn-only
 * staleness notice and doctor reports + --fix regenerates a stale derived index.
 * Both surfaces only act on a metadata file that ALREADY EXISTS — a change that
 * never generated change.yml/trace.yml is never nagged, and a missing/stale
 * index never affects the gate's pass/fail.
 */

let tmpRepo: string;
let tmpHome: string;

function changeDir(id: string): string {
  return join(tmpRepo, 'specs', 'changes', id);
}

function scaffoldChange(id: string): void {
  const dir = changeDir(id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tasks.yml'), `change-id: ${id}\nstatus: in-progress\ntier: 1\ntasks: []\n`);
  writeFileSync(join(dir, 'change-classification.md'), [
    '# Change Classification',
    '## Change Types',
    '- primary: feature-enhancement',
    '## Inferred Acceptance Criteria',
    '- AC-1: It works.',
    '',
  ].join('\n'));
}

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-metadata-int-repo-');
  tmpHome = makeTempDir('cdd-metadata-int-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('gate × derived-metadata freshness (P2-1)', () => {
  it('warns (without erroring on it) when an existing change.yml has drifted', () => {
    scaffoldChange('feat-x');
    // Opt into the derived index, then drift a source it is built from.
    runCli(['metadata', 'feat-x'], { cwd: tmpRepo, home: tmpHome });
    appendFileSync(join(changeDir('feat-x'), 'change-classification.md'), '\n## Required Agents\n- backend-engineer\n');

    const r = runCli(['gate', 'feat-x'], { cwd: tmpRepo, home: tmpHome });
    const out = r.stdout + r.stderr;
    // The staleness nudge is printed as a warning regardless of pass/fail.
    expect(out).toMatch(/derived metadata stale \([^)]*change\.yml/);
    expect(out).toMatch(/cdd-kit metadata feat-x/);
  });

  it('does not mention derived metadata when the change never generated it', () => {
    scaffoldChange('feat-y');
    const r = runCli(['gate', 'feat-y'], { cwd: tmpRepo, home: tmpHome });
    const out = r.stdout + r.stderr;
    expect(out).not.toMatch(/derived metadata stale/);
  });
});

describe('doctor × derived-metadata freshness (P2-1)', () => {
  it('reports stale metadata and --fix regenerates it', () => {
    // `.cdd/` marks a real cdd-kit project for doctor's other checks; the
    // metadata check itself runs regardless.
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    scaffoldChange('feat-z');
    runCli(['metadata', 'feat-z'], { cwd: tmpRepo, home: tmpHome });
    appendFileSync(join(changeDir('feat-z'), 'change-classification.md'), '\n## Required Agents\n- qa-reviewer\n');

    const stale = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(stale.stdout + stale.stderr).toMatch(/change feat-z: metadata is stale/);

    const fixed = runCli(['doctor', '--fix'], { cwd: tmpRepo, home: tmpHome });
    expect(fixed.stdout + fixed.stderr).toMatch(/regenerated metadata for feat-z/);

    // After --fix the index matches its sources again → no staleness warning.
    const clean = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(clean.stdout + clean.stderr).not.toMatch(/metadata is stale/);
  });
});
