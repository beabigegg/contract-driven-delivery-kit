/**
 * Tests for `cdd-kit contract set` (ADR 0004 §3) — the keyed write path.
 *
 * The command upserts by primary key, validates structurally, and re-serializes
 * only the affected block, leaving every other line byte-identical. It is a
 * stronger constraint than a free-form edit: invalid or dangling writes are
 * rejected, and untouched rows/lines are preserved exactly.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let repo: string;
let home: string;
let contractFile: string;

const CONTRACT = `---
contract: api
summary: Test API
schema-version: 1.0.0
last-changed: 2026-01-01
---

# API Contract

## API Style
- response style: JSON

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /api/users | required | - | User[] | 401 | yes |

## Schemas

### User
| field | type | required | format | notes |
|---|---|---|---|---|
| name | string | yes |  |  |

## Error Format

Errors use a JSON envelope.
`;

function write(content = CONTRACT): void {
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(contractFile, content, 'utf8');
}

function read(): string {
  return readFileSync(contractFile, 'utf8');
}

beforeEach(() => {
  repo = makeTempDir('cdd-cs-');
  home = makeTempDir('cdd-cs-home-');
  contractFile = join(repo, 'contracts', 'api', 'api-contract.md');
  write();
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit contract endpoint set', () => {
  it('appends a new endpoint row keyed by (method, path)', () => {
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/orders', '--auth', 'admin', '--response', 'User', '--errors', '400', '--tests', 'yes', '--json'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('added');
    expect(read()).toContain('| POST | /api/orders | admin | - | User | 400 | yes |');
  });

  it('updates only the named cells of an existing row, preserving the rest', () => {
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'GET', '--path', '/api/users', '--auth', 'optional', '--json'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('updated');
    expect(read()).toContain('| GET | /api/users | optional | - | User[] | 401 | yes |');
  });

  it('leaves every line outside the table block byte-identical', () => {
    const before = read().split('\n');
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/orders', '--tests', 'yes'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    const after = read().split('\n');
    // The only change is the appended row; header, separator, the existing row,
    // and all surrounding lines (frontmatter, schemas, prose) are untouched.
    const newRow = '| POST | /api/orders | - | - | - | - | yes |';
    expect(after.filter(l => l !== newRow)).toEqual(before);
  });

  it('rejects a request/response that references an undefined schema', () => {
    const before = read();
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/x', '--response', 'GhostSchema'],
      { cwd: repo, home },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/GhostSchema/);
    expect(read()).toBe(before); // not written
  });

  it('accepts a reference to a schema that is defined', () => {
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/x', '--response', 'User[]', '--tests', 'yes'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it('rejects an invalid method and a path that does not start with /', () => {
    const before = read();
    const bad = runCli(['contract', 'endpoint', 'set', '--method', 'FETCH', '--path', '/api/x'], { cwd: repo, home });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/invalid method/i);

    const badPath = runCli(['contract', 'endpoint', 'set', '--method', 'GET', '--path', 'api/x'], { cwd: repo, home });
    expect(badPath.status).toBe(1);
    expect(badPath.stderr).toMatch(/start with/i);
    expect(read()).toBe(before);
  });

  it('refuses to write when the key is already duplicated in the table', () => {
    write(CONTRACT.replace(
      '| GET | /api/users | required | - | User[] | 401 | yes |',
      '| GET | /api/dup | required | - | - | 401 | yes |\n| GET | /api/dup | none | - | - | 404 | no |',
    ));
    const before = read();
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'GET', '--path', '/api/dup', '--auth', 'none'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/duplicate/i);
    expect(read()).toBe(before);
  });
});

describe('cdd-kit contract schema set', () => {
  it('inserts a new schema section with a field table', () => {
    const r = runCli(
      ['contract', 'schema', 'set', 'Order', '--field', 'id:string:yes::order id', '--field', 'total:number:yes', '--json'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('inserted');
    const content = read();
    expect(content).toContain('### Order');
    expect(content).toContain('| id | string | yes |  | order id |');
    expect(content).toContain('| total | number | yes |  |  |');
    // The pre-existing User schema is untouched.
    expect(content).toContain('### User');
    expect(content).toContain('| name | string | yes |  |  |');
  });

  it('replaces an existing schema section in place', () => {
    const r = runCli(
      ['contract', 'schema', 'set', 'User', '--field', 'email:string:yes:email', '--json'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('replaced');
    const content = read();
    expect(content).toContain('| email | string | yes | email |  |');
    expect(content).not.toContain('| name | string | yes |  |  |');
  });

  it('rejects an unsupported field type and a duplicate field name', () => {
    const before = read();
    // `string!` is neither a primitive, an enum(...), nor a valid schema-name shape.
    expect(runCli(['contract', 'schema', 'set', 'Bad', '--field', 'x:string!:yes'], { cwd: repo, home }).status).toBe(1);
    const dup = runCli(['contract', 'schema', 'set', 'Bad', '--field', 'x:string:yes', '--field', 'x:integer:no'], { cwd: repo, home });
    expect(dup.status).toBe(1);
    expect(dup.stderr).toMatch(/duplicate field/i);
    expect(read()).toBe(before);
  });

  it('allows a field type that references another schema, even before it is defined', () => {
    // A schema-name-shaped type is a reference; full resolution is the export/gate's
    // job, not set's, so forward references are permitted here.
    const r = runCli(['contract', 'schema', 'set', 'Wrapper', '--field', 'item:NotYetDefined:no'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
  });
});

describe('contract set round-trip', () => {
  it('produces a contract that openapi export accepts, with the new schema and endpoint', () => {
    expect(runCli(['contract', 'schema', 'set', 'Order', '--field', 'id:string:yes', '--field', 'total:number:yes'], { cwd: repo, home }).status).toBe(0);
    expect(runCli(['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/orders', '--request', 'Order', '--response', 'Order', '--errors', '400', '--tests', 'yes'], { cwd: repo, home }).status).toBe(0);

    const exp = runCli(['openapi', 'export'], { cwd: repo, home });
    expect(exp.status, exp.stderr).toBe(0);
    const doc = JSON.parse(exp.stdout);
    expect(doc.paths['/api/orders'].post).toBeTruthy();
    expect(doc.components.schemas.Order).toMatchObject({ type: 'object' });

    // And the query layer can find it by key.
    const q = runCli(['contract', 'query', '--endpoint', 'POST /api/orders', '--json'], { cwd: repo, home });
    expect(q.status, q.stderr).toBe(0);
    expect(JSON.parse(q.stdout).schemas.map((s: any) => s.name)).toContain('Order');
  });
});
