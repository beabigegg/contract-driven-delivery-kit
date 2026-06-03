import { describe, it, expect } from 'vitest';
import {
  parseEndpoints,
  parseContractSchemas,
  stripFrontmatter,
  parseRow,
  isSeparator,
} from '../../src/contracts/parser.js';

/**
 * Unit coverage for the shared contract parser (ADR 0004 §4). The behaviour the
 * OpenAPI projection relies on is also guarded end-to-end by
 * test/cli/openapi-export.test.ts; these tests pin the parser surface directly,
 * including the two Phase-1 enrichments: header-driven endpoint parsing and
 * capture of the `tests` column.
 */

describe('stripFrontmatter', () => {
  it('splits YAML frontmatter from the body', () => {
    const { body, frontmatter } = stripFrontmatter(
      '---\ncontract: api\nschema-version: 1.0.0\n---\n\n# Title\nbody',
    );
    expect(frontmatter.contract).toBe('api');
    expect(frontmatter['schema-version']).toBe('1.0.0');
    expect(body.startsWith('# Title')).toBe(true);
  });

  it('returns the text unchanged when there is no frontmatter', () => {
    const { body, frontmatter } = stripFrontmatter('# No frontmatter');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# No frontmatter');
  });
});

describe('parseRow / isSeparator', () => {
  it('parses and trims pipe-delimited cells', () => {
    expect(parseRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
  });

  it('recognises markdown separator rows', () => {
    expect(isSeparator(['---', ':--', '--:', ''])).toBe(true);
    expect(isSeparator(['a', '---'])).toBe(false);
  });
});

describe('parseEndpoints', () => {
  it('captures every column including tests from the canonical header', () => {
    const body = [
      '## Endpoint Requirements',
      '| method | path | auth | request schema | response schema | errors | tests |',
      '|---|---|---|---|---|---|---|',
      '| GET | /v2/ping | none | - | Pong | - | yes |',
      '| POST | /orders | admin | CreateOrder | Order | 400,404 | yes |',
    ].join('\n');
    expect(parseEndpoints(body)).toEqual([
      { method: 'get', path: '/v2/ping', auth: 'none', request: '-', response: 'Pong', errors: '-', tests: 'yes' },
      { method: 'post', path: '/orders', auth: 'admin', request: 'CreateOrder', response: 'Order', errors: '400,404', tests: 'yes' },
    ]);
  });

  it('is header-driven: non-method columns (and path) may appear in any order', () => {
    const body = [
      '| method | tests | auth | path | response schema | request schema | errors |',
      '|---|---|---|---|---|---|---|',
      '| GET | yes | none | /reordered | Out | In | - |',
    ].join('\n');
    expect(parseEndpoints(body)).toEqual([
      { method: 'get', path: '/reordered', auth: 'none', request: 'In', response: 'Out', errors: '-', tests: 'yes' },
    ]);
  });

  it('accepts the short request / response header aliases', () => {
    const body = [
      '| method | path | auth | request | response | errors | tests |',
      '|---|---|---|---|---|---|---|',
      '| post | /x | required | A | B | 400 | no |',
    ].join('\n');
    const [row] = parseEndpoints(body);
    expect(row.request).toBe('A');
    expect(row.response).toBe('B');
  });

  it('leaves a missing tests cell empty rather than undefined', () => {
    const body = [
      '| method | path | auth | request schema | response schema | errors | tests |',
      '|---|---|---|---|---|---|---|',
      '| GET | /no-test | none | - | Ok | - |  |',
    ].join('\n');
    expect(parseEndpoints(body)[0].tests).toBe('');
  });

  it('lowercases method and auth but keeps other cells verbatim', () => {
    const body = [
      '| method | path | auth | request schema | response schema | errors | tests |',
      '|---|---|---|---|---|---|---|',
      '| Post | /Mixed | ADMIN | CreateOrder | Order | 400 | Yes |',
    ].join('\n');
    const [row] = parseEndpoints(body);
    expect(row.method).toBe('post');
    expect(row.auth).toBe('admin');
    expect(row.path).toBe('/Mixed');
    expect(row.tests).toBe('Yes');
  });

  it('skips invalid methods and paths that do not start with /', () => {
    const body = [
      '| method | path | auth | request schema | response schema | errors | tests |',
      '|---|---|---|---|---|---|---|',
      '| FETCH | /bad-method | none | - | - | - | - |',
      '| GET | bad-path | none | - | - | - | - |',
      '| GET | /ok | none | - | Ok | - | yes |',
    ].join('\n');
    expect(parseEndpoints(body).map(r => r.path)).toEqual(['/ok']);
  });

  it('collects rows from every endpoint table in the document', () => {
    const body = [
      '| method | path | auth | request schema | response schema | errors | tests |',
      '|---|---|---|---|---|---|---|',
      '| GET | /a | none | - | A | - | yes |',
      '',
      'some prose between tables',
      '',
      '| method | path | auth | request schema | response schema | errors | tests |',
      '|---|---|---|---|---|---|---|',
      '| POST | /b | admin | In | Out | 400 | no |',
    ].join('\n');
    expect(parseEndpoints(body).map(r => r.path)).toEqual(['/a', '/b']);
  });

  it('reads method+path from an inventory-shaped table (api fields stay empty)', () => {
    // The inventory table carries category/owner/contract-test columns that are
    // not part of the API EndpointRow; capturing them is a query-layer concern.
    // Phase 1 only needs method+path to resolve, and must not mis-map the rest.
    const body = [
      '| method | path | category | owner | contract test | notes |',
      '|---|---|---|---|---|---|',
      '| GET | /health | health-exception | platform | yes | liveness |',
    ].join('\n');
    const [row] = parseEndpoints(body);
    expect(row.method).toBe('get');
    expect(row.path).toBe('/health');
    expect(row.auth).toBe('');
    expect(row.request).toBe('');
    expect(row.tests).toBe(''); // "contract test" is intentionally NOT aliased to tests
  });
});

describe('parseContractSchemas', () => {
  it('compiles a Tier A field table into an object schema', () => {
    const body = [
      '## Schemas',
      '### CreateOrder',
      '| field | type | required | format | notes |',
      '|---|---|---|---|---|',
      '| email | string | yes | email | login identity |',
      '| qty | integer | no | | how many |',
    ].join('\n');
    const res = parseContractSchemas(body);
    expect(res.errors).toEqual([]);
    expect(res.schemas.CreateOrder).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', description: 'login identity' },
        qty: { type: 'integer', description: 'how many' },
      },
      required: ['email'],
    });
  });

  it('passes a Tier B json-schema block through verbatim', () => {
    const body = [
      '## Schemas',
      '### Flexible',
      '```json-schema',
      '{ "type": "object", "additionalProperties": true }',
      '```',
    ].join('\n');
    const res = parseContractSchemas(body);
    expect(res.errors).toEqual([]);
    expect(res.schemas.Flexible).toEqual({ type: 'object', additionalProperties: true });
  });

  it('rejects a foreign ```json fence with a json-schema hint', () => {
    const body = ['## Schemas', '### Bad', '```json', '{ "type": "object" }', '```'].join('\n');
    const res = parseContractSchemas(body);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toContain('json-schema');
  });

  it('reports a duplicate schema section', () => {
    const body = [
      '## Schemas',
      '### Dup',
      '| field | type | required |',
      '|---|---|---|',
      '| a | string | yes |',
      '### Dup',
      '| field | type | required |',
      '|---|---|---|',
      '| b | string | yes |',
    ].join('\n');
    const res = parseContractSchemas(body);
    expect(res.errors.some(e => e.includes('Duplicate schema section: Dup'))).toBe(true);
  });

  it('leaves a Tier C prose section unresolved without erroring', () => {
    const body = [
      '## Schemas',
      '### Prose',
      'Just free-form prose describing the shape. No table, no fence.',
    ].join('\n');
    const res = parseContractSchemas(body);
    expect(res.errors).toEqual([]);
    expect(res.schemas.Prose).toBeUndefined();
  });
});
