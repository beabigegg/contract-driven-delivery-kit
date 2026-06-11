import { existsSync } from 'fs';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import type { FileEntry } from '../code-map/types.js';
import { findTarget } from './index-impact.js';
import { runContractQuery, type ContractQueryOptions } from './contract-query.js';
import { DEFAULT_CONTRACT_PATH, DEFAULT_INVENTORY_PATH } from '../contracts/parser.js';

/**
 * `cdd-kit contract locate <symbol>` — given a code symbol or file, return the
 * API-contract slices that relate to it, so an agent skips the
 * graph-query → read-file → guess-schema-name → contract-query round-trip.
 *
 * The bridge from code to contract is NAME OVERLAP (a `CreateOrder` interface ↔
 * a `CreateOrder` schema), the same honest, bounded heuristic the rest of the
 * kit uses — never inference. The symbol is resolved in the code-map (best
 * effort) to harvest the file's type/class/function names as additional contract
 * search terms; the raw symbol is always one of the terms, so it still works
 * with no code-map (the symbol may itself be a schema name).
 */

export interface ContractLocateOptions {
  contract: string;
  inventory: string;
  map: string;
  limit: number;
  json: boolean;
  refresh: boolean;
}

interface LocatedEndpoint {
  source: string;
  method: string;
  path: string;
  cells: Record<string, string>;
  matched_via: string[];
}

interface LocatedSchema {
  name: string;
  defined: boolean;
  content: string;
  referenced_by: Array<{ method: string; path: string }>;
  matched_via: string[];
}

interface ContractLocatePayload {
  contract: string;
  symbol: string;
  resolved_file: string | null;
  candidates: string[];
  endpoints: LocatedEndpoint[];
  schemas: LocatedSchema[];
}

const MAX_CANDIDATES = 12;

/** Type/class/function names declared in a file — the likely contract-schema names. */
function candidatesFromEntry(entry: FileEntry): string[] {
  const names: string[] = [];
  for (const c of entry.classes) names.push(c.name);
  for (const t of entry.interfaces ?? []) names.push(t.name);
  for (const t of entry.types ?? []) names.push(t.name);
  for (const e of entry.enums ?? []) names.push(e.name);
  for (const f of entry.functions) names.push(f.name);
  return names;
}

export async function contractLocate(symbol: string, opts: ContractLocateOptions): Promise<number> {
  const mapPath = opts.map || '.cdd/code-map.yml';
  const raw = symbol.trim();

  // Always search for the literal symbol; enrich with the resolved file's
  // declared names when a code-map is present (best effort — never required).
  const candidateSet = new Set<string>();
  if (raw) candidateSet.add(raw);
  let resolvedFile: string | null = null;

  try {
    await ensureCodeMapFresh(mapPath, opts.refresh);
    if (existsSync(mapPath)) {
      const entries = loadCodeMapEntries(mapPath);
      const targetResult = findTarget(entries, symbol);
      if ('entry' in targetResult) {
        resolvedFile = targetResult.entry.path;
        for (const n of candidatesFromEntry(targetResult.entry)) candidateSet.add(n);
      }
    }
  } catch {
    // Code-map is optional for locate; fall back to the literal symbol term.
  }

  const candidates = [...candidateSet].slice(0, MAX_CANDIDATES);

  const endpointMap = new Map<string, LocatedEndpoint>();
  const schemaMap = new Map<string, LocatedSchema>();

  for (const cand of candidates) {
    const { payload, error } = runContractQuery(cand, {
      contract: opts.contract,
      inventory: opts.inventory,
      limit: opts.limit,
      json: false,
    } as ContractQueryOptions);
    if (error) {
      // A missing contract file is fatal and identical for every candidate —
      // surface it once. A "no selector" error cannot happen (we always pass a term).
      if (/not found/i.test(error)) return printFailure(error, opts.json);
      continue;
    }
    if (!payload) continue;

    for (const ep of payload.endpoints) {
      const key = `${ep.method} ${ep.path}`;
      const existing = endpointMap.get(key);
      if (existing) {
        if (!existing.matched_via.includes(cand)) existing.matched_via.push(cand);
      } else {
        endpointMap.set(key, { source: ep.source, method: ep.method, path: ep.path, cells: ep.cells, matched_via: [cand] });
      }
    }
    for (const s of payload.schemas) {
      // Skip a schema that neither exists nor is referenced — it is not a real hit.
      if (!s.defined && s.referenced_by.length === 0) continue;
      const existing = schemaMap.get(s.name);
      if (existing) {
        if (!existing.matched_via.includes(cand)) existing.matched_via.push(cand);
      } else {
        schemaMap.set(s.name, { name: s.name, defined: s.defined, content: s.content, referenced_by: s.referenced_by, matched_via: [cand] });
      }
    }
  }

  const endpoints = [...endpointMap.values()]
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .slice(0, opts.limit);
  const schemas = [...schemaMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, opts.limit);

  const payload: ContractLocatePayload = {
    contract: opts.contract || DEFAULT_CONTRACT_PATH,
    symbol: raw,
    resolved_file: resolvedFile,
    candidates,
    endpoints,
    schemas,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printText(payload);
  }
  // A valid query with no related contract slice is a legitimate (empty) answer,
  // not an error — return 0 so MCP clients don't see it as a tool failure.
  return 0;
}

function printText(payload: ContractLocatePayload): void {
  console.log(`contract: ${payload.contract}`);
  console.log(`symbol: ${payload.symbol}${payload.resolved_file ? ` (resolved to ${payload.resolved_file})` : ' (not in code-map; literal term)'}`);
  console.log(`candidates: ${payload.candidates.join(', ')}`);

  if (payload.endpoints.length > 0) {
    console.log(`endpoints: ${payload.endpoints.length}`);
    for (const ep of payload.endpoints) {
      console.log(`- ${ep.method.toUpperCase()} ${ep.path} (${ep.source}) [via ${ep.matched_via.join(', ')}]`);
    }
  }
  if (payload.schemas.length > 0) {
    console.log(`schemas: ${payload.schemas.length}`);
    for (const s of payload.schemas) {
      const status = s.defined ? 'defined' : 'referenced but NOT defined';
      console.log(`- ${s.name}: ${status} [via ${s.matched_via.join(', ')}]`);
      if (s.referenced_by.length > 0) {
        console.log(`    referenced by: ${s.referenced_by.map(r => `${r.method.toUpperCase()} ${r.path}`).join(', ')}`);
      }
    }
  }
  if (payload.endpoints.length === 0 && payload.schemas.length === 0) {
    console.log('no contract entries relate to this symbol (by name). Try `cdd-kit contract query <term>` with a different key.');
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
