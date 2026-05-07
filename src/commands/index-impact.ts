import { existsSync } from 'fs';
import { posix } from 'path';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import type { FileEntry, ImportEntry } from '../code-map/types.js';

const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.py'] as const;

export interface IndexImpactOptions {
  map: string;
  limit: number;
  json: boolean;
  refresh: boolean;
}

interface ResolvedImport {
  module: string;
  items: string[];
  line: number;
  resolved?: string;
}

interface Dependent {
  path: string;
  total_lines: number;
  imports: ResolvedImport[];
}

interface SymbolSummary {
  kind: string;
  name: string;
  lines?: string;
  line?: number;
}

interface ImpactPayload {
  index: string;
  query: string;
  target: {
    path: string;
    total_lines: number;
    symbols: SymbolSummary[];
  };
  refreshed: boolean;
  imports: ResolvedImport[];
  dependents: Dependent[];
  unresolved_local_imports: ResolvedImport[];
}

export async function indexImpact(term: string, opts: IndexImpactOptions): Promise<number> {
  const mapPath = opts.map || '.cdd/code-map.yml';
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : 20;

  const freshness = await ensureCodeMapFresh(mapPath, opts.refresh);
  if (freshness.error) {
    return printFailure(freshness.error, opts.json);
  }

  if (!existsSync(mapPath)) {
    return printFailure(`${mapPath} is missing; run \`cdd-kit code-map\` first.`, opts.json);
  }

  let entries: FileEntry[];
  try {
    entries = loadCodeMapEntries(mapPath);
  } catch (err) {
    return printFailure(`${mapPath} is not readable YAML: ${(err as Error).message}`, opts.json);
  }

  const targetResult = findTarget(entries, term);
  if ('error' in targetResult) {
    return printFailure(targetResult.error, opts.json);
  }

  const pathSet = new Set(entries.map(e => e.path));
  const target = targetResult.entry;
  const targetImports = target.imports.map(imp => resolveImport(target.path, imp, pathSet));
  const imports = targetImports.filter(imp => imp.resolved);
  const unresolvedLocalImports = targetImports.filter(imp => !imp.resolved && isLocalImport(imp.module));
  const dependents = entries
    .filter(entry => entry.path !== target.path)
    .map(entry => ({
      entry,
      imports: entry.imports
        .map(imp => resolveImport(entry.path, imp, pathSet))
        .filter(imp => imp.resolved === target.path),
    }))
    .filter(hit => hit.imports.length > 0)
    .sort((a, b) => a.entry.path.localeCompare(b.entry.path))
    .slice(0, limit)
    .map(hit => ({
      path: hit.entry.path,
      total_lines: hit.entry.total_lines,
      imports: hit.imports,
    }));

  const payload: ImpactPayload = {
    index: mapPath,
    query: term,
    target: {
      path: target.path,
      total_lines: target.total_lines,
      symbols: summarizeSymbols(target).slice(0, 20),
    },
    refreshed: freshness.refreshed,
    imports,
    dependents,
    unresolved_local_imports: unresolvedLocalImports,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printText(payload, limit);
  }

  return 0;
}

function findTarget(entries: FileEntry[], term: string): { entry: FileEntry } | { error: string } {
  const query = normalizeQueryPath(term);
  const exact = entries.find(entry => entry.path === query);
  if (exact) return { entry: exact };

  const pathMatches = entries.filter(entry =>
    entry.path.toLowerCase().includes(query.toLowerCase()) ||
    posix.basename(entry.path).toLowerCase() === query.toLowerCase()
  );
  if (pathMatches.length === 1) return { entry: pathMatches[0] };
  if (pathMatches.length > 1) {
    return { error: ambiguousTarget(term, pathMatches.map(entry => entry.path)) };
  }

  const symbolMatches = entries.filter(entry =>
    summarizeSymbols(entry).some(symbol => symbol.name.toLowerCase() === term.toLowerCase())
  );
  if (symbolMatches.length === 1) return { entry: symbolMatches[0] };
  if (symbolMatches.length > 1) {
    return { error: ambiguousTarget(term, symbolMatches.map(entry => entry.path)) };
  }

  const fuzzySymbolMatches = entries.filter(entry =>
    summarizeSymbols(entry).some(symbol => symbol.name.toLowerCase().includes(term.toLowerCase()))
  );
  if (fuzzySymbolMatches.length === 1) return { entry: fuzzySymbolMatches[0] };
  if (fuzzySymbolMatches.length > 1) {
    return { error: ambiguousTarget(term, fuzzySymbolMatches.map(entry => entry.path)) };
  }

  return { error: `No code-map path or unique symbol matched "${term}". Try \`cdd-kit index query "${term}"\` first.` };
}

function ambiguousTarget(term: string, paths: string[]): string {
  const shown = paths.slice(0, 10).map(path => `- ${path}`).join('\n');
  const more = paths.length > 10 ? `\n...and ${paths.length - 10} more` : '';
  return `Multiple code-map targets matched "${term}". Use a more specific path.\n${shown}${more}`;
}

function normalizeQueryPath(term: string): string {
  return term.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function resolveImport(importerPath: string, imp: ImportEntry, pathSet: Set<string>): ResolvedImport {
  const resolved = resolveLocalModule(importerPath, imp.module, pathSet);
  return {
    module: imp.module,
    items: Array.isArray(imp.items) ? imp.items : [],
    line: imp.line,
    ...(resolved ? { resolved } : {}),
  };
}

function resolveLocalModule(importerPath: string, moduleName: string, pathSet: Set<string>): string | undefined {
  if (!isLocalImport(moduleName)) return undefined;

  const base = moduleName.startsWith('./') || moduleName.startsWith('../')
    ? posix.normalize(posix.join(posix.dirname(importerPath), moduleName))
    : resolvePythonRelativeImport(importerPath, moduleName);

  for (const candidate of resolutionCandidates(base)) {
    if (pathSet.has(candidate)) return candidate;
  }
  return undefined;
}

function resolvePythonRelativeImport(importerPath: string, moduleName: string): string {
  const match = moduleName.match(/^(\.+)(.*)$/);
  if (!match) return moduleName;
  const upLevels = Math.max(0, match[1].length - 1);
  let baseDir = posix.dirname(importerPath);
  for (let i = 0; i < upLevels; i++) {
    baseDir = posix.dirname(baseDir);
  }
  const rest = match[2].replace(/^\./, '').replace(/\./g, '/');
  return rest ? posix.normalize(posix.join(baseDir, rest)) : baseDir;
}

function resolutionCandidates(base: string): string[] {
  const ext = posix.extname(base);
  const candidates: string[] = [];
  if (ext) {
    candidates.push(base);
    const withoutExt = base.slice(0, -ext.length);
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      candidates.push(`${withoutExt}.ts`, `${withoutExt}.tsx`, `${withoutExt}.vue`);
    }
  } else {
    for (const candidateExt of RESOLUTION_EXTENSIONS) {
      candidates.push(`${base}${candidateExt}`);
    }
  }

  for (const candidateExt of RESOLUTION_EXTENSIONS) {
    candidates.push(posix.join(base, `index${candidateExt}`));
  }
  candidates.push(posix.join(base, '__init__.py'));
  return [...new Set(candidates)];
}

function isLocalImport(moduleName: string): boolean {
  return moduleName.startsWith('.');
}

function summarizeSymbols(entry: FileEntry): SymbolSummary[] {
  const symbols: SymbolSummary[] = [];
  for (const c of entry.classes) {
    symbols.push({ kind: 'class', name: c.name, lines: rangeToString(c.lines) });
    const methods = Array.isArray(c.methods) ? c.methods : [];
    for (const m of methods) {
      symbols.push({ kind: 'method', name: `${c.name}.${m.name}`, lines: rangeToString(m.lines) });
    }
  }
  for (const f of entry.functions) {
    symbols.push({ kind: 'function', name: f.name, lines: rangeToString(f.lines) });
  }
  for (const t of entry.interfaces ?? []) {
    symbols.push({ kind: 'interface', name: t.name, lines: rangeToString(t.lines) });
  }
  for (const t of entry.types ?? []) {
    symbols.push({ kind: 'type', name: t.name, lines: rangeToString(t.lines) });
  }
  for (const e of entry.enums ?? []) {
    symbols.push({ kind: 'enum', name: e.name, lines: rangeToString(e.lines) });
  }
  for (const c of entry.constants) {
    symbols.push({ kind: 'constant', name: c.name, line: c.line });
  }
  return symbols.sort((a, b) => firstLine(a) - firstLine(b) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

function rangeToString(lines: [number, number] | string | undefined): string | undefined {
  if (!lines) return undefined;
  if (typeof lines === 'string') return lines;
  return `${lines[0]}-${lines[1]}`;
}

function firstLine(symbol: SymbolSummary): number {
  if (symbol.line) return symbol.line;
  const m = symbol.lines?.match(/^\d+/);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

function printText(payload: ImpactPayload, limit: number): void {
  console.log(`index: ${payload.index}${payload.refreshed ? ' (refreshed)' : ''}`);
  console.log(`target: ${payload.target.path} (${payload.target.total_lines} lines)`);

  if (payload.target.symbols.length > 0) {
    console.log('symbols:');
    for (const symbol of payload.target.symbols) {
      const loc = symbol.lines ? ` lines ${symbol.lines}` : symbol.line ? ` line ${symbol.line}` : '';
      console.log(`- ${symbol.kind}: ${symbol.name}${loc}`);
    }
  }

  console.log('imports:');
  if (payload.imports.length === 0) {
    console.log('- none resolved to indexed local files');
  } else {
    for (const imp of payload.imports) {
      const items = imp.items.length ? ` {${imp.items.join(', ')}}` : '';
      console.log(`- ${imp.module}${items} line ${imp.line} -> ${imp.resolved}`);
    }
  }

  if (payload.unresolved_local_imports.length > 0) {
    console.log('unresolved-local-imports:');
    for (const imp of payload.unresolved_local_imports.slice(0, limit)) {
      console.log(`- ${imp.module} line ${imp.line}`);
    }
  }

  console.log('dependents:');
  if (payload.dependents.length === 0) {
    console.log('- none found in indexed local imports');
  } else {
    for (const dep of payload.dependents) {
      console.log(`- ${dep.path} (${dep.total_lines} lines)`);
      for (const imp of dep.imports) {
        const items = imp.items.length ? ` {${imp.items.join(', ')}}` : '';
        console.log(`  - ${imp.module}${items} line ${imp.line}`);
      }
    }
  }

  console.log('Next: inspect the target symbols plus relevant imports/dependents.');
}

function printFailure(message: string, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  } else {
    console.error(message);
  }
  return 1;
}
