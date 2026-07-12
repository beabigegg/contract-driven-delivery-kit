import { executionCapsuleSchema } from './execution-capsule.schema.js';

const {
  $schema: _capsuleDraft,
  $id: _capsuleId,
  title: _capsuleTitle,
  ...embeddedCapsuleSchema
} = executionCapsuleSchema;

export const runtimeStateSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://cdd-kit/schemas/runtime-state-v1.schema.json',
  title: 'CDD Runtime State v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'run_id', 'change_id', 'status', 'provider', 'capsule', 'pending_approvals', 'steps', 'created_at', 'updated_at'],
  properties: {
    schema_version: { const: '1.0.0' },
    run_id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' },
    change_id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' },
    status: { type: 'string', enum: ['planned', 'running', 'blocked', 'failed', 'completed'] },
    provider: { type: 'string', enum: ['claude', 'codex', 'both'] },
    capsule: embeddedCapsuleSchema,
    pending_approvals: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    steps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'kind', 'status', 'attempt'],
        properties: {
          id: { type: 'string', minLength: 1 },
          kind: { type: 'string', enum: ['impact', 'boundary', 'test', 'agent', 'review', 'approval', 'export'] },
          status: { type: 'string', enum: ['pending', 'running', 'passed', 'failed', 'blocked', 'superseded'] },
          attempt: { type: 'integer', minimum: 1 },
          evidence: { type: 'array', items: { type: 'string', minLength: 1 } },
          supersedes: { type: 'string', minLength: 1 },
        },
      },
    },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;
