import { existsSync, readFileSync, writeFileSync } from 'fs';
import { log } from '../utils/logger.js';
import {
  stripFrontmatter,
  parseRow,
  isSeparator,
  isEndpointHeaderRow,
  parseSchemaSections,
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

/** Locate the first endpoint (`method` + `path`) table and its data rows. */
function locateEndpointTable(lines: string[]): EndpointTableBlock | null {
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
    return { start: i, end: j - 1, headerCells, labels: headerCells.map(c => c.trim().toLowerCase()), rows };
  }
  return null;
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
  if (!VALID_METHODS.has(method)) {
    return fail(opts.json, `invalid method "${opts.method}" — expected one of: ${[...VALID_METHODS].join(', ')}`);
  }
  if (!opts.path.startsWith('/')) {
    return fail(opts.json, `path must start with "/" (got "${opts.path}")`);
  }

  const raw = readFileSync(contractPath, 'utf8');
  const definedSchemas = new Set(parseSchemaSections(stripFrontmatter(raw).body).sections.map(s => s.name));
  const { lines, trailingNewline } = toLines(raw);

  const block = locateEndpointTable(lines);
  if (!block) {
    return fail(opts.json, `No endpoint table (a "| method | path | ... |" table) found in ${contractPath}.`);
  }

  const methodIdx = block.labels.indexOf('method');
  const pathIdx = block.labels.indexOf('path');

  // The table must be internally consistent before we upsert into it: a
  // pre-existing duplicate (method, path) for ANY key — not just the one being
  // set — means a keyed mutation cannot be guaranteed, so refuse rather than
  // rewrite a malformed table and leave the other duplicate behind. ADR 0004 §3.
  const seenKeys = new Set<string>();
  for (const r of block.rows) {
    const key = `${(r[methodIdx] ?? '').toLowerCase()} ${r[pathIdx] ?? ''}`;
    if (seenKeys.has(key)) {
      return fail(opts.json, `the endpoint table already contains a duplicate key (${key.toUpperCase()}) before this change — resolve it by hand first.`);
    }
    seenKeys.add(key);
  }

  // Resolve the target column for each provided value flag.
  const columnFor = (aliases: string[]): number => {
    for (const alias of aliases) {
      const idx = block.labels.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const provided: Array<{ flag: string; aliases: string[]; value: string }> = [];
  for (const [flag, aliases, value] of [
    ['--auth', ['auth'], opts.auth],
    ['--request', ['request schema', 'request'], opts.request],
    ['--response', ['response schema', 'response'], opts.response],
    ['--errors', ['errors'], opts.errors],
    ['--tests', ['tests'], opts.tests],
  ] as Array<[string, string[], string | undefined]>) {
    if (value === undefined) continue;
    const idx = columnFor(aliases);
    if (idx === -1) {
      return fail(opts.json, `the endpoint table has no column for ${flag} (looked for: ${aliases.join(' / ')})`);
    }
    provided.push({ flag, aliases, value });
  }

  // No cell may contain a pipe or line break, which would corrupt the table.
  const cellError = tableBreakingCellError([
    { value: opts.path, what: 'path' },
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

  // Upsert by primary key.
  const rows = block.rows.map(r => [...r]);
  const existingIdx = rows.findIndex(r => (r[methodIdx] ?? '').toLowerCase() === method && (r[pathIdx] ?? '') === opts.path);
  let action: 'updated' | 'added';
  if (existingIdx !== -1) {
    const row = rows[existingIdx];
    while (row.length < block.headerCells.length) row.push('-');
    for (const p of provided) row[columnFor(p.aliases)] = p.value;
    action = 'updated';
  } else {
    const row = Array.from({ length: block.headerCells.length }, () => '-');
    row[methodIdx] = opts.method.trim().toUpperCase();
    row[pathIdx] = opts.path;
    for (const p of provided) row[columnFor(p.aliases)] = p.value;
    rows.push(row);
    action = 'added';
  }

  const newBlock = [renderRow(block.headerCells), renderSeparator(block.headerCells.length), ...rows.map(renderRow)];
  const out = [...lines.slice(0, block.start), ...newBlock, ...lines.slice(block.end + 1)];
  writeFileSync(contractPath, fromLines(out, trailingNewline), 'utf8');

  const summary = `${action} ${opts.method.toUpperCase()} ${opts.path} (1 row ${action === 'added' ? 'added' : 'changed'})`;
  emit(opts.json, { ok: true, action, method, path: opts.path, summary }, summary);
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
 * Validate a field type the same way the shared compiler does, returning a
 * specific reason or null. In particular an `enum(...)` whose body has no
 * non-empty member (`enum( )`, `enum(,)`) is rejected here — otherwise the regex
 * accepts it, `contract set` writes the schema, and `openapi export` later fails
 * with "enum must list at least one value". A bare SchemaName shape is a
 * reference; full resolution is the export/gate's job, so it passes here.
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
  // rather than "replace" inside the comment; and if the key is defined more than
  // once we refuse, mirroring the endpoint duplicate guard (the shared parser
  // reports duplicate sections and `openapi export` fails on them).
  const headings = findSchemaHeadings(lines, schemasIdx + 1, schemasEnd);
  const targets = headings.filter(h => h.name === opts.name);
  if (targets.length > 1) {
    return fail(opts.json, `schema "${opts.name}" is defined ${targets.length} times in ## Schemas — resolve the duplicate by hand first.`);
  }

  const section = buildSchemaSection(opts.name, fields);
  const nameStart = targets.length === 1 ? targets[0].index : -1;

  let out: string[];
  let action: 'replaced' | 'inserted';
  if (nameStart !== -1) {
    // Replace the section's content, stopping at the next real heading OR a
    // comment block, so a trailing `<!-- ... -->` example is preserved, not eaten.
    const nextHeading = headings.find(h => h.index > nameStart);
    let nameEnd = nextHeading ? nextHeading.index : schemasEnd;
    for (let i = nameStart + 1; i < nameEnd; i += 1) {
      if (lines[i].trim().startsWith('<!--')) {
        nameEnd = i;
        break;
      }
    }
    let last = nameEnd - 1;
    while (last > nameStart && lines[last].trim() === '') last -= 1;
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
