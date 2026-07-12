import { WORKFLOW_PROFILES } from './cdd-policy.schema.js';

const stringArray = { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } } as const;

export const executionCapsuleSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://cdd-kit/schemas/execution-capsule-v1.schema.json',
  title: 'CDD Execution Capsule v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'change_id', 'objective', 'profile', 'capabilities', 'doctrine', 'independent_review', 'risk_signals', 'affected', 'write_scope', 'invariants', 'required_evidence', 'approvals', 'input_digests'],
  properties: {
    schema_version: { const: '1.0.0' },
    change_id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' },
    objective: { type: 'string', minLength: 1 },
    profile: { type: 'string', enum: WORKFLOW_PROFILES },
    capabilities: stringArray,
    doctrine: stringArray,
    independent_review: { type: 'boolean' },
    risk_signals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'source', 'confidence', 'evidence'],
        properties: {
          id: { type: 'string', minLength: 1 }, source: { type: 'string', minLength: 1 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, evidence: stringArray,
        },
      },
    },
    affected: {
      type: 'object', additionalProperties: false, required: ['files', 'symbols', 'operations', 'contracts', 'tests'],
      properties: { files: stringArray, symbols: stringArray, operations: stringArray, contracts: stringArray, tests: stringArray },
    },
    write_scope: stringArray,
    invariants: stringArray,
    required_evidence: stringArray,
    approvals: stringArray,
    input_digests: { type: 'object', additionalProperties: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } },
  },
} as const;
