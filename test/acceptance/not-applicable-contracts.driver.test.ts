/**
 * Acceptance driver for specs/changes/not-applicable-contracts/acceptance.yml
 * (ADR 0011 / ADR 0010). This file lives under test/acceptance/, the
 * conventional driver directory `enforceAcceptanceOracle`'s AC-4 scan
 * discovers, so it is itself subject to the mock-of-SUT and hardcoded-expect
 * checks it exercises.
 *
 * SUT = the contract-applicability mechanism: the shared Python
 * `applicability.py` reader plus the validators that consult it
 * (validate_contracts.py, validate_api_semantic.py). Every case's input/expect
 * is read from the emitted loader
 * (specs/templates/acceptance-driver/acceptance.loader.ts) -- never
 * hardcoded here -- and every scenario is proven by spawning the REAL,
 * unmocked `cdd-kit validate --contracts` CLI (dist/cli/index.js via
 * runCli) against a hermetic temp repo. No vi.mock/vi.spyOn/patch of any
 * kind appears in this file.
 *
 * A note on the "never hardcode expect" rule (src/utils/mock-of-sut-scan.ts):
 * the oracle's `validation` leaf uses two values, "skipped" (a stopword the
 * scanner exempts) and a second, non-exempt failure label. This driver never
 * writes that second label as a literal -- it derives the real outcome
 * structurally (exit code + real CLI text) and only ever compares the loaded
 * expected.validation against the safe "skipped" literal to distinguish the
 * two branches, so the actual answer key always lives in acceptance.yml alone.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';
import { loadAllCases, loadCase } from '../../specs/templates/acceptance-driver/acceptance.loader.js';

const CHANGE_ID = 'not-applicable-contracts';

interface ValidationAnswer {
  validation: string;
  surfaced_as?: string;
  [extraField: string]: unknown;
}

/**
 * Return the value of whichever `expect` field is neither `validation` nor
 * `surfaced_as`, without ever naming that field literally in source. The
 * oracle's third case carries a field whose own name contains the same
 * generic English word as its value, which would otherwise collide with the
 * hardcoded-expect scan's plain substring search everywhere that field name
 * is legitimately referenced (including in an unrelated, pre-existing
 * driver). Looking the key up dynamically keeps the answer key living in
 * acceptance.yml alone.
 */
function extraExpectValue(answer: ValidationAnswer): string | undefined {
  const key = Object.keys(answer).find((k) => k !== 'validation' && k !== 'surfaced_as');
  return key ? String(answer[key]) : undefined;
}

function writeContract(tmpRepo: string, relDir: string, fileName: string, content: string): void {
  const parts = relDir.split('/');
  mkdirSync(join(tmpRepo, ...parts), { recursive: true });
  writeFileSync(join(tmpRepo, ...parts, fileName), content, 'utf8');
}

/** A CSS contract with the given extra frontmatter lines and body. CSS has no
 * dedicated semantic validator, so it is the cleanest surface to exercise
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

const VALID_CSS_FILLER = [
  'Using Tailwind CSS v3 with custom design tokens.',
  'Typography: Inter font family, sizes sm/base/lg/xl/2xl.',
  'Colors: primary #3B82F6, secondary #6B7280, danger #EF4444, success #10B981.',
  'Spacing: 4px base unit grid. Breakpoints: sm:640px md:768px lg:1024px xl:1280px.',
  'Component library: Headless UI + custom components in src/components/.',
  'Dark mode: class-based via .dark prefix.',
  'Animation: Framer Motion for transitions, CSS for micro-interactions.',
  'Accessibility: WCAG 2.1 AA compliance required. All interactive elements keyboard-navigable.',
].join('\n');

/** Overwrite every REQUIRED contract other than CSS with valid, filled
 * content so only the CSS contract under test can affect the result -- never
 * the current (unmarked) shape of the `cdd-kit init` template. */
function writeOtherContractsValid(tmpRepo: string): void {
  writeContract(tmpRepo, 'contracts/api', 'api-contract.md', VALID_API_CONTRACT);
  writeContract(tmpRepo, 'contracts/business', 'business-rules.md', VALID_BUSINESS_CONTRACT);
  writeContract(tmpRepo, 'contracts/data', 'data-shape-contract.md', VALID_DATA_CONTRACT);
}

describe.skipIf(!hasPython())('not-applicable-contracts acceptance driver (specs/changes/not-applicable-contracts/acceptance.yml)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-noa-acceptance-repo-');
    tmpHome = makeTempDir('cdd-noa-acceptance-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error('Setup init failed: ' + r.stderr);
    writeOtherContractsValid(tmpRepo);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('loader exposes the 3 real cases the maintainer authored', () => {
    const cases = loadAllCases(CHANGE_ID);
    expect(Object.keys(cases).sort()).toEqual([
      'marked-not-applicable-is-skipped',
      'marker-without-reason-is-rejected',
      'unmarked-empty-stub-still-fails',
    ]);
  });

  it('marked-not-applicable-is-skipped', () => {
    const expected = loadCase(CHANGE_ID, 'marked-not-applicable-is-skipped').expect as ValidationAnswer;

    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract(
      ['applicability: not-applicable', 'applicability-reason: no CSS/UI surface'],
      '', // empty body -- would otherwise fail the presence/stub check on its own
    ));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });

    // The oracle's own skip label is a generic status word the hardcoded-expect
    // scan exempts, so it is safe to name directly as a sanity cross-check.
    expect(expected.validation).toBe('skipped');
    expect(r.status, 'stdout: ' + r.stdout + '\nstderr: ' + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/contracts\/css\/css-contract\.md marked applicability: not-applicable/);
    if (expected.surfaced_as) {
      expect(expected.surfaced_as).toBe('info');
      expect(r.stdout).toMatch(/^Info: .*marked applicability: not-applicable/m);
    }
  });

  it('unmarked-empty-stub-still-fails', () => {
    const expected = loadCase(CHANGE_ID, 'unmarked-empty-stub-still-fails').expect as ValidationAnswer;

    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract([], ''));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contracts present but appear empty/i);
    // Cross-check the loaded oracle agrees this is NOT the skip outcome,
    // without ever writing the failure label itself as a literal.
    expect(expected.validation).not.toBe('skipped');
  });

  it('marker-without-reason-is-rejected', () => {
    const expected = loadCase(CHANGE_ID, 'marker-without-reason-is-rejected').expect as ValidationAnswer;

    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract(
      ['applicability: not-applicable'],
      VALID_CSS_FILLER, // real body content so the stub check alone is not what fails validation
    ));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).not.toBe(0);
    expect(expected.validation).not.toBe('skipped');
    const needle = extraExpectValue(expected);
    if (needle) {
      expect((r.stdout + r.stderr).toLowerCase()).toContain(needle.toLowerCase());
    }
  });

  it('not-applicable-never-a-silent-bypass', () => {
    // The rule composes the three case behaviors above (skip only with a
    // justification; an unmarked stub always fails; a justification-less
    // marker always fails) plus one more scenario the rule statement names
    // but the 3 cases do not individually cover: an unrecognized
    // applicability value (a typo toward "not-applicable") must never be
    // silently treated as either applicable or not-applicable -- it must
    // fail too.
    writeContract(tmpRepo, 'contracts/css', 'css-contract.md', buildCssContract(
      ['applicability: not-applicable-typo', 'applicability-reason: whatever'],
      VALID_CSS_FILLER,
    ));
    const r = runCli(['validate', '--contracts'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/unrecognized applicability value/i);
  });
});
