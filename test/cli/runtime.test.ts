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

    const verify = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(verify.status, verify.stderr).toBe(0);
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

    const plan = runCli(['work', changeId, 'Update', 'documentation', '--require-acceptance', '--json'], { cwd: repo, home });
    const state = JSON.parse(plan.stdout);
    const verify = runCli(['runtime', 'verify', state.run_id, '--json'], { cwd: repo, home });
    expect(verify.status, verify.stderr).toBe(0);
    expect(JSON.parse(verify.stdout).evidence.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'acceptance-oracle', status: 'passed' }),
    ]));
  });
});
