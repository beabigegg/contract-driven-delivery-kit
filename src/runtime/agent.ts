import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { decisionPolicyDigest, decisionWorkingTreeDigest } from './decisions.js';
import { readRuntimeState, withRuntimeLock, writeRuntimeArtifact, writeRuntimeState, type StoredRuntimeState } from './store.js';
import type { ExecutionCapsule } from './types.js';
import { ASSETS_DIR } from '../utils/paths.js';
import { createHash } from 'crypto';

export type RuntimeAgentRole = 'implementer' | 'reviewer';

export interface RuntimeAgentPrompt {
  schema_version: '1.0.0';
  run_id: string;
  role: RuntimeAgentRole;
  provider: StoredRuntimeState['provider'];
  profile: ExecutionCapsule['profile'];
  doctrine: string[];
  prompt: string;
  estimated_tokens: number;
}

function readDoctrine(cwd: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid doctrine id in capsule: ${id}`);
  const candidates = [join(cwd, '.cdd', 'doctrine', `${id}.md`), join(cwd, 'doctrine', `${id}.md`), join(ASSETS_DIR, 'doctrine', `${id}.md`)];
  const path = candidates.find(existsSync);
  if (!path) throw new Error(`Selected doctrine module is missing: ${id}`);
  return readFileSync(path, 'utf8').trim();
}

export function buildRuntimeAgentPrompt(cwd = process.cwd(), runId?: string, role: RuntimeAgentRole = 'implementer'): RuntimeAgentPrompt {
  const state = readRuntimeState(cwd, runId);
  const capsule = state.capsule as unknown as ExecutionCapsule;
  if (role === 'reviewer' && !capsule.independent_review) throw new Error(`Runtime profile ${capsule.profile} does not require an independent reviewer.`);
  const doctrine = capsule.doctrine.map(id => ({ id, content: readDoctrine(cwd, id) }));
  const roleInstruction = role === 'reviewer'
    ? 'Independently review the implementation. Do not modify implementation files. Verify invariants, boundary behavior, selected tests, and report a passed/failed verdict with concrete evidence.'
    : 'Implement the objective inside the write scope. Update canonical contracts with behavior changes, run the capsule check plan, and stop on unknown scope instead of widening it silently.';
  const prompt = [
    `# CDD runtime ${role}`,
    `Run: ${state.run_id}`,
    `Profile: ${capsule.profile}`,
    `Objective: ${capsule.objective}`,
    roleInstruction,
    `Affected operations: ${capsule.affected.operations.join(', ') || '(none discovered; resolve impact before editing)'}`,
    `Write scope: ${capsule.write_scope.join(', ') || '(not yet resolved; use graph/contract impact tools and record the bounded scope)'}`,
    `Required evidence: ${capsule.required_evidence.join(', ') || '(none)'}`,
    `Checks: ${capsule.check_plan.map(check => `${check.id}=${check.command}`).join('; ') || '(none selected)'}`,
    `Approvals: ${capsule.approvals.join(', ') || '(none)'}`,
    ...doctrine.map(module => `\n## Doctrine: ${module.id}\n${module.content}`),
    role === 'reviewer'
      ? `\nRecord the verdict with: cdd-kit runtime review ${state.run_id} --verdict <passed|failed> --actor <identity> --summary <rationale>`
      : `\nRun evidence with: cdd-kit runtime check run ${state.run_id} --all`,
  ].join('\n');
  return {
    schema_version: '1.0.0', run_id: state.run_id, role, provider: state.provider, profile: capsule.profile,
    doctrine: doctrine.map(module => module.id), prompt, estimated_tokens: Math.ceil(prompt.length / 4),
  };
}

export function recordRuntimeAgentResult(
  cwd = process.cwd(),
  runId: string | undefined,
  options: { actor: string; summary: string; status: 'passed' | 'failed' | 'blocked'; files: string[] },
): { state: StoredRuntimeState; path: string } {
  return withRuntimeLock(cwd, () => {
    const state = readRuntimeState(cwd, runId);
    const capsule = state.capsule as unknown as ExecutionCapsule;
    if (!options.actor.trim() || options.summary.trim().length < 10) throw new Error('Agent actor and a summary of at least 10 characters are required.');
    const safeFiles = [...new Set(options.files)].filter(path => path && !path.startsWith('/') && !path.split('/').includes('..'));
    if (safeFiles.length !== new Set(options.files).size) throw new Error('Agent file paths must be unique repository-relative paths without traversal.');
    const missingFiles = safeFiles.filter(path => !existsSync(join(cwd, path)) || !statSync(join(cwd, path)).isFile());
    if (missingFiles.length) throw new Error(`Agent file paths do not exist as repository files: ${missingFiles.join(', ')}`);
    const attempt = state.steps.filter(step => step.kind === 'agent').length + 1;
    const name = `agent-${String(attempt).padStart(3, '0')}.json`;
    const record = {
      schema_version: '1.0.0', run_id: state.run_id, actor: options.actor.trim(), status: options.status,
      summary: options.summary.trim(), files: safeFiles.sort(),
      working_tree_digest: decisionWorkingTreeDigest(cwd), policy_digest: decisionPolicyDigest(cwd), created_at: new Date().toISOString(),
    };
    const absolute = writeRuntimeArtifact(cwd, state.run_id, name, record);
    if (safeFiles.length > 0) {
      capsule.affected.files = [...new Set([...capsule.affected.files, ...safeFiles])].sort();
      capsule.write_scope = [...new Set([...capsule.write_scope, ...safeFiles])].sort();
      state.capsule = capsule as unknown as Record<string, unknown>;
      writeRuntimeArtifact(cwd, state.run_id, 'capsule.json', capsule);
      const impact = [...state.steps].reverse().find(step => step.kind === 'impact');
      if (impact) impact.status = 'passed';
    }
    // The implementation record establishes a new intentional input baseline.
    // Resume must invalidate changes made *after* this handoff, not the scoped
    // implementation itself. Contract changes are re-bound at the same point.
    capsule.input_digests.working_tree = decisionWorkingTreeDigest(cwd);
    const contractPath = join(cwd, 'contracts', 'api', 'api-contract.md');
    capsule.input_digests.contract = existsSync(contractPath)
      ? `sha256:${createHash('sha256').update(readFileSync(contractPath)).digest('hex')}`
      : `sha256:${createHash('sha256').update('missing').digest('hex')}`;
    state.capsule = capsule as unknown as Record<string, unknown>;
    writeRuntimeArtifact(cwd, state.run_id, 'capsule.json', capsule);
    state.steps.push({ id: `agent-${attempt}`, kind: 'agent', status: options.status, attempt, evidence: [name] });
    state.status = options.status === 'passed' ? 'running' : options.status;
    state.updated_at = new Date().toISOString();
    writeRuntimeState(cwd, state);
    return { state, path: relative(cwd, absolute) };
  });
}
