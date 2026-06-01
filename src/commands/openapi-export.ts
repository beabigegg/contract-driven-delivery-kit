import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
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
  responses: Record<string, { description: string }>;
  parameters?: OpenApiParameter[];
  security?: Array<Record<string, string[]>>;
  requestBody?: { description: string; content: Record<string, unknown>; 'x-cdd-unresolved': true };
  'x-cdd-response-contract'?: string;
  'x-cdd-errors'?: string;
}

type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

interface OpenApiDoc {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  paths: OpenApiPaths;
  components?: { securitySchemes: Record<string, unknown> };
  'x-cdd-generated-from': string;
  'x-cdd-note': string;
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

function buildDoc(endpoints: EndpointRow[], frontmatter: Record<string, string>, styleBlock: string): OpenApiDoc {
  const paths: OpenApiPaths = {};
  let anySecurity = false;

  for (const ep of endpoints) {
    const { path, params } = toOpenApiPath(ep.path);
    const successCode = ep.method === 'post' ? '201' : '200';
    const responses: Record<string, { description: string }> = {
      [successCode]: { description: ep.response ? `Contract response: ${ep.response}` : 'Success' },
    };
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

    // Request/response schemas in the contract are free-form prose, not JSON
    // Schema. Emit them as unresolved markers rather than fabricating fields.
    if (ep.request && ep.request !== '-' && ep.method !== 'get') {
      op.requestBody = {
        description: `Contract request: ${ep.request} (schema not machine-resolved; see contract)`,
        content: {},
        'x-cdd-unresolved': true,
      };
    }
    if (ep.response) op['x-cdd-response-contract'] = ep.response;
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
    doc.components = {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    };
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

  if (endpoints.length === 0) {
    log.error(`No endpoint table rows found in ${contractPath}. Add rows to the "| method | path | ... |" table first.`);
    return 1;
  }

  const styleBlock = extractStyleBlock(body);
  const doc = buildDoc(endpoints, frontmatter, styleBlock);

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
    mkdirSync(dirname(join(process.cwd(), opts.out)), { recursive: true });
    writeFileSync(opts.out, serialized, 'utf8');
    log.ok(`OpenAPI ${format.toUpperCase()} written to ${opts.out} (${endpoints.length} endpoint(s))`);
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
