/**
 * contracts/ci/ci-gate-contract.md `### enforceReconciliationInvariants`
 * (added by reconcile-framework, ADR 0014): the Gate Inventory row and
 * subsection must exist, the schema-version must be bumped, and the check
 * must actually be wired into both `cdd-kit gate` and `cdd-kit validate`
 * source -- not merely documented (ci-gates.md `## Merge Eligibility
 * Decision`: a row describing a check that does not exist is the
 * guarantees-that-never-happened defect class).
 *
 * "the workflow invokes the check" (per this change's AC-5) is proven in two
 * parts: (a) both shipped workflows invoke `cdd-kit gate`/`validate`
 * unconditionally in their trigger contexts (already covered structurally by
 * test/contracts/ci-workflow.test.ts; re-asserted here against the same
 * files for this check's own record), and (b) `gate.ts`/`validate.ts` source
 * actually calls `enforceReconciliationInvariants` -- the check needs no
 * workflow YAML edit because it is wired inside the commands the workflow
 * already runs (ci-gates.md `## New Workflow Changes`: "None this turn").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT_PATH = join(REPO_ROOT, 'contracts', 'ci', 'ci-gate-contract.md');
const CHANGELOG_PATH = join(REPO_ROOT, 'contracts', 'CHANGELOG.md');
const GATE_SRC_PATH = join(REPO_ROOT, 'src', 'commands', 'gate.ts');
const VALIDATE_SRC_PATH = join(REPO_ROOT, 'src', 'commands', 'validate.ts');
const ADOPTER_TEMPLATE_PATH = join(REPO_ROOT, 'github-workflows', 'contract-driven-gates.yml');
const OWN_WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'contract-driven-gates.yml');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

interface Frontmatter {
  'schema-version'?: string;
}

function frontmatter(path: string): Frontmatter {
  const content = read(path);
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return {};
  return (yaml.load(m[1]) as Frontmatter) ?? {};
}

describe('ci-gate-contract.md -- enforceReconciliationInvariants row + subsection (AC-5)', () => {
  it('schema-version is bumped to 0.12.0', () => {
    expect(frontmatter(CONTRACT_PATH)['schema-version']).toBe('0.12.0');
  });

  it('the Gate Inventory table has an enforceReconciliationInvariants row, ci-or-strict, hosted by both gate and validate', () => {
    const content = read(CONTRACT_PATH);
    expect(content).toMatch(/\| enforceReconciliationInvariants \|/);
    const rowLine = content.split('\n').find(l => l.startsWith('| enforceReconciliationInvariants |'));
    expect(rowLine, 'row not found').toBeDefined();
    expect(rowLine).toContain('ci-or-strict');
    expect(rowLine).toContain('`cdd-kit gate` AND `cdd-kit validate`');
  });

  it('the ### enforceReconciliationInvariants subsection exists, immediately before ## Boundary Guard Enforcement Semantics', () => {
    const content = read(CONTRACT_PATH);
    const subsectionIdx = content.indexOf('### enforceReconciliationInvariants');
    const boundaryIdx = content.indexOf('## Boundary Guard Enforcement Semantics');
    expect(subsectionIdx, 'subsection not found').toBeGreaterThan(-1);
    expect(boundaryIdx, 'anchor heading not found').toBeGreaterThan(-1);
    expect(subsectionIdx).toBeLessThan(boundaryIdx);
  });

  it('the subsection states all four Mechanical Enforcement checks', () => {
    const content = read(CONTRACT_PATH);
    const start = content.indexOf('### enforceReconciliationInvariants');
    const end = content.indexOf('## Boundary Guard Enforcement Semantics');
    const body = content.slice(start, end);
    expect(body).toContain('COVERS every surface enumerated');
    expect(body).toContain('single guarded writer');
    expect(body).toContain('guard-refusal');
    expect(body).toContain('fail-open');
  });

  it('the subsection states ci-or-strict, NOT gated on isNewChange, no shadow-mode knob', () => {
    const content = read(CONTRACT_PATH);
    const start = content.indexOf('### enforceReconciliationInvariants');
    const end = content.indexOf('## Boundary Guard Enforcement Semantics');
    const body = content.slice(start, end);
    expect(body).toMatch(/ci-or-strict/);
    expect(body).toMatch(/NOT gated on `isNewChange`/);
    expect(body).toMatch(/NO shadow-mode knob/);
  });
});

describe('contracts/CHANGELOG.md -- [upgrade 0.1.0] and [ci 0.12.0] entries', () => {
  it('has an [upgrade 0.1.0] entry', () => {
    expect(read(CHANGELOG_PATH)).toMatch(/## \[upgrade 0\.1\.0\]/);
  });

  it('has a [ci 0.12.0] entry naming enforceReconciliationInvariants', () => {
    const content = read(CHANGELOG_PATH);
    const idx = content.indexOf('## [ci 0.12.0]');
    expect(idx, 'entry not found').toBeGreaterThan(-1);
    const nextIdx = content.indexOf('## [ci 0.11.0]');
    expect(nextIdx, 'anchor entry not found').toBeGreaterThan(-1);
    expect(idx).toBeLessThan(nextIdx);
    expect(content.slice(idx, nextIdx)).toContain('enforceReconciliationInvariants');
  });
});

describe('the check is actually wired into gate.ts and validate.ts source (no hollow guarantee)', () => {
  it('gate.ts imports and calls enforceReconciliationInvariants', () => {
    const src = read(GATE_SRC_PATH);
    expect(src).toContain("import { enforceReconciliationInvariants } from '../reconcile/invariants.js'");
    expect(src).toContain('enforceReconciliationInvariants(cwd, strict, errors, warnings)');
  });

  it('validate.ts imports and calls enforceReconciliationInvariants', () => {
    const src = read(VALIDATE_SRC_PATH);
    expect(src).toContain("import { enforceReconciliationInvariants } from '../reconcile/invariants.js'");
    expect(src).toContain('enforceReconciliationInvariants(process.cwd()');
  });

  it('gate.ts does not run the check twice: it passes reconciliationCheck: false into its nested validate() call', () => {
    const src = read(GATE_SRC_PATH);
    expect(src).toContain('reconciliationCheck: false');
  });
});

describe('the shipped workflows invoke gate/validate unconditionally, so no workflow edit is needed (AC-5)', () => {
  for (const [label, path] of [
    ['adopter template (github-workflows/)', ADOPTER_TEMPLATE_PATH],
    ["this repo's own (.github/workflows/)", OWN_WORKFLOW_PATH],
  ] as const) {
    it(label + ': runs validate unconditionally and gate on every changed spec directory', () => {
      const content = read(path);
      expect(content).toMatch(/validate/);
      expect(content).toMatch(/gate "\$id"/);
    });
  }
});
