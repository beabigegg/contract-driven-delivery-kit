import { existsSync, readFileSync, writeFileSync } from 'fs';
import { log } from '../utils/logger.js';
import {
  stripFrontmatter,
  parseRow,
  isSeparator,
  isEndpointHeaderRow,
  parseSchemaSections,
  parseContractSchemas,
  VALID_METHODS,
  SCHEMA_NAME_RE,
  DEFAULT_CONTRACT_PATH,
} from '../contracts/parser.js';

/**
 * `cdd-kit contract set` — mutate the API contract by key instead of editing it
 * by hand. See docs/adr/0004-queryable-and-writable-contracts.md (§3).
 *
 * The command does its own file I/O, so it is not subject to the agent harness's
 * read-before-write guard (ADR 0004 §3) — and it is a STRONGER constraint than a
 * free-form edit: every change is structurally valid by construction and touches
 * only the named row/section. It re-serializes only the affected table/section
 * block with deterministic, single-space-padded cells, leaving every other line
 * byte-identical.
 */

const DEFAULT_CONTRACT = DEFAULT_CONTRACT_PATH;
const PRIMITIVE_TYPES = ['string', 'integer', 'number', 'boolean'];

/**
 * A cell value that would corrupt the markdown table if written verbatim: a pipe
 * (the column delimiter the shared `parseRow` splits on) or a line break (which
 * would split one row into several). `contract set` re-serializes by joining
 * cells with `|`, so such a value must be rejected up front — otherwise the
 * command reports success while later query/export read shifted or truncated
 * cells (there is no escaping convention the parser understands). ADR 0004 §3.
 */
const TABLE_BREAKING_CELL = /[|\r\n]/;

/** First table-breaking cell among the given (value, what) pairs, as an error string; null if all clean. */
function tableBreakingCellError(cells: Array<{ value: string; what: string }>): string | null {
  for (const { value, what } of cells) {
    if (TABLE_BREAKING_CELL.test(value)) {
      return `${what} may not contain "|", a newline, or a carriage return — it would corrupt the markdown table (got ${JSON.stringify(value)})`;
    }
  }
  return null;
}

/**
 * Report a failure. With `--json` the error is emitted as structured JSON on
 * stdout (`{ ok: false, error, ... }`) so a script/CI caller gets a parseable
 * result on every path, mirroring `contract query`'s `printFailure`; otherwise it
 * is logged to stderr. Always returns 1 so callers can `return fail(...)`.
 */
function fail(json: boolean, message: string, extra: Record<string, unknown> = {}): 1 {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: message, ...extra }, null, 2)}\n`);
  } else {
    log.error(message);
  }
  return 1;
}

export interface EndpointSetOptions {
  contract: string;
  method: string;
  path: string;
  auth?: string;
  request?: string;
  response?: string;
  errors?: string;
  tests?: string;
  json: boolean;
}

export interface SchemaSetOptions {
  contract: string;
  name: string;
  fields: string[];
  json: boolean;
}

// ── line helpers (byte-identity preserving) ──────────────────────────────────

function toLines(raw: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

function fromLines(lines: string[], trailingNewline: boolean): string {
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

/** Deterministic, single-space-padded data/header row. */
function renderRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/** Compact separator (`|---|---|`), matching the contract template's style. */
function renderSeparator(columns: number): string {
  return `|${Array.from({ length: columns }, () => '---').join('|')}|`;
}

// ── endpoint set ─────────────────────────────────────────────────────────────

interface EndpointTableBlock {
  start: number;
  end: number;
  headerCells: string[];
  labels: string[];
  rows: string[][];
}

/** Locate EVERY endpoint (`method` + `path`) table and its data rows. The shared
 * parser collects rows from all such tables, so set must consider all of them too
 * — otherwise a key living in a later table is missed and a duplicate is appended
 * to the first. */
function locateEndpointTables(lines: string[]): EndpointTableBlock[] {
  const blocks: EndpointTableBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const headerCells = parseRow(line);
    if (!isEndpointHeaderRow(headerCells)) continue;
    const separator = lines[i + 1]?.trim();
    if (!separator?.startsWith('|') || !isSeparator(parseRow(separator))) continue;

    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const rowLine = lines[j].trim();
      if (!rowLine.startsWith('|')) break;
      const cells = parseRow(rowLine);
      if (isSeparator(cells)) break;
      rows.push(cells);
    }
    blocks.push({ start: i, end: j - 1, headerCells, labels: headerCells.map(c => c.trim().toLowerCase()), rows });
    i = j - 1; // resume scanning after this table
  }
  return blocks;
}

/** Index of the first present alias in a table's header labels (-1 if none). */
function columnIn(block: EndpointTableBlock, aliases: string[]): number {
  for (const alias of aliases) {
    const idx = block.labels.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** The (method, path) primary key of a row in a given block, normalized (method lowercased, path trimmed). */
function rowKey(block: EndpointTableBlock, row: string[]): string {
  const m = (row[block.labels.indexOf('method')] ?? '').toLowerCase();
  const p = (row[block.labels.indexOf('path')] ?? '').trim();
  return `${m} ${p}`;
}

/** `CreateOrder` / `CreateOrder[]` → `CreateOrder`; `-`/empty → ''. */
function schemaBaseName(cell: string): string {
  const raw = (cell ?? '').trim();
  if (!raw || raw === '-') return '';
  return raw.endsWith('[]') ? raw.slice(0, -2).trim() : raw;
}

export async function contractEndpointSet(opts: EndpointSetOptions): Promise<number> {
  const contractPath = opts.contract || DEFAULT_CONTRACT;
  if (!existsSync(contractPath)) {
    return fail(opts.json, `API contract not found: ${contractPath}`);
  }

  const method = opts.method.trim().toLowerCase();
  // Normalize the path once and use it everywhere (validation, matching, output):
  // the parser trims cells, so an un-trimmed `--path "/x "` would otherwise miss
  // the existing `/x` row and append a second one that collapses to a duplicate.
  const path = opts.path.trim();
  if (!VALID_METHODS.has(method)) {
    return fail(opts.json, `invalid method "${opts.method}" — expected one of: ${[...VALID_METHODS].join(', ')}`);
  }
  if (!path.startsWith('/')) {
    return fail(opts.json, `path must start with "/" (got "${opts.path}")`);
  }

  const raw = readFileSync(contractPath, 'utf8');
  // The defined-schema set must be trustworthy before we validate references
  // against it: if ## Schemas has a structural error (e.g. a duplicate section),
  // refuse rather than write an endpoint whose reference only "resolves" because
  // the error was discarded — `openapi export` would reject the same contract.
  const schemaParse = parseSchemaSections(stripFrontmatter(raw).body);
  if (schemaParse.errors.length > 0) {
    return fail(opts.json, `the contract's ## Schemas section has errors that must be fixed first:\n${schemaParse.errors.join('\n')}`, { errors: schemaParse.errors });
  }
  const definedSchemas = new Set(schemaParse.sections.map(s => s.name));
  const { lines, trailingNewline } = toLines(raw);

  const blocks = locateEndpointTables(lines);
  if (blocks.length === 0) {
    return fail(opts.json, `No endpoint table (a "| method | path | ... |" table) found in ${contractPath}.`);
  }

  // Every table must be internally consistent before we upsert: a pre-existing
  // duplicate (method, path) for ANY key, in ANY table, means a keyed mutation
  // cannot be guaranteed, so refuse rather than rewrite a malformed table. ADR 0004 §3.
  const keyCount = new Map<string, number>();
  for (const b of blocks) {
    for (const r of b.rows) keyCount.set(rowKey(b, r), (keyCount.get(rowKey(b, r)) ?? 0) + 1);
  }
  for (const [key, count] of keyCount) {
    if (count > 1) {
      return fail(opts.json, `the endpoint table already contains a duplicate key (${key.toUpperCase()}) before this change — resolve it by hand first.`);
    }
  }

  // Find which table (if any) already holds the target key; the duplicate guard
  // above guarantees at most one match. Update that table in place; otherwise
  // append to the first endpoint table.
  const targetKey = `${method} ${path}`;
  let block = blocks[0];
  let existingIdx = -1;
  for (const b of blocks) {
    const idx = b.rows.findIndex(r => rowKey(b, r) === targetKey);
    if (idx !== -1) {
      block = b;
      existingIdx = idx;
      break;
    }
  }

  const methodIdx = block.labels.indexOf('method');
  const pathIdx = block.labels.indexOf('path');

  // Resolve the target column for each provided value flag, against the table we
  // are about to write to.
  const provided: Array<{ flag: string; idx: number; value: string }> = [];
  for (const [flag, aliases, value] of [
    ['--auth', ['auth'], opts.auth],
    ['--request', ['request schema', 'request'], opts.request],
    ['--response', ['response schema', 'response'], opts.response],
    ['--errors', ['errors'], opts.errors],
    ['--tests', ['tests'], opts.tests],
  ] as Array<[string, string[], string | undefined]>) {
    if (value === undefined) continue;
    const idx = columnIn(block, aliases);
    if (idx === -1) {
      return fail(opts.json, `the endpoint table has no column for ${flag} (looked for: ${aliases.join(' / ')})`);
    }
    provided.push({ flag, idx, value });
  }

  // No cell may contain a pipe or line break, which would corrupt the table.
  const cellError = tableBreakingCellError([
    { value: path, what: 'path' },
    ...provided.map(p => ({ value: p.value, what: `${p.flag} value` })),
  ]);
  if (cellError) return fail(opts.json, cellError);

  // Validate referenced schemas resolve (a clean schema-name reference must point
  // at a defined `### Name` section; multi-word prose references are left alone).
  const refErrors: string[] = [];
  for (const ref of [
    { kind: 'request', value: opts.request },
    { kind: 'response', value: opts.response },
  ]) {
    if (ref.value === undefined) continue;
    const base = schemaBaseName(ref.value);
    if (base && SCHEMA_NAME_RE.test(base) && !definedSchemas.has(base)) {
      refErrors.push(`${ref.kind} schema "${base}" is not defined in ## Schemas — add it first with \`cdd-kit contract schema set ${base} ...\`, or use "-"`);
    }
  }
  if (refErrors.length > 0) return fail(opts.json, refErrors.join('\n'), { errors: refErrors });

  // Upsert by primary key, re-serializing only the target table block.
  const rows = block.rows.map(r => [...r]);
  let action: 'updated' | 'added';
  if (existingIdx !== -1) {
    const row = rows[existingIdx];
    while (row.length < block.headerCells.length) row.push('-');
    for (const p of provided) row[p.idx] = p.value;
    action = 'updated';
  } else {
    const row = Array.from({ length: block.headerCells.length }, () => '-');
    row[methodIdx] = method.toUpperCase();
    row[pathIdx] = path;
    for (const p of provided) row[p.idx] = p.value;
    rows.push(row);
    action = 'added';
  }

  const newBlock = [renderRow(block.headerCells), renderSeparator(block.headerCells.length), ...rows.map(renderRow)];
  const out = [...lines.slice(0, block.start), ...newBlock, ...lines.slice(block.end + 1)];
  writeFileSync(contractPath, fromLines(out, trailingNewline), 'utf8');

  const summary = `${action} ${method.toUpperCase()} ${path} (1 row ${action === 'added' ? 'added' : 'changed'})`;
  emit(opts.json, { ok: true, action, method, path, summary }, summary);
  return 0;
}

// ── schema set ───────────────────────────────────────────────────────────────

interface FieldSpec {
  name: string;
  type: string;
  required: string;
  format: string;
  notes: string;
}

/**
 * Validate the SHAPE of a field type, returning a specific reason or null. In
 * particular an `enum(...)` whose body has no non-empty member (`enum( )`,
 * `enum(,)`) is rejected here — otherwise the regex accepts it, `contract set`
 * writes the schema, and `openapi export` later fails with "enum must list at
 * least one value". A bare SchemaName shape passes the shape check; whether that
 * reference actually resolves is checked separately (against the defined-schema
 * set) by `contractSchemaSet`.
 */
function fieldTypeError(type: string): string | null {
  const base = type.endsWith('[]') ? type.slice(0, -2).trim() : type;
  if (!base) return `has an empty type`;
  if (PRIMITIVE_TYPES.includes(base)) return null;
  const enumMatch = base.match(/^enum\((.*)\)$/);
  if (enumMatch) {
    const values = (enumMatch[1] ?? '').split(',').map(v => v.trim()).filter(Boolean);
    return values.length > 0 ? null : `enum type "${type}" must list at least one value`;
  }
  if (SCHEMA_NAME_RE.test(base)) return null;
  return `has unsupported type "${type}" (use string/integer/number/boolean, enum(...), a SchemaName, or those with [])`;
}

/** The schema name a field type references (after stripping `[]`), or null for a
 * primitive / enum / non-reference. Assumes the type already passed `fieldTypeError`. */
function schemaRefName(type: string): string | null {
  const base = type.endsWith('[]') ? type.slice(0, -2).trim() : type.trim();
  if (!base || PRIMITIVE_TYPES.includes(base) || /^enum\(/.test(base)) return null;
  return SCHEMA_NAME_RE.test(base) ? base : null;
}

/** Parse `name:type:required[:format[:notes]]` (notes may contain colons). */
function parseFieldSpec(spec: string): FieldSpec | { error: string } {
  const parts = spec.split(':');
  if (parts.length < 3) return { error: `field "${spec}" must be at least name:type:required` };
  const [name, type, required, format = '', ...rest] = parts;
  if (!name.trim()) return { error: `field "${spec}" has an empty name` };
  const typeErr = fieldTypeError(type.trim());
  if (typeErr) return { error: `field "${name.trim()}" ${typeErr}` };
  // `required` must be stated explicitly: an empty cell (`name:type:`) is a
  // malformed/typoed flag, not a silent "no" — that would quietly turn a field
  // the author meant to mark required into an optional one in the export.
  const req = required.trim().toLowerCase();
  if (req !== 'yes' && req !== 'no') return { error: `field "${name.trim()}" required must be "yes" or "no" (got "${required.trim() || '(empty)'}")` };
  return { name: name.trim(), type: type.trim(), required: req, format: format.trim(), notes: rest.join(':').trim() };
}

/** Real (non-commented) `### Name` heading indices+names in lines[from, to). */
function findSchemaHeadings(lines: string[], from: number, to: number): Array<{ index: number; name: string }> {
  const out: Array<{ index: number; name: string }> = [];
  let inComment = false;
  for (let i = from; i < to; i += 1) {
    if (!inComment) {
      const m = lines[i].trim().match(/^###\s+(.+?)\s*$/);
      if (m) out.push({ index: i, name: m[1].trim() });
    }
    // Track multi-line HTML comments so the template's `<!-- ### ExampleRequest
    // ... -->` example block is not mistaken for a real schema section (the
    // shared parser strips comments before it reads sections, so we must too).
    const opens = (lines[i].match(/<!--/g) ?? []).length;
    const closes = (lines[i].match(/-->/g) ?? []).length;
    if (opens > closes) inComment = true;
    else if (closes > opens) inComment = false;
  }
  return out;
}

/** For lines[from, to), mark each line that is inside or delimits an HTML comment. */
function commentMask(lines: string[], from: number, to: number): boolean[] {
  const mask: boolean[] = [];
  let inComment = false;
  for (let i = from; i < to; i += 1) {
    const opens = (lines[i].match(/<!--/g) ?? []).length;
    const closes = (lines[i].match(/-->/g) ?? []).length;
    mask.push(inComment || opens > 0 || closes > 0);
    if (opens > closes) inComment = true;
    else if (closes > opens) inComment = false;
  }
  return mask;
}

function buildSchemaSection(name: string, fields: FieldSpec[]): string[] {
  const lines = [`### ${name}`, renderRow(['field', 'type', 'required', 'format', 'notes']), renderSeparator(5)];
  for (const f of fields) lines.push(renderRow([f.name, f.type, f.required, f.format, f.notes]));
  return lines;
}

export async function contractSchemaSet(opts: SchemaSetOptions): Promise<number> {
  const contractPath = opts.contract || DEFAULT_CONTRACT;
  if (!existsSync(contractPath)) {
    return fail(opts.json, `API contract not found: ${contractPath}`);
  }
  if (!SCHEMA_NAME_RE.test(opts.name)) {
    return fail(opts.json, `invalid schema name "${opts.name}" — must match ${SCHEMA_NAME_RE}`);
  }
  if (opts.fields.length === 0) {
    return fail(opts.json, 'contract schema set needs at least one --field "name:type:required[:format[:notes]]"');
  }

  const fields: FieldSpec[] = [];
  const seen = new Set<string>();
  for (const spec of opts.fields) {
    const parsed = parseFieldSpec(spec);
    if ('error' in parsed) return fail(opts.json, parsed.error);
    if (seen.has(parsed.name)) return fail(opts.json, `duplicate field "${parsed.name}" in schema ${opts.name}`);
    seen.add(parsed.name);
    // No field cell may contain a pipe or line break (an enum like enum(a|b) or
    // free-form notes are the usual culprits), which would corrupt the table.
    const cellError = tableBreakingCellError([
      { value: parsed.name, what: `field "${parsed.name}" name` },
      { value: parsed.type, what: `field "${parsed.name}" type` },
      { value: parsed.format, what: `field "${parsed.name}" format` },
      { value: parsed.notes, what: `field "${parsed.name}" notes` },
    ]);
    if (cellError) return fail(opts.json, cellError);
    fields.push(parsed);
  }

  const raw = readFileSync(contractPath, 'utf8');
  const body = stripFrontmatter(raw).body;
  const { lines, trailingNewline } = toLines(raw);

  const schemasIdx = lines.findIndex(l => /^##\s+Schemas\s*$/i.test(l.trim()));
  if (schemasIdx === -1) {
    return fail(opts.json, `No "## Schemas" section found in ${contractPath}.`);
  }
  let schemasEnd = lines.length;
  for (let i = schemasIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) {
      schemasEnd = i;
      break;
    }
  }

  // Locate the target among the REAL (non-commented) `### Name` headings. A
  // heading inside the template's `<!-- ### ExampleRequest ... -->` example is
  // not a usable section, so `schema set ExampleRequest` must insert a real one
  // rather than "replace" inside the comment; a duplicate target is refused with
  // a specific message (checked here, before the generic parse-error guard).
  const headings = findSchemaHeadings(lines, schemasIdx + 1, schemasEnd);
  const targets = headings.filter(h => h.name === opts.name);
  if (targets.length > 1) {
    return fail(opts.json, `schema "${opts.name}" is defined ${targets.length} times in ## Schemas — resolve the duplicate by hand first.`);
  }

  // Refuse to mutate a contract whose ## Schemas already has a structural error
  // (e.g. a duplicate of some OTHER section): we would write a section into a
  // contract `openapi export` rejects, and the resolvable-name set trusted below
  // would be built from a partial parse. Mirrors the endpoint-set guard.
  const sectionErrors = parseSchemaSections(body).errors;
  if (sectionErrors.length > 0) {
    return fail(opts.json, `the contract's ## Schemas section has errors that must be fixed first:\n${sectionErrors.join('\n')}`, { errors: sectionErrors });
  }

  // A field whose type is a SchemaName (or SchemaName[]) must reference a schema
  // openapi export can actually resolve — one with a field table or a json-schema
  // block — or this schema itself (a self-reference becomes resolvable once
  // written). A reference to an undefined OR Tier-C prose schema is refused,
  // because the compiler rejects it and `set` would otherwise write a contract
  // that does not export. (Mutually recursive schemas are still reachable by
  // building them incrementally.) The resolvable set is exactly the parser's
  // compiled-schema map, so this never drifts from what export accepts.
  const resolvable = new Set([...Object.keys(parseContractSchemas(body).schemas), opts.name]);
  for (const f of fields) {
    const ref = schemaRefName(f.type);
    if (ref && !resolvable.has(ref)) {
      return fail(opts.json, `field "${f.name}" references schema "${ref}", which is not defined as a resolvable schema in ## Schemas (it needs a field table or a json-schema block) — add it first with \`cdd-kit contract schema set ${ref} ...\``);
    }
  }

  const section = buildSchemaSection(opts.name, fields);
  const nameStart = targets.length === 1 ? targets[0].index : -1;

  let out: string[];
  let action: 'replaced' | 'inserted';
  if (nameStart !== -1) {
    // Replace the whole section body (heading → next real `###`/`##`), but keep a
    // TRAILING run of comment/blank lines: a sibling `<!-- ### Example ... -->`
    // block after the section is preserved, while a comment INTERNAL to the
    // section (one sitting before the section's real body) is replaced along with
    // that body — otherwise an old json-schema block could survive next to the new
    // field table and export would reject a section that has both.
    const nextHeading = headings.find(h => h.index > nameStart);
    const nameEnd = nextHeading ? nextHeading.index : schemasEnd;
    const commented = commentMask(lines, nameStart + 1, nameEnd);
    let last = nameEnd - 1;
    while (last > nameStart && (lines[last].trim() === '' || commented[last - (nameStart + 1)])) last -= 1;
    out = [...lines.slice(0, nameStart), ...section, ...lines.slice(last + 1)];
    action = 'replaced';
  } else {
    // Insert after the last content line of the Schemas section, blank-separated.
    let insertAt = schemasEnd;
    while (insertAt > schemasIdx + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1;
    out = [...lines.slice(0, insertAt), '', ...section, ...lines.slice(insertAt)];
    action = 'inserted';
  }

  writeFileSync(contractPath, fromLines(out, trailingNewline), 'utf8');
  const summary = `${action} schema ${opts.name} (${fields.length} field${fields.length === 1 ? '' : 's'})`;
  emit(opts.json, { ok: true, action, name: opts.name, fields: fields.length, summary }, summary);
  return 0;
}

function emit(json: boolean, payload: Record<string, unknown>, summary: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    log.ok(summary);
  }
}
