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

  it('rejects a field referencing an undefined schema, but accepts a defined or self reference', () => {
    // A schema-name-shaped type is a reference; openapi export rejects a reference
    // to a never-defined schema, so set must too (valid-by-construction).
    const before = read();
    const ghost = runCli(['contract', 'schema', 'set', 'Wrapper', '--field', 'item:Ghost:no'], { cwd: repo, home });
    expect(ghost.status).toBe(1);
    expect(ghost.stderr).toMatch(/unknown type "Ghost"/i); // export's own compiler message
    expect(read()).toBe(before); // not written

    // User IS defined in the contract, so a reference to it is accepted...
    expect(runCli(['contract', 'schema', 'set', 'Wrapper', '--field', 'owner:User:yes'], { cwd: repo, home }).status).toBe(0);
    // ...and a self-reference is allowed (the schema being set counts as defined).
    expect(runCli(['contract', 'schema', 'set', 'Node', '--field', 'parent:Node:no', '--field', 'label:string:yes'], { cwd: repo, home }).status).toBe(0);
  });
});

describe('cdd-kit contract set — review hardening (ADR 0004 Phase 3)', () => {
  // Codex P2: a cell value carrying a markdown table delimiter would silently
  // shift/truncate later reads. Reject `|` / newlines up front, on both paths.
  it('rejects an endpoint cell value that contains a table-breaking pipe', () => {
    const before = read();
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/x', '--errors', '400 | 500'],
      { cwd: repo, home },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/corrupt the markdown table/i);
    expect(read()).toBe(before);
  });

  it('rejects a schema field whose notes or enum body contains a pipe', () => {
    const before = read();
    expect(runCli(['contract', 'schema', 'set', 'Bad', '--field', 'note:string:no::a | b'], { cwd: repo, home }).status).toBe(1);
    // enum(a|b) is a single (valid-shaped) member, but the pipe still breaks the cell.
    const r = runCli(['contract', 'schema', 'set', 'Bad', '--field', 'kind:enum(a|b):yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/corrupt the markdown table/i);
    expect(read()).toBe(before);
  });

  // Codex P2: a duplicate `### Name` must be refused, not silently half-replaced.
  it('refuses to replace a schema whose key is duplicated in ## Schemas', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '### User\n| field | type | required | format | notes |\n|---|---|---|---|---|\n| email | string | yes |  |  |\n\n## Error Format',
    ));
    const before = read();
    const r = runCli(['contract', 'schema', 'set', 'User', '--field', 'name:string:yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/defined 2 times/i);
    expect(read()).toBe(before);
  });

  // Codex P2: enum(...) must have at least one non-empty value (the compiler does).
  it('rejects an enum field with no values, and accepts a populated one', () => {
    const before = read();
    expect(runCli(['contract', 'schema', 'set', 'S', '--field', 'status:enum( ):yes'], { cwd: repo, home }).status).toBe(1);
    const empty = runCli(['contract', 'schema', 'set', 'S', '--field', 'status:enum(,):yes'], { cwd: repo, home });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toMatch(/enum.*at least one value/i);
    expect(read()).toBe(before); // neither malformed write touched the file
    expect(runCli(['contract', 'schema', 'set', 'S', '--field', 'status:enum(open,closed):yes'], { cwd: repo, home }).status).toBe(0);
  });

  // Codex P2: an empty `required` cell is a typo, not a silent "no".
  it('rejects a field whose required cell is empty', () => {
    const before = read();
    const r = runCli(['contract', 'schema', 'set', 'S', '--field', 'email:string:'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/required must be "yes" or "no"/i);
    expect(read()).toBe(before);
  });

  // Codex P2: a pre-existing duplicate for ANY key (not just the target) is refused.
  it('refuses to set any endpoint when the table already holds a duplicate key elsewhere', () => {
    write(CONTRACT.replace(
      '| GET | /api/users | required | - | User[] | 401 | yes |',
      '| GET | /api/old | required | - | - | 401 | yes |\n| GET | /api/old | none | - | - | 404 | no |',
    ));
    const before = read();
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/new', '--tests', 'yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/duplicate key/i);
    expect(read()).toBe(before);
  });

  // Codex P2: a `### Name` that only exists inside an HTML comment is not a real
  // section — set must INSERT a usable one, not "replace" inside the comment.
  it('inserts a real schema rather than editing one that only exists inside an HTML comment', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '<!--\n### ExampleRequest\n| field | type | required | format | notes |\n|---|---|---|---|---|\n| sample | string | no |  |  |\n-->\n\n## Error Format',
    ));
    const r = runCli(['contract', 'schema', 'set', 'ExampleRequest', '--field', 'id:string:yes', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('inserted');
    const content = read();
    expect(content).toContain('<!--'); // the instructional comment is preserved
    // A real ### ExampleRequest now exists outside the comment, carrying the new field.
    const afterComment = content.slice(content.indexOf('-->') + 3);
    expect(afterComment).toContain('### ExampleRequest');
    expect(afterComment).toContain('| id | string | yes |  |  |');
  });

  // Sourcery: with --json, errors are structured on stdout too (mirrors contract query).
  it('emits a structured JSON error on stdout when --json is set and a write is rejected', () => {
    const before = read();
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'FETCH', '--path', '/api/x', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    const payload = JSON.parse(r.stdout);
    expect(payload).toMatchObject({ ok: false });
    expect(payload.error).toMatch(/invalid method/i);
    expect(read()).toBe(before);
  });
});

describe('cdd-kit contract set — review round 2 (ADR 0004 Phase 3)', () => {
  // Codex P2: trim the path so a trailing space doesn't miss the existing row.
  it('normalizes a path with surrounding whitespace so it updates the existing row', () => {
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'GET', '--path', '/api/users ', '--auth', 'optional', '--json'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ action: 'updated', path: '/api/users' });
    const content = read();
    expect(content).toContain('| GET | /api/users | optional | - | User[] | 401 | yes |');
    expect(content.match(/\/api\/users\b/g)).toHaveLength(1); // not duplicated
  });

  // Codex P2: a discarded schema parse error must not let a bad reference through.
  it('refuses to set an endpoint when ## Schemas has a parse error (duplicate section)', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '### User\n| field | type | required | format | notes |\n|---|---|---|---|---|\n| email | string | yes |  |  |\n\n## Error Format',
    ));
    const before = read();
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/x', '--request', 'User'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Duplicate schema section/i);
    expect(read()).toBe(before);
  });

  // Codex P2: search every endpoint table, not just the first.
  it('updates a row that lives in a later endpoint table instead of appending to the first', () => {
    write(`---
contract: api
summary: Test API
schema-version: 1.0.0
last-changed: 2026-01-01
---

# API Contract

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /api/users | required | - | User[] | 401 | yes |

## Admin Endpoints
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| POST | /api/orders | admin | - | User | 400 | yes |

## Schemas

### User
| field | type | required | format | notes |
|---|---|---|---|---|
| name | string | yes |  |  |
`);
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/orders', '--errors', '409', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('updated');
    const content = read();
    expect(content).toContain('| POST | /api/orders | admin | - | User | 409 | yes |');
    expect(content.match(/\/api\/orders\b/g)).toHaveLength(1); // not appended to the first table
    expect(content).toContain('| GET | /api/users | required | - | User[] | 401 | yes |'); // first table untouched
  });

  it('catches a duplicate key spanning two endpoint tables before writing', () => {
    write(`---
contract: api
schema-version: 1.0.0
---

# API Contract

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /api/users | required | - | - | 401 | yes |

## More
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /api/users | none | - | - | 404 | no |

## Schemas
`);
    const before = read();
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/new', '--tests', 'yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/duplicate key/i);
    expect(read()).toBe(before);
  });
});

describe('cdd-kit contract set — review round 3 (ADR 0004 Phase 3)', () => {
  // Codex P2: schema writes must refuse a contract whose ## Schemas already errors.
  it('refuses to write a schema when ## Schemas has a duplicate (parse error) elsewhere', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '### User\n| field | type | required | format | notes |\n|---|---|---|---|---|\n| email | string | yes |  |  |\n\n## Error Format',
    ));
    const before = read();
    const r = runCli(['contract', 'schema', 'set', 'Order', '--field', 'id:string:yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Duplicate schema section/i);
    expect(read()).toBe(before);
  });

  // Codex P2: a field reference must be machine-resolvable, not merely defined.
  it('rejects a field that references a Tier-C prose schema (no resolvable body)', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '### Address\nAddress is described in prose for now (Tier C); it has no field table.\n\n## Error Format',
    ));
    const before = read();
    const bad = runCli(['contract', 'schema', 'set', 'Customer', '--field', 'home:Address:yes'], { cwd: repo, home });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/no field table or json-schema block/i);
    expect(read()).toBe(before);
    // A reference to the resolvable User schema (field table) is still accepted.
    expect(runCli(['contract', 'schema', 'set', 'Customer', '--field', 'who:User:yes'], { cwd: repo, home }).status).toBe(0);
  });

  // Codex P2: replacing a section must not stop at a comment INTERNAL to it.
  it('replaces a section whose old body sits after an internal comment, leaving no stale block', () => {
    write(`---
contract: api
schema-version: 1.0.0
---

# API Contract

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /api/users | required | - | User | 401 | yes |

## Schemas

### User
<!-- legacy note: was machine-typed -->
\`\`\`json-schema
{ "type": "object", "properties": { "name": { "type": "string" } } }
\`\`\`

## Error Format

Errors use a JSON envelope.
`);
    const r = runCli(['contract', 'schema', 'set', 'User', '--field', 'email:string:yes', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('replaced');
    const content = read();
    expect(content).toContain('| email | string | yes |  |  |'); // new field table
    expect(content).not.toContain('json-schema'); // the stale block is gone, not left beside the table
    // A section can't have both a table and a block, so the result must export.
    const exp = runCli(['openapi', 'export'], { cwd: repo, home });
    expect(exp.status, exp.stderr).toBe(0);
    expect(JSON.parse(exp.stdout).components.schemas.User).toMatchObject({ type: 'object' });
  });
});

describe('cdd-kit contract set — review round 4 (ADR 0004 Phase 3)', () => {
  // Codex P2: a heading with an inline comment is the same section to the parser.
  it('matches and replaces a schema whose heading carries an inline comment (no duplicate)', () => {
    write(CONTRACT.replace('### User', '### User <!-- legacy -->'));
    const r = runCli(['contract', 'schema', 'set', 'User', '--field', 'email:string:yes', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('replaced'); // matched the existing section, did not insert a second
    const content = read();
    expect(content.match(/^### User\b/gm)).toHaveLength(1); // exactly one User section
    expect(content).toContain('| email | string | yes |  |  |');
    expect(runCli(['openapi', 'export'], { cwd: repo, home }).status).toBe(0); // no duplicate ### User
  });

  // Codex P2: refuse a write when an UNRELATED schema has a compile-level error
  // that parseSchemaSections() does not surface (only parseContractSchemas does).
  it('refuses a schema write when another schema has a compile-level error', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '### Bad\n| field | type | required | format | notes |\n|---|---|---|---|---|\n| x | weirdtype | yes |  |  |\n\n## Error Format',
    ));
    const before = read();
    const r = runCli(['contract', 'schema', 'set', 'Order', '--field', 'id:string:yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown type "weirdtype"/i);
    expect(read()).toBe(before);
  });

  it('refuses an endpoint write when a schema has a compile-level error', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '### Bad\n| field | type | required | format | notes |\n|---|---|---|---|---|\n| x | weirdtype | yes |  |  |\n\n## Error Format',
    ));
    const before = read();
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/x', '--tests', 'yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown type "weirdtype"/i);
    expect(read()).toBe(before);
  });

  // Validating the POST-mutation result (not the pre-state) lets a write that
  // FIXES a dangling reference through, so recursive schemas stay buildable.
  it('allows a schema write that resolves a previously dangling reference', () => {
    write(CONTRACT.replace(
      '## Error Format',
      '### Wrapper\n| field | type | required | format | notes |\n|---|---|---|---|---|\n| item | Item | yes |  |  |\n\n## Error Format',
    ));
    expect(runCli(['openapi', 'export'], { cwd: repo, home }).status).toBe(1); // Wrapper.item → undefined Item
    const r = runCli(['contract', 'schema', 'set', 'Item', '--field', 'id:string:yes'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0); // adding Item makes the POST-mutation contract valid
    expect(runCli(['openapi', 'export'], { cwd: repo, home }).status).toBe(0);
  });
});

describe('cdd-kit contract set — review round 5 (ADR 0004 Phase 3)', () => {
  // Codex P2: `:id` and `{id}` are the SAME OpenAPI path key (export normalizes
  // both to `{id}` and assigns `paths[path][method]`). Setting one form must
  // UPDATE the row written in the other form, not append a second row that then
  // silently overwrites the first operation on export.
  it('updates an existing `:id` row when set with the `{id}` form (no normalized-duplicate append)', () => {
    write(CONTRACT.replace('| GET | /api/users |', '| GET | /api/users/:id |'));
    const r = runCli(
      ['contract', 'endpoint', 'set', '--method', 'GET', '--path', '/api/users/{id}', '--auth', 'optional', '--json'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).action).toBe('updated'); // matched the :id row, did not append
    const content = read();
    expect(content).toContain('| GET | /api/users/:id | optional | - | User[] | 401 | yes |'); // updated in place, stored path form preserved
    expect(content).not.toContain('/api/users/{id}'); // no second row appended in the other syntax
    // Exactly one operation, so export has no silent collision on paths['/api/users/{id}'].get.
    const exp = runCli(['openapi', 'export'], { cwd: repo, home });
    expect(exp.status, exp.stderr).toBe(0);
    expect(JSON.parse(exp.stdout).paths['/api/users/{id}'].get).toBeTruthy();
  });

  // Codex P2: a pre-existing pair that collides only under path-template
  // normalization is a duplicate the keyed guarantee cannot honor — refuse
  // before writing anything, the same as a raw duplicate key.
  it('refuses to set any endpoint when the table already holds a normalized-duplicate (:id vs {id})', () => {
    write(CONTRACT.replace(
      '| GET | /api/users | required | - | User[] | 401 | yes |',
      '| GET | /api/users/:id | required | - | User | 401 | yes |\n| GET | /api/users/{id} | none | - | User | 404 | no |',
    ));
    const before = read();
    const r = runCli(['contract', 'endpoint', 'set', '--method', 'POST', '--path', '/api/orders', '--tests', 'yes'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/duplicate key/i);
    expect(read()).toBe(before); // nothing written
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
