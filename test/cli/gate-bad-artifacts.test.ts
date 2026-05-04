import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirrors gate.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

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

function writeValidChangeArtifacts(changeDir: string, changeId: string): void {
  const filler = 'This is a meaningful description of the change. '.repeat(4);

  writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature to support new requirements. Scoped to user management module.\n`, 'utf8');
  writeFileSync(join(changeDir, 'change-classification.md'), `# Change Classification\n\n**Risk Level:** medium\n**Tier:** Tier 1\n\n${filler}\n\nThis change is classified as low risk because it is additive only with no breaking changes.\n`, 'utf8');
  writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests cover all new business logic. Integration tests verify API endpoints. E2E tests cover user flows.\n`, 'utf8');
  writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n\n## Promotion Policy\nAll tier-1 gates must pass.\n\n## Rollback Policy\nAutomatic rollback if threshold exceeded.\n\n${filler}\n`, 'utf8');
  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml(changeId), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('cdd-kit gate — bad agent-log artifacts shape', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-gate-bad-artifacts-');
    tmpHome = makeTempDir('cdd-gate-bad-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('gate rejects agent-log with OLD flat top-level keys (files-changed: / tests-added:) instead of artifacts array', () => {
    const changeId = 'bad-artifacts-001';
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir, changeId);

    // Write a backend-engineer.yml with the OLD broken shape:
    // top-level `files-changed:` and `tests-added:` keys instead of `artifacts:`
    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });

    const brokenLog = yaml.dump({
      'change-id': changeId,
      agent: 'backend-engineer',
      timestamp: '2026-05-04T10:00:00Z',
      status: 'complete',
      'files-read': ['src/api/users.ts'],
      // OLD broken shape — flat top-level keys instead of artifacts array
      'files-changed': ['src/api/users.ts:10-45'],
      'tests-added': ['tests/api/users.test.ts::should create user'],
      'test-output': '5 passed',
      'contracts-touched': 'none',
      'next-action': 'none',
    }, { lineWidth: -1, noRefs: true });

    writeFileSync(join(agentLogDir, 'backend-engineer.yml'), brokenLog, 'utf8');

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });

    // Gate must fail because the schema requires `artifacts` as an array
    // and `additionalProperties: false` rejects extra top-level keys.
    expect(r.status).not.toBe(0);
    // The error output should reference the offending file
    expect(r.stdout + r.stderr).toMatch(/agent-log\/backend-engineer\.yml/);
    // Should mention the missing artifacts field or the additional property error
    expect(r.stdout + r.stderr).toMatch(/artifacts|additional properties/i);
  });
});
