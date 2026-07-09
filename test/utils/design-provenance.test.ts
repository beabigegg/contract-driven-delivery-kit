import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { openapiExport } from '../../src/commands/openapi-export.js';
import {
  resolveCitation,
  checkStateDiscriminatorUniqueness,
} from '../../src/utils/design-provenance.js';

const API_PATH = ['contracts', 'api', 'api-contract.md'];
const DATA_PATH = ['contracts', 'data', 'data-shape-contract.md'];
const OPENAPI_PATH = ['contracts', 'api', 'openapi.json'];

function apiContract(opts) {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|--------|------|------|----------------|-----------------|--------|-------|',
    ...opts.rows,
  ].join('\n');
  const fm = opts.applicability
    ? '---\ncontract: api\nschema-version: 0.1.0\nlast-changed: 2026-07-09\nbreaking-change-policy: deprecate-2-minors\napplicability: not-applicable\napplicability-reason: ' + opts.applicability + '\n---\n\n'
    : '---\ncontract: api\nschema-version: 0.1.0\nlast-changed: 2026-07-09\nbreaking-change-policy: deprecate-2-minors\n---\n\n';
  return fm + '# API Contract\n\n## API Style\n- response style: JSON REST\n\n## Endpoint Requirements\n' + table + '\n\n## Schemas\n' + (opts.schemas ?? '') + '\n\n## Error Format\nStandard envelope.\n\n## Compatibility Policy\nNo breaking changes.\n\n## Endpoint Inventory Policy\nAll endpoints listed.\n\n## Breaking Change Policy\nRFC required.\n';
}

function dataShapeContract(opts) {
  const rows = opts.conditions.map(function (c) { return '| ' + c + ' |  |  |  |'; }).join('\n');
  const fm = opts.applicability
    ? '---\ncontract: data\nschema-version: 0.1.0\nlast-changed: 2026-07-09\nbreaking-change-policy: deprecate-2-minors\napplicability: not-applicable\napplicability-reason: ' + opts.applicability + '\n---\n\n'
    : '---\ncontract: data\nschema-version: 0.1.0\nlast-changed: 2026-07-09\nbreaking-change-policy: deprecate-2-minors\n---\n\n';
  return fm + '# Data Shape Contract\n\n## Required Columns\n| column | type | nullable | allowed values | fallback | validation |\n|---|---|---|---|---|---|\n\n## Optional Columns\n| column | type | default | notes |\n|---|---|---|---|\n\n## Invalid Data Behavior\n| condition | expected behavior | error code / UI state | test |\n|---|---|---|---|\n' + rows + '\n\n## Export / Import Format\n\n## Row Limit / Truncation Policy\n';
}

var SCHEMAS_FIELD_TABLE = [
  '',
  '### OrderList',
  '| field | type | required | format | notes |',
  '|---|---|---|---|---|',
  '| items | Order[] | yes | | |',
  '| status | enum(ok, degraded) | yes | | |',
  '',
  '### Order',
  '| field | type | required | format | notes |',
  '|---|---|---|---|---|',
  '| id | string | yes | | |',
  '| total | number | yes | | |',
  '| customer | Customer | no | | |',
  '',
  '### Customer',
  '| field | type | required | format | notes |',
  '|---|---|---|---|---|',
  '| email | string | yes | | |',
  '',
].join('\n');

var SCHEMAS_JSON_BLOCK = [
  '',
  '### Ack',
  '```json-schema',
  '{ "type": "object", "properties": { "ok": { "type": "boolean" } } }',
  '```',
  '',
].join('\n');

var tmpRepo = '';

function write(relParts, content) {
  var p = join(tmpRepo, ...relParts);
  mkdirSync(join(tmpRepo, ...relParts.slice(0, -1)), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

async function regenerateOpenapi() {
  var code = await openapiExport({
    contract: join(tmpRepo, ...API_PATH),
    out: join(tmpRepo, ...OPENAPI_PATH),
  });
  expect(code).toBe(0);
}

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-design-provenance-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
});

describe('resolveCitation: endpoint + schema field (Tier A / Tier B / nested / array descent)', () => {
  it('resolves via a Tier A field table', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders → items', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('resolves via a Tier B json-schema block', async () => {
    write(API_PATH, apiContract({
      rows: ['| POST | /api/v1/ack | required | - | Ack | 400 | x |'],
      schemas: SCHEMAS_JSON_BLOCK,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('POST /api/v1/ack → ok', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('resolves a nested $ref dotted path', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders/:id | required | - | Order | 404 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders/:id → customer.email', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('descends items transparently to resolve an array-element field', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders → items.total', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('resolves a nested dotted path through an array AND a $ref together', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders → items.customer.email', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('fails a field citation for a field that does not exist on the schema', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders → nonexistent_field', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });
});

describe('resolveCitation: enum discriminator pin', () => {
  it('resolves a member present in the field enum(...) list', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders → status=ok', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('rejects a member absent from the enum(...) list', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders → status=missing', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/enum/i);
  });
});

describe('resolveCitation: errors-column status + implicit HTTP status (projection-independent)', () => {
  it('resolves against a row\'s bare comma-separated HTTP integers', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | - | 401,403 | x |'],
    }));

    var r = await resolveCitation('GET /api/v1/orders → 401', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('fails a status code not listed in the errors column', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | - | 401,403 | x |'],
    }));

    var r = await resolveCitation('GET /api/v1/orders → 404', tmpRepo);
    expect(r.ok).toBe(false);
  });

  it('resolves 201 as the implicit success status for POST', async () => {
    write(API_PATH, apiContract({
      rows: ['| POST | /api/v1/orders | required | - | - | 400,409 | x |'],
    }));

    var r = await resolveCitation('POST /api/v1/orders → HTTP 201', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });
});

describe('resolveCitation: implicit HTTP status for GET + Schemas-empty independence', () => {
  it('resolves 200 as the implicit success status for GET (and rejects 201)', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | - | 401,403 | x |'],
    }));

    var ok = await resolveCitation('GET /api/v1/orders → HTTP 200', tmpRepo);
    expect(ok.ok, ok.message).toBe(true);
    var bad = await resolveCitation('GET /api/v1/orders → HTTP 201', tmpRepo);
    expect(bad.ok).toBe(false);
  });

  it('a bare errors-column citation still resolves when ## Schemas is empty (no projection needed)', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | - | 401,403 | x |'],
      schemas: '',
    }));
    // Deliberately do NOT generate openapi.json — this citation form must not need it.

    var r = await resolveCitation('GET /api/v1/orders → 401', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });
});

describe('resolveCitation: data-shape invalid-data row', () => {
  it('matches the condition column verbatim', async () => {
    write(DATA_PATH, dataShapeContract({ conditions: ['empty dataset', 'wrong type'] }));

    var r = await resolveCitation('data-shape: empty dataset', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('fails a condition absent from the table', async () => {
    write(DATA_PATH, dataShapeContract({ conditions: ['empty dataset'] }));

    var r = await resolveCitation('data-shape: unexpected enum', tmpRepo);
    expect(r.ok).toBe(false);
  });
});

describe('resolveCitation: degradation rule — projection missing/stale', () => {
  it('HARD-fails a field citation with an actionable message when openapi.json is missing', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    // No openapi.json generated at all.

    var r = await resolveCitation('GET /api/v1/orders → items', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/openapi\.json/);
    expect(r.message).toMatch(/missing|stale|out of sync/i);
  });

  it('HARD-fails a field citation with an actionable message when openapi.json is stale', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    // Drift the contract without regenerating.
    write(API_PATH, apiContract({
      rows: [
        '| GET | /api/v1/orders | required | - | OrderList | 401,403 | x |',
        '| GET | /api/v1/widgets | required | - | - | 404 | x |',
      ],
      schemas: SCHEMAS_FIELD_TABLE,
    }));

    var r = await resolveCitation('GET /api/v1/orders → items', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/openapi\.json/);
  });
});

describe('resolveCitation: degradation rule — unresolved prose response schema', () => {
  it('HARD-fails a field citation when the response schema cell is unresolved prose', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | an order or 404 | 404 | x |'],
      schemas: SCHEMAS_FIELD_TABLE,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/orders → items', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/unresolved|prose/i);
  });
});

describe('resolveCitation: degradation rule — cited family marked applicability: not-applicable', () => {
  it('HARD-fails, naming the marker + reason, when api-contract.md is not-applicable', async () => {
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/orders | required | - | - | 401 | x |'],
      applicability: 'this project has no HTTP API surface',
    }));

    var r = await resolveCitation('GET /api/v1/orders → HTTP 200', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not-applicable/);
    expect(r.message).toMatch(/this project has no HTTP API surface/);
  });

  it('HARD-fails, naming the marker + reason, when data-shape-contract.md is not-applicable', async () => {
    write(DATA_PATH, dataShapeContract({
      conditions: ['empty dataset'],
      applicability: 'this project has no tabular data surface',
    }));

    var r = await resolveCitation('data-shape: empty dataset', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not-applicable/);
    expect(r.message).toMatch(/this project has no tabular data surface/);
  });

  it('is distinct from a plain "not found" message (marker-aware, not generic)', async () => {
    write(DATA_PATH, dataShapeContract({ conditions: ['empty dataset'] }));
    var notFound = await resolveCitation('data-shape: unexpected enum', tmpRepo);

    write(DATA_PATH, dataShapeContract({
      conditions: ['empty dataset'],
      applicability: 'no tabular surface',
    }));
    var markerAware = await resolveCitation('data-shape: unexpected enum', tmpRepo);

    expect(notFound.message).not.toBe(markerAware.message);
    expect(markerAware.message).toMatch(/not-applicable/);
  });
});

describe('resolveCitation: unparseable citation form', () => {
  it('fails with an actionable message naming the citation that could not be parsed', async () => {
    var r = await resolveCitation('this is not a citation', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('this is not a citation');
  });
});

describe('checkStateDiscriminatorUniqueness (ADR 0012 §2 state-discriminator strictness)', () => {
  it('HARD-fails when two meaning-distinct states cite the same discriminator', () => {
    var errors = checkStateDiscriminatorUniqueness([
      { id: 'state-calm', meaning: 'nothing is wrong', discriminator: 'GET /api/v1/orders → HTTP 200' },
      { id: 'state-blind', meaning: 'the system could not fetch data', discriminator: 'GET /api/v1/orders → HTTP 200' },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/state-calm/);
    expect(errors[0]).toMatch(/state-blind/);
  });

  it('passes when two states cite distinct discriminators', () => {
    var errors = checkStateDiscriminatorUniqueness([
      { id: 'state-calm', meaning: 'nothing is wrong', discriminator: 'GET /api/v1/orders → status=ok' },
      { id: 'state-blind', meaning: 'the system could not fetch data', discriminator: 'GET /api/v1/orders → status=degraded' },
    ]);
    expect(errors).toEqual([]);
  });

  it('does not flag two states with the SAME meaning sharing a discriminator', () => {
    var errors = checkStateDiscriminatorUniqueness([
      { id: 'state-a', meaning: 'nothing is wrong', discriminator: 'GET /api/v1/orders → HTTP 200' },
      { id: 'state-b', meaning: 'nothing is wrong', discriminator: 'GET /api/v1/orders → HTTP 200' },
    ]);
    expect(errors).toEqual([]);
  });
});
