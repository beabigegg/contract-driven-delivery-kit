import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
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

  it('descends a nullable-union node — type: ["object","null"] — exactly like a bare object (#66)', async () => {
    // The standard JSON Schema way to say "an object, or null" (an
    // envelope-tolerant `data` field). A strict `type === "object"` comparison
    // rejected it, so this citation resolved one level deep only, while the
    // byte-identical bare-"object" schema allowed the full dotted path.
    var envelope = [
      '',
      '### Envelope',
      '```json-schema',
      JSON.stringify({
        type: 'object',
        properties: {
          data: {
            type: ['object', 'null'],
            properties: { orderId: { type: 'string' } },
          },
        },
      }),
      '```',
      '',
    ].join('\n');
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/envelope | required | - | Envelope | 401 | x |'],
      schemas: envelope,
    }));
    await regenerateOpenapi();

    // One level deep worked even before the fix; the DEEP path is the
    // discriminator — the unfixed walker answered "no property orderId".
    var shallow = await resolveCitation('GET /api/v1/envelope → data', tmpRepo);
    expect(shallow.ok, shallow.message).toBe(true);
    var deep = await resolveCitation('GET /api/v1/envelope → data.orderId', tmpRepo);
    expect(deep.ok, deep.message).toBe(true);
  });

  it('a genuinely wrong field under a nullable-union node still fails (the check is not loosened)', async () => {
    var envelope = [
      '',
      '### Envelope',
      '```json-schema',
      JSON.stringify({
        type: 'object',
        properties: { data: { type: ['object', 'null'], properties: { orderId: { type: 'string' } } } },
      }),
      '```',
      '',
    ].join('\n');
    write(API_PATH, apiContract({
      rows: ['| GET | /api/v1/envelope | required | - | Envelope | 401 | x |'],
      schemas: envelope,
    }));
    await regenerateOpenapi();

    var r = await resolveCitation('GET /api/v1/envelope → data.nonexistent', tmpRepo);
    expect(r.ok).toBe(false);
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

// ── Sixth citation form: ci-gate: <heading> :: <exact substring> (IP-2) ───────
const CI_PATH = ['contracts', 'ci', 'ci-gate-contract.md'];

function ciGateContract(body) {
  return '---\ncontract: ci\nschema-version: 0.1.0\nlast-changed: 2026-07-09\n---\n\n# CI Gate Contract\n\n' + body;
}

describe('resolveCitation: sixth citation form (ci-gate:) — occurrence uniqueness', () => {
  it('T6a: a substring occurring exactly once resolves', async () => {
    write(CI_PATH, ciGateContract('## Section One\nalpha unique-token beta.\n\n## Section Two\ngamma delta.\n'));
    var r = await resolveCitation('ci-gate: Section One :: unique-token', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('T6b: two-or-more occurrences are rejected as ambiguous', async () => {
    write(CI_PATH, ciGateContract('## Section One\nrepeat here and repeat there.\n'));
    var r = await resolveCitation('ci-gate: Section One :: repeat', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/ambiguous/);
  });

  it('T6c: zero occurrences are rejected as not found', async () => {
    write(CI_PATH, ciGateContract('## Section One\nalpha beta gamma.\n'));
    var r = await resolveCitation('ci-gate: Section One :: absent-token', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not found/);
  });
});

describe('resolveCitation: sixth citation form (ci-gate:) — heading resolution', () => {
  it('T6d: a bare name resolves against a heading carrying a trailing parenthetical', async () => {
    write(CI_PATH, ciGateContract(
      '## Provenance Reconciliation Policy (ADR 0012 §2)\nresolved-by-bare-name token.\n\n## Other\nnope.\n',
    ));
    var r = await resolveCitation('ci-gate: Provenance Reconciliation Policy :: resolved-by-bare-name', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('a heading name matching two heading lines is rejected as ambiguous (line-anchored, case-insensitive)', async () => {
    write(CI_PATH, ciGateContract('## Dup\nfirst.\n\n## Dup\nsecond.\n'));
    var r = await resolveCitation('ci-gate: Dup :: first', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/ambiguous/);
    expect(r.message).toMatch(/heading/);
  });

  it('a heading name that matches nothing is rejected as no-such-heading', async () => {
    write(CI_PATH, ciGateContract('## Present\nbody.\n'));
    var r = await resolveCitation('ci-gate: Absent :: body', tmpRepo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no heading/);
  });
});

describe('resolveCitation: sixth citation form (ci-gate:) — level-aware section body (IP-1 via resolver)', () => {
  it('T6e: a ### body ends at its next ### sibling and does not bleed into it', async () => {
    write(CI_PATH, ciGateContract(
      '## Parent\n\n### Child A\ntoken-in-A only.\n\n### Child B\ntoken-in-B only.\n\n## Next\ntail.\n',
    ));
    // token-in-A is inside Child A's body → resolves.
    var here = await resolveCitation('ci-gate: Child A :: token-in-A', tmpRepo);
    expect(here.ok, here.message).toBe(true);
    // token-in-B lives only in the SIBLING Child B. Under the fixed level-aware
    // terminator Child A's body stops at Child B, so it must NOT be found.
    // (Reverting the terminator to `(?=\n## |$)` makes Child A swallow Child B
    // and this flips to ok:true — the T6e mutation.)
    var bled = await resolveCitation('ci-gate: Child A :: token-in-B', tmpRepo);
    expect(bled.ok).toBe(false);
    expect(bled.message).toMatch(/not found/);
  });

  it('a ## body still spans its ### children (unchanged behaviour)', async () => {
    write(CI_PATH, ciGateContract(
      '## Parent\nintro line.\n\n### Child A\nnested-token here.\n\n## Next\ntail.\n',
    ));
    // nested-token is under a ### child of Parent; citing the ## Parent still sees it.
    var r = await resolveCitation('ci-gate: Parent :: nested-token', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });
});

describe('resolveCitation: sixth citation form (ci-gate:) — normalization + case', () => {
  it('T6g(a): inline-formatting characters are stripped before comparison', async () => {
    write(CI_PATH, ciGateContract('## Section\n**no** recorded baseline at all also fails.\n'));
    var r = await resolveCitation('ci-gate: Section :: no recorded baseline at all also fails', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });

  it('T6g(b): comparison is case-sensitive', async () => {
    write(CI_PATH, ciGateContract('## Section\nExact Case Token here.\n'));
    var wrong = await resolveCitation('ci-gate: Section :: exact case token', tmpRepo);
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toMatch(/not found/);
    var right = await resolveCitation('ci-gate: Section :: Exact Case Token', tmpRepo);
    expect(right.ok, right.message).toBe(true);
  });

  it('collapses whitespace runs so a multi-space citation still matches', async () => {
    write(CI_PATH, ciGateContract('## Section\nword-a     word-b split across   spaces.\n'));
    var r = await resolveCitation('ci-gate: Section :: word-a word-b split across spaces', tmpRepo);
    expect(r.ok, r.message).toBe(true);
  });
});

describe('resolveCitation: sixth citation form (ci-gate:) — against the real committed contract (T6h)', () => {
  // Runs against the repo's own contracts/ci/ci-gate-contract.md (process.cwd()
  // is the repo root under vitest). Pins the measured ground truth as a
  // regression: every anchor interaction-design.md actually uses resolves at
  // exactly one occurrence; the deliberately-too-loose substrings are rejected.
  const repoRoot = process.cwd();

  // The change may be live under specs/changes/ or already closed under
  // specs/archive/<year>/ — resolve either, so archiving it does not break this
  // regression guard (the archived design's anchors must still resolve against the
  // current contract; a contract edit that breaks one is exactly what this catches).
  function designPath() {
    const active = join(repoRoot, 'specs', 'changes', 'enforce-human-confirmation', 'interaction-design.md');
    if (existsSync(active)) return active;
    const archiveRoot = join(repoRoot, 'specs', 'archive');
    if (existsSync(archiveRoot)) {
      for (const year of readdirSync(archiveRoot)) {
        const p = join(archiveRoot, year, 'enforce-human-confirmation', 'interaction-design.md');
        if (existsSync(p)) return p;
      }
    }
    throw new Error('enforce-human-confirmation/interaction-design.md not found under specs/changes or specs/archive');
  }

  function extractAnchors() {
    const id = readFileSync(designPath(), 'utf8');
    const anchors = [];
    for (const line of id.split('\n')) {
      const idx = line.indexOf('ci-gate:');
      if (idx === -1) continue;
      const cell = line.slice(idx).replace(/\|.*$/, '').trim();
      if (cell.includes('<heading>')) continue; // the syntax-template line, not a real anchor
      anchors.push(cell);
    }
    return [...new Set(anchors)];
  }

  it('every ci-gate anchor used by interaction-design.md resolves to exactly one occurrence', async () => {
    const anchors = extractAnchors();
    expect(anchors.length).toBeGreaterThan(0);
    const failures = [];
    for (const a of anchors) {
      const r = await resolveCitation(a, repoRoot);
      if (!r.ok) failures.push(a + ' -> ' + r.message);
    }
    expect(failures, 'these anchors failed to resolve:\n' + failures.join('\n')).toEqual([]);
  });

  it('rejects deliberately-loose substrings as ambiguous (asserting the rejection, not any count)', async () => {
    for (const bad of [
      'ci-gate: enforceInteractionDesign :: the',
      'ci-gate: enforceInteractionDesign :: AC-4',
      'ci-gate: enforceInteractionDesign :: AC-7',
    ]) {
      const r = await resolveCitation(bad, repoRoot);
      expect(r.ok, bad + ' unexpectedly resolved').toBe(false);
      expect(r.message, bad).toMatch(/ambiguous/);
    }
  });
});
