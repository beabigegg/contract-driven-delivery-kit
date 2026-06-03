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

const DEFAULT_CONTRACT = 'contracts/api/api-contract.md';
const PRIMITIVE_TYPES = ['string', 'integer', 'number', 'boolean'];

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
    log.error(`API contract not found: ${contractPath}`);
    return 1;
  }

  const method = opts.method.trim().toLowerCase();
  if (!VALID_METHODS.has(method)) {
    log.error(`invalid method "${opts.method}" — expected one of: ${[...VALID_METHODS].join(', ')}`);
    return 1;
  }
  if (!opts.path.startsWith('/')) {
    log.error(`path must start with "/" (got "${opts.path}")`);
    return 1;
  }

  const raw = readFileSync(contractPath, 'utf8');
  const definedSchemas = new Set(parseSchemaSections(stripFrontmatter(raw).body).sections.map(s => s.name));
  const { lines, trailingNewline } = toLines(raw);

  const block = locateEndpointTable(lines);
  if (!block) {
    log.error(`No endpoint table (a "| method | path | ... |" table) found in ${contractPath}.`);
    return 1;
  }

  const methodIdx = block.labels.indexOf('method');
  const pathIdx = block.labels.indexOf('path');

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
      log.error(`the endpoint table has no column for ${flag} (looked for: ${aliases.join(' / ')})`);
      return 1;
    }
    provided.push({ flag, aliases, value });
  }

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
  if (refErrors.length > 0) {
    for (const e of refErrors) log.error(e);
    return 1;
  }

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

  // No-duplicate-key guard (also catches a pre-existing duplicate the upsert
  // could not collapse — refuse to write rather than silently leave it).
  const keyMatches = rows.filter(r => (r[methodIdx] ?? '').toLowerCase() === method && (r[pathIdx] ?? '') === opts.path);
  if (keyMatches.length > 1) {
    log.error(`duplicate endpoint ${method.toUpperCase()} ${opts.path}: ${keyMatches.length} rows share this key. Resolve the duplicate by hand first.`);
    return 1;
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

function isValidFieldType(type: string): boolean {
  const base = type.endsWith('[]') ? type.slice(0, -2).trim() : type;
  if (PRIMITIVE_TYPES.includes(base)) return true;
  if (/^enum\(.+\)$/.test(base)) return true;
  return SCHEMA_NAME_RE.test(base); // reference to another schema (full resolution is checked by export/gate)
}

/** Parse `name:type:required[:format[:notes]]` (notes may contain colons). */
function parseFieldSpec(spec: string): FieldSpec | { error: string } {
  const parts = spec.split(':');
  if (parts.length < 3) return { error: `field "${spec}" must be at least name:type:required` };
  const [name, type, required, format = '', ...rest] = parts;
  if (!name.trim()) return { error: `field "${spec}" has an empty name` };
  if (!isValidFieldType(type.trim())) return { error: `field "${name.trim()}" has unsupported type "${type.trim()}" (use string/integer/number/boolean, enum(...), a SchemaName, or those with [])` };
  const req = required.trim().toLowerCase();
  if (req && req !== 'yes' && req !== 'no') return { error: `field "${name.trim()}" required must be "yes" or "no" (got "${required.trim()}")` };
  return { name: name.trim(), type: type.trim(), required: req === 'yes' ? 'yes' : 'no', format: format.trim(), notes: rest.join(':').trim() };
}

function buildSchemaSection(name: string, fields: FieldSpec[]): string[] {
  const lines = [`### ${name}`, renderRow(['field', 'type', 'required', 'format', 'notes']), renderSeparator(5)];
  for (const f of fields) lines.push(renderRow([f.name, f.type, f.required, f.format, f.notes]));
  return lines;
}

export async function contractSchemaSet(opts: SchemaSetOptions): Promise<number> {
  const contractPath = opts.contract || DEFAULT_CONTRACT;
  if (!existsSync(contractPath)) {
    log.error(`API contract not found: ${contractPath}`);
    return 1;
  }
  if (!SCHEMA_NAME_RE.test(opts.name)) {
    log.error(`invalid schema name "${opts.name}" — must match ${SCHEMA_NAME_RE}`);
    return 1;
  }
  if (opts.fields.length === 0) {
    log.error('contract schema set needs at least one --field "name:type:required[:format[:notes]]"');
    return 1;
  }

  const fields: FieldSpec[] = [];
  const seen = new Set<string>();
  for (const spec of opts.fields) {
    const parsed = parseFieldSpec(spec);
    if ('error' in parsed) {
      log.error(parsed.error);
      return 1;
    }
    if (seen.has(parsed.name)) {
      log.error(`duplicate field "${parsed.name}" in schema ${opts.name}`);
      return 1;
    }
    seen.add(parsed.name);
    fields.push(parsed);
  }

  const raw = readFileSync(contractPath, 'utf8');
  const { lines, trailingNewline } = toLines(raw);

  const schemasIdx = lines.findIndex(l => /^##\s+Schemas\s*$/i.test(l.trim()));
  if (schemasIdx === -1) {
    log.error(`No "## Schemas" section found in ${contractPath}.`);
    return 1;
  }
  let schemasEnd = lines.length;
  for (let i = schemasIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) {
      schemasEnd = i;
      break;
    }
  }

  const section = buildSchemaSection(opts.name, fields);

  let nameStart = -1;
  for (let i = schemasIdx + 1; i < schemasEnd; i += 1) {
    const m = lines[i].trim().match(/^###\s+(.+?)\s*$/);
    if (m && m[1].trim() === opts.name) {
      nameStart = i;
      break;
    }
  }

  let out: string[];
  let action: 'replaced' | 'inserted';
  if (nameStart !== -1) {
    // Replace the section's content lines, preserving any blank separators after it.
    let nameEnd = schemasEnd;
    for (let i = nameStart + 1; i < schemasEnd; i += 1) {
      if (/^###\s+/.test(lines[i].trim())) {
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
