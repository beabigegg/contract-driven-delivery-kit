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

function digest(content: string | Buffer): string { return `sha256:${createHash('sha256').update(content).digest('hex')}`; }
function fileDigest(path: string): string { return existsSync(path) ? digest(readFileSync(path)) : digest('missing'); }
function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() || null : null;
}
function dirtyDigest(cwd: string): string {
  const diff = git(cwd, ['diff', 'HEAD', '--', '.', ':(exclude).cdd/runtime']) ?? '';
  const status = (git(cwd, ['status', '--porcelain']) ?? '').split(/\r?\n/)
    .filter(line => !line.slice(3).startsWith('.cdd/runtime/')).join('\n');
  const untracked = (git(cwd, ['ls-files', '--others', '--exclude-standard']) ?? '').split(/\r?\n/)
    .filter(path => path && !path.startsWith('.cdd/runtime/'))
    .map(path => {
      const absolute = join(cwd, path);
      return existsSync(absolute) && statSync(absolute).isFile() ? `${path}:${fileDigest(absolute)}` : `${path}:non-file`;
    }).join('\n');
  return digest(`${status}\n${diff}\n${untracked}`);
}
function now(): string { return new Date().toISOString(); }
function runId(changeId: string): string { return `${changeId}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`; }

interface RuntimePolicy { default_profile: WorkflowProfile; profiles: Record<string, { validators: string[] }> }
function loadPolicy(cwd: string): RuntimePolicy {
  const path = join(cwd, '.cdd', 'policy.yml');
  if (!existsSync(path)) throw new Error('.cdd/policy.yml is required; run `cdd-kit upgrade --yes`.');
  return yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA }) as RuntimePolicy;
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
    const signals = detectRiskSignals(boundary.changed_files, boundary.changed_operations, options.objective);
    if (boundary.findings.some(f => f.code === 'unmapped-api-impact')) {
      signals.push({ id: 'unknown-boundary-impact', source: 'boundary', confidence: 'high', evidence: boundary.findings.filter(f => f.code === 'unmapped-api-impact').flatMap(f => f.evidence), floor: 'controlled' });
    }
    const profile = selectProfile(policy.default_profile, signals, options.profile);
    const approvals = requiredApprovals(signals);
    const composition = selectCapabilitiesAndDoctrine(signals, profile);
    const requiredEvidence = new Set(policy.profiles[profile]?.validators ?? []);
    if (options.requireAcceptance || acceptanceOracleMode(cwd, profile) === 'required') requiredEvidence.add('acceptance-oracle');
    const capsule: ExecutionCapsule = {
      schema_version: '1.0.0', change_id: options.changeId, objective: options.objective, profile,
      capabilities: composition.capabilities, doctrine: composition.doctrine, independent_review: composition.independentReview,
      risk_signals: signals.map(({ id, source, confidence, evidence }) => ({ id, source, confidence, evidence })),
      affected: { files: boundary.changed_files, symbols: [], operations: boundary.changed_operations, contracts: [boundary.contract], tests: [] },
      write_scope: boundary.changed_files, invariants: ['Canonical contracts remain authoritative.', 'Unknown boundary impact fails upward.'],
      required_evidence: [...requiredEvidence], approvals,
      input_digests: { contract: boundary.contract_digest, policy: fileDigest(join(cwd, '.cdd', 'policy.yml')), working_tree: dirtyDigest(cwd) },
    };
    const timestamp = now();
    const state: StoredRuntimeState = {
      schema_version: '1.0.0', run_id: runId(options.changeId), change_id: options.changeId, status: approvals.length ? 'blocked' : 'planned',
      provider: options.provider ?? inferProvider(cwd), capsule: capsule as unknown as Record<string, unknown>, pending_approvals: approvals,
      steps: [
        { id: 'impact-1', kind: 'impact', status: 'passed', attempt: 1, evidence: ['capsule.json'] },
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
    const boundary = runBoundaryGuard({ cwd, operations: capsule.affected.operations });
    const testEvidencePath = join(cwd, 'specs', 'changes', state.change_id, 'test-evidence.yml');
    let testStatus: 'passed' | 'failed' | 'unknown' | 'not-applicable' = capsule.profile === 'lightweight' ? 'not-applicable' : 'unknown';
    if (existsSync(testEvidencePath)) {
      const test = yaml.load(readFileSync(testEvidencePath, 'utf8'), { schema: yaml.JSON_SCHEMA }) as { 'final-status'?: string };
      testStatus = test['final-status'] === 'passed' ? 'passed' : 'failed';
    }
    const boundaryStatus = boundary.status === 'failed' ? 'failed' : boundary.status === 'passed' ? 'passed' : 'not-applicable';
    const acceptanceRequired = capsule.required_evidence.includes('acceptance-oracle');
    const acceptanceErrors: string[] = [];
    const acceptanceWarnings: string[] = [];
    if (acceptanceRequired) {
      enforceAcceptanceOracle(
        cwd,
        join(cwd, 'specs', 'changes', state.change_id),
        state.change_id,
        true,
        true,
        acceptanceErrors,
        acceptanceWarnings,
      );
    }
    const acceptanceStatus: 'passed' | 'failed' | 'not-applicable' = acceptanceRequired
      ? acceptanceErrors.length > 0 ? 'failed' : 'passed'
      : 'not-applicable';
    writeRuntimeArtifact(cwd, state.run_id, 'acceptance-verification.json', {
      schema_version: '1.0.0', required: acceptanceRequired, status: acceptanceStatus,
      errors: acceptanceErrors, warnings: acceptanceWarnings,
    });
    const approvals = state.pending_approvals.map(id => ({ id, status: 'pending' as const }));
    const blocked = boundaryStatus === 'failed' || testStatus === 'failed' || testStatus === 'unknown' || acceptanceStatus === 'failed' || approvals.length > 0;
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
        { id: 'boundary', status: boundaryStatus, evidence: ['boundary-verification.json'] },
        { id: 'tests', status: testStatus, evidence: existsSync(testEvidencePath) ? [relative(cwd, testEvidencePath)] : [] },
        {
          id: 'acceptance-oracle', status: acceptanceStatus,
          evidence: ['acceptance-verification.json'],
        },
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
