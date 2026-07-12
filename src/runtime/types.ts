export type WorkflowProfile = 'lightweight' | 'balanced' | 'controlled' | 'strict';
export type BoundaryStatus = 'passed' | 'failed' | 'unknown' | 'not-applicable';

export interface BoundaryVariant {
  id: string;
  status: number;
  content_type: string;
  schema: string;
  dimensions?: Record<string, string>;
  required: boolean;
  capture?: {
    path: string;
    adapter: 'fastapi-testclient' | 'flask-test-client' | 'express-supertest';
    target: string;
    request?: { path?: string; query?: Record<string, string>; headers?: Record<string, string>; json?: unknown };
    provenance?: {
      adapter_version: string; runner_version: string; target_digest: string; contract_digest: string;
      producer_digest: string; capture_digest: string; commit: string; produced_at: string;
    };
  };
}

export interface BoundaryParameter {
  name: string;
  in: 'path' | 'query';
  schema: string;
  required: boolean;
}

export interface BoundaryOperation {
  method: string;
  path: string;
  request_schema?: string;
  parameters?: BoundaryParameter[];
  variants: BoundaryVariant[];
  consumers: string[];
  source_files: string[];
  generated_artifacts?: Array<{
    path: string; digest: string; input_contract_digest: string; generator: 'openapi-typescript'; generator_version: string; input: string;
  }>;
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
  check_plan: Array<{
    id: string;
    kind: 'test' | 'quality';
    command: string;
    required: boolean;
  }>;
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
