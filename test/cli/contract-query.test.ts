/**
 * Tests for `cdd-kit contract query` (ADR 0004 §1).
 *
 * The query is the contract analog of `index query`: ask by key, get only the
 * matching slice. It parses the markdown on demand (no cached artifact), spans
 * the API contract and inventory, and inlines referenced schema definitions and
 * the bounded shared prose sections for an endpoint answer.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let repo: string;
let home: string;

const CONTRACT = `---
contract: api
summary: Test API
schema-version: 1.0.0
---

# API Contract

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /api/users | required | - | User[] | 401 | yes |
| POST | /api/orders | admin | CreateOrder | Order | 400, 409 | yes |
| GET | /api/orders/:id | required | - | Order | 404 | no |

## Schemas

### CreateOrder
| field | type | required | format | notes |
|---|---|---|---|---|
| email | string | yes | email | buyer identity |
| qty | integer | yes | | how many |

### Order
| field | type | required | format | notes |
|---|---|---|---|---|
| id | string | yes | | order id |

### User
| field | type | required | format | notes |
|---|---|---|---|---|
| name | string | yes | | display name |

## Error Format

Errors use a JSON envelope: { "error": { "message": "..." } }.

## Compatibility Policy

Additive changes only within a major version.

## Breaking Change Policy

Deprecate for two minors before removal.
`;

const INVENTORY = `---
contract: api-inventory
summary: Inventory
---

# API Inventory

| method | path | category | owner | contract test | notes |
|---|---|---|---|---|---|
| GET | /api/health | health-exception | platform | yes | liveness probe |
| GET | /api/orders/export | stream-download-exception | orders-team | no | csv stream |
`;

function writeContracts(): void {
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), CONTRACT, 'utf8');
  writeFileSync(join(repo, 'contracts', 'api', 'api-inventory.md'), INVENTORY, 'utf8');
}

function query(args: string[]): { status: number | null; stdout: string; stderr: string; payload: any } {
  const r = runCli(['contract', 'query', ...args, '--json'], { cwd: repo, home });
  let payload: any = null;
  try {
    payload = JSON.parse(r.stdout);
  } catch {
    /* leave null; the test asserts on status/stderr */
  }
  return { ...r, payload };
}

beforeEach(() => {
  repo = makeTempDir('cdd-cq-');
  home = makeTempDir('cdd-cq-home-');
  writeContracts();
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit contract query', () => {
  it('--endpoint returns the row, its referenced schemas, and the shared prose', () => {
    const { status, payload } = query(['--endpoint', 'POST /api/orders']);
    expect(status).toBe(0);
    expect(payload.endpoints).toHaveLength(1);
    expect(payload.endpoints[0]).toMatchObject({ source: 'api-contract', method: 'post', path: '/api/orders' });
    expect(payload.endpoints[0].cells.auth).toBe('admin');

    const schemaNames = payload.schemas.map((s: any) => s.name).sort();
    expect(schemaNames).toEqual(['CreateOrder', 'Order']);
    const createOrder = payload.schemas.find((s: any) => s.name === 'CreateOrder');
    expect(createOrder.defined).toBe(true);
    expect(createOrder.content).toContain('email');
    expect(createOrder.referenced_by).toContainEqual({ method: 'post', path: '/api/orders' });

    expect(payload.prose.map((p: any) => p.name)).toEqual([
      'Error Format',
      'Compatibility Policy',
      'Breaking Change Policy',
    ]);
    expect(payload.prose[0].content).toContain('JSON envelope');
  });

  it('--endpoint returns nothing and exits 1 for an unknown key', () => {
    const { status, payload } = query(['--endpoint', 'DELETE /api/nope']);
    expect(status).toBe(1);
    expect(payload.endpoints).toHaveLength(0);
  });

  it('--schema returns the definition plus its reverse index across endpoints', () => {
    const { status, payload } = query(['--schema', 'Order']);
    expect(status).toBe(0);
    expect(payload.schemas).toHaveLength(1);
    expect(payload.schemas[0]).toMatchObject({ name: 'Order', defined: true });
    const refs = payload.schemas[0].referenced_by;
    expect(refs).toContainEqual({ method: 'post', path: '/api/orders' });
    expect(refs).toContainEqual({ method: 'get', path: '/api/orders/:id' });
    expect(refs).toHaveLength(2);
  });

  it('--schema flags a referenced-but-undefined schema', () => {
    const { status, payload } = query(['--schema', 'Ghost']);
    expect(status).toBe(1); // not defined and not referenced
    expect(payload.schemas[0]).toMatchObject({ name: 'Ghost', defined: false, referenced_by: [] });
  });

  it('--path prefix spans the contract and the inventory', () => {
    const { status, payload } = query(['--path', '/api/orders']);
    expect(status).toBe(0);
    const paths = payload.endpoints.map((e: any) => e.path).sort();
    expect(paths).toEqual(['/api/orders', '/api/orders/:id', '/api/orders/export']);
    // The inventory row carries its own columns through.
    const exportRow = payload.endpoints.find((e: any) => e.path === '/api/orders/export');
    expect(exportRow).toMatchObject({ source: 'api-inventory' });
    expect(exportRow.cells.category).toBe('stream-download-exception');
  });

  it('--path supports a * glob', () => {
    const { payload } = query(['--path', '/api/*/export']);
    expect(payload.endpoints.map((e: any) => e.path)).toEqual(['/api/orders/export']);
  });

  it('--auth filters by the auth column', () => {
    const { payload } = query(['--auth', 'admin']);
    expect(payload.endpoints).toHaveLength(1);
    expect(payload.endpoints[0].path).toBe('/api/orders');
  });

  it('--category and --owner filter inventory endpoints', () => {
    expect(query(['--category', 'health-exception']).payload.endpoints.map((e: any) => e.path)).toEqual(['/api/health']);
    expect(query(['--owner', 'orders-team']).payload.endpoints.map((e: any) => e.path)).toEqual(['/api/orders/export']);
  });

  it('a free-text term fuzzy-matches endpoints and schema names', () => {
    const byEndpoint = query(['health']);
    expect(byEndpoint.payload.endpoints.map((e: any) => e.path)).toContain('/api/health');

    const bySchema = query(['createorder']);
    expect(bySchema.payload.schemas.map((s: any) => s.name)).toContain('CreateOrder');
    expect(bySchema.payload.endpoints.map((e: any) => e.path)).toContain('/api/orders');
  });

  it('errors and exits 1 when no selector is given', () => {
    const { status, payload } = query([]);
    expect(status).toBe(1);
    expect(payload.error).toMatch(/selector/i);
  });

  it('renders human-readable text without --json', () => {
    const r = runCli(['contract', 'query', '--endpoint', 'POST /api/orders'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('POST /api/orders');
    expect(r.stdout).toContain('schema CreateOrder');
    expect(r.stdout).toContain('Error Format');
  });

  it('still answers from the contract when the inventory file is absent', () => {
    cleanupDir(join(repo, 'contracts', 'api', 'api-inventory.md'));
    const { status, payload } = query(['--endpoint', 'GET /api/users']);
    expect(status).toBe(0);
    expect(payload.inventory).toBeNull();
    expect(payload.endpoints[0].path).toBe('/api/users');
  });
});
