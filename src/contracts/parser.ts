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

export const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
export const SCHEMA_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
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

export function parseRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

export function isSeparator(cells: string[]): boolean {
  return cells.every(c => c === '' || /^:?-+:?$/.test(c));
}

/**
 * Map a normalized contract-table header label to an `EndpointRow` field.
 * Header-driven (not positional) so a reordered column — or a different
 * contract surface — can never silently land in the wrong field. Aliases cover
 * the API contract's `request schema` / `response schema` headers and the
 * shorter `request` / `response` forms.
 */
const ENDPOINT_HEADER_ALIASES: Record<string, keyof EndpointRow> = {
  method: 'method',
  path: 'path',
  auth: 'auth',
  request: 'request',
  'request schema': 'request',
  response: 'response',
  'response schema': 'response',
  errors: 'errors',
  tests: 'tests',
};

/** Build a field→column-index map from a detected header row's cells. */
function endpointHeaderMap(headerCells: string[]): Partial<Record<keyof EndpointRow, number>> {
  const map: Partial<Record<keyof EndpointRow, number>> = {};
  headerCells.forEach((cell, i) => {
    const field = ENDPOINT_HEADER_ALIASES[cell.trim().toLowerCase()];
    if (field && map[field] === undefined) map[field] = i;
  });
  return map;
}

/** Collect data rows from every `| method | ... |` table in the document. */
export function parseEndpoints(body: string): EndpointRow[] {
  const rows: EndpointRow[] = [];
  let header: Partial<Record<keyof EndpointRow, number>> | null = null;
  let sepSeen = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || !line.startsWith('|')) continue;
    const cells = parseRow(line);
    if (cells[0]?.toLowerCase() === 'method') {
      header = endpointHeaderMap(cells);
      sepSeen = false;
      continue;
    }
    if (!header) continue;
    if (!sepSeen && isSeparator(cells)) {
      sepSeen = true;
      continue;
    }
    if (cells.length < 2 || !cells.some(Boolean)) continue;
    const at = (field: keyof EndpointRow): string => {
      const idx = header![field];
      return idx === undefined ? '' : (cells[idx] ?? '');
    };
    const method = at('method').toLowerCase();
    const path = at('path');
    if (!VALID_METHODS.has(method) || !path.startsWith('/')) continue;
    rows.push({
      method,
      path,
      auth: at('auth').toLowerCase(),
      request: at('request'),
      response: at('response'),
      errors: at('errors'),
      tests: at('tests'),
    });
  }
  return rows;
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

function parseSchemaSections(body: string): { sections: SchemaSection[]; errors: string[] } {
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

function parseJsonSchemaBlocks(section: SchemaSection): { blocks: JsonSchema[]; errors: string[] } {
  const blocks: JsonSchema[] = [];
  const errors: string[] = [];
  const blockRe = /```json-schema\s*\n([\s\S]*?)```/g;
  for (const match of section.content.matchAll(blockRe)) {
    try {
      const parsed = JSON.parse(match[1] ?? '') as unknown;
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
 * one would otherwise be silently dropped). The whole info string is captured —
 * not just the leading word — so the two stay in lock-step. Returns the
 * offending info string (`''` = a fence with no tag); `null` = no foreign fence.
 */
function findForeignFenceTag(section: SchemaSection): string | null {
  const fenceRe = /```([^\n]*)(?:\n|$)[\s\S]*?```/g;
  for (const match of section.content.matchAll(fenceRe)) {
    const info = (match[1] ?? '').trim();
    if (info !== 'json-schema') return info;
  }
  return null;
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
