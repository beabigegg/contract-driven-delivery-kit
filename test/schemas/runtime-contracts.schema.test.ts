import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { cddPolicySchema } from '../../src/schemas/cdd-policy.schema.js';
import { boundaryManifestSchema } from '../../src/schemas/boundary-manifest.schema.js';
import { executionCapsuleSchema } from '../../src/schemas/execution-capsule.schema.js';
import { runtimeStateSchema } from '../../src/schemas/runtime-state.schema.js';
import { runtimeEvidenceSchema } from '../../src/schemas/runtime-evidence.schema.js';

function validator(schema: object) {
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const digest = `sha256:${'a'.repeat(64)}`;

const policy = {
  version: 1,
  default_profile: 'balanced',
  shadow_mode: true,
  boundary_guard: {
    enabled: true,
    fail_on_zero_coverage: true,
    changed_api_requires_typed_request: true,
    changed_api_requires_typed_response: true,
    require_complete_variant_discovery: true,
    generic_schema_policy: 'controlled',
  },
  approvals: {
    breaking_api: 'required', destructive_migration: 'required',
    auth_policy: 'required', production_operation: 'required',
  },
  profiles: {
    balanced: { validators: ['boundary', 'tests'], independent_review: false, state_persistence: 'runtime', fail_on_unknown: true, acceptance_oracle: 'not-required' },
    strict: { validators: ['legacy-gate'], independent_review: true, state_persistence: 'committed', fail_on_unknown: true, legacy_workflow: true, acceptance_oracle: 'required' },
  },
  exceptions: [],
};

const capsule = {
  schema_version: '1.0.0', change_id: 'add-status', objective: 'Add status response', profile: 'controlled',
  capabilities: ['contract'], doctrine: ['api-boundary', 'core-engineering'], independent_review: true,
  risk_signals: [{ id: 'api-response', source: 'diff', confidence: 'high', evidence: ['contracts/api/api-contract.md'] }],
  affected: { files: ['src/status.ts'], symbols: ['getStatus'], operations: ['GET /status'], contracts: ['contracts/api/api-contract.md'], tests: ['test/status.test.ts'] },
  write_scope: ['src/status.ts', 'test/status.test.ts'], invariants: ['Existing fields remain compatible'],
  required_evidence: ['response-200'],
  check_plan: [{ id: 'tests', kind: 'test', command: 'npm test', required: true }],
  approvals: [], input_digests: { contract: digest },
};

describe('agent-native runtime contracts', () => {
  it('accepts a complete v1 project policy and rejects unowned exceptions', () => {
    const validate = validator(cddPolicySchema);
    expect(validate(policy), JSON.stringify(validate.errors)).toBe(true);
    const bad = { ...policy, exceptions: [{ id: 'legacy', operation: 'GET /x', class: 'legacy', reason: 'temporary legacy response' }] };
    expect(validate(bad)).toBe(false);
    expect(validate({ ...policy, profiles: { ...policy.profiles, balanced: { ...policy.profiles.balanced, acceptance_oracle: 'sometimes' } } })).toBe(false);
  });

  it('accepts a typed multi-variant boundary manifest', () => {
    const validate = validator(boundaryManifestSchema);
    const manifest = {
      schema_version: '1.0.0', contract_digest: digest, generated_at: '2026-07-11T00:00:00.000Z',
      operations: [{
        method: 'POST', path: '/jobs', request_schema: 'CreateJobRequest', consumers: ['web/src/jobs.ts'], source_files: ['src/jobs.ts'],
        variants: [
          { id: 'sync-201', status: 201, content_type: 'application/json', schema: 'Job', required: true },
          { id: 'async-202', status: 202, content_type: 'application/json', schema: 'JobAccepted', required: true, dimensions: { mode: 'async' } },
        ],
        discovery: { adapter: 'typescript', completeness: 'complete', unknown_reasons: [] },
      }],
    };
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts a capsule embedded in resumable runtime state', () => {
    expect(validator(executionCapsuleSchema)(capsule)).toBe(true);
    const state = {
      schema_version: '1.0.0', run_id: 'run-1', change_id: 'add-status', status: 'running', provider: 'codex', capsule,
      pending_approvals: [], steps: [{ id: 'impact-1', kind: 'impact', status: 'passed', attempt: 1, evidence: ['.cdd/runtime/run-1/impact.json'] }],
      created_at: '2026-07-11T00:00:00.000Z', updated_at: '2026-07-11T00:01:00.000Z',
    };
    const validate = validator(runtimeStateSchema);
    expect(validate(state), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts digest-bound runtime evidence and rejects a vacuous shape omission', () => {
    const validate = validator(runtimeEvidenceSchema);
    const evidence = {
      schema_version: '1.0.0', run_id: 'run-1', change_id: 'add-status',
      repository: { root: '/repo', base_commit: null, head_commit: 'abc', working_tree_digest: digest },
      profile: 'controlled',
      boundary: { changed_operations: ['GET /status'], route: 'passed', request: 'not-applicable', variants: { 'GET /status#200': 'passed' }, consumers: 'passed', coverage_non_vacuous: true },
      checks: [{ id: 'boundary', status: 'passed', evidence: ['.cdd/runtime/run-1/boundary.json'] }],
      approvals: [], final_status: 'passed', created_at: '2026-07-11T00:00:00.000Z',
    };
    expect(validate(evidence), JSON.stringify(validate.errors)).toBe(true);
    const { boundary: _boundary, ...withoutBoundary } = evidence;
    expect(validate(withoutBoundary)).toBe(false);
  });
});
