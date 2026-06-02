import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

// ?????????????????????????????????????????????????????????????????????????????
// Contract helpers (mirrors validate-semantic.test.ts)
// ?????????????????????????????????????????????????????????????????????????????

function buildApiContract(rows: string[]): string {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|--------|------|------|----------------|-----------------|--------|-------|',
    ...rows,
  ].join('\n');

  return `---
contract: api
schema-version: 0.1.0
last-changed: 2026-04-27
breaking-change-policy: deprecate-2-minors
---

# API Contract

## API Style
- response style: JSON REST
- error style: envelope
- auth style: Bearer JWT

## Endpoint Requirements
${table}

## Error Format
Standard envelope.

## Compatibility Policy
No breaking changes without a major version bump.

## Endpoint Inventory Policy
All endpoints must appear here.

## Breaking Change Policy
RFC required.
`;
}

function buildEnvContract(rows: string[]): string {
  const table = [
    '| name | scope | environments | required | secret | default | example | owner | validation | restart required | failure behavior |',
    '|------|-------|--------------|----------|--------|---------|---------|-------|------------|------------------|------------------|',
    ...rows,
  ].join('\n');

  return `---
contract: env
schema-version: 0.1.0
last-changed: 2026-04-27
breaking-change-policy: deprecate-2-minors
---

# Env Contract

${table}

## Public Frontend Env Policy
VITE_ variables are browser-exposed.

## Secret Policy
Secrets must not have defaults.

## Deployment Sync Policy
All vars must be set before deploy.
`;
}

/** Write all 6 contracts with sufficient content to pass validators. */
function writeValidContracts(tmpRepo: string): void {
  const cssContent = `---
contract: css
schema-version: 0.1.0
last-changed: 2026-04-27
breaking-change-policy: deprecate-2-minors
---

# CSS Contract

## Design System
Using Tailwind CSS v3 with custom design tokens.
Typography: Inter font family, sizes sm/base/lg/xl/2xl.
Colors: primary #3B82F6, secondary #6B7280, danger #EF4444, success #10B981.
Spacing: 4px base unit grid. Breakpoints: sm:640px md:768px lg:1024px xl:1280px.
Component library: Headless UI + custom components in src/components/.
Dark mode: class-based via .dark prefix.
Animation: Framer Motion for transitions, CSS for micro-interactions.
Accessibility: WCAG 2.1 AA compliance required. All interactive elements keyboard-navigable.
`;
  mkdirSync(join(tmpRepo, 'contracts', 'css'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'css', 'css-contract.md'), cssContent, 'utf8');

  const envContent = buildEnvContract([
    '| DATABASE_URL | backend | all | true | true | - | postgres://localhost/app | backend-team | valid postgres URI | yes | crash |',
    '| JWT_SECRET | backend | all | true | true | - | 32-char-random | backend-team | min 32 chars | yes | crash |',
    '| VITE_API_URL | frontend | all | true | false | http://localhost:3000 | https://api.example.com | frontend-team | valid URL | no | use default |',
  ]);
  mkdirSync(join(tmpRepo, 'contracts', 'env'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'env', 'env-contract.md'), envContent, 'utf8');

  const apiContent = buildApiContract([
    '| GET | /api/v1/users | required | - | UserList | 401,403 | users.spec.ts |',
    '| POST | /api/v1/users | required | CreateUserReq | User | 400,409 | users.spec.ts |',
    '| DELETE | /api/v1/users/:id | admin | - | - | 401,403,404 | users.spec.ts |',
  ]);
  mkdirSync(join(tmpRepo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'api', 'api-contract.md'), apiContent, 'utf8');

  const dataContent = `---
contract: data
schema-version: 0.1.0
last-changed: 2026-04-27
breaking-change-policy: deprecate-2-minors
---

# Data Shape Contract

## Data Shapes
User: { id: UUID, email: string, name: string, role: admin|user, createdAt: ISO8601 }
Post: { id: UUID, title: string, body: string, authorId: UUID, publishedAt: ISO8601|null }
Comment: { id: UUID, body: string, postId: UUID, authorId: UUID, createdAt: ISO8601 }
Pagination: { data: T[], meta: { total: int, page: int, per_page: int, next_cursor: string|null } }
Error: { code: string, message: string, details: ErrorDetail[] }
ErrorDetail: { field: string, message: string, code: string }
Database: PostgreSQL 15. ORM: Prisma. Migrations: prisma migrate.
Caching: Redis for sessions and rate-limit counters.
`;
  mkdirSync(join(tmpRepo, 'contracts', 'data'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'data', 'data-shape-contract.md'), dataContent, 'utf8');

  const bizContent = `---
contract: business
schema-version: 0.1.0
last-changed: 2026-04-27
breaking-change-policy: deprecate-2-minors
---

# Business Rules

Authentication: Users must verify email before accessing protected resources.
Authorization: Role-based access control. Admin role required for user management.
Rate Limiting: 100 req/min per user, 1000 req/min per IP for public endpoints.
Data Retention: User data retained 7 years per compliance. Soft-delete with 30-day recovery.
Billing: Monthly subscription. Proration on plan changes. Grace period 7 days on payment failure.
Notifications: Email on account events. Webhook support for enterprise. Push notifications opt-in.
Content Policy: User content moderated. DMCA compliance. Automated spam detection.
SLA: 99.9% uptime commitment. Less than 200ms p95 API response. Incident response under 15 minutes.
`;
  mkdirSync(join(tmpRepo, 'contracts', 'business'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'business', 'business-rules.md'), bizContent, 'utf8');

  const ciContent = `---
contract: ci
schema-version: 0.1.0
last-changed: 2026-04-27
breaking-change-policy: deprecate-2-minors
---

# CI Gate Contract

## Required Gates
| tier | gate | trigger | workflow | description |
|---|---|---|---|---|
| 1 | lint | PR | ci.yml | ESLint + TypeScript type check |
| 1 | unit-tests | PR | ci.yml | Vitest unit tests, coverage >= 80% |
| 2 | integration | PR | ci.yml | Integration tests against test DB |
| 3 | e2e | merge to main | e2e.yml | Playwright E2E smoke tests |
| 4 | deploy-staging | merge to main | deploy.yml | Auto-deploy to staging |
| 5 | deploy-prod | tag vX.Y.Z | deploy.yml | Manual approval required |

## Promotion Policy
All tier-1 gates must pass before merge. Tier 2+ required for release.

## Rollback Policy
Automatic rollback if error rate exceeds 1% within 10 min of deploy. Manual rollback available.
`;
  mkdirSync(join(tmpRepo, 'contracts', 'ci'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'ci', 'ci-gate-contract.md'), ciContent, 'utf8');
}

interface TasksFileOptions {
  changeId: string;
  status?: string;
  tier?: number | null;
  contextGovernance?: 'v1';
  archiveTasks?: string[];
  dependsOn?: string[];
  tasks?: Array<{ id: string; title: string; status: 'pending' | 'done' | 'skipped'; section?: string }>;
  extra?: Record<string, unknown>;
}

function buildTasksYaml(opts: TasksFileOptions): string {
  const data: Record<string, unknown> = {
    'change-id': opts.changeId,
    status: opts.status ?? 'in-progress',
  };
  if (opts.tier !== undefined) data['tier'] = opts.tier;
  if (opts.contextGovernance) data['context-governance'] = opts.contextGovernance;
  if (opts.archiveTasks) data['archive-tasks'] = opts.archiveTasks;
  if (opts.dependsOn) data['depends-on'] = opts.dependsOn;
  if (opts.extra) Object.assign(data, opts.extra);
  data['tasks'] = opts.tasks ?? [
    { id: '1.1', section: 'Preparation', title: 'Confirm classification', status: 'done' },
    { id: '1.2', section: 'Preparation', title: 'Confirm contracts', status: 'done' },
    { id: '1.3', section: 'Preparation', title: 'Confirm design decisions', status: 'skipped' },
    { id: '1.4', section: 'Preparation', title: 'Confirm CI plan', status: 'done' },
    { id: '1.5', section: 'Preparation', title: 'Confirm implementation plan', status: 'done' },
    { id: '7.1', section: 'Archive', title: 'Archive change', status: 'pending' },
    { id: '7.2', section: 'Archive', title: 'Promote learnings', status: 'pending' },
  ];
  return yaml.dump(data, { lineWidth: -1, noRefs: true });
}

interface AgentLogOptions {
  changeId: string;
  agent?: string;
  timestamp?: string;
  status?: 'complete' | 'done' | 'approved' | 'needs-review' | 'blocked';
  filesRead?: string[] | null;
  artifacts?: Array<{ type: string; pointer: string }>;
  nextAction?: string;
  notes?: string;
}

function buildAgentLogYaml(opts: AgentLogOptions): string {
  const data: Record<string, unknown> = {
    'change-id': opts.changeId,
    agent: opts.agent ?? 'backend-engineer',
    timestamp: opts.timestamp ?? '2026-04-27T14:30:00Z',
    status: opts.status ?? 'complete',
  };
  if (opts.filesRead !== undefined && opts.filesRead !== null) {
    data['files-read'] = opts.filesRead;
  }
  data['artifacts'] = opts.artifacts ?? [
    { type: 'files-changed', pointer: 'src/api/users.ts:10-45' },
  ];
  data['next-action'] = opts.nextAction ?? 'none';
  if (opts.notes) data['notes'] = opts.notes;
  return yaml.dump(data, { lineWidth: -1, noRefs: true });
}

function writeValidImplementationPlan(changeDir: string): void {
  const changeId = changeDir.split(/[/\\]/).pop() ?? 'unknown-change';
  const filler = 'Implementation agents receive a bounded execution packet with scope, non-goals, file-level actions, contract updates, tests, and constraints. '.repeat(2);
  writeFileSync(join(changeDir, 'implementation-plan.md'), [
    `# Implementation Plan: ${changeId}`,
    '',
    '## Objective',
    filler,
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
    '| IP-1 | user management | Update implementation according to contracts and test plan | backend-engineer |',
    '',
    '## File-Level Plan',
    '| path or glob | action | notes |',
    '|---|---|---|',
    '| src/api/users.ts | update | keep response contract stable |',
    '',
    '## Test Execution Plan',
    '| acceptance criterion | test file / command | expected signal |',
    '|---|---|---|',
    '| AC-1 | tests/api/users.test.ts | failing test passes after implementation |',
    '',
    '## Handoff Constraints',
    '- Stop as blocked if the plan is incomplete.',
  ].join('\n'), 'utf8');
}

/** Write all required change artifacts with > 100 meaningful chars each,
 *  and include a tier marker in change-classification.md. */
function writeValidChangeArtifacts(changeDir: string): void {
  const filler = 'This is a meaningful description of the change. '.repeat(4);
  const changeId = changeDir.split(/[/\\]/).pop() ?? 'unknown-change';

  writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature to support the new requirements from the product team. The change is scoped to the user management module and will not affect other systems.\n`, 'utf8');

  writeFileSync(join(changeDir, 'change-classification.md'), `# Change Classification\n\n**Risk Level:** medium\n**Tier:** Tier 1\n\n${filler}\n\nThis change is classified as low risk because it is additive only, with no breaking changes to existing APIs or data schemas. Rollback is straightforward by reverting the feature flag.\n`, 'utf8');

  writeValidImplementationPlan(changeDir);

  writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests will cover all new business logic. Integration tests will verify the API endpoints. E2E tests will cover the user flows affected by this change. Performance tests ensure no regression in response times.\n`, 'utf8');

  writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n| 2 | unit-tests | PR | ci.yml | Unit tests |\n\n## Promotion Policy\nAll tier-1 gates must pass before merge.\n\n## Rollback Policy\nAutomatic rollback if error rate exceeds threshold within 10 minutes.\n\n${filler}\n`, 'utf8');

  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId }), 'utf8');
}

function writeContextGovernanceFiles(changeDir: string): void {
  const filler = 'This is a meaningful description of the context policy. '.repeat(4);
  const changeId = changeDir.split(/[/\\]/).pop() ?? 'test-change';

  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
    changeId,
    contextGovernance: 'v1',
  }), 'utf8');

  writeFileSync(join(changeDir, 'context-manifest.md'), [
    '# Context Manifest',
    '',
    filler,
    '',
    '## Allowed Paths',
    '- src/api/users.ts',
    `- specs/changes/${changeId}/`,
    '',
    '## Approved Expansions',
    '-',
    '',
    '## Context Expansion Requests',
    '-',
  ].join('\n'), 'utf8');
}

// ?????????????????????????????????????????????????????????????????????????????
// Tests
// ?????????????????????????????????????????????????????????????????????????????

describe('cdd-kit gate', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-gate-repo-');
    tmpHome = makeTempDir('cdd-gate-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('1: gate on non-existent change exits 1 and reports change not found', () => {
    const r = runCli(['gate', 'nonexistent'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/change not found/i);
  });

  it('2: gate on fresh cdd-kit new (templates only) fails on stub content', () => {
    runCli(['new', 'feat-001'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['gate', 'feat-001'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/stub|appears to be|invalid YAML|missing required/i);
  });

  it('3: gate with missing required file fails and names it', () => {
    runCli(['new', 'feat-002'], { cwd: tmpRepo, home: tmpHome });
    rmSync(join(tmpRepo, 'specs', 'changes', 'feat-002', 'tasks.yml'));
    const r = runCli(['gate', 'feat-002'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/missing required artifact.*tasks\.yml/i);
  });

  it('4: gate with classification missing tier marker fails', () => {
    runCli(['new', 'feat-003'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-003');
    const filler = 'This is a meaningful description. '.repeat(5);

    writeFileSync(join(changeDir, 'change-classification.md'), `# Classification\n\n${filler}\n\nThis change affects the frontend module only. No database migrations required. Deployment is straightforward with no special procedures needed beyond the standard release process.\n`, 'utf8');
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature to support the new requirements. The change is additive only with no breaking changes to any existing APIs or data schemas.\n`, 'utf8');
    writeValidImplementationPlan(changeDir);
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests will cover all new business logic paths. Integration tests verify the API endpoints work correctly. E2E tests cover all user-facing flows that are affected by this change.\n`, 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n${filler}\n\nAll existing CI gates must pass before merge. Additional integration test suite covering new endpoints. Deploy gate requires manual approval. Automated rollback if error rate exceeds threshold.\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId: 'feat-003' }), 'utf8');

    const r = runCli(['gate', 'feat-003'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/tier|risk marker/i);
  });

  it.skipIf(!hasPython())('5: gate on fully-filled change with valid contracts passes', () => {
    runCli(['new', 'feat-004'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-004');

    writeValidChangeArtifacts(changeDir);
    writeValidContracts(tmpRepo);

    const r = runCli(['gate', 'feat-004'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/gate passed for change: feat-004/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // agent-log validation tests
  // ?????????????????????????????????????????????????????????????????????????

  it('6: gate passes with no agent-log/ dir (acceptable ??no agents logged yet)', () => {
    runCli(['new', 'feat-005'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-005');
    writeValidChangeArtifacts(changeDir);
    const r = runCli(['gate', 'feat-005'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/agent-log/i);
  });

  it('7: gate passes with valid agent log (status: complete)', () => {
    runCli(['new', 'feat-006'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-006');
    writeValidChangeArtifacts(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.yml'), buildAgentLogYaml({
      changeId: 'feat-006',
      artifacts: [
        { type: 'files-changed', pointer: 'src/api/users.ts:10-45' },
        { type: 'tests-added', pointer: 'test/users.test.ts::should create user' },
        { type: 'test-output', pointer: '5 passed' },
        { type: 'contracts-touched', pointer: 'contracts/api/api-contract.md' },
      ],
    }), 'utf8');

    const r = runCli(['gate', 'feat-006'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/invalid "status:"|missing required "status:"/i);
    expect(r.stdout + r.stderr).not.toMatch(/status=blocked/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // --strict flag tests
  // ?????????????????????????????????????????????????????????????????????????

  it('10: gate without --strict: pending tasks produce warning but do NOT fail', () => {
    runCli(['new', 'feat-009'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-009');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-009',
      tasks: [
        { id: '1.1', title: 'Confirm classification', status: 'done' },
        { id: '1.2', title: 'Confirm contracts', status: 'pending' },
        { id: '7.1', title: 'Archive change', status: 'pending' },
        { id: '7.2', title: 'Promote learnings', status: 'pending' },
      ],
    }), 'utf8');

    const r = runCli(['gate', 'feat-009'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/task\(s\) still pending.*archive-tasks frontmatter/i);
  });

  it('11: gate with --strict: pending non-archive tasks cause failure', () => {
    runCli(['new', 'feat-010'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-010');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-010',
      tasks: [
        { id: '1.1', title: 'Confirm classification', status: 'done' },
        { id: '1.2', title: 'Confirm contracts', status: 'pending' },
        { id: '7.1', title: 'Archive change', status: 'pending' },
        { id: '7.2', title: 'Promote learnings', status: 'pending' },
      ],
    }), 'utf8');

    const r = runCli(['gate', 'feat-010', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/task\(s\) still pending/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // artifact pointer validation
  // ?????????????????????????????????????????????????????????????????????????

  // ?????????????????????????????????????????????????????????????????????????
  // tier-based agent-log requirements
  // ?????????????????????????????????????????????????????????????????????????

  it('14b: gate tier regex does NOT trigger on unfilled template placeholder', () => {
    runCli(['new', 'feat-014b'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-014b');
    writeValidChangeArtifacts(changeDir);

    const filler = 'This is a meaningful description of the change. '.repeat(4);
    writeFileSync(join(changeDir, 'change-classification.md'), [
      '# Change Classification',
      '',
      '**Risk Level:** medium',
      '**Tier:** Tier 1',
      '',
      '## Tier',
      '- 0 / 1 / 2 / 3 / 4 / 5',
      '',
      filler,
      'This change is classified as medium risk. Rollback is straightforward by reverting the feature flag.',
    ].join('\n'), 'utf8');

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.yml'), buildAgentLogYaml({ changeId: 'feat-014b' }), 'utf8');

    const r = runCli(['gate', 'feat-014b'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/e2e-resilience-engineer/i);
    expect(r.stdout + r.stderr).not.toMatch(/monkey-test-engineer/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // per-artifact minimum char counts
  // ?????????????????????????????????????????????????????????????????????????

  it('15: gate fails when change-classification.md has fewer than 200 meaningful chars', () => {
    runCli(['new', 'feat-015'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015');

    writeFileSync(join(changeDir, 'change-classification.md'), [
      '# Change Classification',
      '',
      '**Risk Level:** medium',
      '**Tier:** Tier 1',
      '',
      'Adds user management feature.',
      'Additive only, no breaking changes.',
      'Feature flag rollback option.',
    ].join('\n'), 'utf8');

    const filler = 'This is a meaningful description of the change. '.repeat(4);
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature.\n`, 'utf8');
    writeValidImplementationPlan(changeDir);
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests will cover all new business logic. Integration tests verify the API endpoints. E2E tests cover all user-facing flows.\n`, 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n\n## Promotion Policy\nAll tier-1 gates must pass. ${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId: 'feat-015' }), 'utf8');

    const r = runCli(['gate', 'feat-015'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/change-classification\.md.*stub|stub.*change-classification\.md/i);
  });

  it('15b: gate fails when test-plan.md has fewer than 200 meaningful chars', () => {
    runCli(['new', 'feat-015b'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015b');

    const filler = 'This is a meaningful description of the change. '.repeat(4);
    writeFileSync(join(changeDir, 'change-classification.md'), `# Change Classification\n\n**Risk Level:** medium\n**Tier:** Tier 1\n\n${filler}\n\nThis change is classified as low risk. Rollback is straightforward by reverting the feature flag.\n`, 'utf8');
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature. The change is additive only.\n`, 'utf8');
    writeValidImplementationPlan(changeDir);

    writeFileSync(join(changeDir, 'test-plan.md'), [
      '# Test Plan',
      '',
      'Unit tests will cover all new business logic paths.',
      'Integration tests will verify the API endpoints work.',
      'E2E tests will cover the main user flows.',
    ].join('\n'), 'utf8');

    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n\n## Promotion Policy\nAll tier-1 gates must pass. ${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId: 'feat-015b' }), 'utf8');

    const r = runCli(['gate', 'feat-015b'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/test-plan\.md.*stub|stub.*test-plan\.md/i);
  });

  it('15c: gate fails when an artifact still carries unfilled <id>/<date>/<change-id> template placeholders', () => {
    runCli(['new', 'feat-015c'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015c');

    // Everything else valid and well past MIN_CHARS...
    writeValidChangeArtifacts(changeDir);

    // ...but implementation-plan.md is left as an unfilled scaffold: long
    // enough to clear the 200-char stub floor (the template's own prose does
    // that) while every fill-in is still a placeholder token. This is the exact
    // "fake-passthrough" hole — the stub check alone lets it through.
    const filler = 'Implementation agents receive a bounded execution packet with scope, non-goals, file-level actions, contract updates, tests, and constraints. '.repeat(3);
    writeFileSync(join(changeDir, 'implementation-plan.md'), [
      '---',
      'change-id: <id>',
      'schema-version: 0.1.0',
      'last-changed: <date>',
      '---',
      '',
      '# Implementation Plan: <change-id>',
      '',
      '## Objective',
      filler,
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-015c'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/implementation-plan\.md.*placeholder/i);
    expect(r.stdout + r.stderr).toMatch(/<id>|<date>|<change-id>/);
  });

  it.skipIf(!hasPython())('15d: gate does NOT flag a legitimate hyphenated custom element as a placeholder', () => {
    // Guards against a false positive: a frontend-facing artifact may mention a
    // custom element like <date-picker> / <my-element> in prose. The placeholder
    // check is a closed allowlist (<id>/<date>/<change-id>), so these must pass.
    runCli(['new', 'feat-015d'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015d');
    writeValidChangeArtifacts(changeDir);
    writeValidContracts(tmpRepo);

    const filler = 'This is a meaningful description of the change to the date picker component. '.repeat(4);
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nE2E tests exercise the <date-picker> and <my-element> custom elements rendered by the shell. Unit tests cover the new logic.\n`, 'utf8');

    const r = runCli(['gate', 'feat-015d'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/placeholder/i);
  });

  it.skipIf(!hasPython())('15e: gate does NOT flag XML element examples (<id>123</id>) as placeholders', () => {
    // <id>/<date> are valid XML element names. A change documenting an XML
    // payload must not be mistaken for an unfilled scaffold: a real element has
    // a closing tag, a template fill-in does not.
    runCli(['new', 'feat-015e'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015e');
    writeValidChangeArtifacts(changeDir);
    writeValidContracts(tmpRepo);

    const filler = 'This is a meaningful description of the legacy XML payload integration work. '.repeat(4);
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nThe SOAP endpoint returns <id>123</id> and <date>2026-06-01</date>; tests assert the parser maps both correctly. Unit and integration coverage included.\n`, 'utf8');

    const r = runCli(['gate', 'feat-015e'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/placeholder/i);
  });

  it('15f: gate still catches an unfilled placeholder even when the same file also has an XML example', () => {
    // Adversarial: a partially-filled scaffold that also documents <id>123</id>
    // must not slip through. Element-stripping is per-occurrence, so the bare
    // frontmatter `change-id: <id>` is still flagged.
    runCli(['new', 'feat-015f'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015f');
    writeValidChangeArtifacts(changeDir);

    const filler = 'Meaningful description of the XML payload mapping work for this change. '.repeat(4);
    writeFileSync(join(changeDir, 'implementation-plan.md'), [
      '---',
      'change-id: <id>',          // <- still unfilled
      'last-changed: 2026-06-01',
      '---',
      '',
      '# Implementation Plan: feat-015f',
      '',
      '## Objective',
      filler,
      'The SOAP response includes <id>123</id> which we map to the report model.',  // <- legit XML
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-015f'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/implementation-plan\.md.*placeholder.*<id>/i);
  });

  it('12: gate with --strict: only archive task IDs are exempt from pending check', () => {
    runCli(['new', 'feat-011'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-011');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-011',
      tasks: [
        { id: '1.1', title: 'Confirm classification', status: 'done' },
        { id: '1.2', title: 'Confirm contracts', status: 'done' },
        { id: '1.3', title: 'Confirm design decisions', status: 'skipped' },
        { id: '1.4', title: 'Confirm CI plan', status: 'done' },
        { id: '1.5', title: 'Confirm implementation plan', status: 'done' },
        { id: '2.1', title: 'API contract updated', status: 'done' },
        { id: '7.1', title: 'Archive change', status: 'pending' },
        { id: '7.2', title: 'Promote learnings', status: 'pending' },
      ],
    }), 'utf8');

    const r = runCli(['gate', 'feat-011', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/task\(s\) still pending/i);
  });

  it('16: new context-governed change fails when context-manifest.md is missing', () => {
    runCli(['new', 'feat-cg-missing'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-missing');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);
    rmSync(join(changeDir, 'context-manifest.md'));

    const r = runCli(['gate', 'feat-cg-missing'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing required artifact: context-manifest\.md/i);
  });

  it('17: legacy change warns when context-manifest.md is missing, but strict mode fails', () => {
    runCli(['new', 'feat-legacy-cg'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-legacy-cg');
    writeValidChangeArtifacts(changeDir);
    rmSync(join(changeDir, 'context-manifest.md'));

    const normal = runCli(['gate', 'feat-legacy-cg'], { cwd: tmpRepo, home: tmpHome });
    expect(normal.stdout + normal.stderr).toMatch(/missing context-manifest\.md \(legacy change/i);
    expect(normal.stdout + normal.stderr).not.toMatch(/missing required artifact: context-manifest\.md/i);

    const strict = runCli(['gate', 'feat-legacy-cg', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.status).not.toBe(0);
    expect(strict.stdout + strict.stderr).toMatch(/missing required artifact: context-manifest\.md/i);
  });

  it('22: gate warns when context expansion request is pending', () => {
    runCli(['new', 'feat-cg-pending'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-pending');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);
    writeFileSync(join(changeDir, 'context-manifest.md'), [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '- request-id: CER-001',
      '  requested_paths:',
      '    - src/other/file.ts',
      '  reason: needs read access',
      '  status: pending',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-pending'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/context-manifest\.md: has 1 pending context expansion request/i);
  });

  it('25: gate blocks atomic changes when upstream dependency is still in progress', () => {
    runCli(['new', 'dep-db'], { cwd: tmpRepo, home: tmpHome });
    runCli(['new', 'feat-dependent', '--depends-on', 'dep-db'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-dependent');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-dependent',
      contextGovernance: 'v1',
      dependsOn: ['dep-db'],
    }), 'utf8');

    const r = runCli(['gate', 'feat-dependent'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/dependency dep-db: upstream change is not completed/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // tier source: tasks.yml frontmatter (with classification fallback)
  // ?????????????????????????????????????????????????????????????????????????

  it('B1.2: bold-only `**Tier:** Tier 1` no longer silently triggers enforcement (legacy warn)', () => {
    runCli(['new', 'feat-bold-legacy'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-bold-legacy');
    writeValidChangeArtifacts(changeDir);

    const r = runCli(['gate', 'feat-bold-legacy'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/Tier 1 change requires agent-log\/e2e-resilience-engineer/i);
    expect(r.stdout + r.stderr).toMatch(/legacy format|set `tier:.*tasks\.yml frontmatter/i);
  });

  it('B1.3: missing tier marker entirely fails gate (silent-skip prevention)', () => {
    runCli(['new', 'feat-no-tier'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-no-tier');

    const filler = 'Description content. '.repeat(8);
    writeFileSync(join(changeDir, 'change-classification.md'), [
      '# Change Classification',
      '',
      filler,
      '',
      'No tier mentioned anywhere in this file.',
    ].join('\n'), 'utf8');
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n${filler}\n`, 'utf8');
    writeValidImplementationPlan(changeDir);
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId: 'feat-no-tier' }), 'utf8');

    const r = runCli(['gate', 'feat-no-tier'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing tier marker|missing tier\/risk marker/i);
  });

  it('B1.4: frontmatter tier wins over classification tier when both present (warn on drift)', () => {
    runCli(['new', 'feat-tier-drift'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-tier-drift');
    writeValidChangeArtifacts(changeDir);

    const filler = 'Description content. '.repeat(8);
    writeFileSync(join(changeDir, 'change-classification.md'), [
      '# Change Classification',
      '',
      filler,
      '',
      '## Tier',
      '- 2',
      '',
    ].join('\n'), 'utf8');

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-tier-drift',
      tier: 4,
    }), 'utf8');

    const r = runCli(['gate', 'feat-tier-drift'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/tier mismatch.*frontmatter says 4.*classification.*2/i);
    expect(r.stdout + r.stderr).not.toMatch(/Tier 4 change requires agent-log\/e2e-resilience-engineer/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // archive-tasks frontmatter
  // ?????????????????????????????????????????????????????????????????????????

  it('B2.1: custom archive-tasks frontmatter exempts listed task IDs in --strict', () => {
    runCli(['new', 'feat-archive-custom'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-archive-custom');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-archive-custom',
      tier: 3,
      archiveTasks: ['8.1', '8.2', '8.3'],
      tasks: [
        { id: '1.1', title: 'Done', status: 'done' },
        { id: '8.1', title: 'Archive', status: 'pending' },
        { id: '8.2', title: 'Promote', status: 'pending' },
        { id: '8.3', title: 'Notify', status: 'pending' },
      ],
    }), 'utf8');

    const r = runCli(['gate', 'feat-archive-custom', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/task\(s\) still pending/i);
  });

  it('B2.2: tasks not in archive-tasks list still trigger pending error in --strict', () => {
    runCli(['new', 'feat-archive-strict'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-archive-strict');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-archive-strict',
      tier: 3,
      archiveTasks: ['8.1'],
      tasks: [
        { id: '1.1', title: 'Pending non-archive task', status: 'pending' },
        { id: '8.1', title: 'Archive (exempt)', status: 'pending' },
      ],
    }), 'utf8');

    const r = runCli(['gate', 'feat-archive-strict', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/1 task\(s\) still pending/i);
  });

  it('B2.3: missing archive-tasks frontmatter falls back to default 7.1, 7.2', () => {
    runCli(['new', 'feat-archive-default'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-archive-default');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-archive-default',
      tier: 3,
      tasks: [
        { id: '1.1', title: 'Done', status: 'done' },
        { id: '7.1', title: 'Archive', status: 'pending' },
        { id: '7.2', title: 'Promote', status: 'pending' },
      ],
    }), 'utf8');

    const r = runCli(['gate', 'feat-archive-default', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/task\(s\) still pending/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // tasks.yml frontmatter lint
  // ?????????????????????????????????????????????????????????????????????????

  it('PR3-3.1: missing change-id in tasks.yml frontmatter fails gate', () => {
    runCli(['new', 'feat-fm-no-change-id'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-fm-no-change-id');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), yaml.dump({
      status: 'in-progress',
      tier: 3,
      tasks: [{ id: '1.1', title: 'Done', status: 'done' }],
    }, { lineWidth: -1 }), 'utf8');

    const r = runCli(['gate', 'feat-fm-no-change-id'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing required `change-id`/i);
  });

  it('PR3-3.2: invalid status value fails gate', () => {
    runCli(['new', 'feat-fm-bad-status'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-fm-bad-status');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), yaml.dump({
      'change-id': 'feat-fm-bad-status',
      status: 'kinda-done',
      tier: 3,
      tasks: [{ id: '1.1', title: 'Done', status: 'done' }],
    }, { lineWidth: -1 }), 'utf8');

    const r = runCli(['gate', 'feat-fm-bad-status'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid.*status.*kinda-done|invalid status.*kinda-done/i);
  });

  it('PR3-3.3: typo `Tier:` (capital T) emits a typo-suggestion warning', () => {
    runCli(['new', 'feat-fm-typo'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-fm-typo');
    writeValidChangeArtifacts(changeDir);

    writeFileSync(join(changeDir, 'tasks.yml'), yaml.dump({
      'change-id': 'feat-fm-typo',
      status: 'in-progress',
      Tier: 1,
      tasks: [{ id: '1.1', title: 'Done', status: 'done' }],
    }, { lineWidth: -1 }), 'utf8');

    const r = runCli(['gate', 'feat-fm-typo'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/unknown key `Tier`.*did you mean `tier`/i);
  });

  // ?????????????????????????????????????????????????????????????????????????
  // depends-on cycle detection
  // ?????????????????????????????????????????????????????????????????????????

  it('PR3-4.1: 2-node depends-on cycle is detected', () => {
    runCli(['new', 'feat-cycle-a'], { cwd: tmpRepo, home: tmpHome });
    runCli(['new', 'feat-cycle-b'], { cwd: tmpRepo, home: tmpHome });
    const dirA = join(tmpRepo, 'specs', 'changes', 'feat-cycle-a');
    const dirB = join(tmpRepo, 'specs', 'changes', 'feat-cycle-b');
    writeValidChangeArtifacts(dirA);
    writeValidChangeArtifacts(dirB);

    writeFileSync(join(dirA, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-cycle-a',
      tier: 3,
      dependsOn: ['feat-cycle-b'],
    }), 'utf8');
    writeFileSync(join(dirB, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-cycle-b',
      tier: 3,
      dependsOn: ['feat-cycle-a'],
    }), 'utf8');

    const r = runCli(['gate', 'feat-cycle-a'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/depends-on cycle detected.*feat-cycle-a.*feat-cycle-b.*feat-cycle-a/i);
  });

  it('PR3-4.2: 3-node A??? cycle is detected', () => {
    for (const id of ['cyc-a', 'cyc-b', 'cyc-c']) {
      runCli(['new', id], { cwd: tmpRepo, home: tmpHome });
      writeValidChangeArtifacts(join(tmpRepo, 'specs', 'changes', id));
    }
    const writeWithDep = (id: string, dep: string) => writeFileSync(
      join(tmpRepo, 'specs', 'changes', id, 'tasks.yml'),
      buildTasksYaml({ changeId: id, tier: 3, dependsOn: [dep] }),
      'utf8',
    );
    writeWithDep('cyc-a', 'cyc-b');
    writeWithDep('cyc-b', 'cyc-c');
    writeWithDep('cyc-c', 'cyc-a');

    const r = runCli(['gate', 'cyc-a'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/depends-on cycle detected/i);
  });

  it('26: gate allows atomic changes when upstream dependency is completed', () => {
    writeValidContracts(tmpRepo);
    runCli(['new', 'dep-api'], { cwd: tmpRepo, home: tmpHome });
    runCli(['new', 'feat-after-api', '--depends-on', 'dep-api'], { cwd: tmpRepo, home: tmpHome });

    const upstreamTasksPath = join(tmpRepo, 'specs', 'changes', 'dep-api', 'tasks.yml');
    const upstreamRaw = readFileSync(upstreamTasksPath, 'utf8');
    const upstreamData = yaml.load(upstreamRaw) as Record<string, unknown>;
    upstreamData['status'] = 'completed';
    writeFileSync(upstreamTasksPath, yaml.dump(upstreamData, { lineWidth: -1 }), 'utf8');

    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-after-api');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);
    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({
      changeId: 'feat-after-api',
      contextGovernance: 'v1',
      dependsOn: ['dep-api'],
    }), 'utf8');

    const r = runCli(['gate', 'feat-after-api'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/dependency dep-api/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mechanical tier-floor safety net
// ─────────────────────────────────────────────────────────────────────────────

describe('cdd-kit gate — tier floor', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-gate-floor-repo-');
    tmpHome = makeTempDir('cdd-gate-floor-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error(`Setup init failed: ${r.stderr}`);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  /** A change whose request describes a critical surface, tiered at `tier`. */
  function scaffoldSensitiveChange(changeId: string, tier: number, extra?: Record<string, unknown>): string {
    runCli(['new', changeId], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
    writeValidChangeArtifacts(changeDir);
    // Critical intent in the user's own words.
    writeFileSync(join(changeDir, 'change-request.md'),
      `# Change Request\n\nAdd JWT authentication and OAuth login to the payments checkout API. ` +
      `This touches password handling and session tokens, so it is security-sensitive.\n`, 'utf8');
    // Structured tier so resolveTier reads it from frontmatter.
    writeFileSync(join(changeDir, 'change-classification.md'),
      `# Change Classification\n\n## Tier\n- ${tier}\n\n` +
      `This is a meaningful classification body describing the affected surface, the risk profile, the blast radius, and the rollback story in enough detail to clear the stub threshold so the gate proceeds far enough to evaluate the mechanical tier floor against the change request. ` +
      `The change is scoped to the authentication and checkout surfaces and is reversible by feature flag.\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId, tier, extra }), 'utf8');
    return changeDir;
  }

  it('fails when a critical request is under-classified as tier 2', () => {
    scaffoldSensitiveChange('under-tiered', 2);
    const r = runCli(['gate', 'under-tiered'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/tier floor violation/i);
    expect(r.stderr + r.stdout).toMatch(/tier 0/i);
  });

  it('does not raise a floor violation when the request is correctly tier 0', () => {
    scaffoldSensitiveChange('correctly-tiered', 0);
    const r = runCli(['gate', 'correctly-tiered'], { cwd: tmpRepo, home: tmpHome });
    // May still fail later on contract validators (no valid contracts here),
    // but the floor must be satisfied.
    expect(r.stderr + r.stdout).not.toMatch(/tier floor violation/i);
  });

  it('downgrades to a warning when tier-floor-override is recorded', () => {
    scaffoldSensitiveChange('overridden', 2, { 'tier-floor-override': 'auth handled by audited Auth0 SDK; no in-house crypto' });
    const r = runCli(['gate', 'overridden'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stderr + r.stdout).toMatch(/tier floor override/i);
    expect(r.stderr + r.stdout).not.toMatch(/tier floor violation/i);
  });

  it('respects .cdd/tier-policy.json enabled:false', () => {
    scaffoldSensitiveChange('disabled-policy', 2);
    writeFileSync(join(tmpRepo, '.cdd', 'tier-policy.json'), JSON.stringify({ enabled: false }), 'utf8');
    const r = runCli(['gate', 'disabled-policy'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stderr + r.stdout).not.toMatch(/tier floor/i);
  });

  it('catches a path-only sensitive change even when the request reads generic', () => {
    // getTouchedPaths needs a git repo; the scaffolded files are untracked.
    spawnSync('git', ['init'], { cwd: tmpRepo, stdio: 'ignore' });
    runCli(['new', 'path-only'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'path-only');
    writeValidChangeArtifacts(changeDir);

    // Deliberately generic request — no sensitive words at all.
    writeFileSync(join(changeDir, 'change-request.md'),
      `# Change Request\n\nRefactor the middleware layer for clarity and testability. No behavior change is intended; this is a purely structural cleanup of the request pipeline so the modules are smaller and easier to maintain over time.\n`, 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'),
      `# Change Classification\n\n## Tier\n- 2\n\nClassified medium because the author framed it as a non-behavioral refactor. This body is long enough to clear the stub threshold so the gate proceeds to evaluate the mechanical tier floor against the request text and the touched file paths of the change.\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId: 'path-only', tier: 2 }), 'utf8');

    // The actual work lands under a critical path.
    mkdirSync(join(tmpRepo, 'src', 'auth'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src', 'auth', 'middleware.ts'), 'export const mw = () => true;\n', 'utf8');

    const r = runCli(['gate', 'path-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/tier floor violation/i);
    expect(r.stderr + r.stdout).toMatch(/tier 0/i);
  });

  it.skipIf(!hasPython())('passes end-to-end when correctly tiered with valid contracts', () => {
    scaffoldSensitiveChange('floor-pass', 0);
    writeValidContracts(tmpRepo);
    const r = runCli(['gate', 'floor-pass'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/gate passed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classify-check advisory
// ─────────────────────────────────────────────────────────────────────────────

describe('cdd-kit classify-check', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-classcheck-repo-');
    tmpHome = makeTempDir('cdd-classcheck-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('reports a tier-0 floor for a sensitive --text intent', () => {
    const r = runCli(['classify-check', '--text', 'add stripe payment checkout', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.floorTier).toBe(0);
  });

  it('reports no floor for a benign intent', () => {
    const r = runCli(['classify-check', '--text', 'fix a typo in the footer', '--json'], { cwd: tmpRepo, home: tmpHome });
    const out = JSON.parse(r.stdout);
    expect(out.floorTier).toBeNull();
  });
});
