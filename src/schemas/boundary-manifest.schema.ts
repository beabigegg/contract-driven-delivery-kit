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
                  type: 'object', additionalProperties: false, required: ['path', 'source'],
                  properties: {
                    path: { type: 'string', minLength: 1, pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+' },
                    source: { type: 'string', minLength: 1 },
                    digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                  },
                },
              },
            },
          },
          consumers: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          source_files: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
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
