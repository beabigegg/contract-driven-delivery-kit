import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import { runBoundaryGuard } from '../boundary/guard.js';
import { inferProvider, type Provider } from '../utils/provider.js';
import type { ExecutionCapsule, RuntimeEvidence, WorkflowProfile } from './types.js';
import { detectRiskSignals, requiredApprovals, selectCapabilitiesAndDoctrine, selectProfile } from './router.js';
import { readRuntimeState, runDir, withRuntimeLock, writeRuntimeArtifact, writeRuntimeState, type StoredRuntimeState } from './store.js';
import { acceptanceOracleMode } from '../policy/profile.js';
import { enforceAcceptanceOracle } from '../commands/gate-acceptance.js';
import { decisionPolicyDigest, decisionWorkingTreeDigest, verifyRuntimeApprovalEvidence } from './decisions.js';
import { normalizeApiPath, parseEndpoints, stripFrontmatter } from '../contracts/parser.js';

function digest(content: string | Buffer): string { return `sha256:${createHash('sha256').update(content).digest('hex')}`; }
function fileDigest(path: string): string { return existsSync(path) ? digest(readFileSync(path)) : digest('missing'); }
function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const output = (result.stdout ?? '').trimEnd();
  return output.length ? output : null;
}
function dirtyDigest(cwd: string): string {
  const diff = git(cwd, ['diff', 'HEAD', '--', '.', ':(exclude).cdd/runtime', ':(exclude).cdd/approvals']) ?? '';
  const status = (git(cwd, ['status', '--porcelain', '--untracked-files=all']) ?? '').split(/\r?\n/)
    .filter(line => !line.slice(3).startsWith('.cdd/runtime/') && !line.slice(3).startsWith('.cdd/approvals/')).join('\n');
  const untracked = (git(cwd, ['ls-files', '--others', '--exclude-standard']) ?? '').split(/\r?\n/)
    .filter(path => path && !path.startsWith('.cdd/runtime/') && !path.startsWith('.cdd/approvals/'))
    .map(path => {
      const absolute = join(cwd, path);
      return existsSync(absolute) && statSync(absolute).isFile() ? `${path}:${fileDigest(absolute)}` : `${path}:non-file`;
    }).join('\n');
  return digest(`${status}\n${diff}\n${untracked}`);
}
function now(): string { return new Date().toISOString(); }
function runId(changeId: string): string { return `${changeId}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`; }

function packageManager(cwd: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  return 'npm';
}

function packageScriptCommand(pm: ReturnType<typeof packageManager>, script: string): string {
  if (script === 'test') return pm === 'bun' ? 'bun run test' : `${pm} test`;
  return `${pm} run ${script}`;
}

function deriveCheckPlan(cwd: string, requiredEvidence: Set<string>): ExecutionCapsule['check_plan'] {
  const plan: ExecutionCapsule['check_plan'] = [];
  if (requiredEvidence.has('quality')) {
    plan.push({ id: 'quality-diff', kind: 'quality', command: 'git diff --check', required: true });
  }
  const packagePath = join(cwd, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      const pm = packageManager(cwd);
      if (scripts.test) plan.push({ id: 'tests', kind: 'test', command: packageScriptCommand(pm, 'test'), required: requiredEvidence.has('tests') });
      for (const script of ['typecheck', 'build'] as const) {
        if (scripts[script]) plan.push({ id: `quality-${script}`, kind: 'quality', command: packageScriptCommand(pm, script), required: requiredEvidence.has('quality') });
      }
    } catch { /* policy verification reports an absent required check below */ }
  } else if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'tests'))) {
    plan.push({ id: 'tests', kind: 'test', command: 'python -m pytest', required: requiredEvidence.has('tests') });
  }
  return plan;
}

interface RuntimePolicy { default_profile: WorkflowProfile; profiles: Record<string, { validators: string[] }> }
function loadPolicy(cwd: string): RuntimePolicy {
  const path = join(cwd, '.cdd', 'policy.yml');
  if (!existsSync(path)) throw new Error('.cdd/policy.yml is required; run `cdd-kit upgrade --yes`.');
  return yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA }) as RuntimePolicy;
}

const OBJECTIVE_STOP_WORDS = new Set(['add', 'change', 'update', 'modify', 'create', 'remove', 'with', 'from', 'into', 'that', 'this', 'feature', 'support']);

function inferObjectiveImpact(cwd: string, objective: string): { files: string[]; operations: string[] } {
  const terms = [...new Set((objective.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])
    .filter(term => !OBJECTIVE_STOP_WORDS.has(term)))].slice(0, 8);
  const grepArgs = terms.flatMap(term => ['-e', term]);
  const matched = terms.length ? git(cwd, ['grep', '-l', '-i', '--fixed-strings', ...grepArgs, '--']) : null;
  const files = (matched ?? '').split(/\r?\n/).filter(Boolean).slice(0, 40);
  const contractPath = join(cwd, 'contracts', 'api', 'api-contract.md');
  const operations: string[] = [];
  if (existsSync(contractPath) && terms.length > 0) {
    const rows = parseEndpoints(stripFrontmatter(readFileSync(contractPath, 'utf8')).body);
    for (const row of rows) {
      const text = `${row.method} ${row.path} ${row.request} ${row.response}`.toLowerCase();
      if (terms.some(term => text.includes(term))) operations.push(`${row.method.toUpperCase()} ${normalizeApiPath(row.path)}`);
    }
  }
  return { files, operations: [...new Set(operations)].sort() };
}

export interface PlanRuntimeOptions {
  cwd?: string; changeId: string; objective: string; provider?: Provider; profile?: WorkflowProfile; base?: string; requireAcceptance?: boolean;
}

export function planRuntime(options: PlanRuntimeOptions): StoredRuntimeState {
  const cwd = options.cwd ?? process.cwd();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.changeId)) {
    throw new Error(`Invalid change id: ${options.changeId}`);
  }
  return withRuntimeLock(cwd, () => {
    const policy = loadPolicy(cwd);
    const boundary = runBoundaryGuard({ cwd, base: options.base });
    const inferred = inferObjectiveImpact(cwd, options.objective);
    const impactFiles = [...new Set([...boundary.changed_files, ...inferred.files])].sort();
    const impactOperations = [...new Set([...boundary.changed_operations, ...inferred.operations])].sort();
    const signals = detectRiskSignals(impactFiles, impactOperations, options.objective);
    if (boundary.findings.some(f => f.code === 'unmapped-api-impact')) {
      signals.push({ id: 'unknown-boundary-impact', source: 'boundary', confidence: 'high', evidence: boundary.findings.filter(f => f.code === 'unmapped-api-impact').flatMap(f => f.evidence), floor: 'controlled' });
    }
    const controlledBoundaryFindings = boundary.findings.filter(f => ['generic-response-schema', 'consumer-type-compatibility-unproven'].includes(f.code));
    if (controlledBoundaryFindings.length > 0) {
      signals.push({ id: 'boundary-review-required', source: 'boundary', confidence: 'high', evidence: controlledBoundaryFindings.flatMap(f => f.evidence), floor: 'controlled' });
    }
    const profile = selectProfile(policy.default_profile, signals, options.profile);
    const approvals = requiredApprovals(signals);
    const composition = selectCapabilitiesAndDoctrine(signals, profile);
    const requiredEvidence = new Set(policy.profiles[profile]?.validators ?? []);
    if (profile !== 'strict') requiredEvidence.add('implementation');
    if (options.requireAcceptance || acceptanceOracleMode(cwd, profile) === 'required') requiredEvidence.add('acceptance-oracle');
    const checkPlan = deriveCheckPlan(cwd, requiredEvidence);
    const capsule: ExecutionCapsule = {
      schema_version: '1.0.0', change_id: options.changeId, objective: options.objective, profile,
      capabilities: composition.capabilities, doctrine: composition.doctrine, independent_review: composition.independentReview,
      risk_signals: signals.map(({ id, source, confidence, evidence }) => ({ id, source, confidence, evidence })),
      affected: { files: impactFiles, symbols: [], operations: impactOperations, contracts: [boundary.contract], tests: [] },
      write_scope: impactFiles, invariants: ['Canonical contracts remain authoritative.', 'Unknown boundary impact fails upward.'],
      required_evidence: [...requiredEvidence], check_plan: checkPlan, approvals,
      input_digests: {
        contract: boundary.contract_digest,
        policy: fileDigest(join(cwd, '.cdd', 'policy.yml')),
        approval_policy: fileDigest(join(cwd, '.cdd', 'approval-policy.yml')),
        working_tree: dirtyDigest(cwd),
      },
    };
    const timestamp = now();
    const state: StoredRuntimeState = {
      schema_version: '1.0.0', run_id: runId(options.changeId), change_id: options.changeId, status: approvals.length ? 'blocked' : 'planned',
      provider: options.provider ?? inferProvider(cwd), capsule: capsule as unknown as Record<string, unknown>, pending_approvals: approvals,
      steps: [
        { id: 'impact-1', kind: 'impact', status: impactFiles.length > 0 || signals.every(signal => signal.id === 'documentation-only') ? 'passed' : 'pending', attempt: 1, evidence: ['capsule.json'] },
        { id: 'boundary-1', kind: 'boundary', status: boundary.status === 'failed' ? 'failed' : 'pending', attempt: 1, evidence: ['boundary-plan.json'] },
      ], created_at: timestamp, updated_at: timestamp,
    };
    writeRuntimeArtifact(cwd, state.run_id, 'capsule.json', capsule);
    writeRuntimeArtifact(cwd, state.run_id, 'boundary-plan.json', boundary);
    writeRuntimeState(cwd, state);
    return state;
  });
}

export function resumeRuntime(cwd = process.cwd(), runId?: string): { state: StoredRuntimeState; invalidated: string[] } {
  return withRuntimeLock(cwd, () => {
    const state = readRuntimeState(cwd, runId);
    const capsule = state.capsule as unknown as ExecutionCapsule;
    const current = {
      contract: fileDigest(join(cwd, 'contracts', 'api', 'api-contract.md')),
      policy: fileDigest(join(cwd, '.cdd', 'policy.yml')),
      approval_policy: fileDigest(join(cwd, '.cdd', 'approval-policy.yml')),
      working_tree: dirtyDigest(cwd),
    };
    const invalidated = Object.entries(current).filter(([key, value]) => capsule.input_digests[key] !== value).map(([key]) => key);
    if (invalidated.length) state.status = 'blocked';
    else if (state.status === 'planned') state.status = 'running';
    state.updated_at = now();
    writeRuntimeState(cwd, state);
    return { state, invalidated };
  });
}

export function verifyRuntime(cwd = process.cwd(), runId?: string): { state: StoredRuntimeState; evidence: RuntimeEvidence; path: string } {
  return withRuntimeLock(cwd, () => {
    const state = readRuntimeState(cwd, runId);
    const capsule = state.capsule as unknown as ExecutionCapsule;
    const boundary = runBoundaryGuard({ cwd, operations: capsule.affected.operations, verifyGenerated: true, verifyCaptures: true });
    const testEvidencePath = join(cwd, 'specs', 'changes', state.change_id, 'test-evidence.yml');
    const latestCheckStep = (checkId: string) => [...state.steps].reverse().find(step => step.kind === 'test' && step.phase === checkId);
    const stepEvidence = (step: Record<string, unknown> | undefined): string[] => Array.isArray(step?.evidence)
      ? step.evidence.filter((value): value is string => typeof value === 'string')
      : [];
    const decisionIsFresh = (step: Record<string, unknown> | undefined): boolean => {
      const evidenceFiles = stepEvidence(step);
      if (evidenceFiles.length === 0) return false;
      try {
        const decision = JSON.parse(readFileSync(join(runDir(cwd, state.run_id), evidenceFiles[0]), 'utf8')) as {
          working_tree_digest?: string; policy_digest?: string;
        };
        return decision.working_tree_digest === decisionWorkingTreeDigest(cwd)
          && decision.policy_digest === decisionPolicyDigest(cwd);
      } catch { return false; }
    };
    const checkIsFresh = (step: Record<string, unknown> | undefined): boolean => {
      const evidenceFiles = stepEvidence(step);
      if (evidenceFiles.length === 0) return false;
      try {
        const result = JSON.parse(readFileSync(join(runDir(cwd, state.run_id), evidenceFiles[0]), 'utf8')) as {
          input_digests?: Record<string, string>;
        };
        return result.input_digests?.working_tree === decisionWorkingTreeDigest(cwd)
          && result.input_digests?.policy === decisionPolicyDigest(cwd);
      } catch { return false; }
    };
    const requiredNativeChecks = capsule.check_plan.filter(check => check.required);
    const nativeCheckStatus = (kind: 'test' | 'quality'): 'passed' | 'failed' | 'unknown' | 'not-applicable' => {
      const expected = requiredNativeChecks.filter(check => check.kind === kind);
      const evidenceRequired = capsule.required_evidence.includes(kind === 'test' ? 'tests' : 'quality');
      if (expected.length === 0) return evidenceRequired ? 'unknown' : 'not-applicable';
      const steps = expected.map(check => latestCheckStep(check.id));
      if (steps.some(step => step?.status === 'failed' && checkIsFresh(step))) return 'failed';
      if (steps.every(step => step?.status === 'passed' && checkIsFresh(step))) return 'passed';
      return 'unknown';
    };
    let testStatus: 'passed' | 'failed' | 'unknown' | 'not-applicable';
    let qualityStatus: 'passed' | 'failed' | 'unknown' | 'not-applicable';
    if (capsule.profile === 'strict') {
      testStatus = 'unknown';
      if (existsSync(testEvidencePath)) {
        const test = yaml.load(readFileSync(testEvidencePath, 'utf8'), { schema: yaml.JSON_SCHEMA }) as { 'final-status'?: string };
        testStatus = test['final-status'] === 'passed' ? 'passed' : 'failed';
      }
      qualityStatus = 'not-applicable';
    } else {
      testStatus = nativeCheckStatus('test');
      qualityStatus = nativeCheckStatus('quality');
    }
    const boundaryStatus = boundary.status === 'failed' ? 'failed' : boundary.status === 'passed' ? 'passed' : 'not-applicable';
    const acceptanceRequired = capsule.required_evidence.includes('acceptance-oracle');
    const acceptanceErrors: string[] = [];
    const acceptanceWarnings: string[] = [];
    if (acceptanceRequired) {
      enforceAcceptanceOracle(cwd, join(cwd, 'specs', 'changes', state.change_id), state.change_id, true, true, acceptanceErrors, acceptanceWarnings);
    }
    const acceptanceStatus: 'passed' | 'failed' | 'not-applicable' = acceptanceRequired
      ? acceptanceErrors.length > 0 ? 'failed' : 'passed'
      : 'not-applicable';
    writeRuntimeArtifact(cwd, state.run_id, 'acceptance-verification.json', {
      schema_version: '1.0.0', required: acceptanceRequired, status: acceptanceStatus,
      errors: acceptanceErrors, warnings: acceptanceWarnings,
    });
    const approvals: RuntimeEvidence['approvals'] = capsule.approvals.map(id => {
      const step = [...state.steps].reverse().find(candidate => candidate.kind === 'approval' && candidate.phase === id);
      const verified = verifyRuntimeApprovalEvidence(cwd, state, id, step);
      if (!verified.valid) return { id, status: 'pending' as const };
      return { id, status: verified.verdict === 'approved' ? 'approved' as const : 'rejected' as const, actor: verified.actor };
    });
    const approvalEvidenceStatus: 'passed' | 'failed' | 'unknown' | 'not-applicable' = approvals.length === 0
      ? 'not-applicable'
      : approvals.some(approval => approval.status === 'rejected') ? 'failed'
        : approvals.every(approval => approval.status === 'approved') ? 'passed' : 'unknown';
    const reviewRequired = capsule.required_evidence.includes('review');
    const reviewStep = [...state.steps].reverse().find(step => step.kind === 'review');
    const reviewStatus: 'passed' | 'failed' | 'unknown' | 'not-applicable' = reviewRequired
      ? !reviewStep || !decisionIsFresh(reviewStep) ? 'unknown' : reviewStep.status === 'passed' ? 'passed' : 'failed'
      : 'not-applicable';
    const implementationRequired = capsule.required_evidence.includes('implementation');
    const agentStep = [...state.steps].reverse().find(step => step.kind === 'agent');
    const implementationStatus: 'passed' | 'failed' | 'unknown' | 'not-applicable' = implementationRequired
      ? !agentStep || !decisionIsFresh(agentStep) ? 'unknown' : agentStep.status === 'passed' ? 'passed' : 'failed'
      : 'not-applicable';
    const impactStep = [...state.steps].reverse().find(step => step.kind === 'impact');
    const impactStatus: 'passed' | 'failed' | 'unknown' = impactStep?.status === 'passed' ? 'passed' : impactStep?.status === 'failed' ? 'failed' : 'unknown';
    const requiredStatuses = new Map<string, 'passed' | 'failed' | 'unknown' | 'not-applicable'>([
      ['impact', impactStatus],
      ['boundary', boundaryStatus === 'not-applicable' ? 'passed' : boundaryStatus],
      ['tests', testStatus], ['quality', qualityStatus], ['implementation', implementationStatus],
      ['review', reviewStatus], ['acceptance-oracle', acceptanceStatus],
      ['approvals', approvalEvidenceStatus],
      ['legacy-gate', capsule.profile === 'strict' ? 'not-applicable' : 'unknown'],
    ]);
    const unsupportedRequired = capsule.required_evidence.filter(id => !requiredStatuses.has(id));
    const requiredEvidenceBlocked = capsule.required_evidence.some(id => {
      const status = requiredStatuses.get(id);
      return status !== 'passed' && status !== 'not-applicable';
    }) || unsupportedRequired.length > 0;
    const blocked = boundaryStatus === 'failed'
      || testStatus === 'failed' || testStatus === 'unknown'
      || qualityStatus === 'failed' || qualityStatus === 'unknown'
      || implementationStatus === 'failed' || implementationStatus === 'unknown'
      || reviewStatus === 'failed' || reviewStatus === 'unknown'
      || acceptanceStatus === 'failed' || requiredEvidenceBlocked || approvals.some(approval => approval.status !== 'approved');
    const evidence: RuntimeEvidence = {
      schema_version: '1.0.0', run_id: state.run_id, change_id: state.change_id,
      repository: { root: cwd, base_commit: git(cwd, ['merge-base', 'HEAD', 'HEAD^']), head_commit: git(cwd, ['rev-parse', 'HEAD']), working_tree_digest: dirtyDigest(cwd) },
      profile: capsule.profile,
      boundary: {
        changed_operations: boundary.changed_operations,
        route: boundaryStatus, request: boundaryStatus,
        variants: Object.fromEntries(boundary.changed_operations.map(operation => [operation, boundaryStatus])),
        consumers: boundary.findings.some(f => f.code === 'consumer-coverage-unknown') ? 'unknown' : boundaryStatus,
        coverage_non_vacuous: boundary.coverage_non_vacuous,
      },
      checks: [
        { id: 'impact', status: impactStatus, evidence: ['capsule.json'] },
        { id: 'boundary', status: boundaryStatus, evidence: ['boundary-verification.json'] },
        { id: 'implementation', status: implementationStatus, evidence: stepEvidence(agentStep) },
        {
          id: 'tests', status: testStatus,
          evidence: capsule.profile === 'strict' && existsSync(testEvidencePath)
            ? [relative(cwd, testEvidencePath)]
            : capsule.check_plan.filter(check => check.kind === 'test').flatMap(check => stepEvidence(latestCheckStep(check.id))),
        },
        {
          id: 'quality', status: qualityStatus,
          evidence: capsule.check_plan.filter(check => check.kind === 'quality').flatMap(check => stepEvidence(latestCheckStep(check.id))),
        },
        { id: 'review', status: reviewStatus, evidence: stepEvidence(reviewStep) },
        {
          id: 'approvals', status: approvalEvidenceStatus,
          evidence: capsule.approvals.flatMap(id => stepEvidence([...state.steps].reverse().find(step => step.kind === 'approval' && step.phase === id))),
        },
        { id: 'acceptance-oracle', status: acceptanceStatus, evidence: ['acceptance-verification.json'] },
        ...unsupportedRequired.map(id => ({ id, status: 'unknown' as const, evidence: [] })),
      ], approvals, final_status: blocked ? 'blocked' : 'passed', created_at: now(),
    };
    const attempt = state.steps.filter(step => step.kind === 'boundary').length + 1;
    const evidenceName = `evidence-${String(attempt).padStart(3, '0')}.json`;
    writeRuntimeArtifact(cwd, state.run_id, 'boundary-verification.json', boundary);
    const path = writeRuntimeArtifact(cwd, state.run_id, evidenceName, evidence);
    state.steps.push({ id: `verify-${attempt}`, kind: 'boundary', status: blocked ? 'blocked' : 'passed', attempt, evidence: [evidenceName] });
    state.status = blocked ? 'blocked' : 'completed'; state.updated_at = now();
    writeRuntimeState(cwd, state);
    return { state, evidence, path: relative(cwd, path) };
  });
}

export function runtimeStatus(cwd = process.cwd(), runId?: string): StoredRuntimeState { return readRuntimeState(cwd, runId); }
export function runtimeDirectory(cwd = process.cwd(), runId?: string): string { return runDir(cwd, readRuntimeState(cwd, runId).run_id); }
