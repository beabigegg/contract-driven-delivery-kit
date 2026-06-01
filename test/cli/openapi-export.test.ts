/**
 * Tests for `cdd-kit openapi export`.
 *
 * The export is a one-way projection of the markdown API contract (the source
 * of truth) into a minimal OpenAPI 3.1 skeleton for tooling. It must emit only
 * what the table mechanically determines and mark free-form request/response
 * schemas as unresolved rather than fabricating them.
 * See docs/adr/0001-contract-to-openapi-export.md.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let repo: string;
let home: string;

function writeContract(rows: string[], style?: string[]): void {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
  const styleBlock = style ? `\n## API Style\n${style.map(s => `- ${s}`).join('\n')}\n` : '';
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(
    join(repo, 'contracts', 'api', 'api-contract.md'),
    `---\ncontract: api\nsummary: Test API\nschema-version: 2.3.4\n---\n\n# API Contract\n${styleBlock}\n## Endpoint Requirements\n${table}\n`,
    'utf8',
  );
}

beforeEach(() => {
  repo = makeTempDir('cdd-openapi-');
  home = makeTempDir('cdd-openapi-home-');
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit openapi export', () => {
  it('emits a 3.1 doc with info from frontmatter and api-style description', () => {
    writeContract(
      ['| GET | /api/users | required | - | User[] | 401 | yes |'],
      ['response style: JSON REST'],
    );
    const r = runCli(['openapi', 'export'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Test API');
    expect(doc.info.version).toBe('2.3.4');
    expect(doc.info.description).toContain('response style: JSON REST');
    expect(doc.paths['/api/users'].get.summary).toBe('GET /api/users');
  });

  it('normalizes :id and {id} to a single {id} path with a path parameter', () => {
    writeContract([
      '| GET | /api/users/:id | required | - | User | 404 | yes |',
      '| DELETE | /api/users/{id} | admin | - | - | 404 | yes |',
    ]);
    const r = runCli(['openapi', 'export'], { cwd: repo, home });
    const doc = JSON.parse(r.stdout);
    const p = doc.paths['/api/users/{id}'];
    expect(p).toBeTruthy();
    expect(Object.keys(p).sort()).toEqual(['delete', 'get']);
    expect(p.get.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
  });

  it('maps POST to 201 and lists error status codes from the contract', () => {
    writeContract(['| POST | /api/orders | required | CreateOrder | Order | 400, 409 | yes |']);
    const r = runCli(['openapi', 'export'], { cwd: repo, home });
    const op = JSON.parse(r.stdout).paths['/api/orders'].post;
    expect(Object.keys(op.responses).sort()).toEqual(['201', '400', '409']);
  });

  it('marks free-form request bodies as unresolved rather than fabricating a schema', () => {
    writeContract(['| POST | /api/orders | required | CreateOrder | Order | 400 | yes |']);
    const r = runCli(['openapi', 'export'], { cwd: repo, home });
    const op = JSON.parse(r.stdout).paths['/api/orders'].post;
    expect(op.requestBody['x-cdd-unresolved']).toBe(true);
    expect(op.requestBody.description).toContain('CreateOrder');
    // It must NOT invent a JSON Schema with properties.
    expect(JSON.stringify(op.requestBody)).not.toContain('properties');
  });

  it('emits a bearer security scheme for authed routes and none for public ones', () => {
    writeContract([
      '| GET | /api/me | required | - | User | 401 | yes |',
      '| GET | /api/health | none | - | Status | - | yes |',
    ]);
    const r = runCli(['openapi', 'export'], { cwd: repo, home });
    const doc = JSON.parse(r.stdout);
    expect(doc.paths['/api/me'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/api/health'].get.security).toBeUndefined();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('writes valid JSON to --out', () => {
    writeContract(['| GET | /api/users | required | - | User[] | 401 | yes |']);
    const r = runCli(['openapi', 'export', '--out', 'build/openapi.json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const doc = JSON.parse(readFileSync(join(repo, 'build', 'openapi.json'), 'utf8'));
    expect(doc.paths['/api/users']).toBeTruthy();
    expect(r.stdout + r.stderr).toMatch(/written to/i);
  });

  it('emits parseable YAML with --yaml', () => {
    writeContract([
      '| GET | /api/users/:id | required | - | User | 404 | yes |',
      '| POST | /api/users | required | NewUser | User | 400 | yes |',
    ]);
    const r = runCli(['openapi', 'export', '--yaml', '--out', 'openapi.yaml'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const text = readFileSync(join(repo, 'openapi.yaml'), 'utf8');
    // Structural checks that lock in the line-break invariant the hand-rolled
    // emitter must hold (a non-empty mapping value never stays on the key line).
    // `3.1.0` is digit-leading so it is quoted — that is correct YAML.
    expect(text).toMatch(/^openapi: "3\.1\.0"$/m);
    // The status-code key must break before its `description` mapping value
    // (the bug the rewritten emitter fixes), one indent level deeper.
    expect(text).toMatch(/^(\s+)"?\d{3}"?:\n\1 {2}description:/m);
    // `responses:` must be followed by a newline, never an inline mapping.
    expect(text).toMatch(/responses:\n/);
    expect(text).not.toMatch(/responses: \S/);
  });

  it('fails clearly when the contract is missing', () => {
    const r = runCli(['openapi', 'export'], { cwd: repo, home });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contract not found/i);
  });

  it('fails clearly when the endpoint table is empty', () => {
    writeContract([]);
    const r = runCli(['openapi', 'export'], { cwd: repo, home });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no endpoint table rows/i);
  });
});
