import { createHash } from 'crypto';
import { posix } from 'path';
import type { FileEntry, ImportEntry } from '../code-map/types.js';
import type {
  CodeGraphEdge,
  CodeGraphFile,
  CodeGraphIndex,
  CodeGraphNode,
  CodeGraphNodeKind,
  CodeGraphUnresolvedRef,
} from './types.js';
import type { AliasResolver } from './tsconfig-paths.js';

const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.py'] as const;

interface BuildOptions {
  generator: string;
  sourcesDigest: string;
  /**
   * Resolves non-relative imports (tsconfig `paths` aliases like `@/x` and
   * `baseUrl`-rooted bare specifiers) to candidate repo-relative base paths.
   * When absent, every non-relative import is treated as third-party, as before.
   */
  aliasResolver?: AliasResolver;
}

interface SymbolTarget {
  node: CodeGraphNode;
  exported: boolean;
}

function stableId(parts: string[]): string {
  return createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 16);
}

function nodeId(filePath: string, kind: string, name: string, startLine: number): string {
  return `n:${stableId([filePath, kind, name, String(startLine)])}`;
}

function edgeId(source: string, target: string, kind: string, line?: number, name?: string): string {
  return `e:${stableId([source, target, kind, String(line ?? 0), name ?? ''])}`;
}

function fileNode(path: string, totalLines: number): CodeGraphNode {
  return {
    id: nodeId(path, 'file', path, 1),
    kind: 'file',
    name: posix.basename(path),
    qualified_name: path,
    file_path: path,
    start_line: totalLines > 0 ? 1 : 0,
    end_line: totalLines,
  };
}

function symbolNode(
  filePath: string,
  kind: CodeGraphNodeKind,
  name: string,
  lines: [number, number] | [number, number?],
  exported?: boolean,
): CodeGraphNode {
  const start = lines[0] ?? 1;
  const end = lines[1] ?? start;
  return {
    id: nodeId(filePath, kind, name, start),
    kind,
    name,
    qualified_name: `${filePath}::${name}`,
    file_path: filePath,
    start_line: start,
    end_line: end,
    ...(exported !== undefined ? { exported } : {}),
  };
}

function addEdge(edges: CodeGraphEdge[], source: string, target: string, kind: CodeGraphEdge['kind'], line: number | undefined, provenance: CodeGraphEdge['provenance'], metadata?: Record<string, unknown>): void {
  edges.push({
    id: edgeId(source, target, kind, line, metadata?.name as string | undefined),
    source,
    target,
    kind,
    ...(line ? { line } : {}),
    provenance,
    ...(metadata ? { metadata } : {}),
  });
}

function isLocalImport(moduleName: string): boolean {
  return moduleName.startsWith('.');
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

function resolveLocalModule(
  importerPath: string,
  moduleName: string,
  pathSet: Set<string>,
  aliasResolver?: AliasResolver,
): string | undefined {
  if (isLocalImport(moduleName)) {
    const base = moduleName.startsWith('./') || moduleName.startsWith('../')
      ? posix.normalize(posix.join(posix.dirname(importerPath), moduleName))
      : resolvePythonRelativeImport(importerPath, moduleName);

    for (const candidate of resolutionCandidates(base)) {
      if (pathSet.has(candidate)) return candidate;
    }
    return undefined;
  }

  // Non-relative: try tsconfig `paths` aliases and baseUrl-rooted specifiers.
  // Each candidate base is gated by pathSet membership, so a stray guess that
  // points at a non-existent file (e.g. a real npm package) is simply ignored.
  if (aliasResolver) {
    for (const base of aliasResolver(moduleName)) {
      for (const candidate of resolutionCandidates(base)) {
        if (pathSet.has(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

function importedBindings(imp: ImportEntry, resolvedPath: string | undefined): Array<{ local: string; imported: string; resolvedPath?: string }> {
  const out: Array<{ local: string; imported: string; resolvedPath?: string }> = [];
  for (const item of imp.items ?? []) {
    if (item.startsWith('default:')) {
      const local = item.slice('default:'.length);
      out.push({ local, imported: 'default', ...(resolvedPath ? { resolvedPath } : {}) });
    } else if (item.startsWith('*:')) {
      const local = item.slice('*:'.length);
      out.push({ local, imported: '*', ...(resolvedPath ? { resolvedPath } : {}) });
    } else if (/^[A-Za-z_$][\w$]*:[A-Za-z_$][\w$]*$/.test(item)) {
      const [imported, local] = item.split(':');
      out.push({ local, imported, ...(resolvedPath ? { resolvedPath } : {}) });
    } else {
      out.push({ local: item, imported: item, ...(resolvedPath ? { resolvedPath } : {}) });
    }
  }
  return out;
}

function simpleName(name: string): string {
  return name.replace(/^async\s+/, '').split('.').pop() ?? name;
}

function isWithin(node: CodeGraphNode, line: number): boolean {
  return node.start_line <= line && line <= node.end_line;
}

function findCallerNode(nodes: CodeGraphNode[], caller: string, line: number): CodeGraphNode | undefined {
  const exact = nodes.find(n => n.name === caller || n.qualified_name.endsWith(`::${caller}`));
  if (exact) return exact;
  return nodes
    .filter(n => (n.kind === 'function' || n.kind === 'method') && isWithin(n, line))
    .sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line))[0];
}

export function buildCodeGraph(entries: FileEntry[], opts: BuildOptions): CodeGraphIndex {
  const nodes: CodeGraphNode[] = [];
  const edges: CodeGraphEdge[] = [];
  const unresolved: CodeGraphUnresolvedRef[] = [];
  const files: CodeGraphFile[] = [];
  const pathSet = new Set(entries.map(e => e.path));
  const fileNodes = new Map<string, CodeGraphNode>();
  const nodesByFile = new Map<string, CodeGraphNode[]>();
  const symbolsByFile = new Map<string, Map<string, SymbolTarget[]>>();
  const globalSymbols = new Map<string, SymbolTarget[]>();

  const registerSymbol = (filePath: string, node: CodeGraphNode, exported: boolean): void => {
    nodes.push(node);
    const fileMap = symbolsByFile.get(filePath) ?? new Map<string, SymbolTarget[]>();
    const target = { node, exported };
    fileMap.set(node.name, [...(fileMap.get(node.name) ?? []), target]);
    const shortName = simpleName(node.name);
    if (shortName !== node.name) {
      fileMap.set(shortName, [...(fileMap.get(shortName) ?? []), target]);
    }
    symbolsByFile.set(filePath, fileMap);
    globalSymbols.set(node.name, [...(globalSymbols.get(node.name) ?? []), target]);
    if (shortName !== node.name) {
      globalSymbols.set(shortName, [...(globalSymbols.get(shortName) ?? []), target]);
    }
  };

  for (const entry of entries) {
    const file = fileNode(entry.path, entry.total_lines);
    fileNodes.set(entry.path, file);
    nodesByFile.set(entry.path, [file]);
    nodes.push(file);
  }

  for (const entry of entries) {
    const file = fileNodes.get(entry.path)!;
    const localNodes = nodesByFile.get(entry.path)!;

    for (const c of entry.classes) {
      const n = symbolNode(entry.path, 'class', c.name, c.lines, c.exported);
      localNodes.push(n);
      registerSymbol(entry.path, n, c.exported === true);
      addEdge(edges, file.id, n.id, 'contains', c.lines[0], 'codemap');
      for (const m of c.methods ?? []) {
        const methodName = `${c.name}.${m.name}`;
        const mn = symbolNode(entry.path, 'method', methodName, m.lines);
        localNodes.push(mn);
        registerSymbol(entry.path, mn, false);
        addEdge(edges, n.id, mn.id, 'contains', m.lines[0], 'codemap');
      }
    }

    for (const f of entry.functions) {
      const n = symbolNode(entry.path, 'function', f.name, f.lines, f.exported);
      localNodes.push(n);
      registerSymbol(entry.path, n, f.exported === true);
      addEdge(edges, file.id, n.id, 'contains', f.lines[0], 'codemap');
    }

    for (const t of entry.interfaces ?? []) {
      const n = symbolNode(entry.path, 'interface', t.name, t.lines, t.exported);
      localNodes.push(n);
      registerSymbol(entry.path, n, t.exported === true);
      addEdge(edges, file.id, n.id, 'contains', t.lines[0], 'codemap');
    }

    for (const t of entry.types ?? []) {
      const n = symbolNode(entry.path, 'type_alias', t.name, t.lines, t.exported);
      localNodes.push(n);
      registerSymbol(entry.path, n, t.exported === true);
      addEdge(edges, file.id, n.id, 'contains', t.lines[0], 'codemap');
    }

    for (const e of entry.enums ?? []) {
      const n = symbolNode(entry.path, 'enum', e.name, e.lines, e.exported);
      localNodes.push(n);
      registerSymbol(entry.path, n, e.exported === true);
      addEdge(edges, file.id, n.id, 'contains', e.lines[0], 'codemap');
    }

    for (const c of entry.constants) {
      const n = symbolNode(entry.path, 'constant', c.name, [c.line, c.line], true);
      localNodes.push(n);
      registerSymbol(entry.path, n, true);
      addEdge(edges, file.id, n.id, 'contains', c.line, 'codemap');
    }
  }

  const importBindingsByFile = new Map<string, Map<string, SymbolTarget[]>>();

  for (const entry of entries) {
    const file = fileNodes.get(entry.path)!;
    const bindings = new Map<string, SymbolTarget[]>();
    importBindingsByFile.set(entry.path, bindings);

    for (const imp of entry.imports) {
      const resolved = resolveLocalModule(entry.path, imp.module, pathSet, opts.aliasResolver);
      if (resolved) {
        addEdge(edges, file.id, fileNodes.get(resolved)!.id, 'imports', imp.line, 'ast', { module: imp.module });
      }

      for (const binding of importedBindings(imp, resolved)) {
        if (!binding.resolvedPath) continue;
        const fileSymbols = symbolsByFile.get(binding.resolvedPath);
        const candidates = binding.imported === '*'
          ? Array.from(fileSymbols?.values() ?? []).flat()
          : fileSymbols?.get(binding.imported) ?? [];
        const exported = candidates.filter(c => c.exported || candidates.length === 1);
        if (exported.length > 0) {
          bindings.set(binding.local, [...(bindings.get(binding.local) ?? []), ...exported]);
        }
      }
    }
  }

  for (const entry of entries) {
    const localNodes = nodesByFile.get(entry.path) ?? [];
    const localSymbols = symbolsByFile.get(entry.path) ?? new Map();
    const importBindings = importBindingsByFile.get(entry.path) ?? new Map();

    for (const c of entry.classes) {
      const source = localSymbols.get(c.name)?.[0]?.node;
      if (!source) continue;
      for (const base of c.extends ?? []) {
        const target = resolveSymbol(base, entry.path, localSymbols, importBindings, globalSymbols);
        if (target) addEdge(edges, source.id, target.node.id, 'extends', c.lines[0], 'ast', { name: base });
        else unresolved.push({ from: source.id, kind: 'extends', name: base, line: c.lines[0], file_path: entry.path });
      }
      for (const iface of c.implements ?? []) {
        const target = resolveSymbol(iface, entry.path, localSymbols, importBindings, globalSymbols);
        if (target) addEdge(edges, source.id, target.node.id, 'implements', c.lines[0], 'ast', { name: iface });
        else unresolved.push({ from: source.id, kind: 'implements', name: iface, line: c.lines[0], file_path: entry.path });
      }
    }

    for (const call of entry.calls ?? []) {
      const caller = findCallerNode(localNodes, call.caller, call.line);
      if (!caller) continue;
      const target = resolveSymbol(call.callee, entry.path, localSymbols, importBindings, globalSymbols);
      if (target) {
        addEdge(edges, caller.id, target.node.id, 'calls', call.line, 'ast', { name: call.callee });
      } else {
        unresolved.push({ from: caller.id, kind: 'calls', name: call.callee, line: call.line, file_path: entry.path });
      }
    }
  }

  const uniqueNodes = dedupeBy(nodes, n => n.id);
  const uniqueEdges = dedupeBy(edges, e => e.id);
  for (const entry of entries) {
    files.push({
      path: entry.path,
      total_lines: entry.total_lines,
      node_count: uniqueNodes.filter(n => n.file_path === entry.path).length,
    });
  }

  return {
    schema_version: '1.0',
    generator: opts.generator,
    sources_digest: opts.sourcesDigest,
    files,
    nodes: uniqueNodes.sort((a, b) => a.file_path.localeCompare(b.file_path) || a.start_line - b.start_line || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    edges: uniqueEdges.sort((a, b) => a.source.localeCompare(b.source) || a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target)),
    unresolved: unresolved.sort((a, b) => a.file_path.localeCompare(b.file_path) || a.line - b.line || a.name.localeCompare(b.name)),
  };
}

function resolveSymbol(
  rawName: string,
  filePath: string,
  localSymbols: Map<string, SymbolTarget[]>,
  importBindings: Map<string, SymbolTarget[]>,
  globalSymbols: Map<string, SymbolTarget[]>,
): SymbolTarget | undefined {
  const candidates = symbolLookupNames(rawName);
  for (const name of candidates) {
    const imported = importBindings.get(name);
    if (imported?.length === 1) return imported[0];
  }
  for (const name of candidates) {
    const local = localSymbols.get(name);
    if (local?.length === 1) return local[0];
  }
  for (const name of candidates) {
    const global = (globalSymbols.get(name) ?? []).filter(t => t.node.file_path !== filePath || t.exported);
    if (global.length === 1) return global[0];
  }
  return undefined;
}

function symbolLookupNames(name: string): string[] {
  const cleaned = name.replace(/^this\./, '').replace(/^self\./, '');
  const parts = cleaned.split('.').filter(Boolean);
  return [...new Set([cleaned, parts[parts.length - 1] ?? cleaned])];
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
