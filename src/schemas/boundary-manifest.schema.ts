const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const boundaryManifestSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://cdd-kit/schemas/boundary-manifest-v1.schema.json',
  title: 'CDD Boundary Manifest v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'contract_digest', 'operations'],
  properties: {
    schema_version: { const: '1.0.0' },
    contract_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    generated_at: { type: 'string', format: 'date-time' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['method', 'path', 'variants', 'consumers', 'source_files', 'discovery'],
        properties: {
          method: { type: 'string', enum: HTTP_METHODS },
          path: { type: 'string', pattern: '^/' },
          request_schema: { type: 'string', minLength: 1 },
          parameters: {
            type: 'array', uniqueItems: true,
            items: {
              type: 'object', additionalProperties: false, required: ['name', 'in', 'schema', 'required'],
              properties: {
                name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' },
                in: { type: 'string', enum: ['path', 'query'] },
                schema: { type: 'string', minLength: 1 },
                required: { type: 'boolean' },
              },
            },
          },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'status', 'content_type', 'schema', 'required'],
              properties: {
                id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' },
                status: { type: 'integer', minimum: 100, maximum: 599 },
                content_type: { type: 'string', minLength: 1 },
                schema: { type: 'string', minLength: 1 },
                required: { type: 'boolean' },
                dimensions: { type: 'object', additionalProperties: { type: 'string' } },
                capture: {
                  type: 'object', additionalProperties: false, required: ['path', 'adapter', 'target'],
                  properties: {
                    path: { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+' },
                    adapter: { type: 'string', enum: ['fastapi-testclient', 'flask-test-client', 'express-supertest'] },
                    target: { type: 'string', minLength: 3 },
                    request: {
                      type: 'object', additionalProperties: false,
                      properties: {
                        path: { type: 'string', pattern: '^/' },
                        query: { type: 'object', additionalProperties: { type: 'string' } },
                        headers: { type: 'object', additionalProperties: { type: 'string' } },
                        json: {},
                      },
                    },
                    provenance: {
                      type: 'object', additionalProperties: false,
                      required: ['adapter_version', 'runner_version', 'target_digest', 'contract_digest', 'producer_digest', 'capture_digest', 'commit', 'produced_at'],
                      properties: {
                        adapter_version: { const: '1.0.0' }, runner_version: { type: 'string', minLength: 1 },
                        target_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                        contract_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                        producer_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                        capture_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                        commit: { type: 'string', pattern: '^[a-f0-9]{7,64}$' }, produced_at: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          consumers: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+' } },
          source_files: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+' } },
          generated_artifacts: {
            type: 'array', uniqueItems: true,
            items: {
              type: 'object', additionalProperties: false,
              required: ['path', 'digest', 'input_contract_digest', 'generator', 'generator_version', 'input'],
              properties: {
                path: { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+' },
                digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                input_contract_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                generator: { const: 'openapi-typescript' }, generator_version: { type: 'string', minLength: 1 },
                input: { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+' },
              },
            },
          },
          discovery: {
            type: 'object',
            additionalProperties: false,
            required: ['adapter', 'completeness', 'unknown_reasons'],
            properties: {
              adapter: { type: 'string', minLength: 1 },
              completeness: { type: 'string', enum: ['complete', 'partial', 'unknown'] },
              unknown_reasons: { type: 'array', items: { type: 'string', minLength: 1 } },
            },
          },
        },
      },
    },
  },
} as const;

export { HTTP_METHODS };
