/**
 * Direct unit tests for the native code-graph query engine (P2-10).
 *
 * The graph queries were previously exercised only end-to-end through the CLI
 * (`cdd-kit graph …`), which left the pure traversal functions — notably
 * `graphCallers` / `graphCallees`, with zero references — untested in isolation.
 * These tests drive the functions against a hand-built `CodeGraphIndex` so the
 * directionality, depth/limit bounds, name resolution, and unresolved-candidate
 * enrichment are pinned down without a filesystem or a build step.
 */
import { describe, it, expect } from 'vitest';
import {
  searchGraph,
  findGraphNode,
  graphCallers,
  graphCallees,
  graphImpact,
  graphContext,
  graphUnresolved,
} from '../../src/code-graph/queries.js';
import type { CodeGraphIndex } from '../../src/code-graph/types.js';

/**
 * A small graph:
 *   a.ts::handler  --calls-->  b.ts::save
 *   a.ts           --imports-> b.ts
 *   c.ts::Repo     --contains-> c.ts::Repo.save   (a same-leaf-name method)
 * plus two unresolved refs from a.ts::handler: an ambiguous `save` (two same-name
 * nodes exist) and a truly external `externalThing` (no node at all).
 */
function makeGraph(): CodeGraphIndex {
  return {
    schema_version: '1.0',
    generator: 'test',
    sources_digest: 'deadbeef',
    files: [
      { path: 'a.ts', total_lines: 5, node_count: 1 },
      { path: 'b.ts', total_lines: 3, node_count: 1 },
      { path: 'c.ts', total_lines: 4, node_count: 2 },
    ],
    nodes: [
      { id: 'a.ts', kind: 'file', name: 'a.ts', qualified_name: 'a.ts', file_path: 'a.ts', start_line: 1, end_line: 5 },
      { id: 'a.ts::handler', kind: 'function', name: 'handler', qualified_name: 'a.ts::handler', file_path: 'a.ts', start_line: 1, end_line: 3, exported: true },
      { id: 'b.ts', kind: 'file', name: 'b.ts', qualified_name: 'b.ts', file_path: 'b.ts', start_line: 1, end_line: 3 },
      { id: 'b.ts::save', kind: 'function', name: 'save', qualified_name: 'b.ts::save', file_path: 'b.ts', start_line: 1, end_line: 2, exported: true },
      { id: 'c.ts', kind: 'file', name: 'c.ts', qualified_name: 'c.ts', file_path: 'c.ts', start_line: 1, end_line: 4 },
      { id: 'c.ts::Repo', kind: 'class', name: 'Repo', qualified_name: 'c.ts::Repo', file_path: 'c.ts', start_line: 1, end_line: 4, exported: true },
      { id: 'c.ts::Repo.save', kind: 'method', name: 'Repo.save', qualified_name: 'c.ts::Repo.save', file_path: 'c.ts', start_line: 2, end_line: 3 },
    ],
    edges: [
      { id: 'e1', source: 'a.ts', target: 'a.ts::handler', kind: 'contains', provenance: 'codemap' },
      { id: 'e2', source: 'a.ts::handler', target: 'b.ts::save', kind: 'calls', line: 2, provenance: 'ast' },
      { id: 'e3', source: 'a.ts', target: 'b.ts', kind: 'imports', provenance: 'codemap' },
      { id: 'e4', source: 'b.ts', target: 'b.ts::save', kind: 'contains', provenance: 'codemap' },
      { id: 'e5', source: 'c.ts', target: 'c.ts::Repo', kind: 'contains', provenance: 'codemap' },
      { id: 'e6', source: 'c.ts::Repo', target: 'c.ts::Repo.save', kind: 'contains', provenance: 'codemap' },
    ],
    unresolved: [
      { from: 'a.ts::handler', kind: 'calls', name: 'save', line: 2, file_path: 'a.ts' },
      { from: 'a.ts::handler', kind: 'calls', name: 'externalThing', line: 2, file_path: 'a.ts' },
    ],
  };
}

describe('code-graph queries', () => {
  describe('searchGraph', () => {
    it('ranks same-name nodes and returns both `save` symbols', () => {
      const results = searchGraph(makeGraph(), 'save', 10);
      const names = results.map(r => r.node.qualified_name);
      expect(names).toContain('b.ts::save');
      expect(names).toContain('c.ts::Repo.save');
      // Every returned result carries its incoming/outgoing edge counts.
      const handler = searchGraph(makeGraph(), 'handler', 10)[0];
      expect(handler.edges.incoming).toBe(1); // a.ts contains handler
      expect(handler.edges.outgoing).toBe(1); // handler calls save
    });

    it('returns nothing for an empty query and respects the limit', () => {
      expect(searchGraph(makeGraph(), '   ', 10)).toEqual([]);
      expect(searchGraph(makeGraph(), 'save', 1)).toHaveLength(1);
    });
  });

  describe('findGraphNode', () => {
    it('resolves a file path, a unique symbol, and is undefined for an ambiguous bare name', () => {
      expect(findGraphNode(makeGraph(), 'a.ts')?.id).toBe('a.ts');
      expect(findGraphNode(makeGraph(), 'handler')?.id).toBe('a.ts::handler');
      // `save` matches two symbol nodes exactly, so the unique-symbol shortcut
      // does not fire; it falls back to the best search hit (still a `save`).
      expect(findGraphNode(makeGraph(), 'save')?.name).toBe('save');
    });
  });

  describe('graphCallers / graphCallees', () => {
    it('graphCallers walks incoming call edges (who calls save?)', () => {
      const res = graphCallers(makeGraph(), 'b.ts::save', 2, 50);
      expect(res).toBeDefined();
      const ids = res!.nodes.map(n => n.id);
      expect(ids).toContain('a.ts::handler'); // handler calls save
      // It must NOT pull in the `contains`/`imports` neighbors — calls only.
      expect(ids).not.toContain('c.ts::Repo.save');
    });

    it('graphCallees walks outgoing call edges (what does handler call?)', () => {
      const res = graphCallees(makeGraph(), 'handler', 2, 50);
      expect(res).toBeDefined();
      const ids = res!.nodes.map(n => n.id);
      expect(ids).toContain('b.ts::save');
    });

    it('returns undefined for an unknown target', () => {
      expect(graphCallers(makeGraph(), 'does-not-exist', 1, 10)).toBeUndefined();
      expect(graphCallees(makeGraph(), 'does-not-exist', 1, 10)).toBeUndefined();
    });
  });

  describe('graphImpact', () => {
    it('walks both directions and carries the unresolved refs from the impact set', () => {
      const res = graphImpact(makeGraph(), 'handler', 2, 50);
      expect(res).toBeDefined();
      const ids = res!.nodes.map(n => n.id);
      expect(ids).toContain('a.ts::handler'); // the target itself
      expect(ids).toContain('b.ts::save'); // handler calls save (outgoing)
      // impact traverses calls/imports/references/extends/implements (not the
      // `contains` edge), so the enclosing a.ts file node is not pulled in here.
      expect(ids).not.toContain('a.ts');
      // Both unresolved refs originate from a.ts::handler, which is in the set.
      const names = res!.unresolved.map(u => u.name).sort();
      expect(names).toEqual(['externalThing', 'save']);
    });
  });

  describe('graphContext', () => {
    it('returns entry points and a 1-hop neighborhood for a task query', () => {
      const ctx = graphContext(makeGraph(), 'handler', 25);
      expect(ctx.query).toBe('handler');
      expect(ctx.entry_points.length).toBeGreaterThan(0);
      expect(ctx.nodes.map(n => n.id)).toContain('a.ts::handler');
    });
  });

  describe('graphUnresolved', () => {
    it('distinguishes an ambiguous ref (same-name candidates) from a truly external one', () => {
      const res = graphUnresolved(makeGraph(), undefined, { limit: 50 });
      expect(res.scope).toBe('all');
      expect(res.total).toBe(2);

      const save = res.unresolved.find(u => u.name === 'save')!;
      expect(save.from_qualified_name).toBe('a.ts::handler');
      expect(save.candidates.map(c => c.qualified_name).sort()).toEqual(['b.ts::save', 'c.ts::Repo.save']);

      const ext = res.unresolved.find(u => u.name === 'externalThing')!;
      expect(ext.candidates).toEqual([]);
    });

    it('scopes to a file and filters by kind', () => {
      const scoped = graphUnresolved(makeGraph(), 'a.ts', { limit: 50 });
      expect(scoped.scope).toBe('file');
      expect(scoped.filter?.resolved).toBe('a.ts');
      expect(scoped.unresolved.every(u => u.file_path === 'a.ts')).toBe(true);

      const calls = graphUnresolved(makeGraph(), undefined, { kind: 'calls', limit: 50 });
      expect(calls.unresolved.every(u => u.kind === 'calls')).toBe(true);
      const extendsOnly = graphUnresolved(makeGraph(), undefined, { kind: 'extends', limit: 50 });
      expect(extendsOnly.total).toBe(0);
      expect(extendsOnly.unresolved).toEqual([]);
    });

    it('reports truncation when the limit is below the match count', () => {
      const res = graphUnresolved(makeGraph(), undefined, { limit: 1 });
      expect(res.total).toBe(2);
      expect(res.returned).toBe(1);
      expect(res.truncated).toBe(true);
    });
  });
});
