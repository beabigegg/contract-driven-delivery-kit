import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';
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
export function decisionWorkingTreeDigest(cwd: string): string {
  const diff = git(cwd, ['diff', 'HEAD', '--', '.', ':(exclude).cdd/runtime']);
  const status = git(cwd, ['status', '--porcelain', '--untracked-files=all']).split(/\r?\n/)
    .filter(line => line && !line.slice(3).startsWith('.cdd/runtime/')).join('\n');
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/)
    .filter(path => path && !path.startsWith('.cdd/runtime/'))
    .map(path => {
      const absolute = join(cwd, path);
      return existsSync(absolute) && statSync(absolute).isFile() ? `${path}:${digest(readFileSync(absolute))}` : `${path}:non-file`;
    }).join('\n');
  return digest(`${status}\n${diff}\n${untracked}`);
}

export function decisionPolicyDigest(cwd: string): string {
  const path = join(cwd, '.cdd', 'policy.yml');
  return existsSync(path) ? digest(readFileSync(path)) : digest('missing');
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
}

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

export function recordRuntimeApproval(
  cwd = process.cwd(),
  runId: string | undefined,
  approvalId: string,
  options: { actor: string; reason: string; scope: string; verdict: 'approved' | 'rejected' },
): { state: StoredRuntimeState; record: DecisionRecord; path: string } {
  return withRuntimeLock(cwd, () => {
    const state = readRuntimeState(cwd, runId);
    const capsule = state.capsule as unknown as ExecutionCapsule;
    if (!capsule.approvals.includes(approvalId)) throw new Error(`Approval is not required by this capsule: ${approvalId}`);
    const actor = requireText(options.actor, 'actor');
    if (latestAgentActor(cwd, state) === actor) throw new Error('A runtime implementation agent cannot approve its own change.');
    const safeId = approvalId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const attempt = state.steps.filter(step => step.kind === 'approval' && step.phase === approvalId).length + 1;
    const name = `approval-${safeId}-${String(attempt).padStart(3, '0')}.json`;
    const record: DecisionRecord = {
      schema_version: '1.0.0', run_id: state.run_id, kind: 'approval', decision_id: approvalId,
      verdict: options.verdict, actor,
      summary: requireText(options.reason, 'reason', 10), scope: requireText(options.scope, 'scope'),
      working_tree_digest: decisionWorkingTreeDigest(cwd), policy_digest: decisionPolicyDigest(cwd), created_at: new Date().toISOString(),
    };
    const path = writeRuntimeArtifact(cwd, state.run_id, name, record);
    state.steps.push({
      id: `approval-${safeId}-${attempt}`, kind: 'approval', phase: approvalId,
      status: options.verdict === 'approved' ? 'passed' : 'failed', attempt, evidence: [name],
    });
    if (options.verdict === 'approved') state.pending_approvals = state.pending_approvals.filter(id => id !== approvalId);
    else if (!state.pending_approvals.includes(approvalId)) state.pending_approvals.push(approvalId);
    state.status = options.verdict === 'approved' && state.pending_approvals.length === 0 ? 'running' : 'blocked';
    state.updated_at = new Date().toISOString();
    writeRuntimeState(cwd, state);
    return { state, record, path: relative(cwd, path) };
  });
}
