import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { buildChangeMetadata, buildTraceMetadata } from '../../src/commands/metadata.js';

/**
 * Pure-builder tests for `cdd-kit metadata` (P2-1). These exercise the
 * markdown/YAML → structured-object derivation directly, with no CLI spawn, so
 * the field-by-field mapping (and its graceful degradation on missing inputs)
 * stays cheap to pin. CLI wiring (--check / --all / --json / exit codes) is
 * covered in test/cli/metadata.test.ts.
 */

let tmpRepo: string;
let changeDir: string;
const CHANGE_ID = 'add-jwt-auth';

function write(rel: string, body: string): void {
  const full = join(changeDir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

function scaffoldFullChange(): void {
  write('tasks.yml', [
    'change-id: add-jwt-auth',
    'status: in-progress',
    'tier: 2',
    'depends-on: [setup-db]',
    'tasks:',
    '  - { id: "1.1", title: "x", status: pending }',
    '',
  ].join('\n'));

  write('change-classification.md', [
    '# Change Classification',
    '',
    '## Change Types',
    '- primary: feature-enhancement',
    '- secondary: api-only-change, data-change',
    '',
    '## Lane',
    '- feature',
    '',
    '## Required Agents',
    '- change-classifier',
    '- backend-engineer (implements the endpoint)',
    '- qa-reviewer',
    '',
    '## Inferred Acceptance Criteria',
    '<!-- 3-8 testable acceptance criteria -->',
    '- AC-1: Users can log in with a valid JWT.',
    '- AC-2: Invalid tokens are rejected with 401.',
    '- AC-3:',
    '',
  ].join('\n'));

  write('context-manifest.md', [
    '# Context Manifest',
    '## Allowed Paths',
    '- specs/changes/add-jwt-auth/',
    '- src/auth/',
    '- tests/auth/',
    '## Required Contracts',
    '-',
    '',
  ].join('\n'));

  write('test-plan.md', [
    '# Test Plan',
    '## Acceptance Criteria → Test Mapping',
    '| criterion id | test family | test file path | tier |',
    '|---|---|---|---|',
    '| AC-1 | integration | tests/auth/login.test.ts | 2 |',
    '| AC-2 | unit | tests/auth/reject.test.ts | 1 |',
    '## Notes',
    '',
  ].join('\n'));

  write('ci-gates.md', [
    '# CI/CD Gate Plan',
    '## Required Gates',
    '| gate | tier | required | trigger | command/workflow | expected artifact |',
    '|---|---:|---:|---|---|---|',
    '| unit | 1 | yes | pull_request |  |  |',
    '| integration | 1 | yes | pull_request |  |  |',
    '| visual | 2 | conditional | pull_request |  |  |',
    '## Notes',
    '',
  ].join('\n'));

  write('agent-log/qa-reviewer.yml', [
    'change-id: add-jwt-auth',
    'timestamp: 2026-06-11T00:00:00Z',
    'agent: qa-reviewer',
    'status: approved',
    'artifacts:',
    '  - { type: qa-verdict, pointer: "specs/changes/add-jwt-auth/agent-log/qa-reviewer.yml" }',
    'next-action: none',
    '',
  ].join('\n'));

  // An optional artifact that is present.
  write('design.md', '# Design\n\nsome design content.\n');
}

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-metadata-build-');
  changeDir = join(tmpRepo, 'specs', 'changes', CHANGE_ID);
  mkdirSync(changeDir, { recursive: true });
});

afterEach(() => {
  cleanupDir(tmpRepo);
});

describe('buildChangeMetadata', () => {
  it('derives every field from a fully populated change', () => {
    scaffoldFullChange();
    const { data, warnings } = buildChangeMetadata(changeDir, tmpRepo);

    expect(warnings).toEqual([]);
    expect(data['change-id']).toBe('add-jwt-auth');
    expect(data.status).toBe('in-progress');
    expect(data.tier).toBe(2);
    expect(data.lane).toBe('tracked');
    expect(data['classification-lane']).toBe('feature');
    expect(data.types.primary).toBe('feature-enhancement');
    expect(data.types.secondary).toEqual(['api-only-change', 'data-change']);
    // Trailing prose after the agent slug must be stripped to the slug.
    expect(data['required-agents']).toEqual(['change-classifier', 'backend-engineer', 'qa-reviewer']);
    // required = the canonical required set; optional = the optional artifacts present.
    expect(data.artifacts.required).toContain('tasks.yml');
    expect(data.artifacts.required).toContain('context-manifest.md');
    expect(data.artifacts.optional).toEqual(['design.md']);
    expect(data.context.manifest).toBe('specs/changes/add-jwt-auth/context-manifest.md');
    expect(data.context['allowed-paths-count']).toBe(3);
    expect(data.dependencies).toEqual(['setup-db']);
    expect(Object.keys(data['generated-from']).sort())
      .toEqual(['change-classification.md', 'context-manifest.md', 'tasks.yml']);
    for (const ref of Object.values(data['generated-from'])) {
      expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('omits classification-lane when no `## Lane` is declared', () => {
    write('tasks.yml', 'change-id: add-jwt-auth\nstatus: in-progress\ntier: 1\ntasks: []\n');
    const { data } = buildChangeMetadata(changeDir, tmpRepo);
    expect(data['classification-lane']).toBeUndefined();
  });

  it('resolves tier from a structured `## Tier` marker when tasks.yml has none', () => {
    write('tasks.yml', 'change-id: add-jwt-auth\nstatus: in-progress\ntier: null\ntasks: []\n');
    write('change-classification.md', '# Change Classification\n\n## Tier\n- 3\n');
    const { data } = buildChangeMetadata(changeDir, tmpRepo);
    expect(data.tier).toBe(3);
  });

  it('degrades gracefully when only tasks.yml exists', () => {
    write('tasks.yml', 'change-id: add-jwt-auth\nstatus: in-progress\ntasks: []\n');
    const { data, warnings } = buildChangeMetadata(changeDir, tmpRepo);
    expect(warnings).toEqual([]);
    expect(data.tier).toBeNull();
    expect(data.types).toEqual({ primary: null, secondary: [] });
    expect(data['required-agents']).toEqual([]);
    expect(data.artifacts.optional).toEqual([]);
    expect(data.context.manifest).toBeNull();
    expect(data.context['allowed-paths-count']).toBe(0);
    expect(data.dependencies).toEqual([]);
    expect(Object.keys(data['generated-from'])).toEqual(['tasks.yml']);
  });

  it('reports status `unknown` when tasks.yml is absent', () => {
    write('change-classification.md', '# Change Classification\n\n## Tier\n- 1\n');
    const { data } = buildChangeMetadata(changeDir, tmpRepo);
    expect(data.status).toBe('unknown');
    expect(data.tier).toBe(1);
  });
});

describe('buildTraceMetadata', () => {
  it('maps acceptance criteria to tests, gates, and evidence', () => {
    scaffoldFullChange();
    const { data, warnings } = buildTraceMetadata(changeDir, tmpRepo);

    expect(warnings).toEqual([]);
    expect(data['change-id']).toBe('add-jwt-auth');
    // AC-3 has empty text → it must be skipped.
    expect(data.criteria.map(c => c.id)).toEqual(['AC-1', 'AC-2']);

    const ac1 = data.criteria.find(c => c.id === 'AC-1')!;
    expect(ac1.text).toBe('Users can log in with a valid JWT.');
    expect(ac1.tests).toEqual([{ family: 'integration', path: 'tests/auth/login.test.ts' }]);
    // gates = required gates whose name overlaps this criterion's test families.
    expect(ac1.gates).toEqual(['integration']);

    const ac2 = data.criteria.find(c => c.id === 'AC-2')!;
    expect(ac2.gates).toEqual(['unit']);

    // required-gates = only gates marked required:yes (visual is conditional → excluded).
    expect(data['required-gates']).toEqual(['unit', 'integration']);

    expect(data.evidence).toEqual([
      { agent: 'qa-reviewer', type: 'qa-verdict', pointer: 'specs/changes/add-jwt-auth/agent-log/qa-reviewer.yml' },
    ]);

    expect(Object.keys(data['generated-from'])).toContain('agent-log/qa-reviewer.yml');
  });

  it('degrades to empty criteria/evidence when test-plan and agent-log are absent', () => {
    write('change-classification.md', '# Change Classification\n\n## Inferred Acceptance Criteria\n- AC-1: Something testable.\n');
    const { data, warnings } = buildTraceMetadata(changeDir, tmpRepo);
    expect(warnings).toEqual([]);
    // The criterion is present but with no tests/gates (no test-plan to map).
    expect(data.criteria).toEqual([{ id: 'AC-1', text: 'Something testable.', tests: [], gates: [] }]);
    expect(data['required-gates']).toEqual([]);
    expect(data.evidence).toEqual([]);
  });

  it('records a warning and skips an unreadable agent-log file', () => {
    write('change-classification.md', '# Change Classification\n\n## Inferred Acceptance Criteria\n- AC-1: x.\n');
    write('agent-log/broken.yml', 'this: : : not valid yaml: [\n');
    const { data, warnings } = buildTraceMetadata(changeDir, tmpRepo);
    expect(data.evidence).toEqual([]);
    expect(warnings.some(w => w.includes('agent-log/broken.yml'))).toBe(true);
  });
});
