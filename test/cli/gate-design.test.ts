import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

// Integration coverage for enforceInteractionDesign (ADR 0012; gate-design.ts)
// per test-plan.md AC-4..AC-8 rows. Mirrors the fixture-building conventions of
// test/cli/acceptance-oracle.test.ts, but deliberately MINIMAL: enforceInteractionDesign's
// messages accumulate into the SAME gate run as every other required-file check,
// so a test asserting a specific substring does not need every other artifact to
// be valid -- only tests asserting an overall PASS (status 0) need the full set.

function scaffold(tmpRepo: string, changeId: string, opts: { governed?: boolean } = {}): string {
  const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
  mkdirSync(changeDir, { recursive: true });
  const tasks: Record<string, unknown> = { 'change-id': changeId, status: 'in-progress', tasks: [] };
  if (opts.governed !== false) tasks['context-governance'] = 'v1';
  writeFileSync(join(changeDir, 'tasks.yml'), yaml.dump(tasks, { lineWidth: -1 }), 'utf8');
  return changeDir;
}

interface DesignRow {
  item?: string; rationale?: string; provenance?: string;
  id?: string; intent?: string; frequency?: string; path?: string;
  control?: string; reason?: string;
  meaning?: string; discriminator?: string;
}

interface DesignOpts {
  openDecisions?: Array<{ resolved: boolean; text: string }>;
  confirmed?: string | null;
  infoRows?: DesignRow[];
  intentRows?: DesignRow[];
  controlRows?: DesignRow[];
  deletedRows?: DesignRow[];
  stateRows?: DesignRow[];
  applicability?: string;
  applicabilityReason?: string;
}

function buildDesign(opts: DesignOpts = {}): string {
  const openDecisions = opts.openDecisions ?? [{ resolved: true, text: 'what copy for the empty state? — "No orders yet."' }];
  const confirmed = opts.confirmed !== undefined
    ? opts.confirmed
    : 'The maintainer confirmed: the empty-state copy is "No orders yet." and applies whenever the list has zero rows.';
  const infoRows = opts.infoRows ?? [];
  const intentRows = opts.intentRows ?? [];
  const controlRows = opts.controlRows ?? [];
  const deletedRows = opts.deletedRows ?? [];
  const stateRows = opts.stateRows ?? [];

  const lines: string[] = [];
  if (opts.applicability) {
    lines.push('---');
    lines.push('applicability: ' + opts.applicability);
    if (opts.applicabilityReason !== undefined) lines.push('applicability-reason: ' + opts.applicabilityReason);
    lines.push('---');
    lines.push('');
  }
  lines.push('# Interaction Design: my-change');
  lines.push('');
  lines.push('This interaction design describes the orders list screen: what it shows, why each control exists, and how each state is told apart from every other state.');
  lines.push('');
  lines.push('## Presented Information');
  lines.push('| item | rationale | provenance |');
  lines.push('|---|---|---|');
  for (const r of infoRows) lines.push('| ' + r.item + ' | ' + (r.rationale ?? 'answers a user question') + ' | ' + (r.provenance ?? '') + ' |');
  lines.push('');
  lines.push('## User Intents');
  lines.push('| id | intent | frequency | path |');
  lines.push('|---|---|---|---|');
  for (const r of intentRows) lines.push('| ' + r.id + ' | ' + (r.intent ?? 'view the order list') + ' | ' + (r.frequency ?? 'high') + ' | ' + (r.path ?? '') + ' |');
  lines.push('');
  lines.push('## Controls');
  lines.push('| id | control | intent |');
  lines.push('|---|---|---|');
  for (const r of controlRows) lines.push('| ' + r.id + ' | ' + r.control + ' | ' + (r.intent ?? '') + ' |');
  if (deletedRows.length > 0) {
    lines.push('');
    lines.push('### Deleted Controls');
    lines.push('| control | reason |');
    lines.push('|---|---|');
    for (const r of deletedRows) lines.push('| ' + r.control + ' | ' + (r.reason ?? '') + ' |');
  }
  lines.push('');
  lines.push('## Reversibility');
  lines.push('The user can always tell where they are and return to the previous state via the back control.');
  lines.push('');
  lines.push('## States');
  lines.push('| id | meaning | discriminator |');
  lines.push('|---|---|---|');
  for (const r of stateRows) lines.push('| ' + r.id + ' | ' + (r.meaning ?? '') + ' | ' + (r.discriminator ?? '') + ' |');
  lines.push('');
  lines.push('## Open Decisions');
  for (const od of openDecisions) lines.push('- [' + (od.resolved ? 'x' : ' ') + '] ' + od.text);
  lines.push('');
  lines.push('## Confirmed');
  if (confirmed) lines.push(confirmed);
  lines.push('');
  return lines.join('\n');
}

function writeDesign(changeDir: string, opts: DesignOpts = {}): void {
  writeFileSync(join(changeDir, 'interaction-design.md'), buildDesign(opts), 'utf8');
}

function apiContract(rows: string[], schemas?: string): string {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|--------|------|------|----------------|-----------------|--------|-------|',
    ...rows,
  ].join('\n');
  return '---\ncontract: api\nschema-version: 0.1.0\nlast-changed: 2026-07-09\nbreaking-change-policy: deprecate-2-minors\n---\n\n' +
    '# API Contract\n\n## API Style\n- response style: JSON REST\n\n## Endpoint Requirements\n' + table +
    '\n\n## Schemas\n' + (schemas ?? '') +
    '\n\n## Error Format\nStandard envelope.\n\n## Compatibility Policy\nNo breaking changes.\n\n' +
    '## Endpoint Inventory Policy\nAll endpoints listed.\n\n## Breaking Change Policy\nRFC required.\n';
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-gate-design-repo-');
  tmpHome = makeTempDir('cdd-gate-design-home-');
  const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
  if (r.status !== 0) throw new Error('Setup init failed: ' + r.stderr);
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('enforceInteractionDesign — AC-4: missing artifact + migration window', () => {
  it('AC-4/AC-7: a context-governed change missing interaction-design.md fails the gate', () => {
    scaffold(tmpRepo, 'design-governed-missing', { governed: true });
    const r = runCli(['gate', 'design-governed-missing'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing required artifact: interaction-design\.md/i);
  });

  it('AC-7: a legacy change missing interaction-design.md only warns, but --strict fails', () => {
    scaffold(tmpRepo, 'design-legacy-missing', { governed: false });
    const normal = runCli(['gate', 'design-legacy-missing'], { cwd: tmpRepo, home: tmpHome });
    expect(normal.stdout + normal.stderr).toMatch(/missing interaction-design\.md \(legacy change/i);
    expect(normal.stdout + normal.stderr).not.toMatch(/missing required artifact: interaction-design\.md/i);

    const strict = runCli(['gate', 'design-legacy-missing', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.status).not.toBe(0);
    expect(strict.stdout + strict.stderr).toMatch(/missing required artifact: interaction-design\.md/i);
  });

  it('AC-7: a NEW change dir with no interaction-design.md fails even non-strict', () => {
    scaffold(tmpRepo, 'design-new-missing', { governed: true });
    const r = runCli(['gate', 'design-new-missing'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing required artifact: interaction-design\.md/i);
  });

  it('AC-7: a migrate-placeholder-shaped interaction-design.md fails until replaced by a real design', () => {
    const changeDir = scaffold(tmpRepo, 'design-migrated', { governed: false });
    // Mirrors the placeholder-plus-instructions shape acceptance.yml's migrate
    // scaffold uses (PLACEHOLDER_LITERALS `<change-id>` / `<date>`), which the
    // SAME generic stub/placeholder detection this check reuses must reject —
    // no separate code path, exactly like enforceAcceptanceOracle's AC-7.
    writeFileSync(join(changeDir, 'interaction-design.md'), [
      '---',
      'change-id: <change-id>',
      'last-changed: <date>',
      '---',
      '',
      '# Interaction Design: <change-id>',
      '',
      '<!-- TODO: fill in the derivation chain, then have the human answer Open Decisions -->',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'design-migrated', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/interaction-design\.md.*(placeholder|stub)/i);
  });
});

describe('enforceInteractionDesign — AC-4: Open Decisions + Confirmed presence', () => {
  it.skipIf(!hasPython())('fails when ## Open Decisions has an unresolved item', () => {
    const changeDir = scaffold(tmpRepo, 'design-open-decision', { governed: true });
    writeDesign(changeDir, {
      openDecisions: [{ resolved: false, text: 'what should the empty-state copy say?' }],
    });
    const r = runCli(['gate', 'design-open-decision'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/unresolved Open Decision/i);
    expect(r.stdout + r.stderr).toMatch(/what should the empty-state copy say\?/);
  });

  it.skipIf(!hasPython())('passes the Open Decisions check when every item is resolved', () => {
    const changeDir = scaffold(tmpRepo, 'design-resolved-decision', { governed: true });
    writeDesign(changeDir, {
      openDecisions: [{ resolved: true, text: 'what should the empty-state copy say? — "No orders yet."' }],
    });
    const r = runCli(['gate', 'design-resolved-decision'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/unresolved Open Decision/i);
  });

  it.skipIf(!hasPython())('fails when there is no human ## Confirmed', () => {
    const changeDir = scaffold(tmpRepo, 'design-no-confirmed', { governed: true });
    writeDesign(changeDir, { confirmed: '' });
    const r = runCli(['gate', 'design-no-confirmed'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no human ## Confirmed/i);
  });
});

describe('enforceInteractionDesign — AC-4: referential integrity', () => {
  it.skipIf(!hasPython())('fails when a control cites zero intent ids', () => {
    const changeDir = scaffold(tmpRepo, 'design-control-zero', { governed: true });
    writeDesign(changeDir, {
      intentRows: [{ id: 'intent-1', path: '/orders' }],
      controlRows: [{ id: 'ctl-1', control: 'Refresh button', intent: '' }],
    });
    const r = runCli(['gate', 'design-control-zero'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Refresh button.*cites zero intent ids/i);
  });

  it.skipIf(!hasPython())('fails when a control cites two intent ids', () => {
    const changeDir = scaffold(tmpRepo, 'design-control-two', { governed: true });
    writeDesign(changeDir, {
      intentRows: [{ id: 'intent-1', path: '/orders' }, { id: 'intent-2', path: '/orders/new' }],
      controlRows: [{ id: 'ctl-1', control: 'Submit button', intent: 'intent-1, intent-2' }],
    });
    const r = runCli(['gate', 'design-control-two'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Submit button.*cites 2 intent ids/i);
  });

  it.skipIf(!hasPython())('passes referential integrity when a control cites exactly one intent id', () => {
    const changeDir = scaffold(tmpRepo, 'design-control-one', { governed: true });
    writeDesign(changeDir, {
      intentRows: [{ id: 'intent-1', path: '/orders' }],
      controlRows: [{ id: 'ctl-1', control: 'Refresh button', intent: 'intent-1' }],
    });
    const r = runCli(['gate', 'design-control-one'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/cites zero intent ids|cites \d+ intent ids/i);
  });

  it.skipIf(!hasPython())('fails when an intent has no path', () => {
    const changeDir = scaffold(tmpRepo, 'design-intent-nopath', { governed: true });
    writeDesign(changeDir, {
      intentRows: [{ id: 'intent-1', path: '' }],
    });
    const r = runCli(['gate', 'design-intent-nopath'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/intent-1.*has no path/i);
  });

  it.skipIf(!hasPython())('fails when a deleted control has no recorded reason', () => {
    const changeDir = scaffold(tmpRepo, 'design-deleted-noreason', { governed: true });
    writeDesign(changeDir, {
      deletedRows: [{ control: 'Reset filters button', reason: '' }],
    });
    const r = runCli(['gate', 'design-deleted-noreason'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Reset filters button.*has no recorded reason/i);
  });

  it.skipIf(!hasPython())('passes when a deleted control records its reason', () => {
    const changeDir = scaffold(tmpRepo, 'design-deleted-reason', { governed: true });
    writeDesign(changeDir, {
      deletedRows: [{ control: 'Reset filters button', reason: 'redundant with the per-filter dismiss chips' }],
    });
    const r = runCli(['gate', 'design-deleted-reason'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/has no recorded reason/i);
  });
});

describe('enforceInteractionDesign — AC-5: provenance reconciliation', () => {
  it.skipIf(!hasPython())('blocks the gate with the resolver\'s actionable message on a HARD provenance failure', () => {
    const changeDir = scaffold(tmpRepo, 'design-bad-provenance', { governed: true });
    // Deliberately no contracts/api/api-contract.md in this repo at all.
    writeDesign(changeDir, {
      infoRows: [{ item: 'order count', provenance: 'GET /api/v1/orders → total_count' }],
    });
    const r = runCli(['gate', 'design-bad-provenance'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/order count/i);
    expect(r.stdout + r.stderr).toMatch(/no .*endpoint row found|openapi\.json/i);
  });

  it.skipIf(!hasPython())('passes provenance reconciliation when every citation resolves', () => {
    mkdirSync(join(tmpRepo, 'contracts', 'api'), { recursive: true });
    writeFileSync(join(tmpRepo, 'contracts', 'api', 'api-contract.md'), apiContract([
      '| GET | /api/v1/orders | required | - | - | 401,403 | x |',
    ]), 'utf8');

    const changeDir = scaffold(tmpRepo, 'design-good-provenance', { governed: true });
    writeDesign(changeDir, {
      infoRows: [{ item: 'auth failure banner', provenance: 'GET /api/v1/orders → 401' }],
      stateRows: [{ id: 'state-ok', meaning: 'the request succeeded', discriminator: 'GET /api/v1/orders → HTTP 200' }],
    });
    const r = runCli(['gate', 'design-good-provenance'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/no .*endpoint row found|not listed in the .errors. column/i);
  });

  it.skipIf(!hasPython())('never emits an over-fetch / reverse-direction finding (per-change gate, ADR 0012 §2/§6)', () => {
    mkdirSync(join(tmpRepo, 'contracts', 'api'), { recursive: true });
    writeFileSync(join(tmpRepo, 'contracts', 'api', 'api-contract.md'), apiContract([
      '| GET | /api/v1/orders | required | - | - | 401,403 | x |',
    ]), 'utf8');

    // Change id deliberately avoids the substring "overfetch" itself (it would
    // otherwise appear in the "run `cdd-kit design confirm <id>`" hint text
    // and produce a false positive against the assertion below).
    const changeDir = scaffold(tmpRepo, 'design-reverse-direction', { governed: true });
    writeDesign(changeDir, {});
    const r = runCli(['gate', 'design-reverse-direction'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/over-?fetch/i);
  });
});

describe('enforceInteractionDesign — AC-6: tamper-evidence hash-lock', () => {
  it.skipIf(!hasPython())('fails with exactly the re-confirm message when ## Confirmed diverges from the baseline', () => {
    const changeDir = scaffold(tmpRepo, 'design-tampered', { governed: true });
    writeDesign(changeDir, { confirmed: 'Answer: yes.' });
    const confirm = runCli(['design', 'confirm', 'design-tampered'], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    // Semantic edit after confirmation.
    writeDesign(changeDir, { confirmed: 'Answer: no.' });

    const r = runCli(['gate', 'design-tampered'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/interaction design modified after confirmation — human must re-confirm\./);
  });

  it.skipIf(!hasPython())('does not fail after a pure reformat/reindent of ## Confirmed (whitespace-insensitive)', () => {
    const changeDir = scaffold(tmpRepo, 'design-reflow', { governed: true });
    writeDesign(changeDir, { confirmed: 'Answer: yes.\n\nSecond sentence here.' });
    const confirm = runCli(['design', 'confirm', 'design-reflow'], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    writeDesign(changeDir, { confirmed: '   Answer:    yes.   \n\n\n\n  Second   sentence   here.  \n\n' });

    const r = runCli(['gate', 'design-reflow'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/interaction design modified after confirmation/i);
  });

  // Regression: the predecessor of these three tests was named "warns (not a
  // hard fail) when there is no recorded baseline yet", ran against a GOVERNED
  // change, and asserted only on `stdout + stderr` message text. It passed
  // identically whether the gate warned or errored, which is what let an
  // unlocked (agent-authorable) `## Confirmed` section pass the gate for the
  // whole of 3.10.0.
  //
  // `expect(r.status).not.toBe(0)` is NOT a sufficient replacement: a scaffolded
  // governed change already fails the gate on unrelated checks, so the exit code
  // says nothing about THIS condition. The discriminator is the stream --
  // log.warn writes stdout, log.error writes stderr (src/utils/logger.ts) --
  // so each assertion below pins which stream the message lands on. Verified by
  // mutation: reverting the check to warn-only turns these red.
  const BASELINE_MSG = /no recorded baseline/i;

  it.skipIf(!hasPython())('a governed change whose ## Confirmed has no lock baseline FAILS the gate (stderr, not a warning)', () => {
    const changeDir = scaffold(tmpRepo, 'design-no-baseline', { governed: true });
    writeDesign(changeDir, { confirmed: 'Answer: yes.' });
    const r = runCli(['gate', 'design-no-baseline'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(BASELINE_MSG);
    expect(r.stderr).toMatch(/proves nothing/i);
    expect(r.stdout).not.toMatch(BASELINE_MSG);
    // Not the tamper message -- the baseline is absent, not divergent.
    expect(r.stderr).not.toMatch(/interaction design modified after confirmation/i);
  });

  it.skipIf(!hasPython())('...and running `design confirm` is what clears it (isolates the cause)', () => {
    const changeDir = scaffold(tmpRepo, 'design-then-confirm', { governed: true });
    writeDesign(changeDir, { confirmed: 'Answer: yes.' });

    const before = runCli(['gate', 'design-then-confirm'], { cwd: tmpRepo, home: tmpHome });
    expect(before.stderr).toMatch(BASELINE_MSG);

    const confirm = runCli(['design', 'confirm', 'design-then-confirm'], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    const after = runCli(['gate', 'design-then-confirm'], { cwd: tmpRepo, home: tmpHome });
    expect(after.stdout + after.stderr).not.toMatch(BASELINE_MSG);
  });

  it.skipIf(!hasPython())('a legacy change is warned on stdout, not failed -- but --strict moves it to stderr', () => {
    const changeDir = scaffold(tmpRepo, 'design-legacy-no-baseline', { governed: false });
    writeDesign(changeDir, { confirmed: 'Answer: yes.' });

    const normal = runCli(['gate', 'design-legacy-no-baseline'], { cwd: tmpRepo, home: tmpHome });
    expect(normal.stdout).toMatch(BASELINE_MSG);
    expect(normal.stdout).toMatch(/legacy change; not yet migrated/i);
    expect(normal.stderr).not.toMatch(BASELINE_MSG);

    const strict = runCli(['gate', 'design-legacy-no-baseline', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.status).not.toBe(0);
    expect(strict.stderr).toMatch(BASELINE_MSG);
    expect(strict.stdout).not.toMatch(BASELINE_MSG);
  });
});

describe('enforceInteractionDesign — AC-8: ADR 0011 skip path (applicability.py sole authority)', () => {
  it.skipIf(!hasPython())('applicability: not-applicable with a non-empty reason skips conditions 1-6', () => {
    const changeDir = scaffold(tmpRepo, 'design-not-applicable', { governed: true });
    // Deliberately broken content (unresolved Open Decision, no Confirmed,
    // referential-integrity violations) — none of it should matter once the
    // marker is set with a real reason.
    writeFileSync(join(changeDir, 'interaction-design.md'), [
      '---',
      'applicability: not-applicable',
      'applicability-reason: this change is a CLI-only refactor with no UI surface',
      '---',
      '',
      '# Interaction Design',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'design-not-applicable'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(/missing required artifact: interaction-design\.md/i);
    expect(r.stdout + r.stderr).not.toMatch(/unresolved Open Decision/i);
    expect(r.stdout + r.stderr).not.toMatch(/no human ## Confirmed/i);
    expect(r.stdout + r.stderr).toMatch(/applicability: not-applicable/i);
    expect(r.stdout + r.stderr).toMatch(/this change is a CLI-only refactor with no UI surface/);
  });

  it.skipIf(!hasPython())('applicability: not-applicable with an empty/missing reason is a HARD error', () => {
    const changeDir = scaffold(tmpRepo, 'design-empty-reason', { governed: true });
    writeFileSync(join(changeDir, 'interaction-design.md'), [
      '---',
      'applicability: not-applicable',
      '---',
      '',
      '# Interaction Design',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'design-empty-reason'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/applicability-reason/i);
  });

  it.skipIf(!hasPython())('an unknown applicability value is a HARD error', () => {
    const changeDir = scaffold(tmpRepo, 'design-unknown-value', { governed: true });
    writeFileSync(join(changeDir, 'interaction-design.md'), [
      '---',
      'applicability: not-applicble',
      'applicability-reason: typo above',
      '---',
      '',
      '# Interaction Design',
    ].join('\n'), 'utf8');

    const r = runCli(['gate', 'design-unknown-value'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/unrecognized applicability value/i);
  });
});

describe('enforceInteractionDesign — composed into cdd-kit gate', () => {
  it.skipIf(!hasPython())('a fully valid, confirmed interaction-design.md does not fail the gate on any enforceInteractionDesign condition', () => {
    // AC-1 now fires on an empty derivation chain, so `buildDesign`'s default
    // `[]` for infoRows/stateRows would trip the "fully valid" fixture. Seed
    // ≥1 information item and ≥1 state (Test Update Contract), each citing a
    // resolvable api-contract endpoint so provenance reconciliation also passes.
    mkdirSync(join(tmpRepo, 'contracts', 'api'), { recursive: true });
    writeFileSync(join(tmpRepo, 'contracts', 'api', 'api-contract.md'), apiContract([
      '| GET | /api/v1/orders | required | - | - | 401,403 | x |',
    ]), 'utf8');

    const changeDir = scaffold(tmpRepo, 'design-fully-valid', { governed: true });
    writeDesign(changeDir, {
      infoRows: [{ item: 'auth failure banner', provenance: 'GET /api/v1/orders → 401' }],
      intentRows: [{ id: 'intent-1', path: '/orders' }],
      controlRows: [{ id: 'ctl-1', control: 'Refresh button', intent: 'intent-1' }],
      stateRows: [{ id: 'state-ok', meaning: 'the request succeeded', discriminator: 'GET /api/v1/orders → HTTP 200' }],
    });
    const confirm = runCli(['design', 'confirm', 'design-fully-valid'], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    const r = runCli(['gate', 'design-fully-valid'], { cwd: tmpRepo, home: tmpHome });
    const out = r.stdout + r.stderr;
    expect(out).not.toMatch(/interaction-design\.md/i);
  });
});

describe('enforceInteractionDesign — AC-1: the derivation chain may not be vacuous', () => {
  // Discriminator is the STREAM + message text, never the exit code: a scaffolded
  // governed change already exits non-zero on unrelated checks. log.warn → stdout,
  // log.error → stderr (src/utils/logger.ts). Verified by mutation (see agent log).
  const ZERO_ROWS = /zero rows/i;

  // `buildDesign`'s default confirmed/openDecisions text mentions "zero rows",
  // so AC-1 tests pass neutral copy to keep the ZERO_ROWS discriminator honest.
  const NEUTRAL = {
    confirmed: 'Answer: the derivation-chain population is what these cases exercise.',
    openDecisions: [{ resolved: true, text: 'copy for the empty state? — resolved.' }],
  };

  it.skipIf(!hasPython())('T1a: empty ## Presented Information (states populated) errors on stderr, naming that table', () => {
    const changeDir = scaffold(tmpRepo, 'design-empty-info', { governed: true });
    writeDesign(changeDir, {
      ...NEUTRAL,
      // infoRows defaults to [] — the vacuous table under test.
      stateRows: [{ id: 'state-1', meaning: 'the list is empty', discriminator: 'row count is zero' }],
    });
    const r = runCli(['gate', 'design-empty-info'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stderr).toMatch(/## Presented Information/);
    expect(r.stderr).toMatch(ZERO_ROWS);
    // The message names the empty table, and lands on stderr, not stdout.
    expect(r.stdout).not.toMatch(ZERO_ROWS);
  });

  it.skipIf(!hasPython())('T1b: empty ## States (Presented Information populated) errors on stderr, naming that table', () => {
    const changeDir = scaffold(tmpRepo, 'design-empty-states', { governed: true });
    writeDesign(changeDir, {
      ...NEUTRAL,
      infoRows: [{ item: 'order count', provenance: 'ignored for this check' }],
      // stateRows defaults to [] — the vacuous table under test.
    });
    const r = runCli(['gate', 'design-empty-states'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stderr).toMatch(/## States/);
    expect(r.stderr).toMatch(ZERO_ROWS);
    expect(r.stdout).not.toMatch(ZERO_ROWS);
  });

  it.skipIf(!hasPython())('T1c: both tables populated emits no zero-rows message on any stream', () => {
    const changeDir = scaffold(tmpRepo, 'design-both-populated', { governed: true });
    writeDesign(changeDir, {
      ...NEUTRAL,
      infoRows: [{ item: 'order count', provenance: 'ignored for this check' }],
      stateRows: [{ id: 'state-1', meaning: 'the list is empty', discriminator: 'row count is zero' }],
    });
    const r = runCli(['gate', 'design-both-populated'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(ZERO_ROWS);
  });

  it.skipIf(!hasPython())('T1d: applicability: not-applicable short-circuits ahead of the row count (no zero-rows error)', () => {
    const changeDir = scaffold(tmpRepo, 'design-na-empty', { governed: true });
    // Not-applicable + both tables empty: the marker skip must win, so the AC-1
    // row count is never reached. Mutation: moving the check above the return breaks this.
    writeFileSync(join(changeDir, 'interaction-design.md'), [
      '---',
      'applicability: not-applicable',
      'applicability-reason: this change has no UI surface',
      '---',
      '',
      '# Interaction Design',
      '',
      'This change is a CLI-only refactor; there is no screen to derive.',
    ].join('\n'), 'utf8');
    const r = runCli(['gate', 'design-na-empty'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).not.toMatch(ZERO_ROWS);
    expect(r.stdout + r.stderr).toMatch(/applicability: not-applicable/i);
  });

  it.skipIf(!hasPython())('T1e: a legacy dir with an empty chain warns on stdout; --strict moves it to stderr', () => {
    const changeDir = scaffold(tmpRepo, 'design-legacy-empty', { governed: false });
    writeDesign(changeDir, { ...NEUTRAL }); // both tables empty

    const normal = runCli(['gate', 'design-legacy-empty'], { cwd: tmpRepo, home: tmpHome });
    expect(normal.stdout).toMatch(ZERO_ROWS);
    expect(normal.stderr).not.toMatch(ZERO_ROWS);

    const strict = runCli(['gate', 'design-legacy-empty', '--strict'], { cwd: tmpRepo, home: tmpHome });
    expect(strict.status).not.toBe(0);
    expect(strict.stderr).toMatch(ZERO_ROWS);
    expect(strict.stdout).not.toMatch(ZERO_ROWS);
  });
});
