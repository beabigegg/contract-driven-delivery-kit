import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
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

  writeFileSync(join(changeDir, 'tasks.md'), `# Tasks\n\n${filler}\n\n1. Implement the new user management API endpoints\n2. Add unit tests for all new business logic\n3. Update the API contract documentation\n4. Run integration tests against the test database\n5. Review changes with the team before merging\n`, 'utf8');
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
});
