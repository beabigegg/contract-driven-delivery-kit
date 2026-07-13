const PROFILE = ['lightweight', 'balanced', 'controlled', 'strict'] as const;

export const cddPolicySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://cdd-kit/schemas/policy-v1.schema.json',
  title: 'CDD Project Policy v1',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'default_profile', 'boundary_guard', 'approvals', 'profiles'],
  properties: {
    version: { const: 1 },
    default_profile: { type: 'string', enum: PROFILE },
    shadow_mode: { type: 'boolean', default: true },
    boundary_guard: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'fail_on_zero_coverage', 'changed_api_requires_typed_request', 'changed_api_requires_typed_response'],
      properties: {
        enabled: { type: 'boolean' },
        fail_on_zero_coverage: { type: 'boolean' },
        changed_api_requires_typed_request: { type: 'boolean' },
        changed_api_requires_typed_response: { type: 'boolean' },
        require_complete_variant_discovery: { type: 'boolean', default: true },
        generic_schema_policy: { type: 'string', enum: ['allow', 'controlled', 'deny'] },
      },
    },
    approvals: {
      type: 'object',
      additionalProperties: false,
      required: ['breaking_api', 'destructive_migration', 'auth_policy', 'production_operation'],
      properties: {
        breaking_api: { type: 'string', enum: ['required', 'optional'] },
        destructive_migration: { type: 'string', enum: ['required', 'optional'] },
        auth_policy: { type: 'string', enum: ['required', 'optional'] },
        production_operation: { type: 'string', enum: ['required', 'optional'] },
      },
    },
    profiles: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: Object.fromEntries(PROFILE.map(profile => [profile, {
        type: 'object',
        additionalProperties: false,
        required: ['validators', 'independent_review', 'state_persistence', 'fail_on_unknown'],
        properties: {
          validators: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          independent_review: { type: 'boolean' },
          state_persistence: { type: 'string', enum: ['ephemeral', 'runtime', 'committed'] },
          fail_on_unknown: { type: 'boolean' },
          legacy_workflow: { type: 'boolean' },
          acceptance_oracle: { type: 'string', enum: ['not-required', 'conditional', 'required'] },
        },
      }])),
    },
    acceptance: {
      type: 'object',
      additionalProperties: false,
      properties: {
        authorized_logins: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        authorized_associations: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['OWNER', 'MEMBER', 'COLLABORATOR'] } },
        // Whether a chat-confirmed receipt binds to the exact source-branch HEAD
        // (default true) or only to the acceptance-criteria hash (false). Binding
        // to HEAD means every push re-stales the confirmation; binding to the
        // criteria hash means a re-confirmation is required only when the criteria
        // themselves change. Setting this false is a recorded loosening -- the
        // human approved the CRITERIA, not the exact commit -- surfaced as a gate
        // warning (see docs/loosening-the-harness.md).
        chat_binds_head: { type: 'boolean', default: true },
      },
    },
    // Recorded, reviewable acknowledgments for deliberately loosened "bone"
    // protections (see docs/loosening-the-harness.md). Each entry names the
    // disabled protection by id and records why it is safe. `cdd-kit policy
    // check` errors on a disabled bone with no matching acknowledgment and warns
    // (does not fail) when one is present -- loosening becomes explicit and
    // evidence-gated instead of silent.
    loosening: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason'],
        properties: {
          id: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 10 },
          reversible: { type: 'boolean' },
          evidence: { type: 'string', minLength: 1 },
        },
      },
    },
    exceptions: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'operation', 'class', 'reason', 'owner', 'expires'],
        properties: {
          id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' },
          operation: { type: 'string', pattern: '^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /' },
          class: { type: 'string', enum: ['open-content', 'legacy', 'binary', 'stream'] },
          reason: { type: 'string', minLength: 10 },
          owner: { type: 'string', minLength: 1 },
          expires: { type: 'string', format: 'date' },
          approval: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

export { PROFILE as WORKFLOW_PROFILES };
