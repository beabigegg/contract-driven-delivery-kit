import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { log } from '../utils/logger.js';

/**
 * `cdd-kit openapi export` — project `contracts/api/api-contract.md` into a
 * minimal OpenAPI 3.1 skeleton. See docs/adr/0001-contract-to-openapi-export.md.
 *
 * The markdown contract stays the single source of truth; this is a one-way
 * projection for tooling (e.g. feeding `openapi-typescript` in a consumer repo).
 * It emits only what the table mechanically determines — path, method, params,
 * auth hint, status codes — and marks free-form request/response schemas as
 * unresolved rather than fabricating field-level schemas it does not have.
 */

export interface OpenApiExportOptions {
  contract?: string;
  out?: string;
  format?: 'json' | 'yaml';
  /**
   * Sync gate: instead of writing, verify the committed artifact at `out` still
   * matches what the contract currently produces. Exits non-zero on drift so CI
   * fails when someone edits the contract but forgets to regenerate the export.
   */
  check?: boolean;
}

const DEFAULT_CONTRACT = 'contracts/api/api-contract.md';
const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

interface EndpointRow {
  method: string;
  path: string;
  auth: string;
  request: string;
  response: string;
  errors: string;
}

interface OpenApiParameter {
  name: string;
  in: 'path';
  required: true;
  schema: { type: 'string' };
}

interface OpenApiOperation {
  summary: string;
  responses: Record<string, OpenApiResponse>;
  parameters?: OpenApiParameter[];
  security?: Array<Record<string, string[]>>;
  requestBody?: {
    description: string;
    content: Record<string, unknown>;
    'x-cdd-unresolved'?: true;
  };
  'x-cdd-response-contract'?: string;
  'x-cdd-errors'?: string;
}

type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

interface OpenApiResponse {
  description: string;
  content?: Record<string, unknown>;
}

interface OpenApiDoc {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  paths: OpenApiPaths;
  components?: { securitySchemes?: Record<string, unknown>; schemas?: Record<string, JsonSchema> };
  'x-cdd-generated-from': string;
  'x-cdd-note': string;
}

type JsonSchema = Record<string, unknown>;

interface SchemaSection {
  name: string;
  content: string;
}

interface SchemaParseResult {
  schemas: Record<string, JsonSchema>;
  errors: string[];
}

function stripFrontmatter(text: string): { body: string; frontmatter: Record<string, string> } {
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

function parseRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.every(c => c === '' || /^:?-+:?$/.test(c));
}

/** Collect data rows from every `| method | ...` table in the document. */
function parseEndpoints(body: string): EndpointRow[] {
  const rows: EndpointRow[] = [];
  let inTable = false;
  let sepSeen = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || !line.startsWith('|')) continue;
    const cells = parseRow(line);
    if (cells[0]?.toLowerCase() === 'method') {
      inTable = true;
      sepSeen = false;
      continue;
    }
    if (!inTable) continue;
    if (!sepSeen && isSeparator(cells)) {
      sepSeen = true;
      continue;
    }
    if (cells.length < 2 || !cells.some(Boolean)) continue;
    const method = (cells[0] ?? '').toLowerCase();
    const path = cells[1] ?? '';
    if (!VALID_METHODS.has(method) || !path.startsWith('/')) continue;
    rows.push({
      method,
      path,
      auth: (cells[2] ?? '').toLowerCase(),
      request: cells[3] ?? '',
      response: cells[4] ?? '',
      errors: cells[5] ?? '',
    });
  }
  return rows;
}

const SCHEMA_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

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
 * A schema section that contains a fenced code block tagged as anything other
 * than `json-schema` is almost always a mistake (most authors and agents reach
 * for ```` ```json ````). Return the offending tag so the error can name the
 * fix; `''` means a fence with no language tag; `null` means no foreign fence.
 */
function findForeignFenceTag(section: SchemaSection): string | null {
  const fenceRe = /```([A-Za-z0-9_-]*)[^\n]*(?:\n|$)[\s\S]*?```/g;
  for (const match of section.content.matchAll(fenceRe)) {
    const tag = (match[1] ?? '').trim();
    if (tag !== 'json-schema') return tag;
  }
  return null;
}

interface FieldRow {
  field: string;
  type: string;
  required: string;
  notes: string;
  format: string;
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

function parseContractSchemas(body: string): SchemaParseResult {
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

function resolveSchemaCell(cell: string, schemas: Record<string, JsonSchema>): JsonSchema | undefined {
  const raw = cell.trim();
  if (!raw || raw === '-') return undefined;
  const isArray = raw.endsWith('[]');
  const name = isArray ? raw.slice(0, -2).trim() : raw;
  if (!SCHEMA_NAME_RE.test(name) || !schemas[name]) return undefined;
  const ref = { $ref: `#/components/schemas/${name}` };
  return isArray ? { type: 'array', items: ref } : ref;
}

/** `/users/:id` and `/users/{id}` -> OpenAPI `/users/{id}` plus its parameters. */
function toOpenApiPath(path: string): { path: string; params: OpenApiParameter[] } {
  const params: OpenApiParameter[] = [];
  const seen = new Set<string>();
  const addParam = (name: string) => {
    if (name && !seen.has(name)) {
      seen.add(name);
      params.push({ name, in: 'path', required: true, schema: { type: 'string' } });
    }
  };
  let oapi = path
    // :id  ->  {id}
    .replace(/:([A-Za-z_][\w]*)/g, (_m, n: string) => {
      addParam(n);
      return `{${n}}`;
    })
    // already-{id}  ->  record the name
    .replace(/\{([^}/]+)\}/g, (_m, n: string) => {
      addParam(n.trim());
      return `{${n.trim()}}`;
    });
  oapi = oapi.split('?', 1)[0];
  return { path: oapi, params };
}

function authToSecurity(auth: string): { security?: Array<Record<string, string[]>>; scheme?: string } {
  switch (auth) {
    case 'required':
    case 'admin':
      return { security: [{ bearerAuth: [] }], scheme: 'bearerAuth' };
    case 'optional':
      return { security: [{ bearerAuth: [] }, {}], scheme: 'bearerAuth' };
    case 'none':
    case 'public':
    case '':
      return {};
    default:
      return { security: [{ bearerAuth: [] }], scheme: 'bearerAuth' };
  }
}

function statusFromErrors(errors: string): string[] {
  // Pull explicit 3-digit codes if the contract lists them; otherwise leave the
  // success code only and mark errors as a free-form note on the operation.
  const codes = (errors.match(/\b[1-5]\d\d\b/g) ?? []).filter((v, i, a) => a.indexOf(v) === i);
  return codes;
}

function buildDoc(
  endpoints: EndpointRow[],
  frontmatter: Record<string, string>,
  styleBlock: string,
  schemas: Record<string, JsonSchema>,
): OpenApiDoc {
  const paths: OpenApiPaths = {};
  let anySecurity = false;

  for (const ep of endpoints) {
    const { path, params } = toOpenApiPath(ep.path);
    const successCode = ep.method === 'post' ? '201' : '200';
    const responseSchema = resolveSchemaCell(ep.response, schemas);
    const responses: Record<string, OpenApiResponse> = {
      [successCode]: { description: ep.response ? `Contract response: ${ep.response}` : 'Success' },
    };
    if (responseSchema) {
      responses[successCode].content = {
        'application/json': { schema: responseSchema },
      };
    }
    for (const code of statusFromErrors(ep.errors)) {
      if (!responses[code]) responses[code] = { description: 'Error response (see contract error format)' };
    }

    const op: OpenApiOperation = {
      summary: `${ep.method.toUpperCase()} ${ep.path}`,
      responses,
    };
    if (params.length > 0) op.parameters = params;

    const { security, scheme } = authToSecurity(ep.auth);
    if (security) {
      op.security = security;
      if (scheme) anySecurity = true;
    }

    if (ep.request && ep.request !== '-' && ep.method !== 'get') {
      const requestSchema = resolveSchemaCell(ep.request, schemas);
      if (requestSchema) {
        op.requestBody = {
          description: `Contract request: ${ep.request}`,
          content: {
            'application/json': { schema: requestSchema },
          },
        };
      } else {
        op.requestBody = {
          description: `Contract request: ${ep.request} (schema not machine-resolved; see contract)`,
          content: {},
          'x-cdd-unresolved': true,
        };
      }
    }
    if (ep.response && !responseSchema) op['x-cdd-response-contract'] = ep.response;
    if (ep.errors) op['x-cdd-errors'] = ep.errors;

    paths[path] = paths[path] ?? {};
    paths[path][ep.method] = op;
  }

  const doc: OpenApiDoc = {
    openapi: '3.1.0',
    info: {
      title: frontmatter.summary || frontmatter.surface || 'API',
      version: frontmatter['schema-version'] || '0.0.0',
    },
    paths,
    'x-cdd-generated-from': DEFAULT_CONTRACT,
    'x-cdd-note':
      'Generated by `cdd-kit openapi export` from the markdown API contract (the source of truth). ' +
      'Partial by design: request/response bodies are free-form prose in the contract and are marked unresolved. ' +
      'Do not hand-edit; regenerate from the contract.',
  };

  const styleText = styleBlock.trim();
  if (styleText) doc.info.description = styleText;

  if (anySecurity) {
    doc.components = doc.components ?? {};
    doc.components.securitySchemes = {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    };
  }

  if (Object.keys(schemas).length > 0) {
    doc.components = doc.components ?? {};
    doc.components.schemas = schemas;
  }

  return doc;
}

/** Extract the `## API Style` bullet block, if present, for info.description. */
function extractStyleBlock(body: string): string {
  const m = body.match(/^##\s+API Style\s*\n([\s\S]*?)(?:\n##\s|\n#\s|$)/m);
  if (!m) return '';
  return m[1]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('-'))
    .join('\n');
}

/** True for a non-empty object/array — these must break onto indented lines. */
function isNonEmptyComposite(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
}

/** Render a YAML scalar (string/number/boolean/null), quoting strings when needed. */
function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value);
  // Quote anything that could be misread by a YAML parser.
  if (s === '' || /[:#?{}\[\],&*!|>'"%@`]/.test(s) || /^[\s-]/.test(s) || /\s$/.test(s) || /^\d/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/**
 * Minimal, dependency-free YAML emitter for the OpenAPI doc shape. Non-empty
 * objects/arrays always break to their own indented block; empty ones and
 * scalars stay inline after the key. (js-yaml is an external dep we keep out of
 * the runtime path for this small, fixed shape.)
 */
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);

  if (!isNonEmptyComposite(value)) {
    // empty object / empty array / scalar
    if (Array.isArray(value)) return '[]';
    if (typeof value === 'object' && value !== null) return '{}';
    return yamlScalar(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (isNonEmptyComposite(item)) {
          return `${pad}-\n${toYaml(item, indent + 1)}`;
        }
        return `${pad}- ${toYaml(item, indent)}`;
      })
      .join('\n');
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => {
      const key = /[:#\s]/.test(k) ? JSON.stringify(k) : k;
      if (isNonEmptyComposite(v)) {
        return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${key}: ${toYaml(v, indent)}`;
    })
    .join('\n');
}

export async function openapiExport(opts: OpenApiExportOptions = {}): Promise<number> {
  const contractPath = opts.contract || DEFAULT_CONTRACT;
  const format = opts.format || 'json';

  if (!existsSync(contractPath)) {
    log.error(`API contract not found: ${contractPath}`);
    return 1;
  }

  const raw = readFileSync(contractPath, 'utf8');
  const { body, frontmatter } = stripFrontmatter(raw);
  const endpoints = parseEndpoints(body);
  const contractSchemas = parseContractSchemas(body);
  if (contractSchemas.errors.length > 0) {
    for (const err of contractSchemas.errors) log.error(err);
    return 1;
  }

  if (endpoints.length === 0) {
    log.error(`No endpoint table rows found in ${contractPath}. Add rows to the "| method | path | ... |" table first.`);
    return 1;
  }

  const styleBlock = extractStyleBlock(body);
  const doc = buildDoc(endpoints, frontmatter, styleBlock, contractSchemas.schemas);

  const serialized = format === 'yaml' ? `${toYaml(doc)}\n` : `${JSON.stringify(doc, null, 2)}\n`;

  if (opts.check) {
    // Sync gate. Compare the committed artifact against the freshly-generated
    // projection. This is the kit-owned half of the preventive chain: it does
    // not run the consumer's codegen, it only guarantees the OpenAPI artifact
    // the consumer generates from is never silently stale against the contract.
    //
    if (!opts.out) {
      log.error('openapi export --check requires --out <path> (the committed artifact to verify against the contract)');
      return 1;
    }
    // Echo the active --contract back in the fix command so a non-default
    // contract path produces a runnable instruction (not one that reads the
    // default contract instead).
    const contractFlag = contractPath === DEFAULT_CONTRACT ? '' : ` --contract ${contractPath}`;
    const yamlFlag = format === 'yaml' ? ' --yaml' : '';
    const regen = `cdd-kit openapi export${contractFlag} --out ${opts.out}${yamlFlag}`;
    if (!existsSync(opts.out)) {
      log.error(`openapi export --check: ${opts.out} does not exist. Run \`${regen}\` and commit it.`);
      return 1;
    }
    const committed = readFileSync(opts.out, 'utf8');
    if (committed === serialized) {
      log.ok(`OpenAPI artifact ${opts.out} is in sync with ${contractPath} (${endpoints.length} endpoint(s))`);
      return 0;
    }
    log.error(`OpenAPI artifact ${opts.out} is OUT OF SYNC with ${contractPath}. The contract changed but the export was not regenerated.`);
    log.error(`Fix: \`${regen}\` and commit the result.`);
    return 1;
  }

  if (opts.out) {
    // `resolve` correctly preserves absolute paths (Windows `C:\…` or POSIX
    // `/tmp/…`) and resolves relative ones against cwd. `join(cwd, out)` would
    // concatenate an absolute `out` onto cwd (e.g. `D:\proj\C:\Users\…`) and
    // then ENOENT on mkdir.
    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serialized, 'utf8');
    log.ok(`OpenAPI ${format.toUpperCase()} written to ${outPath} (${endpoints.length} endpoint(s))`);
    const unresolved = countUnresolved(doc);
    if (unresolved > 0) {
      log.info(`${unresolved} request body schema(s) left unresolved (free-form prose in the contract). Fill them in the consumer generator or enrich the contract.`);
    }
  } else {
    process.stdout.write(serialized);
  }

  return 0;
}

function countUnresolved(doc: OpenApiDoc): number {
  let n = 0;
  for (const methods of Object.values(doc.paths)) {
    for (const op of Object.values(methods)) {
      if (op.requestBody?.['x-cdd-unresolved']) n += 1;
    }
  }
  return n;
}
