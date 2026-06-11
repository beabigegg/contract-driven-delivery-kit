/**
 * CLI tests for `cdd-kit contract locate` (P2-3).
 *
 * Bridges a code symbol/file to the API-contract slices that relate to it by
 * NAME OVERLAP (a `CreateOrder` interface ↔ a `CreateOrder` schema). The code-map
 * is best-effort enrichment: the literal symbol is always one of the search
 * terms, so it works with no code-map too.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

const CONTRACT = `---
contract: api
---

# API Contract

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| POST | /api/orders | admin | CreateOrder | Order | 400 | yes |
| GET | /api/users | required | - | User[] | 401 | yes |

## Schemas

### CreateOrder
| field | type | required | format | notes |
|---|---|---|---|---|
| email | string | yes | email | buyer |

### Order
| field | type | required | format | notes |
|---|---|---|---|---|
| id | string | yes | | order id |
`;

function write(rel: string, body: string): void {
  const full = join(tmpRepo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

beforeEach(() => {
  tmpRepo = makeTempDir('contract-locate-repo-');
  tmpHome = makeTempDir('contract-locate-home-');
  write('contracts/api/api-contract.md', CONTRACT);
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit contract locate', () => {
  it('bridges a source file to the contract slices via its declared type names', () => {
    write('src/orders.ts', [
      'export interface CreateOrder { email: string; qty: number; }',
      'export interface Order { id: string; }',
      'export function placeOrder(o: CreateOrder): Order { return { id: "x" }; }',
      '',
    ].join('\n'));

    const r = runCli(['contract', 'locate', 'src/orders.ts', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      resolved_file: string | null;
      candidates: string[];
      endpoints: { method: string; path: string; matched_via: string[] }[];
      schemas: { name: string; defined: boolean; matched_via: string[] }[];
    };

    expect(payload.resolved_file).toBe('src/orders.ts');
    // The file's declared type names become contract search terms.
    expect(payload.candidates).toContain('CreateOrder');
    expect(payload.candidates).toContain('Order');
    // The POST /api/orders endpoint references those schemas → it is located.
    const ep = payload.endpoints.find(e => e.path === '/api/orders');
    expect(ep?.method).toBe('post');
    expect(ep?.matched_via).toContain('CreateOrder');
    // Both schemas are returned, defined, annotated with the term that found them.
    const names = payload.schemas.map(s => s.name).sort();
    expect(names).toEqual(['CreateOrder', 'Order']);
    expect(payload.schemas.every(s => s.defined)).toBe(true);
  });

  it('works with no code-map when the symbol is itself a schema name', () => {
    const r = runCli(['contract', 'locate', 'CreateOrder', '--no-refresh', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      resolved_file: string | null;
      candidates: string[];
      schemas: { name: string }[];
    };
    // No source resolved → literal term only.
    expect(payload.resolved_file).toBeNull();
    expect(payload.candidates).toEqual(['CreateOrder']);
    expect(payload.schemas.some(s => s.name === 'CreateOrder')).toBe(true);
  });

  it('returns an empty (but successful) result when nothing relates to the symbol', () => {
    const r = runCli(['contract', 'locate', 'NoSuchThing', '--no-refresh', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { endpoints: unknown[]; schemas: unknown[] };
    expect(payload.endpoints).toEqual([]);
    expect(payload.schemas).toEqual([]);
  });

  it('exits 1 when the contract file is missing', () => {
    const r = runCli(['contract', 'locate', 'CreateOrder', '--contract', 'contracts/api/missing.md', '--no-refresh', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toMatch(/API contract not found/);
  });
});
