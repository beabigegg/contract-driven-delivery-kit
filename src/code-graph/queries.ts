import type { CodeGraphEdge, CodeGraphEdgeKind, CodeGraphIndex, CodeGraphNode, CodeGraphUnresolvedRef } from './types.js';

export interface GraphSearchResult {
  node: CodeGraphNode;
  score: number;
  edges: {
    incoming: number;
    outgoing: number;
  };
}

export interface GraphImpactResult {
  target: CodeGraphNode;
  depth: number;
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  /**
   * References originating from any node in the impact set that the graph
   * builder could NOT link to a target (external/dynamic/DI calls, ambiguous
   * names). Surfaced so impact analysis does not silently drop them.
   */
  unresolved: CodeGraphUnresolvedRef[];
}

/** A single same-name candidate node for an unresolved reference. */
export interface UnresolvedCandidate {
  id: string;
  qualified_name: string;
  file_path: string;
  kind: CodeGraphNode['kind'];
}

/** An unresolved reference enriched for human/agent consumption. */
export interface UnresolvedRefView {
  from: string;
  from_qualified_name: string;
  file_path: string;
  line: number;
  kind: CodeGraphEdgeKind;
  name: string;
  /**
   * Graph nodes whose name equals the unresolved name. Non-empty = AMBIGUOUS
   * (the target exists but could not be linked deterministically); empty =
   * truly external/dynamic/DI (no such node in the graph at all).
   */
  candidates: UnresolvedCandidate[];
}

export interface GraphUnresolvedResult {
  scope: 'all' | 'file' | 'symbol';
  filter?: { term: string; resolved: string };
  total: number;
  returned: number;
  truncated: boolean;
  unresolved: UnresolvedRefView[];
}

const CANDIDATE_CAP = 5;

export function searchGraph(graph: CodeGraphIndex, term: string, limit: number): GraphSearchResult[] {
  const query = term.trim().toLowerCase();
  if (!query) return [];
  return graph.nodes
    .map(node => {
      const score = Math.max(
        scoreText(node.name, query, 120),
        scoreText(node.qualified_name, query, 100),
        scoreText(node.file_path, query, 80),
      );
      return {
        node,
        score,
        edges: {
          incoming: graph.edges.filter(e => e.target === node.id).length,
          outgoing: graph.edges.filter(e => e.source === node.id).length,
        },
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.node.file_path.localeCompare(b.node.file_path) || a.node.start_line - b.node.start_line)
    .slice(0, limit);
}

export function findGraphNode(graph: CodeGraphIndex, term: string): CodeGraphNode | undefined {
  const query = term.trim().toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');
  const exact = graph.nodes.find(n => n.id === term || n.qualified_name.toLowerCase() === query || n.file_path.toLowerCase() === query);
  if (exact) return exact;

  const pathMatches = graph.nodes.filter(n => n.kind === 'file' && n.file_path.toLowerCase().includes(query));
  if (pathMatches.length === 1) return pathMatches[0];

  const symbolMatches = graph.nodes.filter(n => n.name.toLowerCase() === query || n.qualified_name.toLowerCase().endsWith(`::${query}`));
  if (symbolMatches.length === 1) return symbolMatches[0];

  return searchGraph(graph, term, 1)[0]?.node;
}

export function graphCallers(graph: CodeGraphIndex, term: string, depth: number, limit: number): GraphImpactResult | undefined {
  const target = findGraphNode(graph, term);
  if (!target) return undefined;
  return traverse(graph, target, ['calls'], 'incoming', depth, limit);
}

export function graphCallees(graph: CodeGraphIndex, term: string, depth: number, limit: number): GraphImpactResult | undefined {
  const target = findGraphNode(graph, term);
  if (!target) return undefined;
  return traverse(graph, target, ['calls'], 'outgoing', depth, limit);
}

export function graphImpact(graph: CodeGraphIndex, term: string, depth: number, limit: number): GraphImpactResult | undefined {
  const target = findGraphNode(graph, term);
  if (!target) return undefined;
  const result = traverse(graph, target, ['calls', 'imports', 'references', 'extends', 'implements'], 'both', depth, limit);
  // The blast radius also includes references the builder could not resolve
  // (DI lookups, external service calls, dynamic dispatch). Surface the ones
  // emanating from any node we touched so callers do not assume completeness.
  const visited = new Set(result.nodes.map(n => n.id));
  result.unresolved = graph.unresolved.filter(u => visited.has(u.from));
  return result;
}

/**
 * List references the builder could not resolve to a target node, optionally
 * scoped to a file or symbol. Each ref is enriched with the originating node's
 * qualified name and with same-name candidate nodes (computed at query time;
 * the on-disk index is never mutated) so callers can tell an AMBIGUOUS target
 * (candidates present) from a truly external/dynamic one (no candidates).
 */
export function graphUnresolved(
  graph: CodeGraphIndex,
  term: string | undefined,
  opts: { kind?: CodeGraphEdgeKind; limit: number },
): GraphUnresolvedResult {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
  // Index symbol nodes by both their full name and their leaf segment so an
  // unresolved `save` can surface a `Repo.save` method as a candidate.
  const byName = new Map<string, CodeGraphNode[]>();
  for (const node of graph.nodes) {
    if (node.kind === 'file') continue;
    for (const key of new Set([node.name.toLowerCase(), unresolvedBaseName(node.name)])) {
      const list = byName.get(key) ?? [];
      list.push(node);
      byName.set(key, list);
    }
  }

  let scope: GraphUnresolvedResult['scope'] = 'all';
  let filter: GraphUnresolvedResult['filter'];
  let inScope: (ref: CodeGraphUnresolvedRef) => boolean = () => true;

  const trimmed = term?.trim();
  if (trimmed) {
    const node = findGraphNode(graph, trimmed);
    if (node?.kind === 'file') {
      scope = 'file';
      filter = { term: trimmed, resolved: node.file_path };
      inScope = ref => ref.file_path === node.file_path;
    } else if (node) {
      scope = 'symbol';
      filter = { term: trimmed, resolved: node.qualified_name };
      inScope = ref => ref.from === node.id;
    } else {
      // No graph node matched the filter: fall back to a substring match over
      // the originating file path / qualified name so a path that exists only
      // as an unresolved ref source is still selectable.
      const q = trimmed.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');
      scope = 'file';
      filter = { term: trimmed, resolved: trimmed };
      inScope = ref =>
        ref.file_path.toLowerCase().includes(q) ||
        (nodeById.get(ref.from)?.qualified_name.toLowerCase().includes(q) ?? false);
    }
  }

  let matched = graph.unresolved.filter(inScope);
  if (opts.kind) matched = matched.filter(ref => ref.kind === opts.kind);

  const total = matched.length;
  const limited = matched.slice(0, Math.max(1, opts.limit));
  const unresolved: UnresolvedRefView[] = limited.map(ref => {
    const fromNode = nodeById.get(ref.from);
    const candidates = (byName.get(unresolvedBaseName(ref.name)) ?? [])
      .slice(0, CANDIDATE_CAP)
      .map(n => ({ id: n.id, qualified_name: n.qualified_name, file_path: n.file_path, kind: n.kind }));
    return {
      from: ref.from,
      from_qualified_name: fromNode?.qualified_name ?? ref.from,
      file_path: ref.file_path,
      line: ref.line,
      kind: ref.kind,
      name: ref.name,
      candidates,
    };
  });

  return { scope, filter, total, returned: unresolved.length, truncated: total > unresolved.length, unresolved };
}

/** Strip receiver prefixes (this./self.) and member access to the leaf name. */
function unresolvedBaseName(name: string): string {
  const cleaned = name.replace(/^this\./, '').replace(/^self\./, '');
  const parts = cleaned.split('.').filter(Boolean);
  return (parts[parts.length - 1] ?? cleaned).toLowerCase();
}

export function graphContext(graph: CodeGraphIndex, task: string, maxNodes: number): { query: string; entry_points: GraphSearchResult[]; nodes: CodeGraphNode[]; edges: CodeGraphEdge[] } {
  const entryPoints = searchGraph(graph, task, Math.min(maxNodes, 10));
  const nodeIds = new Set(entryPoints.map(r => r.node.id));
  const edgeMap = new Map<string, CodeGraphEdge>();
  for (const entry of entryPoints) {
    const neighborhood = traverse(graph, entry.node, ['contains', 'calls', 'imports', 'references', 'extends', 'implements'], 'both', 1, maxNodes);
    for (const node of neighborhood.nodes) nodeIds.add(node.id);
    for (const edge of neighborhood.edges) edgeMap.set(edge.id, edge);
  }
  const nodes = graph.nodes.filter(n => nodeIds.has(n.id)).slice(0, maxNodes);
  return { query: task, entry_points: entryPoints, nodes, edges: [...edgeMap.values()] };
}

function traverse(
  graph: CodeGraphIndex,
  target: CodeGraphNode,
  kinds: CodeGraphEdge['kind'][],
  direction: 'incoming' | 'outgoing' | 'both',
  depth: number,
  limit: number,
): GraphImpactResult {
  const maxDepth = Math.max(1, depth || 1);
  const maxNodes = Math.max(1, limit || 50);
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
  const visited = new Set<string>([target.id]);
  const keptEdges = new Map<string, CodeGraphEdge>();
  let frontier = [target.id];

  for (let d = 0; d < maxDepth && frontier.length > 0 && visited.size < maxNodes; d++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      const edges = graph.edges.filter(e =>
        kinds.includes(e.kind) &&
        (direction === 'both'
          ? e.source === nodeId || e.target === nodeId
          : direction === 'incoming'
            ? e.target === nodeId
            : e.source === nodeId)
      );
      for (const edge of edges) {
        const other = edge.source === nodeId ? edge.target : edge.source;
        if (!nodeById.has(other)) continue;
        keptEdges.set(edge.id, edge);
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
          if (visited.size >= maxNodes) break;
        }
      }
    }
    frontier = next;
  }

  return {
    target,
    depth: maxDepth,
    nodes: [...visited].map(id => nodeById.get(id)).filter((node): node is CodeGraphNode => !!node),
    edges: [...keptEdges.values()],
    unresolved: [],
  };
}

function scoreText(text: string, query: string, weight: number): number {
  const haystack = text.toLowerCase();
  if (haystack === query) return weight + 40;
  if (haystack.endsWith(`/${query}`) || haystack.endsWith(`.${query}`) || haystack.endsWith(`::${query}`)) return weight + 30;
  if (haystack.startsWith(query)) return weight + 20;
  if (haystack.includes(query)) return weight;
  return 0;
}
