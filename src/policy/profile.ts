import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { createHash } from 'crypto';
import type { ExecutionCapsule, WorkflowProfile } from '../runtime/types.js';

export type AcceptanceOracleMode = 'not-required' | 'conditional' | 'required';

interface ProfilePolicy {
  acceptance_oracle?: AcceptanceOracleMode;
}

interface ProjectPolicy {
  profiles?: Partial<Record<WorkflowProfile, ProfilePolicy>>;
}

export interface GateProfileResolution {
  profile: WorkflowProfile | null;
  source: 'legacy' | 'explicit' | 'runtime';
  capsule: ExecutionCapsule | null;
  run_id: string | null;
}

const WORKFLOW_PROFILES = new Set<WorkflowProfile>(['lightweight', 'balanced', 'controlled', 'strict']);
const PROFILE_ORDER: WorkflowProfile[] = ['lightweight', 'balanced', 'controlled', 'strict'];

function policyDigest(cwd: string): string | null {
  const path = join(cwd, '.cdd', 'policy.yml');
  if (!existsSync(path)) return null;
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function readCurrentCapsule(cwd: string, changeId: string, requestedRunId?: string): { capsule: ExecutionCapsule; run_id: string } | null {
  const root = join(cwd, '.cdd', 'runtime');
  if (!existsSync(root)) return null;
  const ids = requestedRunId ? [requestedRunId] : readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  const candidates: Array<{ created_at: string; capsule: ExecutionCapsule; run_id: string }> = [];
  for (const id of ids) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) continue;
    try {
      const state = JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8')) as { change_id?: string; created_at?: string; capsule?: ExecutionCapsule };
      const capsule = state.capsule;
      if (state.change_id !== changeId || !capsule || !WORKFLOW_PROFILES.has(capsule.profile)) continue;
      if (!capsule.input_digests || capsule.input_digests.policy !== policyDigest(cwd)) continue;
      candidates.push({ created_at: state.created_at ?? '', capsule, run_id: id });
    } catch { /* malformed/stale runs are ignored fail-closed */ }
  }
  return candidates.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function readPolicy(cwd: string): ProjectPolicy | null {
  const path = join(cwd, '.cdd', 'policy.yml');
  if (!existsSync(path)) return null;
  try { return yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA }) as ProjectPolicy; }
  catch { return null; }
}

export function resolveGateProfile(
  cwd: string,
  changeId: string,
  requested?: WorkflowProfile,
  strictFlag = false,
  runId?: string,
): GateProfileResolution {
  if (strictFlag && requested && requested !== 'strict') {
    throw new Error(`--strict cannot be combined with --profile ${requested}; strict is itself a workflow profile.`);
  }
  const resolved = readCurrentCapsule(cwd, changeId, runId);
  const capsule = resolved?.capsule ?? null;
  if (strictFlag) return { profile: 'strict', source: 'explicit', capsule, run_id: resolved?.run_id ?? null };
  if (requested) {
    const policy = readPolicy(cwd);
    if (!policy) throw new Error(`--profile ${requested} requires a valid .cdd/policy.yml.`);
    if (!policy.profiles?.[requested]) throw new Error(`Profile ${requested} is not configured in .cdd/policy.yml.`);
    if (capsule) {
      if (PROFILE_ORDER.indexOf(capsule.profile) < PROFILE_ORDER.indexOf(requested)) {
        throw new Error(`Runtime capsule profile ${capsule.profile} is weaker than requested profile ${requested}; create a new runtime plan.`);
      }
      return { profile: capsule.profile, source: 'runtime', capsule, run_id: resolved?.run_id ?? null };
    }
    return { profile: requested, source: 'explicit', capsule: null, run_id: null };
  }
  if (capsule) return { profile: capsule.profile, source: 'runtime', capsule, run_id: resolved?.run_id ?? null };
  // No explicit/runtime profile means the existing gate keeps its exact legacy
  // behavior. This is the compatibility boundary during shadow migration.
  return { profile: null, source: 'legacy', capsule: null, run_id: null };
}

export function acceptanceOracleMode(cwd: string, profile: WorkflowProfile): AcceptanceOracleMode {
  if (profile === 'strict') return 'required'; // organization/project policy cannot weaken strict compatibility
  const configured = readPolicy(cwd)?.profiles?.[profile]?.acceptance_oracle;
  if (configured) return configured;
  return profile === 'controlled' ? 'conditional' : 'not-required';
}

export function acceptanceOracleRequired(
  cwd: string,
  resolution: GateProfileResolution,
  explicitlyRequired = false,
): boolean | null {
  if (!resolution.profile) return null;
  if (explicitlyRequired) return true;
  // Capsule requirements are upward-only and outrank a profile default. This
  // is how `cdd-kit work --require-acceptance` survives into a later plain gate.
  if (resolution.capsule?.required_evidence.includes('acceptance-oracle')) return true;
  const mode = acceptanceOracleMode(cwd, resolution.profile);
  if (mode === 'required') return true;
  if (mode === 'not-required') return false;
  return false;
}
