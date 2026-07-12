import { existsSync, readFileSync } from 'fs';
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
}

const WORKFLOW_PROFILES = new Set<WorkflowProfile>(['lightweight', 'balanced', 'controlled', 'strict']);

function policyDigest(cwd: string): string | null {
  const path = join(cwd, '.cdd', 'policy.yml');
  if (!existsSync(path)) return null;
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function readCurrentCapsule(cwd: string, changeId: string): ExecutionCapsule | null {
  try {
    const pointerPath = join(cwd, '.cdd', 'runtime', 'current.json');
    if (!existsSync(pointerPath)) return null;
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as { run_id?: string; change_id?: string };
    if (!pointer.run_id || pointer.change_id !== changeId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(pointer.run_id)) return null;
    const state = JSON.parse(readFileSync(join(cwd, '.cdd', 'runtime', pointer.run_id, 'state.json'), 'utf8')) as { capsule?: ExecutionCapsule };
    const capsule = state.capsule;
    if (!capsule || !WORKFLOW_PROFILES.has(capsule.profile)) return null;
    // A stale capsule must never weaken a newer policy. Resume will explain the
    // invalidation; gate simply falls back to legacy-safe behavior.
    if (!capsule.input_digests || capsule.input_digests.policy !== policyDigest(cwd)) return null;
    return capsule;
  } catch {
    return null;
  }
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
): GateProfileResolution {
  if (strictFlag && requested && requested !== 'strict') {
    throw new Error(`--strict cannot be combined with --profile ${requested}; strict is itself a workflow profile.`);
  }
  const capsule = readCurrentCapsule(cwd, changeId);
  if (strictFlag) return { profile: 'strict', source: 'explicit', capsule };
  if (requested) {
    const policy = readPolicy(cwd);
    if (!policy) throw new Error(`--profile ${requested} requires a valid .cdd/policy.yml.`);
    if (!policy.profiles?.[requested]) throw new Error(`Profile ${requested} is not configured in .cdd/policy.yml.`);
    return { profile: requested, source: 'explicit', capsule };
  }
  if (capsule) return { profile: capsule.profile, source: 'runtime', capsule };
  // No explicit/runtime profile means the existing gate keeps its exact legacy
  // behavior. This is the compatibility boundary during shadow migration.
  return { profile: null, source: 'legacy', capsule: null };
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
