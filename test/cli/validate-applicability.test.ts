/**
 * `cdd-kit validate --contracts` end-to-end coverage of the `applicability`
 * marker (ADR 0011): AC-1 (skip + info note), AC-2 (unmarked stub still
 * hard-fails — the key regression guard), AC-3 (invalid marker hard-fails),
 * AC-7 (drift is a warning, not a failure). Mirrors the setup convention in
 * test/cli/validate-semantic.test.ts, including writing every OTHER required
 * contract with valid, non-stub content so a test only depends on the
 * contract it is actually exercising — never on the current shape of the
 * `cdd-kit init` template (which build.js deliberately ships WITHOUT the
 * marker — see build.js's APPLICABILITY_MARKED_TEMPLATES comment).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

function setupRepo(tmpRepo: string, tmpHome: string): void {
  const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
  if (r.status !== 0) throw new Error(`Setup init failed: ${r.stderr}`);
}

function writeContract(tmpRepo: string, relDir: string, fileName: string, content: string): void {
  mkdirSync(join(tmpRepo, ...relDir.split('/')), { recursive: true });
  writeFileSync(join(tmpRepo, ...relDir.split('/'), fileName), content, 'utf8');
}

/** A CSS contract with the given extra frontmatter lines. CSS has no dedicated
 * semantic validator, so it is the cleanest surface to exercise
 * validate_contracts.py's presence/stub branch in isolation. */
function buildCssContract(extraFrontmatter: string[], body: string): string {
  return [
    '---',
    'contract: css',
    'schema-version: 0.1.0',
    'last-changed: 2026-04-27',
    ...extraFrontmatter,
    '---',
    '',
    '# CSS / UI Contract',
    '',
    body,
  ].join('\n');
}

const VALID_API_CONTRACT = [
  '---', 'contract: api', 'schema-version: 0.1.0', 'last-changed: 2026-04-27', '---', '',
  '# API Contract', '',
  '## API Style',
  '- response style: JSON REST with envelope { data, error, meta }',
  '- error style: { code, message, details[] }',
  '- auth style: Bearer JWT in Authorization header',
  '',
  '## Endpoint Requirements',
  '| method | path | auth | request schema | response schema | errors | tests |',
  '|---|---|---|---|---|---|---|',
  '| GET | /v2/ping | none | - | Pong | - | yes |',
  '| POST | /v2/users | required | CreateUserReq | User | 400,409 | yes |',
  '',
  '## Error Format', '{ "code": "VALIDATION_ERROR", "message": "human readable", "details": [] }', '',
  '## Compatibility Policy', 'No breaking changes without a major version bump. Deprecation notices 60 days before removal.', '',
  '## Endpoint Inventory Policy', 'All endpoints must appear in this contract before implementation.', '',
  '## Breaking Change Policy', 'Breaking changes require RFC and migration guide before merging.',
].join('\n');

const VALID_BUSINESS_CONTRACT = [
  '---', 'contract: business', 'schema-version: 0.1.0', '---', '',
  '# Business Rules', '',
  'Authentication: Users must verify email before accessing protected resources.',
  'Authorization: Role-based access control. Admin role required for user management.',
  'Rate Limiting: 100 req/min per user, 1000 req/min per IP for public endpoints.',
  'Data Retention: User data retained 7 years per compliance. Soft-delete with 30-day recovery.',
  'Billing: Monthly subscription. Proration on plan changes. Grace period 7 days on payment failure.',
  'Notifications: Email on account events. Webhook support for enterprise. Push notifications opt-in.',
  'Content Policy: User content moderated. DMCA compliance. Automated spam detection.',
  'SLA: 99.9% uptime commitment. Less than 200ms p95 API response. Incident response under 15 minutes.',
].join('\n');

const VALID_DATA_CONTRACT = [
  '---', 'contract: data', 'schema-version: 0.1.0', '---', '',
  '# Data Shape Contract', '',
  'User: { id: UUID, email: string, name: string, role: admin|user, createdAt: ISO8601 }',
  'Post: { id: UUID, title: string, body: string, authorId: UUID, publishedAt: ISO8601|null }',
  'Comment: { id: UUID, body: string, postId: UUID, authorId: UUID, createdAt: ISO8601 }',
  'Pagination: { data: T[], meta: { total: int, page: int, per_page: int, next_cursor: string|null } }',
  'Error: { code: string, message: string, details: ErrorDetail[] }',
  'ErrorDetail: { field: string, message: string, code: string }',
  'Database: PostgreSQL 15. ORM: Prisma. Migrations: prisma migrate.',
  'Caching: Redis for sessions and rate-limit counters.',
].join('\n');

/** Overwrite every REQUIRED contract other than `except_` with valid, filled
 * content so only the contract actually under test can affect the result —
 * never the current (unmarked) shape of the `cdd-kit init` template. */
function writeOtherContractsValid(tmpRepo: string, except_: 'api' | 'css'): void {
  if (except_ !== 'api') writeContract(tmpRepo, 'contracts/api', 'api-contract.md', VALID_API_CONTRACT);
  if (except_ !== 'css') {
    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract([], [
      'Using Tailwind CSS v3 with custom design tokens.',
      'Typography: Inter font family, sizes sm/base/lg/xl/2xl.',
      'Colors: primary #3B82F6, secondary #6B7280, danger #EF4444, success #10B981.',
      'Spacing: 4px base unit grid. Breakpoints: sm:640px md:768px lg:1024px xl:1280px.',
      'Component library: Headless UI + custom components in src/components/.',
      'Dark mode: class-based via .dark prefix.',
      'Animation: Framer Motion for transitions, CSS for micro-interactions.',
      'Accessibility: WCAG 2.1 AA compliance required. All interactive elements keyboard-navigable.',
    ].join('\n')));
  }
  writeContract(tmpRepo, 'contracts/business', 'business-rules.md', VALID_BUSINESS_CONTRACT);
  writeContract(tmpRepo, 'contracts/data', 'data-shape-contract.md', VALID_DATA_CONTRACT);
}

describe.skipIf(!hasPython())('validate --contracts — applicability marker (ADR 0011)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-applicability-validate-repo-');
    tmpHome = makeTempDir('cdd-applicability-validate-home-');
    setupRepo(tmpRepo, tmpHome);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  // ── AC-1: marked + reason -> skip, info note ────────────────────────────────
  it('skips a not-applicable CSS contract and prints an info note naming the surface + reason', () => {
    writeOtherContractsValid(tmpRepo, 'css');
    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract(
      ['applicability: not-applicable', 'applicability-reason: no CSS/UI surface'],
      '', // empty body -- would otherwise hard-fail the stub check
    ));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/contracts\/css\/css-contract\.md marked applicability: not-applicable \(no CSS\/UI surface\)/);
  });

  it('self-skips the API semantic chain when the API contract is not-applicable', () => {
    writeOtherContractsValid(tmpRepo, 'api');
    writeContract(tmpRepo, 'contracts/api', 'api-contract.md', [
      '---',
      'contract: api',
      'schema-version: 0.1.0',
      'applicability: not-applicable',
      'applicability-reason: no HTTP API surface',
      '---',
      '',
      '# API Contract',
    ].join('\n'));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/API contract marked applicability: not-applicable \(no HTTP API surface\) — semantic check skipped/);
  });

  // ── AC-2: unmarked empty stub still hard-fails (regression guard) ──────────
  it('an unmarked empty CSS stub still hard-fails (must not weaken)', () => {
    writeOtherContractsValid(tmpRepo, 'css');
    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract([], ''));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contracts present but appear empty/i);
    expect(r.stdout + r.stderr).toMatch(/css-contract\.md/);
  });

  // ── AC-3: invalid marker -> hard error ──────────────────────────────────────
  it('hard-fails a not-applicable marker with no reason', () => {
    writeOtherContractsValid(tmpRepo, 'css');
    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract(
      ['applicability: not-applicable'],
      'Some real content here so the stub check alone would not be the failure reason. '.repeat(6),
    ));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid applicability marker/i);
    expect(r.stdout + r.stderr).toMatch(/applicability-reason/i);
  });

  it('hard-fails an unrecognized applicability value rather than passing silently', () => {
    writeOtherContractsValid(tmpRepo, 'css');
    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract(
      ['applicability: not-applicable-typo', 'applicability-reason: whatever'],
      'Some real content here so the stub check alone would not be the failure reason. '.repeat(6),
    ));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid applicability marker/i);
    expect(r.stdout + r.stderr).toMatch(/unrecognized applicability value/i);
  });

  // ── AC-7: drift is a warning, never a failure ───────────────────────────────
  it('warns (not fails) when a not-applicable contract body now looks filled', () => {
    writeOtherContractsValid(tmpRepo, 'css');
    const filledBody = Array.from({ length: 20 }, (_, i) =>
      `Real substantive rule number ${i}: this line pretends the CSS contract body was actually filled in by a human.`,
    ).join('\n');
    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract(
      ['applicability: not-applicable', 'applicability-reason: no CSS/UI surface'],
      filledBody,
    ));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/Warning:.*css-contract\.md/i);
    expect(r.stdout).toMatch(/looks filled/i);
  });
});
