import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { checkCodeMapFreshness } from '../code-map/freshness.js';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import type { FileEntry } from '../code-map/types.js';
import { graphPathFor, loadCodeGraph } from '../code-graph/reader.js';
import { graphContext as buildNativeContext, graphImpact as nativeImpact, searchGraph } from '../code-graph/queries.js';
import { indexQuery, queryEntries, resolveSourceBudget, surfaceRootFor } from './index-query.js';
import { indexImpact } from './index-impact.js';

type GraphEngine = 'auto' | 'native' | 'codegraph' | 'codemap';

interface GraphBaseOptions {
  engine?: GraphEngine;
  map?: string;
  json?: boolean;
  refresh?: boolean;
}

export interface GraphStatusOptions extends GraphBaseOptions {
  path?: string;
}

export interface GraphQueryOptions extends GraphBaseOptions {
  limit: number;
  withSource?: boolean;
  sourceBudget?: number;
}

export interface GraphImpactOptions extends GraphBaseOptions {
  limit: number;
  depth: number;
}

export interface GraphContextOptions extends GraphBaseOptions {
  maxNodes: number;
}

export interface GraphSyncOptions extends GraphBaseOptions {
  path?: string;
}

interface CodeGraphProbe {
  available: boolean;
  command: string;
  initialized: boolean;
  reason?: string;
}

interface SelectedEngine {
  engine: 'native' | 'codegraph' | 'codemap';
  probe: CodeGraphProbe;
}

function codeGraphCommand(): string {
  return process.env.CDD_CODEGRAPH_BIN || 'codegraph';
}

function runCodeGraph(args: string[], cwd = process.cwd()): SpawnSyncReturns<Buffer> {
  const command = codeGraphCommand();
  if (command.toLowerCase().endsWith('.js')) {
    return spawnSync(process.execPath, [command, ...args], { cwd, encoding: 'buffer' });
  }
  return spawnSync(command, args, { cwd, encoding: 'buffer' });
}

function probeCodeGraph(cwd = process.cwd()): CodeGraphProbe {
  const command = codeGraphCommand();
  const initialized = existsSync(join(cwd, '.codegraph'));
  const version = runCodeGraph(['--version'], cwd);
  if (version.error) {
    return {
      available: false,
      command,
      initialized,
      reason: version.error.message,
    };
  }
  if (version.status !== 0) {
    return {
      available: false,
      command,
      initialized,
      reason: (version.stderr?.toString('utf8') || version.stdout?.toString('utf8') || `exit ${version.status}`).trim(),
    };
  }
  return { available: true, command, initialized };
}

function selectEngine(opts: GraphBaseOptions, cwd = process.cwd()): SelectedEngine | { error: string; probe: CodeGraphProbe } {
  const requested = opts.engine ?? 'auto';
  const probe = probeCodeGraph(cwd);
  if (!['auto', 'native', 'codegraph', 'codemap'].includes(requested)) {
    return { error: `Invalid graph engine: ${requested}. Use auto, native, codegraph, or codemap.`, probe };
  }

  if (requested === 'codemap') return { engine: 'codemap', probe };
  if (requested === 'native' || requested === 'auto') return { engine: 'native', probe };
  if (requested === 'codegraph') {
    if (!probe.available) {
      return {
        error: `CodeGraph is not available (${probe.command}): ${probe.reason ?? 'command not found'}`,
        probe,
      };
    }
    return { engine: 'codegraph', probe };
  }

  return { engine: 'native', probe };
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function pipeResult(result: SpawnSyncReturns<Buffer>): number {
  if (result.stdout?.length) process.stdout.write(result.stdout);
  if (result.stderr?.length) process.stderr.write(result.stderr);
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function printEngineError(message: string, json?: boolean, probe?: CodeGraphProbe): number {
  if (json) {
    writeJson({ error: message, codegraph: probe });
  } else {
    console.error(message);
  }
  return 1;
}

async function ensureNativeGraph(mapPath: string, refresh: boolean): Promise<{ graphPath: string; refreshed: boolean; error?: string }> {
  const freshness = await ensureCodeMapFresh(mapPath, refresh);
  if (freshness.error) return { graphPath: graphPathFor(mapPath), refreshed: freshness.refreshed, error: freshness.error };

  const graphPath = graphPathFor(mapPath);
  if (!existsSync(graphPath) && refresh) {
    const { codeMap } = await import('./code-map.js');
    const exit = await codeMap({
      path: '.',
      out: mapPath,
      include: [],
      exclude: [],
      check: false,
      maxLines: 100000,
      silent: true,
    });
    if (exit !== 0) {
      return { graphPath, refreshed: freshness.refreshed, error: `could not refresh ${graphPath}; run \`cdd-kit code-map\` for details.` };
    }
    return { graphPath, refreshed: true };
  }

  return { graphPath, refreshed: freshness.refreshed };
}

export async function graphStatus(opts: GraphStatusOptions = {}): Promise<number> {
  const cwd = process.cwd();
  const selected = selectEngine(opts, cwd);
  if ('error' in selected) return printEngineError(selected.error, opts.json, selected.probe);

  if (selected.engine === 'codegraph') {
    const args = ['status'];
    if (opts.path) args.push(opts.path);
    return pipeResult(runCodeGraph(args, cwd));
  }

  const mapPath = opts.map || '.cdd/code-map.yml';
  const graphPath = graphPathFor(mapPath);
  const freshness = checkCodeMapFreshness(cwd, mapPath);
  let graphStats: { graph: string; nodes: number; edges: number; unresolved: number } | undefined;
  if (existsSync(graphPath)) {
    try {
      const graph = loadCodeGraph(graphPath);
      graphStats = { graph: graphPath, nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length };
    } catch {
      graphStats = { graph: graphPath, nodes: 0, edges: 0, unresolved: 0 };
    }
  }
  const payload = {
    engine: selected.engine,
    codegraph: selected.probe,
    code_map: {
      map: mapPath,
      status: freshness.status,
      stale_count: 'staleCount' in freshness ? freshness.staleCount : 0,
      stale_files: 'staleFiles' in freshness ? freshness.staleFiles.slice(0, 10) : [],
      config_error: 'configError' in freshness ? freshness.configError : undefined,
    },
    native_graph: graphStats ?? { graph: graphPath, missing: true },
  };

  if (opts.json) {
    writeJson(payload);
  } else {
    console.log(`graph engine: ${selected.engine === 'native' ? 'native cdd-kit graph' : 'code-map fallback'}`);
    console.log(`code-map: ${payload.code_map.status}`);
    if (graphStats) {
      console.log(`code-graph: ${graphStats.nodes} nodes, ${graphStats.edges} edges, ${graphStats.unresolved} unresolved`);
    } else {
      console.log(`code-graph: missing (${graphPath}); run cdd-kit code-map`);
    }
    if (!selected.probe.available) {
      console.log(`CodeGraph: unavailable (${selected.probe.command})`);
    } else if (!selected.probe.initialized) {
      console.log('CodeGraph: available but project is not initialized (.codegraph/ missing)');
    }
    console.log('Next: run `codegraph init -i` to enable semantic graph queries, or continue with code-map fallback.');
  }
  return freshness.status === 'config-error' ? 1 : 0;
}

export async function graphSync(opts: GraphSyncOptions = {}): Promise<number> {
  const selected = selectEngine({ ...opts, engine: opts.engine ?? 'codegraph' });
  if ('error' in selected) return printEngineError(selected.error, opts.json, selected.probe);
  if (selected.engine !== 'codegraph') {
    return printEngineError('graph sync requires CodeGraph; code-map fallback refreshes during query/impact.', opts.json, selected.probe);
  }
  const args = ['sync'];
  if (opts.path) args.push(opts.path);
  return pipeResult(runCodeGraph(args));
}

export async function graphQuery(term: string, opts: GraphQueryOptions): Promise<number> {
  const selected = selectEngine(opts);
  if ('error' in selected) return printEngineError(selected.error, opts.json, selected.probe);

  if (selected.engine === 'codegraph') {
    const args = ['query', term, '--limit', String(opts.limit)];
    if (opts.json) args.push('--json');
    return pipeResult(runCodeGraph(args));
  }

  if (selected.engine === 'native') {
    const mapPath = opts.map || '.cdd/code-map.yml';
    const ensured = await ensureNativeGraph(mapPath, opts.refresh !== false);
    if (ensured.error) return printEngineError(ensured.error, opts.json, selected.probe);
    try {
      const graph = loadCodeGraph(ensured.graphPath);
      const results = searchGraph(graph, term, opts.limit);
      const sources = opts.withSource
        ? collectNodeSources(results.map(r => r.node), resolveSourceBudget(opts.sourceBudget), surfaceRootFor(mapPath))
        : new Map<string, { source: string; truncated: boolean }>();
      if (opts.json) {
        const withSrc = opts.withSource
          ? results.map(r => ({ ...r, source: sources.get(r.node.id)?.source, source_truncated: sources.get(r.node.id)?.truncated }))
          : results;
        writeJson({ engine: 'native', graph: ensured.graphPath, query: term, refreshed: ensured.refreshed, results: withSrc });
      } else {
        console.log(`graph: ${ensured.graphPath}${ensured.refreshed ? ' (refreshed)' : ''}`);
        console.log(`query: ${term}`);
        console.log(`results: ${results.length}`);
        for (const result of results) {
          const n = result.node;
          console.log(`- ${n.kind}: ${n.qualified_name} lines ${n.start_line}-${n.end_line}`);
          console.log(`  edges: ${result.edges.incoming} incoming, ${result.edges.outgoing} outgoing`);
          const src = sources.get(n.id);
          if (src) {
            for (const srcLine of src.source.split('\n')) console.log(`    | ${srcLine}`);
            if (src.truncated) console.log('    | … (source budget reached; Read the rest directly)');
          }
        }
        console.log(opts.withSource
          ? 'Source included above — no separate Read needed for these ranges.'
          : 'Next: run cdd-kit graph impact <node/file/symbol> before editing.');
      }
      return results.length === 0 ? 1 : 0;
    } catch (err) {
      return printEngineError((err as Error).message, opts.json, selected.probe);
    }
  }

  return indexQuery(term, {
    map: opts.map || '.cdd/code-map.yml',
    limit: opts.limit,
    json: opts.json === true,
    refresh: opts.refresh !== false,
    withSource: opts.withSource === true,
    sourceBudget: resolveSourceBudget(opts.sourceBudget),
  });
}

/**
 * Read the real source slice for each graph node (file_path + line range),
 * one file read per path, honoring a shared line budget. Lets `graph query
 * --with-source` return code directly instead of pointing at a range the
 * caller must then Read.
 */
function collectNodeSources(
  nodes: { id: string; file_path: string; start_line: number; end_line: number }[],
  budget: number,
  baseDir?: string,
): Map<string, { source: string; truncated: boolean }> {
  const out = new Map<string, { source: string; truncated: boolean }>();
  const fileCache = new Map<string, string[] | null>();
  let used = 0;

  const readLines = (path: string): string[] | null => {
    if (fileCache.has(path)) return fileCache.get(path) ?? null;
    let lines: string[] | null = null;
    try {
      const resolved = baseDir && baseDir !== '.' ? `${baseDir.replace(/\/+$/, '')}/${path}` : path;
      lines = existsSync(resolved) ? readFileSync(resolved, 'utf8').split(/\r?\n/) : null;
    } catch {
      lines = null;
    }
    fileCache.set(path, lines);
    return lines;
  };

  for (const node of nodes) {
    const fileLines = readLines(node.file_path);
    if (!fileLines || !node.start_line) continue;
    if (used >= budget) {
      out.set(node.id, { source: '', truncated: true });
      continue;
    }
    const end = node.end_line && node.end_line >= node.start_line ? node.end_line : node.start_line;
    const allowedEnd = Math.min(end, node.start_line + (budget - used) - 1);
    const slice = fileLines.slice(node.start_line - 1, allowedEnd);
    out.set(node.id, { source: slice.join('\n'), truncated: allowedEnd < end });
    used += slice.length;
  }
  return out;
}

export async function graphImpact(term: string, opts: GraphImpactOptions): Promise<number> {
  const selected = selectEngine(opts);
  if ('error' in selected) return printEngineError(selected.error, opts.json, selected.probe);

  if (selected.engine === 'codegraph') {
    const args = ['impact', term, '--depth', String(opts.depth)];
    if (opts.json) args.push('--json');
    return pipeResult(runCodeGraph(args));
  }

  if (selected.engine === 'native') {
    const mapPath = opts.map || '.cdd/code-map.yml';
    const ensured = await ensureNativeGraph(mapPath, opts.refresh !== false);
    if (ensured.error) return printEngineError(ensured.error, opts.json, selected.probe);
    try {
      const graph = loadCodeGraph(ensured.graphPath);
      const impact = nativeImpact(graph, term, opts.depth, opts.limit);
      if (!impact) return printEngineError(`No graph node matched "${term}". Try \`cdd-kit graph query "${term}"\` first.`, opts.json, selected.probe);
      if (opts.json) {
        writeJson({ engine: 'native', graph: ensured.graphPath, query: term, refreshed: ensured.refreshed, ...impact });
      } else {
        console.log(`graph: ${ensured.graphPath}${ensured.refreshed ? ' (refreshed)' : ''}`);
        console.log(`target: ${impact.target.qualified_name} (${impact.target.kind})`);
        console.log(`impact depth: ${impact.depth}`);
        console.log('nodes:');
        for (const node of impact.nodes) {
          console.log(`- ${node.kind}: ${node.qualified_name} lines ${node.start_line}-${node.end_line}`);
        }
        console.log('edges:');
        for (const edge of impact.edges.slice(0, opts.limit)) {
          const source = graph.nodes.find(n => n.id === edge.source)?.qualified_name ?? edge.source;
          const target = graph.nodes.find(n => n.id === edge.target)?.qualified_name ?? edge.target;
          console.log(`- ${edge.kind}: ${source} -> ${target}${edge.line ? ` line ${edge.line}` : ''} (${edge.provenance})`);
        }
        console.log('Next: inspect target plus listed callers/callees/imports before editing.');
      }
      return 0;
    } catch (err) {
      return printEngineError((err as Error).message, opts.json, selected.probe);
    }
  }

  if (!opts.json && opts.depth > 1) {
    console.log('graph engine: code-map fallback (depth is limited to direct imports/dependents)');
  }
  return indexImpact(term, {
    map: opts.map || '.cdd/code-map.yml',
    limit: opts.limit,
    json: opts.json === true,
    refresh: opts.refresh !== false,
  });
}

export async function graphContext(task: string, opts: GraphContextOptions): Promise<number> {
  const selected = selectEngine(opts);
  if ('error' in selected) return printEngineError(selected.error, opts.json, selected.probe);

  if (selected.engine === 'codegraph') {
    const args = ['context', task, '--max-nodes', String(opts.maxNodes), '--format', opts.json ? 'json' : 'markdown'];
    return pipeResult(runCodeGraph(args));
  }

  if (selected.engine === 'native') {
    const mapPath = opts.map || '.cdd/code-map.yml';
    const ensured = await ensureNativeGraph(mapPath, opts.refresh !== false);
    if (ensured.error) return printEngineError(ensured.error, opts.json, selected.probe);
    try {
      const graph = loadCodeGraph(ensured.graphPath);
      const context = buildNativeContext(graph, task, opts.maxNodes);
      if (opts.json) {
        writeJson({ engine: 'native', graph: ensured.graphPath, refreshed: ensured.refreshed, ...context });
      } else {
        console.log(`graph: ${ensured.graphPath}${ensured.refreshed ? ' (refreshed)' : ''}`);
        console.log(`task: ${task}`);
        console.log('entry-points:');
        for (const entry of context.entry_points) {
          console.log(`- ${entry.node.kind}: ${entry.node.qualified_name} lines ${entry.node.start_line}-${entry.node.end_line}`);
        }
        console.log('related edges:');
        for (const edge of context.edges.slice(0, opts.maxNodes)) {
          const source = graph.nodes.find(n => n.id === edge.source)?.qualified_name ?? edge.source;
          const target = graph.nodes.find(n => n.id === edge.target)?.qualified_name ?? edge.target;
          console.log(`- ${edge.kind}: ${source} -> ${target}${edge.line ? ` line ${edge.line}` : ''}`);
        }
        console.log('Next: run cdd-kit graph impact on the most relevant entry point before editing.');
      }
      return context.entry_points.length === 0 ? 1 : 0;
    } catch (err) {
      return printEngineError((err as Error).message, opts.json, selected.probe);
    }
  }

  const mapPath = opts.map || '.cdd/code-map.yml';
  const freshness = await ensureCodeMapFresh(mapPath, opts.refresh !== false);
  if (freshness.error) return printEngineError(freshness.error, opts.json, selected.probe);
  if (!existsSync(mapPath)) return printEngineError(`${mapPath} is missing; run \`cdd-kit code-map\` first.`, opts.json, selected.probe);

  let entries: FileEntry[];
  try {
    entries = loadCodeMapEntries(mapPath);
  } catch (err) {
    return printEngineError(`${mapPath} is not readable YAML: ${(err as Error).message}`, opts.json, selected.probe);
  }

  const results = queryEntries(entries, task).slice(0, opts.maxNodes);
  const payload = {
    engine: 'codemap',
    query: task,
    refreshed: freshness.refreshed,
    warning: 'CodeGraph is not active; context is built from code-map symbol/file matches only.',
    candidates: results,
    next: results.length > 0
      ? 'Run cdd-kit graph impact <candidate path or symbol> before editing.'
      : 'Try a symbol name, file stem, route/component name, or initialize CodeGraph for semantic context.',
  };

  if (opts.json) {
    writeJson(payload);
  } else {
    console.log(`graph engine: code-map fallback${freshness.refreshed ? ' (refreshed)' : ''}`);
    console.log(`task: ${task}`);
    if (results.length === 0) {
      console.log('candidates: none');
      console.log(payload.next);
      return 1;
    }
    console.log('candidates:');
    for (const result of results) {
      console.log(`- ${result.path} (${result.total_lines} lines)`);
      for (const match of result.matches.slice(0, 5)) {
        const loc = match.lines ? ` lines ${match.lines}` : match.line ? ` line ${match.line}` : '';
        console.log(`  - ${match.kind}: ${match.name}${loc}`);
      }
    }
    console.log(payload.next);
  }
  return results.length === 0 ? 1 : 0;
}
