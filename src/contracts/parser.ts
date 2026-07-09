/**
 * Shared contract parser — the single, deterministic way the kit reads a
 * markdown contract into structured data. See
 * docs/adr/0004-queryable-and-writable-contracts.md (§4).
 *
 * Three consumers project from this one parser:
 *   - `openapi export` → an OpenAPI document (src/commands/openapi-export.ts)
 *   - `contract query` → a keyed query slice                 (follow-up PR)
 *   - `contract set`   → parse → mutate → re-serialize        (follow-up PR)
 *
 * The parsing core was extracted from openapi-export.ts (ADR 0004 Phase 1); the
 * existing openapi-export tests are the guard that the extraction preserves
 * behaviour. The only intentional enrichment over the original is that endpoint
 * parsing is now header-driven instead of positional — so column order (or a
 * different contract surface) can never silently mis-map a cell — and it
 * captures the `tests` column the OpenAPI projection ignores but a substantive
 * gate check needs (ADR 0004 §5).
 */

export type JsonSchema = Record<string, unknown>;

export const VALID_METHODS: ReadonlySet<string> = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
export const SCHEMA_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * The default on-disk locations of the API contract and its inventory. Defined
 * here, in the shared contract module, so the CLI command definitions and every
 * command implementation (openapi export, contract query, contract set) read the
 * same value instead of each repeating the literal — one place to change.
 */
export const DEFAULT_CONTRACT_PATH = 'contracts/api/api-contract.md';
export const DEFAULT_INVENTORY_PATH = 'contracts/api/api-inventory.md';
const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

export interface EndpointRow {
  method: string;
  path: string;
  auth: string;
  request: string;
  response: string;
  errors: string;
  /**
   * The endpoint's `tests` cell. The OpenAPI projection ignores it, but the
   * substantive gate check (ADR 0004 §5) asserts it is non-empty, so the shared
   * parser captures it rather than dropping it on the floor as the original
   * positional parser did.
   */
  tests: string;
}

export interface SchemaSection {
  name: string;
  content: string;
}

export interface SchemaParseResult {
  schemas: Record<string, JsonSchema>;
  errors: string[];
}

interface FieldRow {
  field: string;
  type: string;
  required: string;
  notes: string;
  format: string;
}

export function stripFrontmatter(text: string): { body: string; frontmatter: Record<string, string> } {
  const fm: Record<string, string> = {};
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const block = text.slice(3, end);
      for (const line of block.split('\n')) {
        const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (m) fm[m[1].trim()] = m[2].trim();
      }
      return { body: text.slice(end + 4).replace(/^\n+/, ''), frontmatter: fm };
    }
  }
  return { body: text, frontmatter: fm };
}

export interface ApplicabilityProjection {
  status: 'applicable' | 'not-applicable' | 'invalid';
  /** Set only when `status === 'not-applicable'`. */
  reason?: string;
  /** Set only when `status === 'invalid'`. */
  error?: string;
}

function unquoteFrontmatterValue(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/**
 * Read-only projection of the `applicability` / `applicability-reason`
 * frontmatter marker (ADR 0011) off `stripFrontmatter().frontmatter`, for
 * DISPLAY in `cdd-kit doctor` only. This mirrors
 * `.claude/skills/contract-driven-delivery/scripts/applicability.py`'s
 * classification exactly (AC-6 agreement), but carries NO pass/fail
 * authority of its own — the Python reader is the sole authority
 * (design.md decision 2); this function must never gate a validator's
 * exit code.
 */
export function projectApplicability(frontmatter: Record<string, string>): ApplicabilityProjection {
  const raw = frontmatter['applicability'];
  if (raw === undefined || raw.trim() === '') return { status: 'applicable' };

  const value = unquoteFrontmatterValue(raw);

  if (value === 'applicable') return { status: 'applicable' };

  if (value === 'not-applicable') {
    const rawReason = frontmatter['applicability-reason'];
    const reason = rawReason !== undefined ? unquoteFrontmatterValue(rawReason) : '';
    if (!reason) {
      return {
        status: 'invalid',
        error: 'applicability: not-applicable requires a non-empty applicability-reason (ADR 0011).',
      };
    }
    return { status: 'not-applicable', reason };
  }

  return {
    status: 'invalid',
    error: `unrecognized applicability value "${raw.trim()}" — expected "applicable" or "not-applicable" (ADR 0011).`,
  };
}

export function parseRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

export function isSeparator(cells: string[]): boolean {
  return cells.every(c => c === '' || /^:?-+:?$/.test(c));
}

/**
 * Per-field header aliases used to project a generic endpoint row onto the
 * API-contract `EndpointRow`. The API contract writes `request schema` /
 * `response schema`; the shorter `request` / `response` forms are also accepted.
 * Aliases are listed in priority order.
 */
const ENDPOINT_FIELD_ALIASES: Record<Exclude<keyof EndpointRow, 'method' | 'path'>, string[]> = {
  auth: ['auth'],
  request: ['request schema', 'request'],
  response: ['response schema', 'response'],
  errors: ['errors'],
  tests: ['tests'],
};

/**
 * True when a table row is an endpoint header. Detection is by the presence of
 * the `method` and `path` labels anywhere in the row (not by `method` being the
 * first column), so a reordered header — `| path | method | … |` — is still
 * recognised, while a non-endpoint table (e.g. a `| field | type | … |` schema
 * field table) is never mistaken for one.
 */
export function isEndpointHeaderRow(cells: string[]): boolean {
  const labels = new Set(cells.map(c => c.trim().toLowerCase()));
  return labels.has('method') && labels.has('path');
}

/**
 * A generic endpoint-table data row: every column keyed by its normalized
 * (lowercased) header label, plus the validated `method` / `path` primary key
 * (`method` lowercased; `cells` preserves the raw values). This is the substrate
 * `cdd-kit contract query` reads — so it can see inventory columns like
 * `category` / `owner` that the OpenAPI projection ignores — and `parseEndpoints`
 * is the API-contract projection over it.
 */
export interface EndpointTableRow {
  method: string;
  path: string;
  cells: Record<string, string>;
}

/** Collect a generic record for every data row of every endpoint (`method` + `path`) table. */
export function parseEndpointTableRows(body: string): EndpointTableRow[] {
  const rows: EndpointTableRow[] = [];
  let headerLabels: string[] | null = null;
  let sepSeen = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || !line.startsWith('|')) {
      // A blank or non-table line ends the current table; reset the header so it
      // can never leak into an unrelated table further down the document.
      headerLabels = null;
      sepSeen = false;
      continue;
    }
    const cells = parseRow(line);
    if (isEndpointHeaderRow(cells)) {
      headerLabels = cells.map(c => c.trim().toLowerCase());
      sepSeen = false;
      continue;
    }
    if (!headerLabels) continue;
    if (!sepSeen && isSeparator(cells)) {
      sepSeen = true;
      continue;
    }
    if (cells.length < 2 || !cells.some(Boolean)) continue;
    const record: Record<string, string> = {};
    headerLabels.forEach((label, i) => {
      if (label && record[label] === undefined) record[label] = cells[i] ?? '';
    });
    const method = (record.method ?? '').toLowerCase();
    const path = record.path ?? '';
    if (!VALID_METHODS.has(method) || !path.startsWith('/')) continue;
    rows.push({ method, path, cells: record });
  }
  return rows;
}

/**
 * Collect API-contract endpoint rows — the projection the OpenAPI export reads.
 * `method` and `auth` are lowercased; schema / errors / tests cells are verbatim.
 */
export function parseEndpoints(body: string): EndpointRow[] {
  return parseEndpointTableRows(body).map(row => {
    const pick = (aliases: string[]): string => {
      for (const alias of aliases) {
        if (row.cells[alias] !== undefined) return row.cells[alias];
      }
      return '';
    };
    return {
      method: row.method,
      path: row.path,
      auth: pick(ENDPOINT_FIELD_ALIASES.auth).toLowerCase(),
      request: pick(ENDPOINT_FIELD_ALIASES.request),
      response: pick(ENDPOINT_FIELD_ALIASES.response),
      errors: pick(ENDPOINT_FIELD_ALIASES.errors),
      tests: pick(ENDPOINT_FIELD_ALIASES.tests),
    };
  });
}

/**
 * Parse a schema cell as a bare schema reference — `Name` or `Name[]` — the
 * exact grammar `openapi export` resolves to a `$ref`. Returns the name and
 * whether it is an array, independent of whether `Name` is actually defined.
 * Returns null for an empty/`-` cell or any non-bare form (prose, a decorated
 * reference like `→ Name`). Factored into the shared parser so `openapi export`,
 * `doctor`, and the near-miss detector all key off ONE definition of "what a
 * resolvable response/request cell looks like" and can never drift.
 */
export function parseSchemaCellRef(cell: string): { name: string; isArray: boolean } | null {
  const raw = cell.trim();
  if (!raw || raw === '-') return null;
  const isArray = raw.endsWith('[]');
  const name = (isArray ? raw.slice(0, -2) : raw).trim();
  if (!SCHEMA_NAME_RE.test(name)) return null;
  return { name, isArray };
}

/**
 * Detect a NEAR-MISS schema reference: a response/request cell that does NOT
 * resolve to a defined schema (so `openapi export` emits no `$ref` and the body
 * is silently left unenforced) but that mentions, as an identifier token, the
 * name of a schema that IS defined under `## Schemas` — e.g. `→ AckResponse`,
 * `see AckResponse`, `AckResponse (success)`. This is almost always an author or
 * agent meaning to reference the schema in a non-bare form the grammar rejects;
 * left undetected it reads as a clean pass while enforcing nothing (the exact
 * "looked green, checked zero" trap data-shape conformance exists to kill).
 *
 * Returns the matched schema name plus the bare correction to suggest, or null
 * when the cell resolves cleanly, is empty/`-`, or is genuine prose naming no
 * defined schema (legitimate Tier-C — never flagged, per ADR 0007's
 * no-forced-migration guarantee). High precision by construction: it only fires
 * when the named schema actually exists, so prose labels like `success_response`
 * (no such schema) are never false-positived.
 */
export function detectSchemaCellNearMiss(
  cell: string,
  definedSchemas: ReadonlySet<string>,
): { name: string; suggestion: string } | null {
  const raw = cell.trim();
  if (!raw || raw === '-') return null;
  const ref = parseSchemaCellRef(cell);
  if (ref && definedSchemas.has(ref.name)) return null; // already a clean, resolved reference
  for (const m of raw.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)) {
    const token = m[0];
    if (!definedSchemas.has(token)) continue;
    // Preserve an array intent when the token is immediately followed by `[]`.
    const after = raw.slice((m.index ?? 0) + token.length).trimStart();
    return { name: token, suggestion: after.startsWith('[]') ? `${token}[]` : token };
  }
  return null;
}

/**
 * Normalize an endpoint path to the OpenAPI path-template form that `openapi
 * export` uses as the `paths[path]` key: Express-style `:id` and brace `{ id }`
 * params both collapse to `{id}`, and any `?query` suffix is dropped. Two
 * contract rows whose paths normalize to the same string land on the same
 * OpenAPI operation (`paths[path][method]`), so the later one silently
 * overwrites the earlier. `contract set` keys its duplicate guard on THIS, not
 * the raw cell, to stay valid-by-construction against what export will emit —
 * and export computes its path key from the same function so the two can never
 * drift on which rows collide.
 */
export function normalizeApiPath(path: string): string {
  return path
    .replace(/:([A-Za-z_][\w]*)/g, (_m, n: string) => `{${n}}`)
    .replace(/\{([^}/]+)\}/g, (_m, n: string) => `{${n.trim()}}`)
    .split('?', 1)[0];
}

function extractSchemasSection(body: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex(line => /^##\s+Schemas\s*$/i.test(line.trim()));
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

/**
 * Return the trimmed body of a `## <heading>` section (case-insensitive), up to
 * the next `## ` heading or end of document. Used to surface the bounded shared
 * prose sections (Error Format, Compatibility Policy, Breaking Change Policy) an
 * endpoint answer references. Returns '' when the heading is absent.
 */
export function extractSection(body: string, heading: string): string {
  const lines = body.split('\n');
  const target = heading.trim().toLowerCase();
  const start = lines.findIndex(line => {
    const m = line.trim().match(/^##\s+(.+?)\s*$/);
    return m ? m[1].trim().toLowerCase() === target : false;
  });
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

export function parseSchemaSections(body: string): { sections: SchemaSection[]; errors: string[] } {
  const schemasBlock = extractSchemasSection(body).replace(/<!--[\s\S]*?-->/g, '');
  if (!schemasBlock.trim()) return { sections: [], errors: [] };

  const sections: SchemaSection[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const headingRe = /^###\s+(.+?)\s*$/gm;
  const headings = Array.from(schemasBlock.matchAll(headingRe));

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const name = (heading[1] ?? '').trim();
    const contentStart = (heading.index ?? 0) + heading[0].length;
    const contentEnd = i + 1 < headings.length ? (headings[i + 1].index ?? schemasBlock.length) : schemasBlock.length;

    if (!SCHEMA_NAME_RE.test(name)) continue;
    if (seen.has(name)) {
      errors.push(`Duplicate schema section: ${name}`);
      continue;
    }
    seen.add(name);
    sections.push({ name, content: schemasBlock.slice(contentStart, contentEnd) });
  }

  return { sections, errors };
}

interface FenceBlock {
  /** Full info string after the opening backticks, trimmed (`''` when untagged). */
  info: string;
  /** Inner block content, without the backtick fences. */
  content: string;
}

/**
 * Scan a section for fenced code blocks once. `parseJsonSchemaBlocks` and
 * `findForeignFenceTag` both classify off this single pass rather than each
 * running its own near-identical regex over the same text.
 */
function findFencedBlocks(text: string): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  const fenceRe = /```([^\n]*)(?:\n|$)([\s\S]*?)```/g;
  for (const match of text.matchAll(fenceRe)) {
    blocks.push({ info: (match[1] ?? '').trim(), content: match[2] ?? '' });
  }
  return blocks;
}

function parseJsonSchemaBlocks(section: SchemaSection): { blocks: JsonSchema[]; errors: string[] } {
  const blocks: JsonSchema[] = [];
  const errors: string[] = [];
  for (const fence of findFencedBlocks(section.content)) {
    if (fence.info !== 'json-schema') continue; // only a bare `json-schema` fence is a typed schema body
    try {
      const parsed = JSON.parse(fence.content) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push(`Schema ${section.name}: json-schema block must be a JSON object`);
      } else {
        blocks.push(parsed as JsonSchema);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      errors.push(`Schema ${section.name}: invalid json-schema block (${detail})`);
    }
  }
  return { blocks, errors };
}

/**
 * A schema section that contains a fenced code block whose info string is
 * anything other than exactly `json-schema` is almost always a mistake (most
 * authors and agents reach for ```` ```json ````; a decorated
 * ```` ```json-schema title="X" ```` is also rejected because
 * `parseJsonSchemaBlocks` only parses a bare `json-schema` fence, so a decorated
 * one would otherwise be silently dropped). The whole info string is compared —
 * not just the leading word — so the two stay in lock-step. Returns the
 * offending info string (`''` = a fence with no tag); `null` = no foreign fence.
 */
function findForeignFenceTag(section: SchemaSection): string | null {
  const foreign = findFencedBlocks(section.content).find(f => f.info !== 'json-schema');
  return foreign ? foreign.info : null;
}

function parseFieldTable(section: SchemaSection): { rows: FieldRow[]; found: boolean } {
  const lines = section.content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const header = parseRow(line).map(c => c.toLowerCase());
    const fieldIdx = header.indexOf('field');
    const typeIdx = header.indexOf('type');
    const requiredIdx = header.indexOf('required');
    if (fieldIdx === -1 || typeIdx === -1 || requiredIdx === -1) continue;

    const separator = lines[i + 1]?.trim();
    if (!separator?.startsWith('|') || !isSeparator(parseRow(separator))) continue;

    const notesIdx = header.indexOf('notes');
    const formatIdx = header.indexOf('format');
    const rows: FieldRow[] = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      const rowLine = lines[j].trim();
      if (!rowLine || !rowLine.startsWith('|')) break;
      const cells = parseRow(rowLine);
      if (isSeparator(cells) || cells.length < 2 || !cells.some(Boolean)) continue;
      rows.push({
        field: cells[fieldIdx] ?? '',
        type: cells[typeIdx] ?? '',
        required: cells[requiredIdx] ?? '',
        notes: notesIdx === -1 ? '' : (cells[notesIdx] ?? ''),
        format: formatIdx === -1 ? '' : (cells[formatIdx] ?? ''),
      });
    }
    return { rows, found: true };
  }
  return { rows: [], found: false };
}

function compileType(typeValue: string, schemaNames: Set<string>, resolvableNames: Set<string>, context: string): JsonSchema {
  const type = typeValue.trim();
  if (!type) throw new Error(`${context}: empty type`);

  if (type.endsWith('[]')) {
    const inner = type.slice(0, -2).trim();
    if (!inner || inner.endsWith('[]')) throw new Error(`${context}: unsupported array type "${type}"`);
    return { type: 'array', items: compileType(inner, schemaNames, resolvableNames, context) };
  }

  if (PRIMITIVE_TYPES.has(type)) return { type };

  const enumMatch = type.match(/^enum\((.*)\)$/);
  if (enumMatch) {
    const values = (enumMatch[1] ?? '').split(',').map(v => v.trim()).filter(Boolean);
    if (values.length === 0) throw new Error(`${context}: enum must list at least one value`);
    return { type: 'string', enum: values };
  }

  if (SCHEMA_NAME_RE.test(type) && schemaNames.has(type)) {
    if (!resolvableNames.has(type)) {
      throw new Error(`${context}: referenced schema "${type}" has no field table or json-schema block`);
    }
    return { $ref: `#/components/schemas/${type}` };
  }

  throw new Error(`${context}: unknown type "${type}"`);
}

function compileFieldTable(section: SchemaSection, rows: FieldRow[], schemaNames: Set<string>, resolvableNames: Set<string>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const row of rows) {
    const field = row.field.trim();
    if (!field) throw new Error(`Schema ${section.name}: field name is required`);
    const schema = compileType(row.type, schemaNames, resolvableNames, `Schema ${section.name}, field ${field}`);
    if (row.notes.trim()) schema.description = row.notes.trim();
    if (row.format.trim()) schema.format = row.format.trim();
    properties[field] = schema;
    if (row.required.trim().toLowerCase() === 'yes') required.push(field);
  }

  const compiled: JsonSchema = { type: 'object', properties };
  if (required.length > 0) compiled.required = required;
  return compiled;
}

export function parseContractSchemas(body: string): SchemaParseResult {
  const { sections, errors } = parseSchemaSections(body);
  if (sections.length === 0) return { schemas: {}, errors };

  const schemaNames = new Set(sections.map(s => s.name));
  const metadata = new Map<string, { section: SchemaSection; rawBlocks: JsonSchema[]; fieldRows: FieldRow[]; hasFieldTable: boolean }>();
  const resolvableNames = new Set<string>();

  for (const section of sections) {
    const raw = parseJsonSchemaBlocks(section);
    errors.push(...raw.errors);
    if (raw.blocks.length > 1) errors.push(`Schema ${section.name}: expected at most one json-schema block`);

    const fields = parseFieldTable(section);
    if (raw.blocks.length > 0 && fields.found) {
      errors.push(`Schema ${section.name}: choose either a field table or a json-schema block, not both`);
    }
    // Fail fast on a non-`json-schema` fenced block (```json, ```yaml, …) — the
    // common mis-tagged-Tier-B mistake. This fires regardless of whether a field
    // table is also present: a table plus a stray ```json would otherwise compile
    // the table and SILENTLY ignore the fenced JSON.
    //
    // A section with NEITHER a table nor any fence is a valid Tier C prose
    // contract (ADR 0002: "a field table (Tier A), a single json-schema block
    // (Tier B), or neither (Tier C)"). It must NOT fail — it stays unresolved and
    // the endpoint cell keeps its existing x-cdd markers (the no-migration
    // guarantee), exactly as if no section had been written.
    const foreign = findForeignFenceTag(section);
    if (foreign !== null) {
      const desc = foreign ? `a \`\`\`${foreign} code block` : 'an untagged code block';
      errors.push(
        `Schema ${section.name}: found ${desc}, but a machine-typed schema body must use a \`\`\`json-schema fence. ` +
          `Change the fence to \`\`\`json-schema, use a "| field | type | required | ... |" table, or remove the fence to keep it a free-form (Tier C) prose contract.`,
      );
    }
    if (raw.blocks.length === 1 || fields.found) resolvableNames.add(section.name);
    metadata.set(section.name, {
      section,
      rawBlocks: raw.blocks,
      fieldRows: fields.rows,
      hasFieldTable: fields.found,
    });
  }

  const schemas: Record<string, JsonSchema> = {};
  for (const [name, item] of metadata) {
    if (item.rawBlocks.length === 1 && !item.hasFieldTable) {
      schemas[name] = item.rawBlocks[0];
      continue;
    }
    if (!item.hasFieldTable) continue;
    try {
      schemas[name] = compileFieldTable(item.section, item.fieldRows, schemaNames, resolvableNames);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { schemas, errors };
}
