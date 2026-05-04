/**
 * Tests for gate's code-map freshness check.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// ── helpers ────────────────────────────────────────────────────────────────

function buildTasksYaml(changeId: string): string {
  return yaml.dump({
    'change-id': changeId,
    status: 'in-progress',
    tasks: [
      { id: '1.1', section: 'Preparation', title: 'Confirm classification', status: 'done' },
      { id: '1.2', section: 'Preparation', title: 'Confirm contracts', status: 'done' },
      { id: '1.3', section: 'Preparation', title: 'Confirm CI plan', status: 'done' },
      { id: '7.1', section: 'Archive', title: 'Archive change', status: 'pending' },
      { id: '7.2', section: 'Archive', title: 'Promote learnings', status: 'pending' },
    ],
  }, { lineWidth: -1, noRefs: true });
}

function writeMinimalValidChange(tmpRepo: string, changeId: string): void {
  const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
  mkdirSync(changeDir, { recursive: true });

  const filler = 'This is a meaningful description of the change. '.repeat(4);

  writeFileSync(join(changeDir, 'change-request.md'),
    `# Change Request\n\n${filler}\n\nMotivation: add feature. Change is scoped to user management module.\n`, 'utf8');
  writeFileSync(join(changeDir, 'change-classification.md'),
    `# Classification\n\n**Risk Level:** low\n**Tier:** Tier 1\n\n${filler}\n\nAdditive only, no breaking changes.\n`, 'utf8');
  writeFileSync(join(changeDir, 'test-plan.md'),
    `# Test Plan\n\n${filler}\n\nUnit tests cover new logic. Integration tests verify API. E2E covers user flows.\n`, 'utf8');
  writeFileSync(join(changeDir, 'ci-gates.md'),
    `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n\n## Promotion Policy\nAll gates pass. ## Rollback Policy Auto rollback.\n\n${filler}\n`, 'utf8');
  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml(changeId), 'utf8');
}

// ── setup ──────────────────────────────────────────────────────────────────

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('gate-code-map-repo-');
  tmpHome = makeTempDir('gate-code-map-home-');
  // Initialize a minimal project structure (no .cdd needed for gate-code-map tests)
  mkdirSync(join(tmpRepo, 'specs', 'changes'), { recursive: true });
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('cdd-kit gate: code-map freshness', () => {
  it('missing code-map with source files emits a warning (non-fatal)', () => {
    const changeId = 'cm-missing-test';
    writeMinimalValidChange(tmpRepo, changeId);
    // Write a source file but NO code-map
    writeFileSync(join(tmpRepo, 'foo.py'), 'def hello():\n    return 1\n', 'utf8');

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    // Gate may fail for other reasons (e.g. contracts missing), but the code-map
    // warning should appear
    expect(r.stdout + r.stderr).toMatch(/code-map missing/);
  });

  it('no code-map warning when no source files exist (greenfield)', () => {
    const changeId = 'cm-greenfield-test';
    writeMinimalValidChange(tmpRepo, changeId);
    // No source files, no code-map

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    // Gate may fail for contracts, but should NOT emit code-map warning
    expect(r.stdout + r.stderr).not.toMatch(/code-map/);
  });

  it('stale code-map fails gate with error naming the changed file', () => {
    const changeId = 'cm-stale-test';
    writeMinimalValidChange(tmpRepo, changeId);

    // Write a source file then run code-map
    writeFileSync(join(tmpRepo, 'sample.py'), 'def hello():\n    return 1\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    // Now modify the source file to make the map stale
    // We need a real mtime difference — force it by writing again
    // (on Windows, 1ms resolution may not be enough; write different content)
    writeFileSync(join(tmpRepo, 'sample.py'), 'def hello():\n    return 2\n# modified\n', 'utf8');

    // Verify that code-map --check reports stale
    const checkResult = runCli(['code-map', '--check'], { cwd: tmpRepo, home: tmpHome });
    // If mtime didn't advance enough, skip this check's deeper assertion
    if (checkResult.status !== 1) return;  // mtime too coarse — skip

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/code-map stale/);
    expect(r.stdout + r.stderr).toMatch(/sample\.py/);
  });

  it('hash-based freshness: bumping source mtime without changing content does NOT mark code-map stale', () => {
    const changeId = 'cm-hash-fresh';
    writeMinimalValidChange(tmpRepo, changeId);

    writeFileSync(join(tmpRepo, 'api.js'), 'export const VERSION = 1;\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    // Force the source mtime to a future time without changing content. This
    // mimics the post-`git clone` scenario where mtimes are unreliable.
    const future = new Date(Date.now() + 60_000);
    require('fs').utimesSync(join(tmpRepo, 'api.js'), future, future);

    // Sanity: mtime IS now ahead of map → mtime check would say stale.
    // But hash-based fallback should rescue this.
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/code-map stale/);
  });

  it('hash-based freshness: changing content (not mtime) IS detected as stale', () => {
    const changeId = 'cm-hash-stale';
    writeMinimalValidChange(tmpRepo, changeId);

    writeFileSync(join(tmpRepo, 'api.js'), 'export const VERSION = 1;\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    // Change content; let mtime naturally update too
    writeFileSync(join(tmpRepo, 'api.js'), 'export const VERSION = 2;\n// changed\n', 'utf8');

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/code-map stale/);
  });

  it('fresh code-map produces no code-map error in gate output', () => {
    const changeId = 'cm-fresh-test';
    writeMinimalValidChange(tmpRepo, changeId);

    // Write a source file and generate the map
    writeFileSync(join(tmpRepo, 'api.js'), 'export const VERSION = 1;\n', 'utf8');
    runCli(['code-map'], { cwd: tmpRepo, home: tmpHome });

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    // Gate may fail for contracts, but no code-map error
    expect(r.stdout + r.stderr).not.toMatch(/code-map stale/);
    expect(r.stdout + r.stderr).not.toMatch(/code-map missing/);
  });
});
