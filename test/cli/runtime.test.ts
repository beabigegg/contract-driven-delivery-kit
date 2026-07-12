import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';
import yaml from 'js-yaml';
import { computeAcceptanceHash, writeAcceptanceLock, type AcceptanceFile } from '../../src/utils/acceptance-hash.js';

let repo: string;
let home: string;

const policy = `version: 1
default_profile: balanced
shadow_mode: true
boundary_guard:
  enabled: true
  fail_on_zero_coverage: true
  changed_api_requires_typed_request: true
  changed_api_requires_typed_response: true
  require_complete_variant_discovery: true
  generic_schema_policy: controlled
approvals:
  breaking_api: required
  destructive_migration: required
  auth_policy: required
  production_operation: required
profiles:
  lightweight: { validators: [quality], independent_review: false, state_persistence: ephemeral, fail_on_unknown: false }
  balanced: { validators: [impact, boundary, tests], independent_review: false, state_persistence: runtime, fail_on_unknown: true }
  controlled: { validators: [impact, boundary, tests, review], independent_review: true, state_persistence: runtime, fail_on_unknown: true }
  strict: { validators: [legacy-gate], independent_review: true, state_persistence: committed, fail_on_unknown: true, legacy_workflow: true }
exceptions: []
`;

const contract = `# API Contract
## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
`;

function git(args: string[]) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

function recordAgent(runId: string) {
  const result = runCli([
    'runtime', 'agent', 'complete', runId, '--status', 'passed', '--actor', 'test-agent',
    '--summary', 'Implementation completed inside the selected runtime scope.', '--json',
  ], { cwd: repo, home });
  expect(result.status, result.stderr).toBe(0);
}

beforeEach(() => {
  repo = makeTempDir('cdd-runtime-'); home = makeTempDir('cdd-runtime-home-');
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(repo, '.cdd', 'policy.yml'), policy, 'utf8');
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), contract, 'utf8');
  writeFileSync(join(repo, 'README.md'), '# Project\n', 'utf8');
  git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']);
  git(['add', '.']); git(['commit', '-m', 'baseline']);
});

afterEach(() => { cleanupDir(repo); cleanupDir(home); });

describe('agent-native runtime', () => {
  it('routes documentation-only work to lightweight and verifies without test ceremony', () => {
    writeFileSync(join(repo, 'README.md'), '# Project\n\nMore docs.\n', 'utf8');
    const plan = runCli(['work', 'docs-change', 'Update', 'documentation', '--json'], { cwd: repo, home });
    expect(plan.status, plan.stderr).toBe(0);
    const state = JSON.parse(plan.stdout);
    expect(state.capsule.profile).toBe('lightweight');
    expect(state.status).toBe('planned');
    expect(readFileSync(join(repo, '.cdd', 'runtime', state.run_id, 'capsule.json'), 'utf8')).toContain('documentation-only');

    recordAgent(state.run_id);
    const checks = runCli(['runtime', 'check', 'run', state.run_id, '--all', '--json'], { cwd: repo, home });
    expect(checks.status, checks.stderr).toBe(0);

    const verify = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(verify.status, verify.stdout + verify.stderr).toBe(0);
    expect(JSON.parse(verify.stdout).evidence.final_status).toBe('passed');
  });

  it('invalidates resume when policy or working-tree inputs change', () => {
    writeFileSync(join(repo, 'README.md'), '# Project\n\nMore docs.\n', 'utf8');
    const plan = JSON.parse(runCli(['work', 'docs-change', 'Update', 'documentation', '--json'], { cwd: repo, home }).stdout);
    writeFileSync(join(repo, '.cdd', 'policy.yml'), policy.replace('shadow_mode: true', 'shadow_mode: false'), 'utf8');
    const resume = runCli(['runtime', 'resume', plan.run_id, '--json'], { cwd: repo, home });
    expect(resume.status).toBe(1);
    const result = JSON.parse(resume.stdout);
    expect(result.invalidated).toContain('policy');
    expect(result.state.status).toBe('blocked');
  });

  it('invalidates resume when the content of an already-untracked input changes', () => {
    writeFileSync(join(repo, 'notes.txt'), 'first\n', 'utf8');
    const plan = JSON.parse(runCli(['work', 'notes-change', 'Update', 'notes', '--json'], { cwd: repo, home }).stdout);
    writeFileSync(join(repo, 'notes.txt'), 'second\n', 'utf8');
    const resume = runCli(['runtime', 'resume', plan.run_id, '--json'], { cwd: repo, home });
    expect(resume.status).toBe(1);
    expect(JSON.parse(resume.stdout).invalidated).toContain('working_tree');
  });

  it('rejects traversal in change and run ids before reading or writing runtime files', () => {
    const plan = runCli(['work', '../../outside', 'Unsafe', '--json'], { cwd: repo, home });
    expect(plan.status).toBe(2);
    expect(plan.stderr).toContain('Invalid change id');
    expect(existsSync(join(repo, '..', '..', 'outside'))).toBe(false);

    const status = runCli(['runtime', 'status', '../../outside', '--json'], { cwd: repo, home });
    expect(status.status).toBe(2);
    expect(status.stderr).toContain('Invalid runtime run id');
  });

  it('requires and verifies acceptance only when the capsule declares it', () => {
    writeFileSync(join(repo, 'README.md'), '# Project\n\nAcceptance-sensitive docs.\n', 'utf8');
    const ordinary = runCli(['work', 'ordinary-docs', 'Update', 'documentation', '--json'], { cwd: repo, home });
    expect(JSON.parse(ordinary.stdout).capsule.required_evidence).not.toContain('acceptance-oracle');

    const required = runCli(['work', 'human-contract', 'Update', 'documentation', '--require-acceptance', '--json'], { cwd: repo, home });
    expect(required.status, required.stderr).toBe(0);
    const state = JSON.parse(required.stdout);
    expect(state.capsule.required_evidence).toContain('acceptance-oracle');
    const verify = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(verify.status).toBe(1);
    const result = JSON.parse(verify.stdout);
    expect(result.evidence.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'acceptance-oracle', status: 'failed' }),
    ]));
  });

  it('always includes acceptance provenance in a strict capsule', () => {
    writeFileSync(join(repo, 'README.md'), '# Project\n\nStrict docs.\n', 'utf8');
    const result = runCli(['work', 'strict-docs', 'Update', 'documentation', '--profile', 'strict', '--json'], { cwd: repo, home });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).capsule.required_evidence).toContain('acceptance-oracle');
  });

  it('passes required runtime acceptance only with a real locked oracle and recorded run', () => {
    const changeId = 'accepted-contract';
    const changeDir = join(repo, 'specs', 'changes', changeId);
    mkdirSync(changeDir, { recursive: true });
    const oracle: AcceptanceFile = {
      'oracle-version': '0.1.0', 'authored-by': 'human',
      cases: [{
        id: 'documented-behavior', given: 'an explicit input', when: 'the behavior runs', then: 'the agreed result is returned',
        input: { value: 1 }, expect: { value: 1 },
      }],
      rules: [],
    };
    writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump(oracle), 'utf8');
    writeAcceptanceLock(repo, changeId, computeAcceptanceHash(oracle));
    writeFileSync(join(changeDir, 'test-evidence.yml'), yaml.dump({
      'change-id': changeId, 'schema-version': '0.1.0', 'required-phases': ['acceptance'],
      runs: [{ phase: 'acceptance', status: 'passed', command: 'vitest acceptance', summary: 'summary.json' }],
      'final-status': 'passed',
    }), 'utf8');
    writeFileSync(join(repo, 'README.md'), '# Project\n\nAccepted docs.\n', 'utf8');
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      name: 'accepted-runtime-project', private: true,
      scripts: { test: 'node -e "process.exit(0)"' },
    }, null, 2) + '\n', 'utf8');

    const plan = runCli(['work', changeId, 'Update', 'documentation', '--require-acceptance', '--json'], { cwd: repo, home });
    const state = JSON.parse(plan.stdout);
    recordAgent(state.run_id);
    const checks = runCli(['runtime', 'check', 'run', state.run_id, '--all', '--json'], { cwd: repo, home });
    expect(checks.status, checks.stderr).toBe(0);
    const verify = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(verify.status, verify.stdout + verify.stderr).toBe(0);
    expect(JSON.parse(verify.stdout).evidence.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'acceptance-oracle', status: 'passed' }),
    ]));
  });

  it('gates a balanced runtime with native evidence and no legacy change directory', () => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      name: 'runtime-only-project', private: true,
      scripts: { test: 'node -e "process.exit(0)"' },
    }, null, 2) + '\n', 'utf8');
    const plan = runCli(['work', 'runtime-only', 'Add', 'a', 'normal', 'feature', '--profile', 'balanced', '--json'], { cwd: repo, home });
    expect(plan.status, plan.stderr).toBe(0);
    const state = JSON.parse(plan.stdout);
    expect(existsSync(join(repo, 'specs', 'changes', 'runtime-only'))).toBe(false);
    expect(state.capsule.check_plan).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tests', required: true })]));
    const prompt = runCli(['runtime', 'agent', 'prompt', state.run_id, '--json'], { cwd: repo, home });
    expect(prompt.status, prompt.stderr).toBe(0);
    const promptEnvelope = JSON.parse(prompt.stdout);
    expect(promptEnvelope.doctrine).toEqual(state.capsule.doctrine);
    expect(promptEnvelope.prompt).toContain('runtime-only');
    expect(promptEnvelope.estimated_tokens).toBeGreaterThan(0);
    recordAgent(state.run_id);
    const resumed = runCli(['runtime', 'resume', state.run_id, '--json'], { cwd: repo, home });
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(JSON.parse(resumed.stdout).invalidated).toEqual([]);
    const checks = runCli(['runtime', 'check', 'run', state.run_id, '--all', '--json'], { cwd: repo, home });
    expect(checks.status, checks.stderr).toBe(0);
    const gate = runCli(['gate', 'runtime-only'], { cwd: repo, home });
    expect(gate.status, gate.stdout + gate.stderr).toBe(0);
    expect(gate.stdout + gate.stderr).toMatch(/balanced runtime/i);
    const parity = runCli(['runtime', 'parity', state.run_id, '--json'], { cwd: repo, home });
    expect(parity.status).toBe(1); // strict correctly rejects the intentionally absent legacy artifacts
    const parityReport = JSON.parse(parity.stdout).report;
    expect(parityReport.verdicts).toMatchObject({ runtime: 'passed', strict: 'failed', equivalent: false, strict_compatible: true });
    expect(parityReport.metrics.legacy_required_artifacts).toBe(7);
    expect(parityReport.metrics.dynamic_prompt_estimated_tokens).toBeGreaterThan(0);
  });

  it('requires digest-bound independent review and approval for controlled work', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'auth.ts'), 'export const role = "admin";\n', 'utf8');
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      name: 'controlled-runtime-project', private: true,
      scripts: { test: 'node -e "process.exit(0)"' },
    }, null, 2) + '\n', 'utf8');

    const planned = runCli(['work', 'auth-change', 'Change', 'authorization', 'policy', '--json'], { cwd: repo, home });
    expect(planned.status, planned.stderr).toBe(0);
    const state = JSON.parse(planned.stdout);
    expect(state.capsule.profile).toBe('controlled');
    expect(state.capsule.approvals).toContain('auth_policy');
    expect(state.capsule.required_evidence).toContain('review');
    const reviewerPrompt = runCli(['runtime', 'agent', 'prompt', state.run_id, '--role', 'reviewer', '--json'], { cwd: repo, home });
    expect(reviewerPrompt.status, reviewerPrompt.stderr).toBe(0);
    expect(JSON.parse(reviewerPrompt.stdout).prompt).toContain('Independently review');

    recordAgent(state.run_id);
    expect(runCli(['runtime', 'check', 'run', state.run_id, '--all'], { cwd: repo, home }).status).toBe(0);
    const beforeDecisions = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(beforeDecisions.status).toBe(1);
    expect(JSON.parse(beforeDecisions.stdout).evidence.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'review', status: 'unknown' }),
    ]));

    const selfReview = runCli([
      'runtime', 'review', state.run_id, '--verdict', 'passed', '--actor', 'test-agent',
      '--summary', 'The implementation agent attempted to self review.',
    ], { cwd: repo, home });
    expect(selfReview.status).toBe(2);
    expect(selfReview.stderr).toContain('must differ');

    const review = runCli([
      'runtime', 'review', state.run_id, '--verdict', 'passed', '--actor', 'reviewer@example.com',
      '--summary', 'Authorization behavior and tests were independently reviewed.', '--json',
    ], { cwd: repo, home });
    expect(review.status, review.stderr).toBe(0);
    const selfApproval = runCli([
      'runtime', 'approve', state.run_id, 'auth_policy', '--actor', 'test-agent',
      '--reason', 'The implementation agent attempted self approval.', '--scope', 'src/auth.ts',
    ], { cwd: repo, home });
    expect(selfApproval.status).toBe(2);
    expect(selfApproval.stderr).toContain('cannot approve its own change');
    const approval = runCli([
      'runtime', 'approve', state.run_id, 'auth_policy', '--actor', 'owner@example.com',
      '--reason', 'The authorization policy change is approved.', '--scope', 'src/auth.ts', '--json',
    ], { cwd: repo, home });
    expect(approval.status, approval.stderr).toBe(0);

    const passed = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(passed.status, passed.stdout + passed.stderr).toBe(0);
    expect(JSON.parse(passed.stdout).evidence.approvals).toContainEqual({ id: 'auth_policy', status: 'approved', actor: 'owner@example.com' });

    writeFileSync(join(repo, 'src', 'auth.ts'), 'export const role = "superadmin";\n', 'utf8');
    const stale = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(stale.status).toBe(1);
    const staleEvidence = JSON.parse(stale.stdout).evidence;
    expect(staleEvidence.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tests', status: 'unknown' }),
      expect.objectContaining({ id: 'review', status: 'unknown' }),
    ]));
    expect(staleEvidence.approvals).toContainEqual({ id: 'auth_policy', status: 'pending' });
  });
});
