export type WorkflowProfile = 'lightweight' | 'balanced' | 'controlled' | 'strict';
export type BoundaryStatus = 'passed' | 'failed' | 'unknown' | 'not-applicable';

export interface BoundaryVariant {
  id: string;
  status: number;
  content_type: string;
  schema: string;
  dimensions?: Record<string, string>;
  required: boolean;
  capture?: { path: string; source: string; digest?: string };
}

export interface BoundaryOperation {
  method: string;
  path: string;
  request_schema?: string;
  variants: BoundaryVariant[];
  consumers: string[];
  source_files: string[];
  discovery: {
    adapter: string;
    completeness: 'complete' | 'partial' | 'unknown';
    unknown_reasons: string[];
  };
}

export interface ExecutionCapsule {
  schema_version: '1.0.0';
  change_id: string;
  objective: string;
  profile: WorkflowProfile;
  capabilities: string[];
  doctrine: string[];
  independent_review: boolean;
  risk_signals: Array<{ id: string; source: string; confidence: 'high' | 'medium' | 'low'; evidence: string[] }>;
  affected: {
    files: string[];
    symbols: string[];
    operations: string[];
    contracts: string[];
    tests: string[];
  };
  write_scope: string[];
  invariants: string[];
  required_evidence: string[];
  approvals: string[];
  input_digests: Record<string, string>;
}

export interface RuntimeEvidence {
  schema_version: '1.0.0';
  run_id: string;
  change_id: string;
  repository: {
    root: string;
    base_commit: string | null;
    head_commit: string | null;
    working_tree_digest: string;
  };
  profile: WorkflowProfile;
  boundary: {
    changed_operations: string[];
    route: BoundaryStatus;
    request: BoundaryStatus;
    variants: Record<string, BoundaryStatus>;
    consumers: BoundaryStatus;
    coverage_non_vacuous: boolean;
  };
  checks: Array<{ id: string; status: BoundaryStatus; evidence: string[] }>;
  approvals: Array<{ id: string; status: 'approved' | 'rejected' | 'pending' | 'not-required'; actor?: string }>;
  final_status: 'passed' | 'failed' | 'blocked' | 'in-progress';
  created_at: string;
}
