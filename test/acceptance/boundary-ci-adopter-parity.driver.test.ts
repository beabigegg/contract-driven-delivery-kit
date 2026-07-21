/**
 * Acceptance driver for specs/changes/boundary-ci-adopter-parity/acceptance.yml
 * (ADR 0010). Answers are read LIVE from the oracle via the emitted loader and
 * each driven case runs the REAL CLI against a minimal adopter fixture — the
 * same deterministic one-finding fixture test/cli/boundary.test.ts established
 * (an explicitly selected operation with no manifest entry).
 *
 * The two git-heavy cases (base-resolved-once-for-contract-snapshot,
 * archive-only-push-stays-green) are proven end-to-end by
 * test/cli/boundary.test.ts AC-4 and test/cli/runtime.test.ts; this driver
 * covers the three enforcement-semantics cases plus the cross-cutting rule.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { makeTempDir, cleanupDir, runCli } from '../helpers.js';
import { loadCase } from '../../specs/templates/acceptance-driver/acceptance.loader.js';

const CHANGE_ID = 'boundary-ci-adopter-parity';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CONTRACT = `---
contract: api
schema-version: 1.0.0
---
# API Contract
## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /health | public | - | Health | - | test/health.test.ts |

## Schemas
### Health
| field | type | required | format | notes |
|---|---|---|---|---|
| ok | boolean | yes | | health state |
`;

function policyText(shadowMode: boolean): string {
  return [
    'version: 1',
    'default_profile: balanced',
    `shadow_mode: ${shadowMode}`,
    'boundary_guard:',
    '  enabled: true',
    '  fail_on_zero_coverage: true',
    '  changed_api_requires_typed_request: true',
    '  changed_api_requires_typed_response: true',
    '  require_complete_variant_discovery: true',
    '  generic_schema_policy: controlled',
    'approvals:',
    '  breaking_api: required',
    '  destructive_migration: required',
    '  auth_policy: required',
    '  production_operation: required',
    'profiles:',
    '  balanced:',
    '    validators: [boundary]',
    '    independent_review: false',
    '    state_persistence: runtime',
    '    fail_on_unknown: true',
    'exceptions: []',
    '',
  ].join('\n');
}

const BLOCKING_LINE = 'Boundary Guard: GET /health: Changed operation has no Boundary Guard manifest entry.';

let repo: string;
let home: string;
beforeEach(() => {
  repo = makeTempDir('cdd-bcap-driver-');
  home = makeTempDir('cdd-bcap-driver-home-');
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), CONTRACT, 'utf8');
});
afterEach(() => { cleanupDir(repo); cleanupDir(home); });

/** Run `boundary check` under the case's policy/flags; shape the actual result
 *  the way the oracle states it. `findings_blocked` means the finding surfaced
 *  as a BLOCKING error (stderr, no [shadow] tag) — the stream discipline
 *  test/cli/boundary.test.ts AC-1/AC-2 pin. */
function driveBoundaryCheck(input: { policy_shadow_mode: boolean; enforce_flag: boolean }) {
  writeFileSync(join(repo, '.cdd', 'policy.yml'), policyText(input.policy_shadow_mode), 'utf8');
  const args = ['boundary', 'check', '--operation', 'GET /health'];
  if (input.enforce_flag) args.push('--enforce');
  const r = runCli(args, { cwd: repo, home });
  return {
    exit_code: r.status,
    findings_blocked: r.stderr.includes(BLOCKING_LINE),
  };
}

describe('boundary-ci-adopter-parity acceptance driver (specs/changes/boundary-ci-adopter-parity/acceptance.yml)', () => {
  it('shadow-default-advisory', () => {
    const loaded = loadCase(CHANGE_ID, 'shadow-default-advisory');
    const actual = driveBoundaryCheck(loaded.input as never);
    expect(actual).toEqual(loaded.expect);
  });

  it('enforce-overrides-shadow', () => {
    const loaded = loadCase(CHANGE_ID, 'enforce-overrides-shadow');
    const actual = driveBoundaryCheck(loaded.input as never);
    expect(actual).toEqual(loaded.expect);
  });

  it('shadow-off-blocks-both-paths', () => {
    const loaded = loadCase(CHANGE_ID, 'shadow-off-blocks-both-paths');
    const actual = driveBoundaryCheck(loaded.input as never);
    expect(actual).toEqual(loaded.expect);
  });

  it('rule gate-standalone-enforcement-parity: one shared enforcement-semantics source, verified behaviourally and structurally', () => {
    // Behaviourally: for the SAME policy and the SAME finding, the standalone
    // command and the gate emit the identical advisory-vs-blocking shape. Both
    // sides derive the changed operation the same way — from git seeing the
    // untracked contract — exactly as the AC-3 end-to-end test does.
    writeFileSync(join(repo, '.cdd', 'policy.yml'), policyText(false), 'utf8');
    spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
    const standalone = runCli(['boundary', 'check'], { cwd: repo, home });
    mkdirSync(join(repo, 'specs', 'changes', 'parity-probe'), { recursive: true });
    const gate = runCli(['gate', 'parity-probe'], { cwd: repo, home });
    expect(standalone.stderr).toContain(BLOCKING_LINE);
    expect(gate.stderr).toContain(BLOCKING_LINE);
    // Both blocked; neither wears the advisory tag.
    expect(standalone.stderr).not.toContain('[shadow]');
    expect(gate.stderr).not.toContain('[shadow]');

    // Structurally: parity holds BY CONSTRUCTION only if both callers import
    // the one semantics module rather than re-deriving the decision. The gate
    // and the standalone command must both call runBoundaryGuard from
    // src/boundary/guard.ts, and neither may read shadow_mode on its own.
    const gateSrc = readFileSync(join(REPO_ROOT, 'src', 'commands', 'gate.ts'), 'utf8');
    const cmdSrc = readFileSync(join(REPO_ROOT, 'src', 'commands', 'boundary.ts'), 'utf8');
    expect(gateSrc).toMatch(/runBoundaryGuard/);
    expect(cmdSrc).toMatch(/runBoundaryGuard/);
  });
});
