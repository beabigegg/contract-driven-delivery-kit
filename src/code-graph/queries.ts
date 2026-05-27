import type { CodeGraphEdge, CodeGraphIndex, CodeGraphNode } from './types.js';

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
}

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
  return traverse(graph, target, ['calls', 'imports', 'references', 'extends', 'implements'], 'both', depth, limit);
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
