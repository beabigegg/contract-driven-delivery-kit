/**
 * Tests for the 2.0.7 cross-consistency audit fixes:
 *
 * - CER pending detection: gate must catch pending requests written by
 *   `cdd-kit context request` (BLOCKING #1 in audit punch list)
 * - n/a pointer: artifacts shaped `pointer: "n/a (...)"` must NOT trigger
 *   path-existence check even when the reason text contains '/'
 * - next-action: `tbd`, `n/a`, `investigate further`, `unknown`, `todo`
 *   placeholders must be rejected for status: blocked
 * - Glob support: `Allowed Paths: src/**\/*.ts` must match nested .ts files
 *   (full picomatch grammar, not just trailing /** and /*)
 * - code-map config error: malformed `.cdd/code-map-config.yml` must surface
 *   as a gate error, not silently degrade to greenfield
 * - Per-agent required types: gate must reject an agent log missing one of
 *   the types declared in `.claude/agents/<agent>.md → "Minimum required …"`
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

// ─── helpers ────────────────────────────────────────────────────────────────

interface TasksFileOptions {
  changeId: string;
  contextGovernance?: 'v1';
  archiveTasks?: string[];
  tasks?: Array<{ id: string; section?: string; title: string; status: string }>;
}

function buildTasksYaml(opts: TasksFileOptions): string {
  const data: Record<string, unknown> = {
    'change-id': opts.changeId,
    status: 'in-progress',
  };
  if (opts.contextGovernance) data['context-governance'] = opts.contextGovernance;
  if (opts.archiveTasks) data['archive-tasks'] = opts.archiveTasks;
  data['tasks'] = opts.tasks ?? [
    { id: '1.1', section: 'Preparation', title: 'Confirm classification', status: 'done' },
    { id: '7.1', section: 'Archive', title: 'Archive change', status: 'pending' },
    { id: '7.2', section: 'Archive', title: 'Promote learnings', status: 'pending' },
  ];
  return yaml.dump(data, { lineWidth: -1, noRefs: true });
}

function writeMinChangeDir(changeDir: string, changeId: string): void {
  const filler = 'This is a meaningful description of the change. '.repeat(4);
  writeFileSync(join(changeDir, 'change-request.md'), `# Change\n\n${filler}\nMotivation: required for the audit-fix tests.\n`, 'utf8');
  writeFileSync(join(changeDir, 'change-classification.md'), `# Classification\n\n**Tier:** Tier 1\n\n${filler}\nLow risk additive change with rollback via feature flag.\n`, 'utf8');
  writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\nUnit tests cover all branches; integration tests verify the API; E2E covers user flows.\n`, 'utf8');
  writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | lint |\n\n## Promotion Policy\nAll tier-1 gates pass before merge.\n\n## Rollback Policy\nAutomatic rollback on error rate spike.\n\n${filler}\n`, 'utf8');
  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId, contextGovernance: 'v1' }), 'utf8');
}

function writeManifest(changeDir: string, changeId: string, opts: {
  allowed?: string[];
  approved?: string[];
  cerSection?: string;
}): void {
  const allowed = (opts.allowed ?? [`specs/changes/${changeId}/`]).map(p => `- ${p}`).join('\n');
  const approved = (opts.approved ?? ['-']).map(p => p === '-' ? '-' : `- ${p}`).join('\n');
  const cer = opts.cerSection ?? '-';

  const filler = 'This is a meaningful manifest description. '.repeat(2);
  writeFileSync(join(changeDir, 'context-manifest.md'), [
    '# Context Manifest',
    '',
    filler,
    '',
    '## Allowed Paths',
    allowed,
    '',
    '## Approved Expansions',
    approved,
    '',
    '## Context Expansion Requests',
    cer,
    '',
  ].join('\n'), 'utf8');
}

/**
 * Write a minimal agent prompt file declaring `Minimum required type values`.
 * Necessary for tests that exercise the per-agent required-types check —
 * `cdd-kit init --local-only` does not plant `.claude/agents/`, and the
 * tests use a temp HOME so the global `~/.claude/agents/` is also empty.
 */
function plantAgentPrompt(repoRoot: string, agentName: string, types: string[]): void {
  const dir = join(repoRoot, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const bullets = types.map(t => `- \`${t}\`: test`).join('\n');
  const content = `---
name: ${agentName}
description: Test agent.
tools: Read
model: claude-sonnet-4-6
---

You are the ${agentName}.

### Required artifacts for this agent

Minimum required \`type\` values for this agent (each must appear at least once
in your \`artifacts:\` array; add more items per type as needed):

${bullets}
`;
  writeFileSync(join(dir, `${agentName}.md`), content, 'utf8');
}

function writeAgentLog(changeDir: string, agent: string, options: {
  artifacts?: Array<{ type: string; pointer: string }>;
  filesRead?: string[];
  status?: 'complete' | 'needs-review' | 'blocked';
  nextAction?: string;
}): void {
  const dir = join(changeDir, 'agent-log');
  mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = {
    'change-id': changeDir.split(/[/\\]/).pop(),
    agent,
    timestamp: '2026-05-04T00:00:00Z',
    status: options.status ?? 'complete',
    artifacts: options.artifacts ?? [{ type: 'files-changed', pointer: 'n/a (no files)' }],
    'next-action': options.nextAction ?? 'none',
  };
  if (options.filesRead !== undefined) data['files-read'] = options.filesRead;
  writeFileSync(join(dir, `${agent}.yml`), yaml.dump(data, { lineWidth: -1, noRefs: true }), 'utf8');
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-audit-');
  tmpHome = makeTempDir('cdd-audit-home-');
  const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

// ─── 1. CER pending detection ──────────────────────────────────────────────

describe('audit fix #1 — CER pending detection from canonical writer', () => {
  it('detects pending request written by `cdd-kit context request`', () => {
    const changeId = 'cer-test';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {});

    // Use the actual writer
    const w = runCli(
      ['context', 'request', changeId, 'CER-001', '--path', 'src/x/y.ts', '--reason', 'need access'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(w.status, w.stderr).toBe(0);

    // Now gate should detect the pending request and fail
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/pending context expansion request/i);
  });

  it('passes after `cdd-kit context approve` flips status to approved', () => {
    const changeId = 'cer-approve';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, { allowed: [`specs/changes/${changeId}/`, 'src/x/y.ts'] });

    runCli(['context', 'request', changeId, 'CER-002', '--path', 'src/x/y.ts'], { cwd: tmpRepo, home: tmpHome });
    runCli(['context', 'approve', changeId, 'CER-002'], { cwd: tmpRepo, home: tmpHome });

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    // Gate may still fail for OTHER reasons (no agent logs etc.); we only assert
    // that the pending-CER specific error is gone.
    expect(r.stdout + r.stderr).not.toMatch(/pending context expansion request/i);
  });
});

// ─── 2. n/a pointer with slash in reason ───────────────────────────────────

describe('audit fix #2 — n/a pointer ignores path existence check', () => {
  it('accepts pointer "n/a (no contracts/ files touched)" without existsSync', () => {
    const changeId = 'na-pointer';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {});

    writeAgentLog(changeDir, 'backend-engineer', {
      filesRead: [],
      artifacts: [
        { type: 'files-changed', pointer: 'src/api/users.ts:1-5' },
        { type: 'tests-added', pointer: 'tests/api/users.test.ts::ok' },
        { type: 'test-output', pointer: '5 passed' },
        // The bug case: '/' in reason text used to trigger existsSync('n/a (no contracts/ files touched)')
        { type: 'contracts-touched', pointer: 'n/a (no contracts/ files touched)' },
      ],
    });
    // Source file referenced in pointers must exist for the OTHER check
    mkdirSync(join(tmpRepo, 'src', 'api'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src', 'api', 'users.ts'), 'export const x=1;\n', 'utf8');
    mkdirSync(join(tmpRepo, 'tests', 'api'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'api', 'users.test.ts'), 'export const t=1;\n', 'utf8');

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    // The n/a pointer must NOT cause "artifact pointer not found"
    expect(r.stdout + r.stderr).not.toMatch(/artifact pointer not found.*n\/a/i);
  });
});

// ─── 3. next-action placeholder rejection ──────────────────────────────────

describe('audit fix #3 — next-action placeholders rejected for blocked status', () => {
  it.each(['tbd', 'TBD', 'n/a', 'investigate further', 'unknown', 'todo'])(
    'rejects next-action="%s" when status=blocked',
    (placeholder) => {
      const changeId = 'na-block';
      const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
      mkdirSync(changeDir, { recursive: true });
      writeMinChangeDir(changeDir, changeId);
      writeManifest(changeDir, changeId, {});

      writeAgentLog(changeDir, 'backend-engineer', {
        filesRead: [],
        status: 'blocked',
        nextAction: placeholder,
        artifacts: [
          { type: 'files-changed', pointer: 'n/a (blocked)' },
          { type: 'tests-added', pointer: 'n/a (blocked)' },
          { type: 'test-output', pointer: 'n/a (blocked)' },
          { type: 'contracts-touched', pointer: 'n/a (blocked)' },
        ],
      });
      const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/next-action/i);
    },
  );

  it('accepts a concrete next-action of length >= 10', () => {
    const changeId = 'na-block-ok';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {});
    writeAgentLog(changeDir, 'backend-engineer', {
      filesRead: [],
      status: 'blocked',
      nextAction: 'wait for db migration approval from sre team',
      artifacts: [
        { type: 'files-changed', pointer: 'n/a (blocked)' },
        { type: 'tests-added', pointer: 'n/a (blocked)' },
        { type: 'test-output', pointer: 'n/a (blocked)' },
        { type: 'contracts-touched', pointer: 'n/a (blocked)' },
      ],
    });
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/next-action/i);
  });
});

// ─── 4. Glob support in Allowed Paths ──────────────────────────────────────

describe('audit fix #4 — picomatch glob in Allowed Paths', () => {
  it('matches `src/**/*.ts` against `src/api/users.ts`', () => {
    const changeId = 'glob-test';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {
      allowed: [`specs/changes/${changeId}/`, 'src/**/*.ts'],
    });
    mkdirSync(join(tmpRepo, 'src', 'api'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src', 'api', 'users.ts'), 'export const x=1;\n', 'utf8');

    writeAgentLog(changeDir, 'backend-engineer', {
      filesRead: ['src/api/users.ts'],
      artifacts: [
        { type: 'files-changed', pointer: 'src/api/users.ts:1-5' },
        { type: 'tests-added', pointer: 'n/a (glob test)' },
        { type: 'test-output', pointer: 'n/a (glob test)' },
        { type: 'contracts-touched', pointer: 'n/a (glob test)' },
      ],
    });
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    // Must NOT report unauthorized path on src/api/users.ts
    expect(r.stdout + r.stderr).not.toMatch(/unauthorized path -> src\/api\/users\.ts/);
  });

  it('still rejects a path outside the glob', () => {
    const changeId = 'glob-deny';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {
      allowed: [`specs/changes/${changeId}/`, 'src/**/*.ts'],
    });
    writeAgentLog(changeDir, 'backend-engineer', {
      filesRead: ['lib/oops.js'],
      artifacts: [
        { type: 'files-changed', pointer: 'n/a' },
        { type: 'tests-added', pointer: 'n/a' },
        { type: 'test-output', pointer: 'n/a' },
        { type: 'contracts-touched', pointer: 'n/a' },
      ],
    });
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/unauthorized path -> lib\/oops\.js/);
  });
});

// ─── 5. Code-map config error surfaces in gate ─────────────────────────────

describe('audit fix #5 — malformed code-map-config.yml surfaces as gate error', () => {
  it('reports the config-error and exits 1', () => {
    const changeId = 'cfg-err';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {});

    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(
      join(tmpRepo, '.cdd', 'code-map-config.yml'),
      'include: "not-a-list"\n',
      'utf8',
    );

    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/code-map-config\.yml is invalid/i);
  });
});

// ─── 6. Per-agent required artifact types ──────────────────────────────────

describe('audit fix #6 — per-agent required artifact types enforced', () => {
  it('rejects backend-engineer log missing tests-added / test-output / contracts-touched', () => {
    const changeId = 'req-types';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {});
    plantAgentPrompt(tmpRepo, 'backend-engineer', [
      'files-changed', 'tests-added', 'test-output', 'contracts-touched',
    ]);

    writeAgentLog(changeDir, 'backend-engineer', {
      filesRead: [],
      artifacts: [
        // Only files-changed — missing the other 3 declared types
        { type: 'files-changed', pointer: 'n/a (no files)' },
      ],
    });
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/missing required artifact type\(s\) for agent "backend-engineer"/);
    expect(r.stdout + r.stderr).toMatch(/tests-added/);
    expect(r.stdout + r.stderr).toMatch(/test-output/);
    expect(r.stdout + r.stderr).toMatch(/contracts-touched/);
  });

  it('passes when all required types present (any pointer including n/a)', () => {
    const changeId = 'req-types-ok';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {});
    plantAgentPrompt(tmpRepo, 'backend-engineer', [
      'files-changed', 'tests-added', 'test-output', 'contracts-touched',
    ]);

    writeAgentLog(changeDir, 'backend-engineer', {
      filesRead: [],
      artifacts: [
        { type: 'files-changed', pointer: 'n/a (no files)' },
        { type: 'tests-added', pointer: 'n/a (no tests)' },
        { type: 'test-output', pointer: 'n/a (skipped)' },
        { type: 'contracts-touched', pointer: 'n/a (none)' },
      ],
    });
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/missing required artifact type/);
  });

  it('skips check when agent prompt file is absent (back-compat)', () => {
    const changeId = 'req-types-absent';
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    writeMinChangeDir(changeDir, changeId);
    writeManifest(changeDir, changeId, {});

    writeAgentLog(changeDir, 'unknown-agent-not-installed', {
      filesRead: [],
      artifacts: [{ type: 'files-changed', pointer: 'n/a (no files)' }],
    });
    const r = runCli(['gate', changeId], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/missing required artifact type/);
  });
});
