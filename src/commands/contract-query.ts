import { existsSync, readFileSync } from 'fs';
import {
  stripFrontmatter,
  parseEndpointTableRows,
  parseSchemaSections,
  extractSection,
  SCHEMA_NAME_RE,
  DEFAULT_CONTRACT_PATH,
  DEFAULT_INVENTORY_PATH,
  type EndpointTableRow,
} from '../contracts/parser.js';

/**
 * `cdd-kit contract query` — answer a narrow question about the API contract by
 * key, returning only the matching slice instead of the whole file. The
 * contract analog of `index query`: ask, don't read. See
 * docs/adr/0004-queryable-and-writable-contracts.md (§1).
 *
 * Deliberately parse-on-demand: the markdown contracts are small and are
 * themselves the source of truth, so every call re-parses them and there is NO
 * cached `.cdd/contract-index` artifact to fall out of sync (ADR 0004 §1).
 */

const DEFAULT_CONTRACT = DEFAULT_CONTRACT_PATH;
const DEFAULT_INVENTORY = DEFAULT_INVENTORY_PATH;

/** Bounded shared prose sections an endpoint answer surfaces alongside the row. */
const ENDPOINT_PROSE_SECTIONS = ['Error Format', 'Compatibility Policy', 'Breaking Change Policy'];

export interface ContractQueryOptions {
  contract: string;
  inventory: string;
  endpoint?: string;
  path?: string;
  schema?: string;
  auth?: string;
  category?: string;
  owner?: string;
  limit: number;
  json: boolean;
}

interface SourcedRow extends EndpointTableRow {
  /** Which contract file this row came from. */
  source: string;
}

interface EndpointMatch {
  source: string;
  method: string;
  path: string;
  cells: Record<string, string>;
  score?: number;
}

interface SchemaAnswer {
  name: string;
  /** Whether a `### Name` section is actually defined in the contract. */
  defined: boolean;
  /** Raw markdown of the schema's field table / json-schema block. */
  content: string;
  /** Reverse index: endpoints whose request/response cell references this schema. */
  referenced_by: Array<{ method: string; path: string }>;
}

interface ProseSection {
  name: string;
  content: string;
}

interface ContractQueryPayload {
  contract: string;
  inventory: string | null;
  query: string;
  endpoints: EndpointMatch[];
  schemas: SchemaAnswer[];
  prose: ProseSection[];
}

export async function contractQuery(term: string | undefined, opts: ContractQueryOptions): Promise<number> {
  const contractPath = opts.contract || DEFAULT_CONTRACT;
  if (!existsSync(contractPath)) {
    return printFailure(`API contract not found: ${contractPath}`, opts.json);
  }
  const contractBody = stripFrontmatter(readFileSync(contractPath, 'utf8')).body;

  const inventoryPath = opts.inventory || DEFAULT_INVENTORY;
  const hasInventory = existsSync(inventoryPath);
  const inventoryBody = hasInventory ? stripFrontmatter(readFileSync(inventoryPath, 'utf8')).body : '';

  const rows: SourcedRow[] = [
    ...parseEndpointTableRows(contractBody).map(r => ({ ...r, source: 'api-contract' })),
    ...parseEndpointTableRows(inventoryBody).map(r => ({ ...r, source: 'api-inventory' })),
  ];
  const sections = parseSchemaSections(contractBody).sections;
  const schemaNames = new Set(sections.map(s => s.name));
  const contentByName = new Map(sections.map(s => [s.name, s.content.trim()]));

  const trimmedTerm = (term ?? '').trim();
  const hasFilter = !!(opts.auth || opts.category || opts.owner);

  let payload: ContractQueryPayload;
  if (opts.endpoint) {
    payload = answerEndpoint(opts.endpoint, rows, schemaNames, contentByName, contractBody, contractPath, inventoryPath, hasInventory);
  } else if (opts.schema) {
    payload = {
      contract: contractPath,
      inventory: hasInventory ? inventoryPath : null,
      query: `schema ${opts.schema}`,
      endpoints: [],
      schemas: [schemaAnswer(opts.schema, schemaNames, contentByName, rows)],
      prose: [],
    };
  } else if (opts.path || hasFilter || trimmedTerm) {
    payload = answerList(opts, trimmedTerm, rows, sections, schemaNames, contentByName, contractPath, inventoryPath, hasInventory);
  } else {
    return printFailure(
      'contract query needs a selector: --endpoint "METHOD /path", --path <prefix|glob>, --schema <Name>, a column filter (--auth/--category/--owner), or a free-text term.',
      opts.json,
    );
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printText(payload);
  }
  return hasResult(payload) ? 0 : 1;
}

function answerEndpoint(
  endpointArg: string,
  rows: SourcedRow[],
  schemaNames: Set<string>,
  contentByName: Map<string, string>,
  contractBody: string,
  contractPath: string,
  inventoryPath: string,
  hasInventory: boolean,
): ContractQueryPayload {
  const key = parseEndpointKey(endpointArg);
  const matches = key
    ? rows.filter(r => r.method === key.method && r.path === key.path)
    : [];

  const schemas: SchemaAnswer[] = [];
  for (const match of matches) {
    for (const cell of [referenceCell(match, 'request'), referenceCell(match, 'response')]) {
      const base = schemaBaseName(cell);
      if (base && SCHEMA_NAME_RE.test(base) && !schemas.some(s => s.name === base)) {
        schemas.push(schemaAnswer(base, schemaNames, contentByName, rows));
      }
    }
  }

  const prose = matches.length > 0
    ? ENDPOINT_PROSE_SECTIONS
        .map(name => ({ name, content: extractSection(contractBody, name) }))
        .filter(p => p.content)
    : [];

  return {
    contract: contractPath,
    inventory: hasInventory ? inventoryPath : null,
    query: `endpoint ${key ? `${key.method.toUpperCase()} ${key.path}` : endpointArg}`,
    endpoints: matches.map(toMatch),
    schemas,
    prose,
  };
}

function answerList(
  opts: ContractQueryOptions,
  term: string,
  rows: SourcedRow[],
  sections: Array<{ name: string }>,
  schemaNames: Set<string>,
  contentByName: Map<string, string>,
  contractPath: string,
  inventoryPath: string,
  hasInventory: boolean,
): ContractQueryPayload {
  let filtered = rows;
  if (opts.path) filtered = filtered.filter(r => matchPath(r.path, opts.path!));
  if (opts.auth) filtered = filtered.filter(r => columnEquals(r, 'auth', opts.auth!));
  if (opts.category) filtered = filtered.filter(r => columnEquals(r, 'category', opts.category!));
  if (opts.owner) filtered = filtered.filter(r => columnEquals(r, 'owner', opts.owner!));

  let endpoints: EndpointMatch[];
  let schemas: SchemaAnswer[] = [];
  if (term) {
    const q = term.toLowerCase();
    endpoints = filtered
      .map(r => ({ row: r, score: scoreRow(r, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.row.path.localeCompare(b.row.path))
      .slice(0, opts.limit)
      .map(x => ({ ...toMatch(x.row), score: x.score }));
    schemas = sections
      .map(s => ({ name: s.name, score: scoreText(s.name, q, 100) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, opts.limit)
      .map(x => schemaAnswer(x.name, schemaNames, contentByName, rows));
  } else {
    endpoints = filtered
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
      .slice(0, opts.limit)
      .map(toMatch);
  }

  return {
    contract: contractPath,
    inventory: hasInventory ? inventoryPath : null,
    query: describeListQuery(opts, term),
    endpoints,
    schemas,
    prose: [],
  };
}

function schemaAnswer(
  name: string,
  schemaNames: Set<string>,
  contentByName: Map<string, string>,
  rows: SourcedRow[],
): SchemaAnswer {
  return {
    name,
    defined: schemaNames.has(name),
    content: contentByName.get(name) ?? '',
    referenced_by: rows
      .filter(r => schemaBaseName(referenceCell(r, 'request')) === name || schemaBaseName(referenceCell(r, 'response')) === name)
      .map(r => ({ method: r.method, path: r.path })),
  };
}

/** The request/response cell of a row, honouring `request schema` / `request` aliases. */
function referenceCell(row: EndpointTableRow, kind: 'request' | 'response'): string {
  return row.cells[`${kind} schema`] ?? row.cells[kind] ?? '';
}

/** `CreateOrder` or `CreateOrder[]` → `CreateOrder`; `-`/empty → ''. */
function schemaBaseName(cell: string): string {
  const raw = (cell ?? '').trim();
  if (!raw || raw === '-') return '';
  return raw.endsWith('[]') ? raw.slice(0, -2).trim() : raw;
}

function columnEquals(row: EndpointTableRow, column: string, value: string): boolean {
  return (row.cells[column] ?? '').trim().toLowerCase() === value.trim().toLowerCase();
}

/** `/api/*` → glob (`*` matches within a single path segment); otherwise a prefix match. */
function matchPath(path: string, pattern: string): boolean {
  if (!pattern.includes('*')) return path.startsWith(pattern);
  const re = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[^/]*')}$`);
  return re.test(path);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `"POST /api/orders"` → `{ method: 'post', path: '/api/orders' }`; null if unparseable. */
function parseEndpointKey(arg: string): { method: string; path: string } | null {
  const m = arg.trim().match(/^([A-Za-z]+)\s+(\/\S*)$/);
  if (!m) return null;
  return { method: m[1].toLowerCase(), path: m[2] };
}

function toMatch(row: SourcedRow): EndpointMatch {
  return { source: row.source, method: row.method, path: row.path, cells: row.cells };
}

function scoreText(text: string, query: string, weight: number): number {
  const haystack = (text ?? '').toLowerCase();
  if (!haystack) return 0;
  if (haystack === query) return weight + 40;
  if (haystack.startsWith(query)) return weight + 20;
  if (haystack.includes(query)) return weight;
  return 0;
}

function scoreRow(row: SourcedRow, query: string): number {
  let best = Math.max(scoreText(row.path, query, 100), scoreText(row.method, query, 60));
  for (const value of Object.values(row.cells)) best = Math.max(best, scoreText(value, query, 70));
  return best;
}

function describeListQuery(opts: ContractQueryOptions, term: string): string {
  const parts: string[] = [];
  if (opts.path) parts.push(`path ${opts.path}`);
  if (opts.auth) parts.push(`auth=${opts.auth}`);
  if (opts.category) parts.push(`category=${opts.category}`);
  if (opts.owner) parts.push(`owner=${opts.owner}`);
  if (term) parts.push(`term "${term}"`);
  return parts.join(', ') || 'all endpoints';
}

function hasResult(payload: ContractQueryPayload): boolean {
  return payload.endpoints.length > 0 || payload.schemas.some(s => s.defined || s.referenced_by.length > 0);
}

function printText(payload: ContractQueryPayload): void {
  console.log(`contract: ${payload.contract}${payload.inventory ? ` (+ ${payload.inventory})` : ''}`);
  console.log(`query: ${payload.query}`);

  if (payload.endpoints.length > 0) {
    console.log(`endpoints: ${payload.endpoints.length}`);
    for (const ep of payload.endpoints) {
      const score = ep.score !== undefined ? ` [score ${ep.score}]` : '';
      console.log(`- ${ep.method.toUpperCase()} ${ep.path} (${ep.source})${score}`);
      for (const [key, value] of Object.entries(ep.cells)) {
        if (key === 'method' || key === 'path' || !value || value === '-') continue;
        console.log(`    ${key}: ${value}`);
      }
    }
  }

  for (const schema of payload.schemas) {
    const status = schema.defined ? 'defined' : 'referenced but NOT defined';
    console.log(`schema ${schema.name}: ${status}`);
    if (schema.referenced_by.length > 0) {
      console.log(`  referenced by: ${schema.referenced_by.map(r => `${r.method.toUpperCase()} ${r.path}`).join(', ')}`);
    }
    if (schema.content) {
      for (const line of schema.content.split('\n')) console.log(`  | ${line}`);
    }
  }

  for (const section of payload.prose) {
    console.log(`## ${section.name}`);
    for (const line of section.content.split('\n')) console.log(`  | ${line}`);
  }

  if (!hasResult(payload)) {
    console.log('no matches. Try a different key, a path prefix, or a broader term.');
  }
}

function printFailure(message: string, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  } else {
    console.error(message);
  }
  return 1;
}
