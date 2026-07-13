import { WORKFLOW_PROFILES } from './cdd-policy.schema.js';

const boundaryStatus = { type: 'string', enum: ['passed', 'failed', 'unknown', 'not-applicable'] } as const;

export const runtimeEvidenceSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://cdd-kit/schemas/runtime-evidence-v1.schema.json',
  title: 'CDD Runtime Evidence v1',
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'run_id', 'change_id', 'repository', 'profile', 'boundary', 'checks', 'approvals', 'final_status', 'created_at'],
  properties: {
    schema_version: { const: '1.0.0' },
    run_id: { type: 'string', minLength: 1 },
    change_id: { type: 'string', minLength: 1 },
    repository: {
      type: 'object', additionalProperties: false,
      required: ['root', 'base_commit', 'head_commit', 'working_tree_digest'],
      properties: {
        root: { type: 'string', minLength: 1 },
        base_commit: { type: ['string', 'null'] }, head_commit: { type: ['string', 'null'] },
        working_tree_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      },
    },
    profile: { type: 'string', enum: WORKFLOW_PROFILES },
    boundary: {
      type: 'object', additionalProperties: false,
      required: ['changed_operations', 'route', 'request', 'variants', 'consumers', 'coverage_non_vacuous'],
      properties: {
        changed_operations: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        route: boundaryStatus, request: boundaryStatus,
        variants: { type: 'object', additionalProperties: boundaryStatus },
        consumers: boundaryStatus, coverage_non_vacuous: { type: 'boolean' },
      },
    },
    checks: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'status', 'evidence'],
        properties: { id: { type: 'string', minLength: 1 }, status: boundaryStatus, evidence: { type: 'array', items: { type: 'string' } } },
      },
    },
    approvals: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'status'],
        properties: { id: { type: 'string', minLength: 1 }, status: { type: 'string', enum: ['approved', 'rejected', 'pending', 'not-required'] }, actor: { type: 'string' } },
      },
    },
    final_status: { type: 'string', enum: ['passed', 'failed', 'blocked', 'in-progress'] },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;
