import { createHash, createPublicKey, verify as verifySignature } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import {
  readRuntimeState,
  runDir,
  withRuntimeLock,
  writeRuntimeArtifact,
  writeRuntimeState,
  type StoredRuntimeState,
} from './store.js';
import type { ExecutionCapsule } from './types.js';

function digest(content: string | Buffer): string { return `sha256:${createHash('sha256').update(content).digest('hex')}`; }
function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trimEnd() : '';
}
function approvalTrustRevision(cwd: string): string {
  for (const candidate of [process.env.CDD_BASE_SHA, process.env.GITHUB_BASE_SHA, 'origin/main', 'origin/master', 'HEAD^', 'HEAD']) {
    if (!candidate) continue;
    const revision = git(cwd, ['rev-parse', '--verify', candidate]);
    if (revision) return revision;
  }
  throw new Error('No trusted base revision is available for approval identity verification.');
}

function trustedFileMatches(cwd: string, revision: string, path: string): boolean {
  if (path.startsWith('/') || path.split('/').includes('..')) return false;
  const result = spawnSync('git', ['show', `${revision}:${path}`], { cwd });
  return result.status === 0 && existsSync(join(cwd, path)) && Buffer.from(result.stdout).equals(readFileSync(join(cwd, path)));
}
export function decisionWorkingTreeDigest(cwd: string): string {
  const diff = git(cwd, ['diff', 'HEAD', '--', '.', ':(exclude).cdd/runtime', ':(exclude).cdd/approvals']);
  const status = git(cwd, ['status', '--porcelain', '--untracked-files=all']).split(/\r?\n/)
    .filter(line => line && !line.slice(3).startsWith('.cdd/runtime/') && !line.slice(3).startsWith('.cdd/approvals/')).join('\n');
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/)
    .filter(path => path && !path.startsWith('.cdd/runtime/') && !path.startsWith('.cdd/approvals/'))
    .map(path => {
      const absolute = join(cwd, path);
      return existsSync(absolute) && statSync(absolute).isFile() ? `${path}:${digest(readFileSync(absolute))}` : `${path}:non-file`;
    }).join('\n');
  return digest(`${status}\n${diff}\n${untracked}`);
}

export function decisionPolicyDigest(cwd: string): string {
  const paths = [join(cwd, '.cdd', 'policy.yml'), join(cwd, '.cdd', 'approval-policy.yml')];
  return digest(paths.map(path => existsSync(path) ? digest(readFileSync(path)) : digest('missing')).join('\n'));
}

interface DecisionRecord {
  schema_version: '1.0.0';
  run_id: string;
  kind: 'review' | 'approval';
  decision_id: string;
  verdict: 'passed' | 'failed' | 'approved' | 'rejected';
  actor: string;
  summary: string;
  scope?: string;
  working_tree_digest: string;
  policy_digest: string;
  created_at: string;
  provenance?: { provider: 'signed-file'; key_fingerprint: string; envelope: string; envelope_digest: string; nonce: string };
}

export interface SignedApprovalEnvelope {
  schema_version: '1.0.0';
  run_id: string;
  change_id: string;
  approval_id: string;
  verdict: 'approved' | 'rejected';
  actor: string;
  reason: string;
  scope: string;
  working_tree_digest: string;
  policy_digest: string;
  head_commit: string;
  issued_at: string;
  nonce: string;
  signature: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signedApprovalPayload(envelope: Omit<SignedApprovalEnvelope, 'signature'>): string { return canonical(envelope); }

function requireText(value: string, label: string, minimum = 1): string {
  const trimmed = value.trim();
  if (trimmed.length < minimum) throw new Error(`${label} must be at least ${minimum} characters.`);
  return trimmed;
}

function latestAgentActor(cwd: string, state: StoredRuntimeState): string | null {
  const step = [...state.steps].reverse().find(candidate => candidate.kind === 'agent');
  const evidence = Array.isArray(step?.evidence) ? step.evidence.find(value => typeof value === 'string') : undefined;
  if (typeof evidence !== 'string') return null;
  try { return (JSON.parse(readFileSync(join(runDir(cwd, state.run_id), evidence), 'utf8')) as { actor?: string }).actor ?? null; }
  catch { return null; }
}

export function recordRuntimeReview(
  cwd = process.cwd(),
  runId: string | undefined,
  options: { actor: string; summary: string; verdict: 'passed' | 'failed' },
): { state: StoredRuntimeState; record: DecisionRecord; path: string } {
  return withRuntimeLock(cwd, () => {
    const state = readRuntimeState(cwd, runId);
    const capsule = state.capsule as unknown as ExecutionCapsule;
    if (!capsule.independent_review && !capsule.required_evidence.includes('review')) {
      throw new Error(`Runtime profile ${capsule.profile} does not require independent review.`);
    }
    const actor = requireText(options.actor, 'actor');
    if (latestAgentActor(cwd, state) === actor) throw new Error('Independent reviewer identity must differ from the implementation agent.');
    const attempt = state.steps.filter(step => step.kind === 'review').length + 1;
    const name = `review-${String(attempt).padStart(3, '0')}.json`;
    const record: DecisionRecord = {
      schema_version: '1.0.0', run_id: state.run_id, kind: 'review', decision_id: `review-${attempt}`,
      verdict: options.verdict, actor,
      summary: requireText(options.summary, 'summary', 10),
      working_tree_digest: decisionWorkingTreeDigest(cwd), policy_digest: decisionPolicyDigest(cwd), created_at: new Date().toISOString(),
    };
    const path = writeRuntimeArtifact(cwd, state.run_id, name, record);
    state.steps.push({ id: `review-${attempt}`, kind: 'review', status: options.verdict, attempt, evidence: [name] });
    state.status = options.verdict === 'passed' ? 'running' : 'blocked';
    state.updated_at = new Date().toISOString();
    writeRuntimeState(cwd, state);
    return { state, record, path: relative(cwd, path) };
  });
}

export function importRuntimeApproval(
  cwd = process.cwd(),
  runId: string | undefined,
  envelopePath: string,
): { state: StoredRuntimeState; record: DecisionRecord; path: string } {
  return withRuntimeLock(cwd, () => {
    const state = readRuntimeState(cwd, runId);
    const capsule = state.capsule as unknown as ExecutionCapsule;
    const absoluteEnvelope = envelopePath.startsWith('/') ? envelopePath : join(cwd, envelopePath);
    if (!existsSync(absoluteEnvelope)) throw new Error(`Signed approval envelope not found: ${envelopePath}`);
    const envelope = JSON.parse(readFileSync(absoluteEnvelope, 'utf8')) as SignedApprovalEnvelope;
    const { signature, ...payload } = envelope;
    if (envelope.schema_version !== '1.0.0' || !signature) throw new Error('Signed approval envelope is malformed.');
    const approvalId = envelope.approval_id;
    if (!capsule.approvals.includes(approvalId)) throw new Error(`Approval is not required by this capsule: ${approvalId}`);
    if (envelope.run_id !== state.run_id || envelope.change_id !== state.change_id) throw new Error('Signed approval is bound to a different runtime/change.');
    if (envelope.working_tree_digest !== decisionWorkingTreeDigest(cwd) || envelope.policy_digest !== decisionPolicyDigest(cwd)) {
      throw new Error('Signed approval is stale for the current working tree or policy.');
    }
    const head = git(cwd, ['rev-parse', 'HEAD']);
    if (!head || envelope.head_commit !== head) throw new Error('Signed approval is not bound to the current HEAD commit.');
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(envelope.nonce)) throw new Error('Signed approval nonce is missing or invalid.');
    const nonceAlreadyUsed = state.steps.some(step => (Array.isArray(step.evidence) ? step.evidence : []).some((name: string) => {
      try {
        const prior = JSON.parse(readFileSync(join(runDir(cwd, state.run_id), name), 'utf8')) as DecisionRecord;
        return prior.kind === 'approval' && prior.provenance?.nonce === envelope.nonce;
      } catch { return false; }
    }));
    if (nonceAlreadyUsed) throw new Error('Signed approval nonce has already been imported for this runtime.');
    const issued = Date.parse(envelope.issued_at);
    if (!Number.isFinite(issued) || issued > Date.now() + 60_000 || Date.now() - issued > 86_400_000) throw new Error('Signed approval timestamp is invalid or older than 24 hours.');
    const policyPath = join(cwd, '.cdd', 'approval-policy.yml');
    if (!existsSync(policyPath)) throw new Error('.cdd/approval-policy.yml is required for high-risk approvals.');
    const trustRevision = approvalTrustRevision(cwd);
    if (!trustedFileMatches(cwd, trustRevision, '.cdd/approval-policy.yml')) {
      throw new Error(`Approval policy is not identical to trusted base ${trustRevision}; approver changes must be merged separately before approving high-risk work.`);
    }
    const policy = yaml.load(readFileSync(policyPath, 'utf8'), { schema: yaml.JSON_SCHEMA }) as {
      version?: number; approvals?: Record<string, { provider?: string; actors?: Record<string, { public_key?: string }> }>;
    };
    const rule = policy.approvals?.[approvalId];
    const keyPath = rule?.actors?.[envelope.actor]?.public_key;
    if (policy.version !== 1 || rule?.provider !== 'signed-file' || !keyPath) throw new Error(`Actor ${envelope.actor} is not a configured signed approver for ${approvalId}.`);
    if (!trustedFileMatches(cwd, trustRevision, keyPath)) throw new Error(`Approver key ${keyPath} is not identical to the trusted base revision.`);
    const absoluteKey = keyPath.startsWith('/') ? keyPath : join(cwd, keyPath);
    if (!existsSync(absoluteKey)) throw new Error(`Approver public key not found: ${keyPath}`);
    const publicKey = createPublicKey(readFileSync(absoluteKey));
    if (!verifySignature(null, Buffer.from(signedApprovalPayload(payload)), publicKey, Buffer.from(signature, 'base64'))) {
      throw new Error('Signed approval signature verification failed.');
    }
    const actor = envelope.actor;
    if (latestAgentActor(cwd, state) === actor) throw new Error('A runtime implementation identity cannot approve its own change.');
    const safeId = approvalId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const attempt = state.steps.filter(step => step.kind === 'approval' && step.phase === approvalId).length + 1;
    const name = `approval-${safeId}-${String(attempt).padStart(3, '0')}.json`;
    const record: DecisionRecord = {
      schema_version: '1.0.0', run_id: state.run_id, kind: 'approval', decision_id: approvalId,
      verdict: envelope.verdict, actor,
      summary: requireText(envelope.reason, 'reason', 10), scope: requireText(envelope.scope, 'scope'),
      working_tree_digest: decisionWorkingTreeDigest(cwd), policy_digest: decisionPolicyDigest(cwd), created_at: new Date().toISOString(),
      provenance: {
        provider: 'signed-file', key_fingerprint: digest(publicKey.export({ type: 'spki', format: 'der' })),
        envelope: relative(cwd, absoluteEnvelope), envelope_digest: digest(readFileSync(absoluteEnvelope)), nonce: envelope.nonce,
      },
    };
    const path = writeRuntimeArtifact(cwd, state.run_id, name, record);
    state.steps.push({
      id: `approval-${safeId}-${attempt}`, kind: 'approval', phase: approvalId,
      status: envelope.verdict === 'approved' ? 'passed' : 'failed', attempt, evidence: [name],
    });
    if (envelope.verdict === 'approved') state.pending_approvals = state.pending_approvals.filter(id => id !== approvalId);
    else if (!state.pending_approvals.includes(approvalId)) state.pending_approvals.push(approvalId);
    state.status = envelope.verdict === 'approved' && state.pending_approvals.length === 0 ? 'running' : 'blocked';
    state.updated_at = new Date().toISOString();
    writeRuntimeState(cwd, state);
    return { state, record, path: relative(cwd, path) };
  });
}
