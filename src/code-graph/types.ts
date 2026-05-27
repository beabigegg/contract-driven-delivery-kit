export type CodeGraphNodeKind =
  | 'file'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'constant'
  | 'enum'
  | 'type_alias'
  | 'component';

export type CodeGraphEdgeKind =
  | 'contains'
  | 'imports'
  | 'exports'
  | 'calls'
  | 'references'
  | 'extends'
  | 'implements';

export type CodeGraphProvenance = 'codemap' | 'ast' | 'heuristic';

export interface CodeGraphNode {
  id: string;
  kind: CodeGraphNodeKind;
  name: string;
  qualified_name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  exported?: boolean;
}

export interface CodeGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: CodeGraphEdgeKind;
  line?: number;
  provenance: CodeGraphProvenance;
  metadata?: Record<string, unknown>;
}

export interface CodeGraphFile {
  path: string;
  total_lines: number;
  node_count: number;
}

export interface CodeGraphUnresolvedRef {
  from: string;
  kind: CodeGraphEdgeKind;
  name: string;
  line: number;
  file_path: string;
  candidates?: string[];
}

export interface CodeGraphIndex {
  schema_version: '1.0';
  generator: string;
  sources_digest: string;
  files: CodeGraphFile[];
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  unresolved: CodeGraphUnresolvedRef[];
}
