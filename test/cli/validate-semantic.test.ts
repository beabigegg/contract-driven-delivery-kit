import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal but valid API contract with the given endpoint rows. */
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

/** Build a minimal env contract with the given variable rows. */
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

/**
 * Set up a tmpRepo with a full init (global-only avoided so it's quick),
 * then overwrite the specific contract files as needed.
 */
function setupRepo(tmpRepo: string, tmpHome: string): void {
  const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
  if (r.status !== 0) {
    throw new Error(`Setup init failed: ${r.stderr}`);
  }
}

function writeApiContract(tmpRepo: string, content: string): void {
  mkdirSync(join(tmpRepo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'api', 'api-contract.md'), content, 'utf8');
}

function writeEnvContract(tmpRepo: string, content: string): void {
  mkdirSync(join(tmpRepo, 'contracts', 'env'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'env', 'env-contract.md'), content, 'utf8');
}

/**
 * Write all non-API contracts with enough content to pass the basic
 * placeholder check (> 470 meaningful chars). Called when a test only
 * cares about the API contract but still needs the full suite to pass.
 */
function writeOtherContractsValid(tmpRepo: string): void {
  const cssContent = `---
contract: css
schema-version: 0.1.0
last-changed: 2026-04-27
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
  writeEnvContract(tmpRepo, envContent);

  const dataContent = `---
contract: data
schema-version: 0.1.0
last-changed: 2026-04-27
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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasPython())('validate-semantic — API contract', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-semantic-repo-');
    tmpHome = makeTempDir('cdd-semantic-home-');
    setupRepo(tmpRepo, tmpHome);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('valid API endpoint table passes (exit 0)', () => {
    // Write all contracts with sufficient content so the basic placeholder check passes
    writeOtherContractsValid(tmpRepo);
    const content = buildApiContract([
      '| GET | /api/v1/users | required | - | UserList | 401,403 | users.spec.ts |',
      '| POST | /api/v1/users | required | CreateUserReq | User | 400,409 | users.spec.ts |',
      '| DELETE | /api/v1/users/:id | admin | - | - | 401,403,404 | users.spec.ts |',
    ]);
    writeApiContract(tmpRepo, content);
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    // All three validators (contracts + API semantic + Env semantic) must pass
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/API semantic validation passed/i);
    expect(r.stdout).toMatch(/Env semantic validation passed/i);
  });

  it('API endpoint with invalid method FETCH fails and mentions FETCH', () => {
    const content = buildApiContract([
      '| GET | /api/v1/users | required | - | UserList | 401 | users.spec.ts |',
      '| FETCH | /api/v1/data | required | - | Data | 400 | data.spec.ts |',
    ]);
    writeApiContract(tmpRepo, content);
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/FETCH/);
  });

  it('API endpoint with path not starting with / fails', () => {
    const content = buildApiContract([
      '| GET | api/v1/users | required | - | UserList | 401 | users.spec.ts |',
    ]);
    writeApiContract(tmpRepo, content);
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/does not start with/i);
  });

  it('API contract with no endpoint table fails with "no endpoint table found"', () => {
    const noTableContent = `---
contract: api
schema-version: 0.1.0
last-changed: 2026-04-27
---

# API Contract

## API Style
- response style: JSON REST
- error style: envelope
- auth style: Bearer JWT

## Endpoint Requirements
No table here — just some prose describing the endpoints. Lorem ipsum dolor sit amet.
This file has enough content to pass the basic placeholder check but no actual table.
Adding more text here to make the content exceed the 470-char threshold for the basic check.
The basic contracts validator counts meaningful characters; this text adds to that count.
All endpoints follow RESTful conventions with standard HTTP verbs and status codes.
No breaking changes without a major version bump per the compatibility policy below.

## Error Format
Standard envelope error format.

## Compatibility Policy
No breaking changes without a major version bump.

## Endpoint Inventory Policy
All endpoints must appear in this contract before implementation.

## Breaking Change Policy
Breaking changes require RFC and migration guide before merging.
`;
    writeApiContract(tmpRepo, noTableContent);
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no endpoint table found/i);
  });
});

describe.skipIf(!hasPython())('validate-semantic — Env contract', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-env-semantic-repo-');
    tmpHome = makeTempDir('cdd-env-semantic-home-');
    setupRepo(tmpRepo, tmpHome);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('env variable with secret=true and non-empty default fails and names the variable', () => {
    // SECRET_KEY has secret=true and a default value "foobar" → must fail
    const content = buildEnvContract([
      '| SECRET_KEY | backend | all | true | true | foobar | - | backend | non-empty | yes | crash |',
      '| DB_URL | backend | all | true | true | - | postgres://localhost | backend | valid URI | yes | crash |',
    ]);
    writeEnvContract(tmpRepo, content);
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    // Must name the offending variable
    expect(r.stdout + r.stderr).toMatch(/SECRET_KEY/);
    expect(r.stdout + r.stderr).toMatch(/secret.*default|default.*secret/i);
  });
});
