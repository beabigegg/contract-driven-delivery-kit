import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Contract helpers (mirrors validate-semantic.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

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

/** Write all 5 required change artifacts with > 100 meaningful chars each,
 *  and include a tier marker in change-classification.md. */
function writeValidChangeArtifacts(changeDir: string): void {
  const filler = 'This is a meaningful description of the change. '.repeat(4);

  writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature to support the new requirements from the product team. The change is scoped to the user management module and will not affect other systems.\n`, 'utf8');

  writeFileSync(join(changeDir, 'change-classification.md'), `# Change Classification\n\n**Risk Level:** medium\n**Tier:** Tier 1\n\n${filler}\n\nThis change is classified as low risk because it is additive only, with no breaking changes to existing APIs or data schemas. Rollback is straightforward by reverting the feature flag.\n`, 'utf8');

  writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests will cover all new business logic. Integration tests will verify the API endpoints. E2E tests will cover the user flows affected by this change. Performance tests ensure no regression in response times.\n`, 'utf8');

  writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n| 2 | unit-tests | PR | ci.yml | Unit tests |\n\n## Promotion Policy\nAll tier-1 gates must pass before merge.\n\n## Rollback Policy\nAutomatic rollback if error rate exceeds threshold within 10 minutes.\n\n${filler}\n`, 'utf8');

  writeFileSync(join(changeDir, 'tasks.md'), [
    '---',
    `change-id: ${changeDir.split(/[/\\]/).pop()}`,
    'status: in-progress',
    '---',
    '',
    `# Tasks\n\n${filler}\n\n1. Implement the new user management API endpoints\n2. Add unit tests for all new business logic\n3. Update the API contract documentation\n4. Run integration tests against the test database\n5. Review changes with the team before merging\n`,
  ].join('\n'), 'utf8');
}

function writeContextGovernanceFiles(changeDir: string): void {
  const filler = 'This is a meaningful description of the context policy. '.repeat(4);
  writeFileSync(join(changeDir, 'tasks.md'), [
    '---',
    'change-id: test-change',
    'status: in-progress',
    'context-governance: v1',
    '---',
    '',
    '# Tasks',
    '',
    filler,
    '',
    '- [x] 1.1 Confirm classification and required artifacts',
    '- [x] 1.2 Confirm contracts to update',
    '- [x] 1.3 Confirm CI/CD gate plan',
  ].join('\n'), 'utf8');

  writeFileSync(join(changeDir, 'context-manifest.md'), [
    '# Context Manifest',
    '',
    filler,
    '',
    '## Allowed Paths',
    '- src/api/users.ts',
    '- specs/changes/test-change/',
    '',
    '## Approved Expansions',
    '-',
    '',
    '## Context Expansion Requests',
    '-',
  ].join('\n'), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

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
    expect(r.stderr + r.stdout).toMatch(/stub|appears to be/i);
  });

  it('3: gate with missing required file fails and names it', () => {
    runCli(['new', 'feat-002'], { cwd: tmpRepo, home: tmpHome });
    rmSync(join(tmpRepo, 'specs', 'changes', 'feat-002', 'tasks.md'));
    const r = runCli(['gate', 'feat-002'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/missing required artifact.*tasks\.md/i);
  });

  it('4: gate with classification missing tier marker fails', () => {
    runCli(['new', 'feat-003'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-003');
    const filler = 'This is a meaningful description. '.repeat(5);

    // Fill classification with content but NO tier marker
    writeFileSync(join(changeDir, 'change-classification.md'), `# Classification\n\n${filler}\n\nThis change affects the frontend module only. No database migrations required. Deployment is straightforward with no special procedures needed beyond the standard release process.\n`, 'utf8');

    // Fill the rest with adequate content
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature to support the new requirements. The change is additive only with no breaking changes to any existing APIs or data schemas.\n`, 'utf8');
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests will cover all new business logic paths. Integration tests verify the API endpoints work correctly. E2E tests cover all user-facing flows that are affected by this change.\n`, 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n${filler}\n\nAll existing CI gates must pass before merge. Additional integration test suite covering new endpoints. Deploy gate requires manual approval. Automated rollback if error rate exceeds threshold.\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.md'), `# Tasks\n\n${filler}\n\n1. Implement new endpoints\n2. Add unit tests\n3. Update documentation\n4. Run integration tests\n5. Team review before merging to main branch\n`, 'utf8');

    const r = runCli(['gate', 'feat-003'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/tier|risk marker/i);
  });

  it.skipIf(!hasPython())('5: gate on fully-filled change with valid contracts passes', () => {
    runCli(['new', 'feat-004'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-004');

    // Write valid change artifacts (> 100 meaningful chars each, with tier marker)
    writeValidChangeArtifacts(changeDir);

    // Write valid contracts so the validate sub-command passes
    writeValidContracts(tmpRepo);

    const r = runCli(['gate', 'feat-004'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/gate passed for change: feat-004/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // agent-log validation tests (v1.6.0)
  // ─────────────────────────────────────────────────────────────────────────

  it('6: gate passes with no agent-log/ dir (acceptable — no agents logged yet)', () => {
    runCli(['new', 'feat-005'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-005');
    writeValidChangeArtifacts(changeDir);
    // No agent-log dir created — should not block the gate (step 5 only validates when dir exists)
    // Gate will still fail at step 6 (contract validators) when contracts are absent,
    // so we only assert the agent-log error does NOT appear.
    const r = runCli(['gate', 'feat-005'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/agent-log/i);
  });

  it('7: gate passes with valid agent log (status: complete)', () => {
    runCli(['new', 'feat-006'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-006');
    writeValidChangeArtifacts(changeDir);

    // Write a valid agent log
    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-006',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- status: complete',
      '- artifacts:',
      '  - files-changed: src/api/users.ts:10-45',
      '  - tests-added: test/users.test.ts::should create user',
      '  - test-output: 5 passed',
      '  - contracts-touched: contracts/api/api-contract.md',
      '- next-action: none',
    ].join('\n'), 'utf8');

    // Gate will fail at contract-validator step (no contracts) but NOT at agent-log step
    const r = runCli(['gate', 'feat-006'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/missing or invalid.*status/i);
    expect(r.stdout + r.stderr).not.toMatch(/status=blocked/i);
  });

  it('8: gate fails on agent log missing status line', () => {
    runCli(['new', 'feat-007'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-007');
    writeValidChangeArtifacts(changeDir);

    // Write agent log WITHOUT a status line
    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-007',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- artifacts:',
      '  - files-changed: src/api/users.ts:10-45',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-007'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing or invalid.*status/i);
  });

  it('9: gate fails on status=blocked with empty next-action', () => {
    runCli(['new', 'feat-008'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-008');
    writeValidChangeArtifacts(changeDir);

    // Write agent log with status: blocked but next-action: none
    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-008',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- status: blocked',
      '- artifacts:',
      '  - files-changed: none',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-008'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/status=blocked.*next-action/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // --strict flag tests (Fix 1a + 1e)
  // ─────────────────────────────────────────────────────────────────────────

  it('10: gate without --strict: pending tasks produce warning but do NOT fail', () => {
    runCli(['new', 'feat-009'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-009');

    // Write all artifacts with sufficient content
    writeValidChangeArtifacts(changeDir);

    // Overwrite tasks.md with pending items (simulates in-progress work)
    writeFileSync(join(changeDir, 'tasks.md'), [
      '# Tasks: feat-009',
      '',
      '## 1. Preparation',
      '- [x] 1.1 Confirm classification',
      '- [ ] 1.2 Confirm contracts',
      '',
      '## 7. Archive',
      '- [ ] 7.1 Archive change',
      '- [ ] 7.2 Promote learnings',
    ].join('\n'), 'utf8');

    // Without --strict, pending tasks should only warn, not fail at this step
    // (gate may still fail at contract validator step, but NOT due to pending tasks)
    const r = runCli(['gate', 'feat-009'], { cwd: tmpRepo, home: tmpHome });
    // The gate may or may not pass overall (depends on contracts), but the
    // pending-tasks error message should NOT appear
    expect(r.stdout + r.stderr).not.toMatch(/task\(s\) still pending.*use \[-\]/i);
  });

  it('11: gate with --strict: pending non-archive tasks cause failure', () => {
    runCli(['new', 'feat-010'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-010');

    writeValidChangeArtifacts(changeDir);

    // Overwrite tasks.md with a pending non-archive item
    writeFileSync(join(changeDir, 'tasks.md'), [
      '# Tasks: feat-010',
      '',
      '## 1. Preparation',
      '- [x] 1.1 Confirm classification',
      '- [ ] 1.2 Confirm contracts',
      '',
      '## 7. Archive',
      '- [ ] 7.1 Archive change',
      '- [ ] 7.2 Promote learnings',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-010', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/task\(s\) still pending/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 1b: artifact pointer validation in --strict mode
  // ─────────────────────────────────────────────────────────────────────────

  it('13: gate --strict fails when agent-log artifact pointer references a missing file', () => {
    runCli(['new', 'feat-013'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-013');
    writeValidChangeArtifacts(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-013',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- status: complete',
      '- artifacts:',
      '  - test-plan-path: specs/changes/feat-013/does-not-exist.md',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-013', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/artifact pointer not found/i);
  });

  it('13b: gate --lax skips artifact pointer check (legacy escape hatch, PR-3 #6)', () => {
    runCli(['new', 'feat-013b'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-013b');
    writeValidChangeArtifacts(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-013b',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- status: complete',
      '- artifacts:',
      '  - test-plan-path: specs/changes/feat-013b/does-not-exist.md',
      '- next-action: none',
    ].join('\n'), 'utf8');

    // Default mode: missing pointer is now an error (PR-3 #6 flipped the default).
    const def = runCli(['gate', 'feat-013b'], { cwd: tmpRepo, home: tmpHome });
    expect(def.status).not.toBe(0);
    expect(def.stdout + def.stderr).toMatch(/artifact pointer not found/i);

    // --lax mode: skipped.
    const lax = runCli(['gate', 'feat-013b', '--lax'], { cwd: tmpRepo, home: tmpHome });
    expect(lax.stdout + lax.stderr).not.toMatch(/artifact pointer not found/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 1c: tier-based agent-log requirements
  // ─────────────────────────────────────────────────────────────────────────

  it('14: gate fails when Tier 1 change is missing required e2e/monkey/stress agent-logs', () => {
    runCli(['new', 'feat-014'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-014');

    // Write classification with new ## Tier\n- 1 format (Tier 1 = high-risk)
    const classificationContent = [
      '# Change Classification',
      '',
      '## Change Types',
      '- primary: feature',
      '- secondary: api',
      '',
      '## Risk Level',
      '- high',
      '',
      '## Tier',
      '- 1',
      '',
      '## Impact Radius',
      '- cross-module',
      '',
      'This is a high-risk change that touches multiple components and requires careful review. ',
      'The change introduces new API endpoints with authentication requirements. ',
      'All changes must be reviewed by the security team before deployment. ',
      'Performance testing is required before each deployment to production environment. ',
      'The change follows the established patterns for API development in this codebase. ',
    ].join('\n');
    writeFileSync(join(changeDir, 'change-classification.md'), classificationContent, 'utf8');

    const filler = 'This is a meaningful description of the change. '.repeat(4);
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature to support the new requirements. The change is additive only with no breaking changes.\n`, 'utf8');
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests will cover all new business logic. Integration tests verify the API endpoints. E2E tests cover all user-facing flows affected by this change.\n`, 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n\n## Promotion Policy\nAll tier-1 gates must pass before merge.\n\n## Rollback Policy\nAutomatic rollback on error. ${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.md'), `# Tasks\n\n${filler}\n\n1. Implement endpoints\n2. Add tests\n3. Update docs\n4. Integration tests\n5. Team review\n`, 'utf8');

    // Create agent-log with only backend-engineer — missing e2e, monkey, stress
    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-014',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- status: complete',
      '- artifacts:',
      '  - files-changed: src/api/users.ts',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-014'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/e2e-resilience-engineer/i);
    expect(r.stdout + r.stderr).toMatch(/monkey-test-engineer/i);
    expect(r.stdout + r.stderr).toMatch(/stress-soak-engineer/i);
  });

  it('14b: gate tier regex does NOT trigger on unfilled template placeholder (- 0 / 1 / 2 / 3 / 4 / 5)', () => {
    runCli(['new', 'feat-014b'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-014b');
    writeValidChangeArtifacts(changeDir);

    // Overwrite with classification that has the literal template placeholder (unfilled)
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
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-014b',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- status: complete',
      '- artifacts:',
      '  - files-changed: src/api/users.ts',
      '- next-action: none',
    ].join('\n'), 'utf8');

    // Literal template should NOT trigger tier-based agent-log requirement
    const r = runCli(['gate', 'feat-014b'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/e2e-resilience-engineer/i);
    expect(r.stdout + r.stderr).not.toMatch(/monkey-test-engineer/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 1d: per-artifact minimum char counts
  // ─────────────────────────────────────────────────────────────────────────

  it('15: gate fails when change-classification.md has fewer than 200 meaningful chars', () => {
    runCli(['new', 'feat-015'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015');

    // Write classification with ~110 meaningful chars (above 100-char threshold for tasks.md but below 200-char threshold for change-classification.md)
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
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature to support the new requirements. The change is additive only with no breaking changes.\n`, 'utf8');
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n\n${filler}\n\nUnit tests will cover all new business logic. Integration tests verify the API endpoints. E2E tests cover all user-facing flows affected by this change.\n`, 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n\n## Promotion Policy\nAll tier-1 gates must pass. ${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.md'), `# Tasks\n\n${filler}\n\n1. Implement endpoints\n2. Add tests\n3. Update docs\n`, 'utf8');

    const r = runCli(['gate', 'feat-015'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/change-classification\.md.*stub|stub.*change-classification\.md/i);
  });

  it('15b: gate fails when test-plan.md has fewer than 200 meaningful chars (same threshold as classification)', () => {
    runCli(['new', 'feat-015b'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-015b');

    const filler = 'This is a meaningful description of the change. '.repeat(4);
    writeFileSync(join(changeDir, 'change-classification.md'), `# Change Classification\n\n**Risk Level:** medium\n**Tier:** Tier 1\n\n${filler}\n\nThis change is classified as low risk. Rollback is straightforward by reverting the feature flag.\n`, 'utf8');
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n\n${filler}\n\nMotivation: We need to add this feature. The change is additive only.\n`, 'utf8');

    // Write test-plan.md with only ~150 meaningful chars (below 200 threshold)
    writeFileSync(join(changeDir, 'test-plan.md'), [
      '# Test Plan',
      '',
      'Unit tests will cover all new business logic paths.',
      'Integration tests will verify the API endpoints work.',
      'E2E tests will cover the main user flows.',
    ].join('\n'), 'utf8');

    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n\n## Promotion Policy\nAll tier-1 gates must pass. ${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.md'), `# Tasks\n\n${filler}\n\n1. Implement endpoints\n2. Add tests\n`, 'utf8');

    const r = runCli(['gate', 'feat-015b'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/test-plan\.md.*stub|stub.*test-plan\.md/i);
  });

  it('12: gate with --strict: only section-7 pending tasks are exempt from pending check', () => {
    runCli(['new', 'feat-011'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-011');

    writeValidChangeArtifacts(changeDir);

    // tasks.md where ONLY 7.x items are pending — non-archive all done
    // Must have enough meaningful chars to pass the 100-char stub threshold
    const filler = 'Completed task description with sufficient detail. '.repeat(3);
    writeFileSync(join(changeDir, 'tasks.md'), [
      `# Tasks: feat-011`,
      '',
      filler,
      '',
      '## 1. Preparation',
      '- [x] 1.1 Confirm classification and required artifacts',
      '- [x] 1.2 Confirm contracts to update',
      '- [x] 1.3 Confirm CI/CD gate plan',
      '',
      '## 2. Contract Updates',
      '- [x] 2.1 API contract updated successfully',
      '',
      '## 7. Archive',
      '- [ ] 7.1 Archive change',
      '- [ ] 7.2 Promote durable learnings to contracts or CLAUDE.md',
    ].join('\n'), 'utf8');

    // Strict mode but all non-archive tasks are done — pending check should pass
    // (gate may fail at contract validator, but NOT due to pending tasks)
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

  it('18: new context-governed change fails when agent-log omits files-read', () => {
    runCli(['new', 'feat-cg-files-read'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-files-read');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-cg-files-read',
      '- status: complete',
      '- artifacts:',
      '  - files-changed: src/api/users.ts:1',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-files-read'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing "- files-read:" section/i);
  });

  it('19: gate fails when files-read hits forbidden path', () => {
    runCli(['new', 'feat-cg-forbidden'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-forbidden');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-cg-forbidden',
      '- status: complete',
      '- files-read:',
      '  - node_modules/pkg/index.js',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-forbidden'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/read forbidden path -> node_modules\/pkg\/index\.js/i);
  });

  it('20: gate fails when files-read is outside manifest allowed paths', () => {
    runCli(['new', 'feat-cg-unauthorized'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-unauthorized');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-cg-unauthorized',
      '- status: complete',
      '- files-read:',
      '  - src/secret/file.ts',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-unauthorized'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/read unauthorized path -> src\/secret\/file\.ts/i);
  });

  it('21: gate allows approved expansion paths and current change paths', () => {
    runCli(['new', 'feat-cg-approved'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-approved');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);
    writeFileSync(join(changeDir, 'context-manifest.md'), [
      '# Context Manifest',
      '',
      '## Allowed Paths',
      '- specs/changes/feat-cg-approved/',
      '',
      '## Approved Expansions',
      '- src/secret/file.ts',
    ].join('\n'), 'utf8');

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-cg-approved',
      '- status: complete',
      '- files-read:',
      '  - src/secret/file.ts',
      '  - specs/changes/feat-cg-approved/test-plan.md',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-approved'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/read forbidden path -> specs\/changes\/feat-cg-approved/i);
    expect(r.stdout + r.stderr).not.toMatch(/read unauthorized path -> src\/secret\/file\.ts/i);
  });

  it('22: gate fails when context expansion request is pending', () => {
    runCli(['new', 'feat-cg-pending'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-pending');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);
    writeFileSync(join(changeDir, 'context-manifest.md'), [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '- status: pending',
      '  requested_paths:',
      '    - src/other/file.ts',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-pending'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/context-manifest\.md: has 1 pending context expansion request/i);
  });

  it('23: gate fails when files-read has malformed entries', () => {
    runCli(['new', 'feat-cg-bad-files-read'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-bad-files-read');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-cg-bad-files-read',
      '- status: complete',
      '- files-read:',
      'src/api/users.ts',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-bad-files-read'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid files-read entry format: src\/api\/users\.ts/i);
  });

  it('24: gate fails when files-read uses absolute or parent-traversal paths', () => {
    runCli(['new', 'feat-cg-invalid-paths'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-cg-invalid-paths');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-cg-invalid-paths',
      '- status: complete',
      '- files-read:',
      '  - C:/Users/example/secret.txt',
      '  - ../outside.txt',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cg-invalid-paths'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/files-read path must be repo-relative/i);
    expect(r.stdout + r.stderr).toMatch(/files-read path must not contain "\.\."/i);
  });

  it('25: gate blocks atomic changes when upstream dependency is still in progress', () => {
    runCli(['new', 'dep-db'], { cwd: tmpRepo, home: tmpHome });
    runCli(['new', 'feat-dependent', '--depends-on', 'dep-db'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-dependent');
    writeValidChangeArtifacts(changeDir);

    const tasksPath = join(changeDir, 'tasks.md');
    writeFileSync(tasksPath, [
      '---',
      'change-id: feat-dependent',
      'status: in-progress',
      'context-governance: v1',
      'depends-on: [dep-db]',
      '---',
      '',
      '# Tasks',
      '',
      'This change has enough task context to pass stub checks.',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-dependent'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/dependency dep-db: upstream change is not completed/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B1: tier source moved to tasks.md frontmatter (with classification fallback)
  // ─────────────────────────────────────────────────────────────────────────

  it('B1.1: tasks.md frontmatter `tier: 1` triggers tier-1 agent requirements', () => {
    runCli(['new', 'feat-fm-tier'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-fm-tier');
    writeValidChangeArtifacts(changeDir);

    // Replace tasks.md with frontmatter that sets tier: 1, no `## Tier` in classification.
    const filler = 'Description content. '.repeat(8);
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'change-id: feat-fm-tier',
      'status: in-progress',
      'tier: 1',
      'archive-tasks: ["7.1", "7.2"]',
      '---',
      '',
      '# Tasks',
      '',
      filler,
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-fm-tier'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/e2e-resilience-engineer/i);
    expect(r.stdout + r.stderr).toMatch(/monkey-test-engineer/i);
    expect(r.stdout + r.stderr).toMatch(/stress-soak-engineer/i);
  });

  it('B1.2: bold-only `**Tier:** Tier 1` no longer silently triggers enforcement (legacy warn)', () => {
    runCli(['new', 'feat-bold-legacy'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-bold-legacy');
    writeValidChangeArtifacts(changeDir);  // bold `**Tier:** Tier 1`

    // No `## Tier\n- N`, no frontmatter tier — legacy bold only.
    const r = runCli(['gate', 'feat-bold-legacy'], { cwd: tmpRepo, home: tmpHome });
    // Should NOT enforce tier-1 agent requirements since the source is bold-only.
    expect(r.stdout + r.stderr).not.toMatch(/Tier 1 change requires agent-log\/e2e-resilience-engineer/i);
    // But should warn about needing migration.
    expect(r.stdout + r.stderr).toMatch(/legacy format|set `tier:.*tasks\.md frontmatter/i);
  });

  it('B1.3: missing tier marker entirely fails gate (silent-skip prevention)', () => {
    runCli(['new', 'feat-no-tier'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-no-tier');

    const filler = 'Description content. '.repeat(8);
    // Classification with NO tier marker at all (no bold, no structured)
    writeFileSync(join(changeDir, 'change-classification.md'), [
      '# Change Classification',
      '',
      filler,
      '',
      'No tier mentioned anywhere in this file.',
    ].join('\n'), 'utf8');
    writeFileSync(join(changeDir, 'change-request.md'), `# Change Request\n${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'test-plan.md'), `# Test Plan\n${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'ci-gates.md'), `# CI Gates\n${filler}\n`, 'utf8');
    writeFileSync(join(changeDir, 'tasks.md'), `---\nchange-id: feat-no-tier\nstatus: in-progress\n---\n\n# Tasks\n${filler}\n`, 'utf8');

    const r = runCli(['gate', 'feat-no-tier'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing tier marker|missing tier\/risk marker/i);
  });

  it('B1.4: frontmatter tier wins over classification tier when both present (warn on drift)', () => {
    runCli(['new', 'feat-tier-drift'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-tier-drift');
    writeValidChangeArtifacts(changeDir);

    // Classification says structured Tier 2, frontmatter says Tier 4.
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
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'change-id: feat-tier-drift',
      'status: in-progress',
      'tier: 4',
      '---',
      '',
      '# Tasks',
      '',
      filler,
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-tier-drift'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/tier mismatch.*frontmatter says 4.*classification.*2/i);
    // tier 4 → no e2e/monkey/stress requirement
    expect(r.stdout + r.stderr).not.toMatch(/Tier 4 change requires agent-log\/e2e-resilience-engineer/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B2: archive-tasks frontmatter replaces hard-coded 7.[12]
  // ─────────────────────────────────────────────────────────────────────────

  it('B2.1: custom archive-tasks frontmatter exempts listed task IDs in --strict', () => {
    runCli(['new', 'feat-archive-custom'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-archive-custom');
    writeValidChangeArtifacts(changeDir);

    const filler = 'Completed task description. '.repeat(3);
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'change-id: feat-archive-custom',
      'status: in-progress',
      'tier: 3',
      'archive-tasks: ["8.1", "8.2", "8.3"]',
      '---',
      '',
      '# Tasks',
      '',
      filler,
      '',
      '## 1. Preparation',
      '- [x] 1.1 Done',
      '',
      '## 8. Close',
      '- [ ] 8.1 Archive',
      '- [ ] 8.2 Promote',
      '- [ ] 8.3 Notify',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-archive-custom', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/task\(s\) still pending/i);
  });

  it('B2.2: tasks not in archive-tasks list still trigger pending error in --strict', () => {
    runCli(['new', 'feat-archive-strict'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-archive-strict');
    writeValidChangeArtifacts(changeDir);

    const filler = 'Completed task description. '.repeat(3);
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'change-id: feat-archive-strict',
      'status: in-progress',
      'tier: 3',
      'archive-tasks: ["8.1"]',
      '---',
      '',
      '# Tasks',
      '',
      filler,
      '',
      '## 1. Preparation',
      '- [ ] 1.1 Pending non-archive task',
      '',
      '## 8. Close',
      '- [ ] 8.1 Archive (exempt)',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-archive-strict', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/1 task\(s\) still pending/i);
  });

  it('B2.3: missing archive-tasks frontmatter falls back to default 7.1, 7.2', () => {
    runCli(['new', 'feat-archive-default'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-archive-default');
    writeValidChangeArtifacts(changeDir);

    const filler = 'Completed task description. '.repeat(3);
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'change-id: feat-archive-default',
      'status: in-progress',
      'tier: 3',
      '---',
      '',
      '# Tasks',
      '',
      filler,
      '',
      '## 1. Preparation',
      '- [x] 1.1 Done',
      '',
      '## 7. Archive',
      '- [ ] 7.1 Archive',
      '- [ ] 7.2 Promote',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-archive-default', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/task\(s\) still pending/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PR-3 #3: tasks.md frontmatter lint
  // ─────────────────────────────────────────────────────────────────────────

  it('PR3-3.1: missing change-id in tasks.md frontmatter fails gate', () => {
    runCli(['new', 'feat-fm-no-change-id'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-fm-no-change-id');
    writeValidChangeArtifacts(changeDir);
    const filler = 'Description content. '.repeat(8);
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'status: in-progress',
      'tier: 3',
      '---',
      '',
      `# Tasks\n${filler}`,
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-fm-no-change-id'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing required `change-id`/i);
  });

  it('PR3-3.2: invalid status value fails gate', () => {
    runCli(['new', 'feat-fm-bad-status'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-fm-bad-status');
    writeValidChangeArtifacts(changeDir);
    const filler = 'Description content. '.repeat(8);
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'change-id: feat-fm-bad-status',
      'status: kinda-done',
      'tier: 3',
      '---',
      '',
      `# Tasks\n${filler}`,
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-fm-bad-status'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid status `kinda-done`/i);
  });

  it('PR3-3.3: typo `Tier:` (capital T) emits a typo-suggestion warning', () => {
    runCli(['new', 'feat-fm-typo'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-fm-typo');
    writeValidChangeArtifacts(changeDir);
    const filler = 'Description content. '.repeat(8);
    writeFileSync(join(changeDir, 'tasks.md'), [
      '---',
      'change-id: feat-fm-typo',
      'status: in-progress',
      'Tier: 1',  // capital T — wrong
      '---',
      '',
      `# Tasks\n${filler}`,
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-fm-typo'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/unknown key `Tier`.*did you mean `tier`/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PR-3 #4: depends-on cycle detection
  // ─────────────────────────────────────────────────────────────────────────

  it('PR3-4.1: 2-node depends-on cycle is detected', () => {
    runCli(['new', 'feat-cycle-a'], { cwd: tmpRepo, home: tmpHome });
    runCli(['new', 'feat-cycle-b'], { cwd: tmpRepo, home: tmpHome });
    const dirA = join(tmpRepo, 'specs', 'changes', 'feat-cycle-a');
    const dirB = join(tmpRepo, 'specs', 'changes', 'feat-cycle-b');
    writeValidChangeArtifacts(dirA);
    writeValidChangeArtifacts(dirB);

    // A depends on B
    writeFileSync(join(dirA, 'tasks.md'), [
      '---',
      'change-id: feat-cycle-a',
      'status: in-progress',
      'tier: 3',
      'depends-on: [feat-cycle-b]',
      '---',
      '',
      '# Tasks',
      'A description content here is enough to clear stub.'.repeat(3),
    ].join('\n'), 'utf8');
    // B depends on A → cycle
    writeFileSync(join(dirB, 'tasks.md'), [
      '---',
      'change-id: feat-cycle-b',
      'status: in-progress',
      'tier: 3',
      'depends-on: [feat-cycle-a]',
      '---',
      '',
      '# Tasks',
      'B description content here is enough to clear stub.'.repeat(3),
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-cycle-a'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/depends-on cycle detected.*feat-cycle-a.*feat-cycle-b.*feat-cycle-a/i);
  });

  it('PR3-4.2: 3-node A→B→C→A cycle is detected', () => {
    for (const id of ['cyc-a', 'cyc-b', 'cyc-c']) {
      runCli(['new', id], { cwd: tmpRepo, home: tmpHome });
      writeValidChangeArtifacts(join(tmpRepo, 'specs', 'changes', id));
    }
    const writeWithDep = (id: string, dep: string) => writeFileSync(
      join(tmpRepo, 'specs', 'changes', id, 'tasks.md'),
      [
        '---',
        `change-id: ${id}`,
        'status: in-progress',
        'tier: 3',
        `depends-on: [${dep}]`,
        '---',
        '',
        '# Tasks',
        'Description content padding here for stub.'.repeat(3),
      ].join('\n'),
      'utf8',
    );
    writeWithDep('cyc-a', 'cyc-b');
    writeWithDep('cyc-b', 'cyc-c');
    writeWithDep('cyc-c', 'cyc-a');

    const r = runCli(['gate', 'cyc-a'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/depends-on cycle detected/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PR-3 #6: artifact pointer validation default-on
  // ─────────────────────────────────────────────────────────────────────────

  it('PR3-6.1: missing artifact pointer fails gate by default (no --strict needed)', () => {
    runCli(['new', 'feat-default-pointer'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-default-pointer');
    writeValidChangeArtifacts(changeDir);
    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-default-pointer',
      '- status: complete',
      '- artifacts:',
      '  - test-plan-path: specs/changes/feat-default-pointer/missing.md',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-default-pointer'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/artifact pointer not found/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B3: runtime files-read reconciliation
  // ─────────────────────────────────────────────────────────────────────────

  it('B3.1: runtime log reads not declared in files-read produce a warning (non-strict)', () => {
    runCli(['new', 'feat-runtime-recon'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-runtime-recon');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-runtime-recon',
      '- status: complete',
      '- files-read:',
      '  - src/api/users.ts',
      '- next-action: none',
    ].join('\n'), 'utf8');

    // Runtime hook recorded an extra undeclared read.
    const runtimeDir = join(tmpRepo, '.cdd', 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'feat-runtime-recon-files-read.jsonl'), [
      '{"ts":"2026-04-29T00:00:00Z","change":"feat-runtime-recon","path":"src/api/users.ts"}',
      '{"ts":"2026-04-29T00:00:01Z","change":"feat-runtime-recon","path":"specs/changes/feat-runtime-recon/test-plan.md"}',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-runtime-recon'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/runtime log shows 1 read\(s\) not declared/i);
  });

  it('B3.2: runtime undeclared reads become errors in --strict mode', () => {
    runCli(['new', 'feat-runtime-strict'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-runtime-strict');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-runtime-strict',
      '- status: complete',
      '- files-read:',
      '  - src/api/users.ts',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const runtimeDir = join(tmpRepo, '.cdd', 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'feat-runtime-strict-files-read.jsonl'),
      '{"ts":"2026-04-29T00:00:00Z","change":"feat-runtime-strict","path":"src/secret.ts"}\n', 'utf8');

    const r = runCli(['gate', 'feat-runtime-strict', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/runtime log shows.*not declared/i);
  });

  it('B3.3: runtime log absent → no reconciliation, no warning', () => {
    runCli(['new', 'feat-no-runtime'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-no-runtime');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);

    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: feat-no-runtime',
      '- status: complete',
      '- files-read:',
      '  - src/api/users.ts',
      '- next-action: none',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'feat-no-runtime'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/runtime log shows/i);
  });

  it('26: gate allows atomic changes when upstream dependency is completed', () => {
    writeValidContracts(tmpRepo);
    runCli(['new', 'dep-api'], { cwd: tmpRepo, home: tmpHome });
    runCli(['new', 'feat-after-api', '--depends-on', 'dep-api'], { cwd: tmpRepo, home: tmpHome });

    const upstreamTasksPath = join(tmpRepo, 'specs', 'changes', 'dep-api', 'tasks.md');
    const upstreamTasks = readFileSync(upstreamTasksPath, 'utf8').replace('status: in-progress', 'status: completed');
    writeFileSync(upstreamTasksPath, upstreamTasks, 'utf8');

    const changeDir = join(tmpRepo, 'specs', 'changes', 'feat-after-api');
    writeValidChangeArtifacts(changeDir);
    writeContextGovernanceFiles(changeDir);
    const targetTasksPath = join(changeDir, 'tasks.md');
    const targetTasks = readFileSync(targetTasksPath, 'utf8')
      .replace('context-governance: v1', 'context-governance: v1\ndepends-on: [dep-api]');
    writeFileSync(targetTasksPath, targetTasks, 'utf8');

    const r = runCli(['gate', 'feat-after-api'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/dependency dep-api/i);
  });
});
