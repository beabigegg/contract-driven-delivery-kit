import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

describe.skipIf(!hasPython())('cdd-kit validate', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-validate-repo-');
    tmpHome = makeTempDir('cdd-validate-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('validate after init exits non-zero on placeholder contracts', () => {
    // First-run on placeholder contracts must fail loudly so users cannot
    // accidentally ship before filling in the contract surfaces.
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/appear empty|fill them in/i);
  });

  it('validate --contracts only runs contracts validator (flag scoping)', () => {
    // Status is non-zero on placeholder contracts; this test verifies the
    // --contracts flag scopes execution to the contracts validator only,
    // independent of pass/fail outcome.
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout).toMatch(/contract/i);
    expect(r.stdout).not.toMatch(/env contract|CI gates|spec traceability/i);
  });

  it('validate --ci --spec runs CI-gates and spec-traceability validators only', () => {
    const r = runCli(['validate', '--ci', '--spec'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    // Should mention CI gates and spec traceability
    expect(r.stdout).toMatch(/CI gates|ci gates/i);
    expect(r.stdout).toMatch(/spec traceability/i);
    // Should NOT run contracts or env
    expect(r.stdout).not.toMatch(/Validating contracts/i);
    expect(r.stdout).not.toMatch(/Validating env/i);
  });

  it('validate --contracts exits 0 when contracts have sufficient content', () => {
    // Append enough real content to api-contract.md to exceed the 470-char threshold
    const contractPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');
    const realContent = `
## API Style
- response style: JSON REST with envelope { data, error, meta }
- error style: { code, message, details[] }
- auth style: Bearer JWT in Authorization header
- pagination style: cursor-based with { next_cursor, has_more }
- date/time style: ISO 8601 UTC

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /api/v1/users | required | - | UserList | 401, 403 | users.spec.ts |
| POST | /api/v1/users | required | CreateUserRequest | User | 400, 409 | users.spec.ts |
| GET | /api/v1/users/:id | required | - | User | 401, 404 | users.spec.ts |
| PUT | /api/v1/users/:id | required | UpdateUserRequest | User | 400, 404 | users.spec.ts |
| DELETE | /api/v1/users/:id | admin | - | - | 401, 403, 404 | users.spec.ts |

## Error Format
{ "code": "VALIDATION_ERROR", "message": "human readable", "details": [] }

## Compatibility Policy
No breaking changes without a major version bump. Deprecation notices 60 days before removal.

## Endpoint Inventory Policy
All endpoints must appear in this contract before implementation.

## Breaking Change Policy
Breaking changes require RFC and migration guide before merging.
`;
    appendFileSync(contractPath, realContent, 'utf8');

    // Also fill in the other required contracts with enough content
    const cssPath = join(tmpRepo, 'contracts', 'css', 'css-contract.md');
    const cssContent = `
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
    appendFileSync(cssPath, cssContent, 'utf8');

    const envPath = join(tmpRepo, 'contracts', 'env', 'env-contract.md');
    const envContent = `
## Variables
| name | scope | environments | required | secret | default | example | owner | validation | restart required | failure behavior |
| DATABASE_URL | backend | all | true | true | - | postgres://localhost/app | backend-team | valid postgres URI | yes | crash |
| JWT_SECRET | backend | all | true | true | - | 32-char-random | backend-team | min 32 chars | yes | crash |
| VITE_API_URL | frontend | all | true | false | http://localhost:3000 | https://api.example.com | frontend-team | valid URL | no | use default |
`;
    appendFileSync(envPath, envContent, 'utf8');

    const dataPath = join(tmpRepo, 'contracts', 'data', 'data-shape-contract.md');
    const dataContent = `
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
    appendFileSync(dataPath, dataContent, 'utf8');

    const bizPath = join(tmpRepo, 'contracts', 'business', 'business-rules.md');
    const bizContent = `
## Business Rules
Authentication: Users must verify email before accessing protected resources.
Authorization: Role-based access control. Admin role required for user management.
Rate Limiting: 100 req/min per user, 1000 req/min per IP for public endpoints.
Data Retention: User data retained 7 years per compliance. Soft-delete with 30-day recovery.
Billing: Monthly subscription. Proration on plan changes. Grace period 7 days on payment failure.
Notifications: Email on account events. Webhook support for enterprise. Push notifications opt-in.
Content Policy: User content moderated. DMCA compliance. Automated spam detection.
SLA: 99.9% uptime commitment. < 200ms p95 API response. Incident response < 15min.
`;
    appendFileSync(bizPath, bizContent, 'utf8');

    const ciPath = join(tmpRepo, 'contracts', 'ci', 'ci-gate-contract.md');
    const ciContent = `
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
Automatic rollback if error rate > 1% within 10 min of deploy. Manual rollback available.
`;
    appendFileSync(ciPath, ciContent, 'utf8');

    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    // Should NOT show placeholder warning
    expect(r.stdout).not.toMatch(/appear empty/i);
    expect(r.stdout).toMatch(/All required contract files are present/i);
  });

  it('validate with empty PATH cannot find Python and exits non-zero with clear error', () => {
    // Simulate Python not in PATH by passing an empty PATH
    const r = runCli(['validate'], {
      cwd: tmpRepo,
      home: tmpHome,
      env: { PATH: '' },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/python|not found/i);
  });
});
