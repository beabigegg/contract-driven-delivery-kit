import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';
import { computeAcceptanceHash, writeAcceptanceLock, type AcceptanceFile } from '../../src/utils/acceptance-hash.js';

// Integration coverage for enforceAcceptanceOracle (ADR 0010; gate-acceptance.ts)
// per test-plan.md AC-1/AC-2 rows. Mirrors the fixture-building conventions of
// test/cli/gate.test.ts (writeValidChangeArtifacts/writeValidContracts) -- those
// helpers are file-local there, so this file carries its own minimal copies.

function buildApiContract(rows: string[]): string {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|--------|------|------|----------------|-----------------|--------|-------|',
    ...rows,
  ].join('\n');
  return '---\ncontract: api\nschema-version: 0.1.0\nlast-changed: 2026-04-27\nbreaking-change-policy: deprecate-2-minors\n---\n\n# API Contract\n\n## API Style\n- response style: JSON REST\n- error style: envelope\n- auth style: Bearer JWT\n\n## Endpoint Requirements\n' + table + '\n\n## Error Format\nStandard envelope.\n\n## Compatibility Policy\nNo breaking changes without a major version bump.\n\n## Endpoint Inventory Policy\nAll endpoints must appear here.\n\n## Breaking Change Policy\nRFC required.\n';
}

function buildEnvContract(rows: string[]): string {
  const table = [
    '| name | scope | environments | required | secret | default | example | owner | validation | restart required | failure behavior |',
    '|------|-------|--------------|----------|--------|---------|---------|-------|------------|------------------|------------------|',
    ...rows,
  ].join('\n');
  return '---\ncontract: env\nschema-version: 0.1.0\nlast-changed: 2026-04-27\nbreaking-change-policy: deprecate-2-minors\n---\n\n# Env Contract\n\n' + table + '\n\n## Public Frontend Env Policy\nVITE_ variables are browser-exposed.\n\n## Secret Policy\nSecrets must not have defaults.\n\n## Deployment Sync Policy\nAll vars must be set before deploy.\n';
}

function writeValidContracts(tmpRepo: string): void {
  const cssContent = '---\ncontract: css\nschema-version: 0.1.0\nlast-changed: 2026-04-27\nbreaking-change-policy: deprecate-2-minors\n---\n\n# CSS Contract\n\n## Design System\nUsing Tailwind CSS v3 with custom design tokens.\nTypography: Inter font family, sizes sm/base/lg/xl/2xl.\nColors: primary #3B82F6, secondary #6B7280, danger #EF4444, success #10B981.\nSpacing: 4px base unit grid. Breakpoints: sm:640px md:768px lg:1024px xl:1280px.\nComponent library: Headless UI + custom components in src/components/.\nDark mode: class-based via .dark prefix.\nAnimation: Framer Motion for transitions, CSS for micro-interactions.\nAccessibility: WCAG 2.1 AA compliance required. All interactive elements keyboard-navigable.\n';
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
    '| GET | /api/v1/orders | required | - | OrderList | 401,403 | orders.spec.ts |',
    '| POST | /api/v1/orders | required | CreateOrderReq | Order | 400,409 | orders.spec.ts |',
    '| DELETE | /api/v1/orders/:id | admin | - | - | 401,403,404 | orders.spec.ts |',
  ]);
  mkdirSync(join(tmpRepo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'api', 'api-contract.md'), apiContent, 'utf8');

  const dataContent = '---\ncontract: data\nschema-version: 0.1.0\nlast-changed: 2026-04-27\nbreaking-change-policy: deprecate-2-minors\n---\n\n# Data Shape Contract\n\n## Data Shapes\nOrder: { id: UUID, customer_limit: int, order_amount: int, status: string, createdAt: ISO8601 }\nOrderLine: { id: UUID, orderId: UUID, sku: string, quantity: int, unitPrice: decimal }\nCustomer: { id: UUID, email: string, name: string, creditLimit: int }\nPagination: { data: T[], meta: { total: int, page: int, per_page: int, next_cursor: string|null } }\nError: { code: string, message: string, details: ErrorDetail[] }\nErrorDetail: { field: string, message: string, code: string }\nDatabase: PostgreSQL 15. ORM: Prisma. Migrations: prisma migrate.\nCaching: Redis for sessions and rate-limit counters.\n';
  mkdirSync(join(tmpRepo, 'contracts', 'data'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'data', 'data-shape-contract.md'), dataContent, 'utf8');

  const bizContent = '---\ncontract: business\nschema-version: 0.1.0\nlast-changed: 2026-04-27\nbreaking-change-policy: deprecate-2-minors\n---\n\n# Business Rules\n\nAuthentication: Users must verify email before accessing protected resources.\nAuthorization: Role-based access control. Admin role required for order management.\nRate Limiting: 100 req/min per user, 1000 req/min per IP for public endpoints.\nData Retention: Order data retained 7 years per compliance. Soft-delete with 30-day recovery.\nBilling: Monthly subscription. Proration on plan changes. Grace period 7 days on payment failure.\nNotifications: Email on account events. Webhook support for enterprise. Push notifications opt-in.\nContent Policy: User content moderated. DMCA compliance. Automated spam detection.\nSLA: 99.9% uptime commitment. Less than 200ms p95 API response. Incident response under 15 minutes.\n';
  mkdirSync(join(tmpRepo, 'contracts', 'business'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'business', 'business-rules.md'), bizContent, 'utf8');

  const ciContent = '---\ncontract: ci\nschema-version: 0.1.0\nlast-changed: 2026-04-27\nbreaking-change-policy: deprecate-2-minors\n---\n\n# CI Gate Contract\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | ESLint + TypeScript type check |\n| 1 | unit-tests | PR | ci.yml | Vitest unit tests, coverage >= 80% |\n| 2 | integration | PR | ci.yml | Integration tests against test DB |\n| 3 | e2e | merge to main | e2e.yml | Playwright E2E smoke tests |\n| 4 | deploy-staging | merge to main | deploy.yml | Auto-deploy to staging |\n| 5 | deploy-prod | tag vX.Y.Z | deploy.yml | Manual approval required |\n\n## Promotion Policy\nAll tier-1 gates must pass before merge. Tier 2+ required for release.\n\n## Rollback Policy\nAutomatic rollback if error rate exceeds 1% within 10 min of deploy. Manual rollback available.\n';
  mkdirSync(join(tmpRepo, 'contracts', 'ci'), { recursive: true });
  writeFileSync(join(tmpRepo, 'contracts', 'ci', 'ci-gate-contract.md'), ciContent, 'utf8');
}

function buildTasksYaml(opts: { changeId: string; contextGovernance?: 'v1' }): string {
  const data: Record<string, unknown> = {
    'change-id': opts.changeId,
    status: 'in-progress',
  };
  if (opts.contextGovernance) data['context-governance'] = opts.contextGovernance;
  data['tasks'] = [
    { id: '1.1', section: 'Preparation', title: 'Confirm classification', status: 'done' },
    { id: '7.1', section: 'Archive', title: 'Archive change', status: 'pending' },
    { id: '7.2', section: 'Archive', title: 'Promote learnings', status: 'pending' },
  ];
  return yaml.dump(data, { lineWidth: -1, noRefs: true });
}

function writeValidChangeArtifacts(changeDir: string, changeId: string): void {
  const filler = 'This is a meaningful description of the change. '.repeat(4);

  // `cdd-kit new` scaffolds a placeholder interaction-design.md (ADR 0012), which
  // enforceInteractionDesign correctly rejects. These fixtures exercise the
  // acceptance oracle, not the design loop, so take the sanctioned ADR 0011 skip
  // instead of filling in a design this change does not have.
  writeFileSync(join(changeDir, 'interaction-design.md'), [
    '---',
    'applicability: not-applicable',
    'applicability-reason: "test fixture for the acceptance oracle; this change has no UI surface to design"',
    '---',
    '',
    '# Interaction Design: ' + changeId,
    '',
    'Not applicable — see frontmatter.',
    '',
  ].join('\n'), 'utf8');

  writeFileSync(join(changeDir, 'change-request.md'), '# Change Request\n\n' + filler + '\n\nMotivation: We need to add this feature to support the new requirements from the product team. The change is scoped to the order module and will not affect other systems.\n', 'utf8');
  writeFileSync(join(changeDir, 'change-classification.md'), '# Change Classification\n\n**Risk Level:** medium\n**Tier:** Tier 1\n\n' + filler + '\n\nThis change is classified as low risk because it is additive only, with no breaking changes to existing APIs or data schemas. Rollback is straightforward by reverting the feature flag.\n', 'utf8');
  writeFileSync(join(changeDir, 'implementation-plan.md'), [
    '# Implementation Plan: ' + changeId,
    '',
    '## Objective',
    'Implementation agents receive a bounded execution packet with scope, non-goals, file-level actions, contract updates, tests, and constraints. '.repeat(2),
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
    '| IP-1 | order management | Update implementation according to contracts and test plan | backend-engineer |',
    '',
    '## File-Level Plan',
    '| path or glob | action | notes |',
    '|---|---|---|',
    '| src/api/orders.ts | update | keep response contract stable |',
    '',
    '## Test Execution Plan',
    '| acceptance criterion | test file / command | expected signal |',
    '|---|---|---|',
    '| AC-1 | tests/api/orders.test.ts | failing test passes after implementation |',
    '',
    '## Handoff Constraints',
    '- Stop as blocked if the plan is incomplete.',
  ].join('\n'), 'utf8');
  writeFileSync(join(changeDir, 'test-plan.md'), '# Test Plan\n\n' + filler + '\n\nUnit tests will cover all new business logic. Integration tests will verify the API endpoints. E2E tests will cover the user flows affected by this change. Performance tests ensure no regression in response times.\n', 'utf8');
  writeFileSync(join(changeDir, 'ci-gates.md'), '# CI Gates\n\n## Required Gates\n| tier | gate | trigger | workflow | description |\n|---|---|---|---|---|\n| 1 | lint | PR | ci.yml | Linting |\n| 2 | unit-tests | PR | ci.yml | Unit tests |\n\n## Promotion Policy\nAll tier-1 gates must pass before merge.\n\n## Rollback Policy\nAutomatic rollback if error rate exceeds threshold within 10 minutes.\n\n' + filler + '\n', 'utf8');
  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId }), 'utf8');
}

function writeContextGovernanceFiles(changeDir: string, changeId: string): void {
  const filler = 'This is a meaningful description of the context policy. '.repeat(4);
  writeFileSync(join(changeDir, 'tasks.yml'), buildTasksYaml({ changeId, contextGovernance: 'v1' }), 'utf8');
  writeFileSync(join(changeDir, 'context-manifest.md'), [
    '# Context Manifest',
    '',
    filler,
    '',
    '## Allowed Paths',
    '- src/api/orders.ts',
    '- specs/changes/' + changeId + '/',
    '',
    '## Approved Expansions',
    '-',
    '',
    '## Context Expansion Requests',
    '-',
  ].join('\n'), 'utf8');
}

function realOracle(): AcceptanceFile {
  return {
    'oracle-version': '0.1.0',
    'authored-by': 'human',
    cases: [
      {
        id: 'over-limit-order-rejected',
        given: 'a customer whose credit limit is 1000',
        when: 'they submit an order for 1500',
        then: 'the order is rejected with reason credit-limit-exceeded',
        input: { customer_limit: 1000, order_amount: 1500 },
        expect: { status: 'rejected', reason: 'credit-limit-exceeded' },
      },
    ],
    rules: [
      { id: 'refund-never-exceeds-payment', statement: 'a refund amount can never exceed the original payment' },
    ],
  };
}

function placeholderOracle(): Record<string, unknown> {
  return {
    'oracle-version': '0.1.0',
    'authored-by': 'human',
    cases: [
      {
        id: '<case-id>',
        given: '<narrative>',
        when: '<narrative>',
        then: '<narrative>',
        input: '<input-value>',
        expect: '<expect-value>',
      },
    ],
  };
}

function writeAcceptanceYaml(changeDir: string, data: unknown): void {
  writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump(data, { lineWidth: -1, noRefs: true }), 'utf8');
}

describe('cdd-kit gate -- acceptance oracle (ADR 0010, AC-1/AC-2 core)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-gate-acceptance-repo-');
    tmpHome = makeTempDir('cdd-gate-acceptance-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error('Setup init failed: ' + r.stderr);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('AC-1: a context-governed change missing acceptance.yml fails the gate', () => {
    runCli(['new', 'acc-governed-missing'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-governed-missing');
    writeValidChangeArtifacts(changeDir, 'acc-governed-missing');
    writeContextGovernanceFiles(changeDir, 'acc-governed-missing');
    // `new` auto-scaffolds a placeholder acceptance.yml; remove it to exercise
    // the genuinely-missing code path (a hand-authored change dir predating
    // the scaffold, or one where the placeholder was deleted).
    rmSync(join(changeDir, 'acceptance.yml'));

    const r = runCli(['gate', 'acc-governed-missing'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing required artifact: acceptance\.yml/i);
  });

  it('profile policy: balanced does not require an oracle that was never supplied', () => {
    runCli(['new', 'acc-balanced-optional'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-balanced-optional');
    writeValidChangeArtifacts(changeDir, 'acc-balanced-optional');
    writeContextGovernanceFiles(changeDir, 'acc-balanced-optional');
    rmSync(join(changeDir, 'acceptance.yml'));

    const r = runCli(['gate', 'acc-balanced-optional', '--profile', 'balanced'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/missing (?:required artifact: )?acceptance\.yml/i);
  });

  it('profile policy: strict and explicit conditional activation still require the oracle', () => {
    runCli(['new', 'acc-profile-required'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-profile-required');
    writeValidChangeArtifacts(changeDir, 'acc-profile-required');
    writeContextGovernanceFiles(changeDir, 'acc-profile-required');
    rmSync(join(changeDir, 'acceptance.yml'));

    const strict = runCli(['gate', 'acc-profile-required', '--profile', 'strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.stdout + strict.stderr).toMatch(/missing required artifact: acceptance\.yml/i);

    const controlled = runCli(['gate', 'acc-profile-required', '--profile', 'controlled', '--require-acceptance'], { cwd: tmpRepo, home: tmpHome });
    expect(controlled.stdout + controlled.stderr).toMatch(/missing required artifact: acceptance\.yml/i);
  });

  it('profile policy: a runtime capsule carries --require-acceptance into a later plain gate', () => {
    runCli(['new', 'acc-runtime-required'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-runtime-required');
    writeValidChangeArtifacts(changeDir, 'acc-runtime-required');
    writeContextGovernanceFiles(changeDir, 'acc-runtime-required');
    rmSync(join(changeDir, 'acceptance.yml'));
    const plan = runCli(['work', 'acc-runtime-required', 'Document', 'behavior', '--require-acceptance', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(plan.status, plan.stderr).toBe(0);

    const gate = runCli(['gate', 'acc-runtime-required'], { cwd: tmpRepo, home: tmpHome });
    expect(gate.stdout + gate.stderr).toMatch(/missing required artifact: acceptance\.yml/i);
  });

  it('profile policy: rejects contradictory --strict and non-strict profile flags', () => {
    runCli(['new', 'acc-profile-conflict'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['gate', 'acc-profile-conflict', '--strict', '--profile', 'balanced'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/cannot be combined/i);
  });

  it('AC-1: a legacy change missing acceptance.yml only warns, but --strict fails', () => {
    runCli(['new', 'acc-legacy-missing'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-legacy-missing');
    writeValidChangeArtifacts(changeDir, 'acc-legacy-missing');
    rmSync(join(changeDir, 'acceptance.yml'));

    const normal = runCli(['gate', 'acc-legacy-missing'], { cwd: tmpRepo, home: tmpHome });
    expect(normal.stdout + normal.stderr).toMatch(/missing acceptance\.yml \(legacy change/i);
    expect(normal.stdout + normal.stderr).not.toMatch(/missing required artifact: acceptance\.yml/i);

    const strict = runCli(['gate', 'acc-legacy-missing', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.status).not.toBe(0);
    expect(strict.stdout + strict.stderr).toMatch(/missing required artifact: acceptance\.yml/i);
  });

  it('AC-1: gate fails when every case is a placeholder', () => {
    runCli(['new', 'acc-placeholder'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-placeholder');
    writeValidChangeArtifacts(changeDir, 'acc-placeholder');
    writeAcceptanceYaml(changeDir, placeholderOracle());

    const r = runCli(['gate', 'acc-placeholder'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/acceptance\.yml.*placeholder/i);
  });

  it('AC-1: gate rejects a malformed acceptance.yml (schema violation)', () => {
    runCli(['new', 'acc-malformed'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-malformed');
    writeValidChangeArtifacts(changeDir, 'acc-malformed');
    writeAcceptanceYaml(changeDir, {
      'oracle-version': '0.1.0',
      'authored-by': 'human',
      cases: [{ id: 'case-1', given: 'g', when: 'w', then: 't' }],
    });

    const r = runCli(['gate', 'acc-malformed'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/acceptance\.yml/i);
  });

  it('AC-2: gate fails with the re-confirm message when the oracle hash diverges from the baseline', () => {
    runCli(['new', 'acc-tampered'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-tampered');
    writeValidChangeArtifacts(changeDir, 'acc-tampered');
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    const tamperedOracle = realOracle();
    (tamperedOracle.cases ?? [])[0].expect = { status: 'accepted' };
    writeAcceptanceLock(tmpRepo, 'acc-tampered', computeAcceptanceHash(tamperedOracle));

    const r = runCli(['gate', 'acc-tampered'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/acceptance oracle modified after authoring/);
    expect(r.stdout + r.stderr).toMatch(/human must re-confirm/);
  });

  it('AC-2: a matching baseline hash does not fail the gate on the acceptance check', () => {
    runCli(['new', 'acc-untampered'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-untampered');
    writeValidChangeArtifacts(changeDir, 'acc-untampered');
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-untampered', computeAcceptanceHash(oracle));

    const r = runCli(['gate', 'acc-untampered'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/acceptance oracle modified after authoring/i);
  });

  // Regression: the predecessor of these two tests was named "no recorded
  // baseline warns (not a hard fail) so early authoring is not blocked" and
  // asserted only on `stdout + stderr` message text -- so it passed whether the
  // gate warned or errored. An unlocked acceptance.yml (which the advisory-by-
  // default write hook lets any Edit-capable agent author) therefore passed the
  // gate, and ADR 0010's human-ground-truth guarantee did not exist.
  //
  // The exit code is not a usable discriminator here (a scaffolded change fails
  // the gate on unrelated checks anyway). log.warn writes stdout and log.error
  // writes stderr (src/utils/logger.ts), so the STREAM is what pins severity.
  const BASELINE_MSG = /no recorded baseline/i;

  // NOTE: `writeValidChangeArtifacts` overwrites tasks.yml WITHOUT
  // `context-governance: v1`, so a fixture built from it alone is a LEGACY
  // change (isNewChange === false). `writeContextGovernanceFiles` is what makes
  // it governed. The superseded test used the legacy fixture and matched on the
  // combined streams, so it was asserting the warn path while claiming to
  // describe the required one.
  it('AC-2: a context-governed change whose acceptance.yml has no lock baseline FAILS the gate (stderr, not a warning)', () => {
    runCli(['new', 'acc-no-baseline'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-no-baseline');
    writeValidChangeArtifacts(changeDir, 'acc-no-baseline');
    writeContextGovernanceFiles(changeDir, 'acc-no-baseline');
    writeAcceptanceYaml(changeDir, realOracle());

    const r = runCli(['gate', 'acc-no-baseline'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stderr).toMatch(BASELINE_MSG);
    expect(r.stderr).toMatch(/proves nothing/i);
    expect(r.stdout).not.toMatch(BASELINE_MSG);
    // Not the tamper message -- the baseline is absent, not divergent.
    expect(r.stderr).not.toMatch(/acceptance oracle modified after authoring/i);
  });

  it('AC-2: ...and `accept relock` is what clears it (isolates the cause)', () => {
    runCli(['new', 'acc-then-relock'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-then-relock');
    writeValidChangeArtifacts(changeDir, 'acc-then-relock');
    writeContextGovernanceFiles(changeDir, 'acc-then-relock');
    writeAcceptanceYaml(changeDir, realOracle());

    const before = runCli(['gate', 'acc-then-relock'], { cwd: tmpRepo, home: tmpHome });
    expect(before.stderr).toMatch(BASELINE_MSG);

    const relock = runCli(['accept', 'relock', 'acc-then-relock'], { cwd: tmpRepo, home: tmpHome });
    expect(relock.status, relock.stdout + relock.stderr).toBe(0);

    const after = runCli(['gate', 'acc-then-relock'], { cwd: tmpRepo, home: tmpHome });
    expect(after.stdout + after.stderr).not.toMatch(BASELINE_MSG);
  });

  it('AC-2: a legacy change is warned on stdout, not failed -- but --strict moves it to stderr', () => {
    runCli(['new', 'acc-legacy-no-baseline'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-legacy-no-baseline');
    writeValidChangeArtifacts(changeDir, 'acc-legacy-no-baseline'); // leaves it ungoverned
    writeAcceptanceYaml(changeDir, realOracle());

    const normal = runCli(['gate', 'acc-legacy-no-baseline'], { cwd: tmpRepo, home: tmpHome });
    expect(normal.stdout).toMatch(BASELINE_MSG);
    expect(normal.stdout).toMatch(/legacy change; not yet migrated/i);
    expect(normal.stderr).not.toMatch(BASELINE_MSG);

    const strict = runCli(['gate', 'acc-legacy-no-baseline', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.stderr).toMatch(BASELINE_MSG);
    expect(strict.stdout).not.toMatch(BASELINE_MSG);
  });

  it.skipIf(!hasPython())('AC-1/AC-2: gate passes end-to-end with >=1 real case and a matching lock baseline', () => {
    runCli(['new', 'acc-pass'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-pass');
    writeValidChangeArtifacts(changeDir, 'acc-pass');
    writeValidContracts(tmpRepo);
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-pass', computeAcceptanceHash(oracle));

    // CI='' pins the warn path for the new enforceConfirmationHookInstallation
    // check (this fixture arms no write-block hooks); otherwise it would hard-fail
    // on an unrelated concern under CI. Warns locally and on a runner alike here.
    const r = runCli(['gate', 'acc-pass'], { cwd: tmpRepo, home: tmpHome, env: { CI: '' } });
    expect(r.status, 'stdout: ' + r.stdout + '\nstderr: ' + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/gate passed for change: acc-pass/i);
  });

  it('AC-7: a migrated change fails enforceAcceptanceOracle until real cases are supplied', () => {
    // A legacy in-flight change (pre-dates the oracle): old tasks.md checklist,
    // no acceptance.yml at all.
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-migrated');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Pending\n', 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'), '**Tier:** Tier 2\n', 'utf8');

    const migrateResult = runCli(['migrate', 'acc-migrated'], { cwd: tmpRepo, home: tmpHome });
    expect(migrateResult.status, migrateResult.stderr).toBe(0);
    // migrate scaffolds the placeholder-plus-instructions oracle (AC-7).
    expect(existsSync(join(changeDir, 'acceptance.yml'))).toBe(true);

    writeValidChangeArtifacts(changeDir, 'acc-migrated');

    const r = runCli(['gate', 'acc-migrated', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/acceptance\.yml.*placeholder/i);
  });

  it('AC-4: gate fails when the acceptance driver mocks the resolved SUT', () => {
    runCli(['new', 'acc-mock-sut'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-mock-sut');
    writeValidChangeArtifacts(changeDir, 'acc-mock-sut'); // File-Level Plan declares src/api/orders.ts
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-mock-sut', computeAcceptanceHash(oracle));

    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'src/api/orders.ts:\n  total_lines: 10\n', 'utf8');
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    // Named per the `<change-id>.driver.*` convention so the cross-change
    // isolation filter (BUG 1, src/utils/mock-of-sut-scan.ts) recognizes this
    // fixture as belonging to acc-mock-sut.
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'acc-mock-sut.driver.py'), [
      'def test_over_limit_order_rejected(mocker):',
      '    mocker.patch("src.api.orders.create_order")',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'acc-mock-sut'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/mocks the system under test/i);
  });

  it('AC-4: gate fails when the acceptance driver hardcodes a case expect literal', () => {
    runCli(['new', 'acc-hardcoded'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-hardcoded');
    writeValidChangeArtifacts(changeDir, 'acc-hardcoded');
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-hardcoded', computeAcceptanceHash(oracle));

    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'acc-hardcoded.driver.py'), [
      'def test_over_limit_order_rejected():',
      '    actual = real_system_under_test({"customer_limit": 1000, "order_amount": 1500})',
      '    assert actual["reason"] == "credit-limit-exceeded"',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'acc-hardcoded'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/hardcodes case/i);
  });

  it('AC-4: gate does not flag a driver that fakes an external network boundary', () => {
    runCli(['new', 'acc-fake-network'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-fake-network');
    writeValidChangeArtifacts(changeDir, 'acc-fake-network');
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-fake-network', computeAcceptanceHash(oracle));

    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(tmpRepo, '.cdd', 'code-map.yml'), 'src/api/orders.ts:\n  total_lines: 10\n', 'utf8');
    mkdirSync(join(tmpRepo, 'tests', 'acceptance'), { recursive: true });
    // Case-insensitive on the case id/wording deliberately: uses a name that
    // shares no substring with the case's expect leaves ("rejected",
    // "credit-limit-exceeded") so this test isolates the network-fake path.
    writeFileSync(join(tmpRepo, 'tests', 'acceptance', 'acc-fake-network.driver.py'), [
      'def test_boundary_case(mocker):',
      '    mocker.patch("requests.get")',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'acc-fake-network'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/mocks the system under test/i);
    expect(r.stdout + r.stderr).not.toMatch(/hardcodes case/i);
  });

  it('AC-5: a context-governed change with real cases but no acceptance-phase evidence fails the gate', () => {
    runCli(['new', 'acc-no-evidence'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-no-evidence');
    writeValidChangeArtifacts(changeDir, 'acc-no-evidence');
    writeContextGovernanceFiles(changeDir, 'acc-no-evidence');
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-no-evidence', computeAcceptanceHash(oracle));

    const r = runCli(['gate', 'acc-no-evidence'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no passed `acceptance`-phase run recorded/i);
  });

  it('AC-5: a legacy change with real cases but no acceptance-phase evidence only warns', () => {
    runCli(['new', 'acc-no-evidence-legacy'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-no-evidence-legacy');
    writeValidChangeArtifacts(changeDir, 'acc-no-evidence-legacy');
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-no-evidence-legacy', computeAcceptanceHash(oracle));

    const r = runCli(['gate', 'acc-no-evidence-legacy'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/missing a passed `acceptance`-phase test-evidence run \(legacy change/i);
    expect(r.stdout + r.stderr).not.toMatch(/no passed `acceptance`-phase run recorded/i);
  });

  it('AC-5: a recorded passed acceptance-phase run satisfies the check', () => {
    runCli(['new', 'acc-with-evidence'], { cwd: tmpRepo, home: tmpHome });
    const changeDir = join(tmpRepo, 'specs', 'changes', 'acc-with-evidence');
    writeValidChangeArtifacts(changeDir, 'acc-with-evidence');
    writeContextGovernanceFiles(changeDir, 'acc-with-evidence');
    const oracle = realOracle();
    writeAcceptanceYaml(changeDir, oracle);
    writeAcceptanceLock(tmpRepo, 'acc-with-evidence', computeAcceptanceHash(oracle));
    writeFileSync(join(changeDir, 'test-evidence.yml'), yaml.dump({
      'change-id': 'acc-with-evidence',
      'schema-version': '0.1.0',
      'required-phases': ['acceptance'],
      runs: [{ phase: 'acceptance', status: 'passed', command: 'pytest tests/acceptance -q', summary: 'x' }],
      'final-status': 'passed',
    }, { lineWidth: -1 }), 'utf8');

    const r = runCli(['gate', 'acc-with-evidence'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/no passed `acceptance`-phase run recorded/i);
  });
});
