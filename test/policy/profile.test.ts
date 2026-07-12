import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { acceptanceOracleMode, acceptanceOracleRequired, resolveGateProfile } from '../../src/policy/profile.js';
import { cleanupDir, makeTempDir } from '../helpers.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) cleanupDir(roots.pop()!); });

function project(): string {
  const cwd = makeTempDir('cdd-profile-policy-'); roots.push(cwd);
  mkdirSync(join(cwd, '.cdd'), { recursive: true });
  writeFileSync(join(cwd, '.cdd', 'policy.yml'), yaml.dump({
    version: 1,
    profiles: {
      lightweight: { acceptance_oracle: 'not-required' },
      balanced: { acceptance_oracle: 'not-required' },
      controlled: { acceptance_oracle: 'conditional' },
      strict: { acceptance_oracle: 'required' },
    },
  }));
  return cwd;
}

function currentPolicyDigest(cwd: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(join(cwd, '.cdd', 'policy.yml'))).digest('hex')}`;
}

describe('profile-aware acceptance policy', () => {
  it('preserves legacy gate semantics until a profile is explicit or runtime-selected', () => {
    const cwd = project();
    expect(resolveGateProfile(cwd, 'change-a')).toEqual({ profile: null, source: 'legacy', capsule: null, run_id: null });
    expect(acceptanceOracleRequired(cwd, resolveGateProfile(cwd, 'change-a'))).toBeNull();
  });

  it('makes balanced optional and strict unconditionally required', () => {
    const cwd = project();
    expect(acceptanceOracleRequired(cwd, resolveGateProfile(cwd, 'change-a', 'balanced'))).toBe(false);
    expect(acceptanceOracleMode(cwd, 'strict')).toBe('required');
    expect(acceptanceOracleRequired(cwd, resolveGateProfile(cwd, 'change-a', 'strict'))).toBe(true);
  });

  it('activates a conditional oracle only when the runtime capsule requires it', () => {
    const cwd = project();
    const runId = 'change-a-run';
    mkdirSync(join(cwd, '.cdd', 'runtime', runId), { recursive: true });
    writeFileSync(join(cwd, '.cdd', 'runtime', 'current.json'), JSON.stringify({ run_id: runId, change_id: 'change-a' }));
    writeFileSync(join(cwd, '.cdd', 'runtime', runId, 'state.json'), JSON.stringify({
      change_id: 'change-a', created_at: '2026-01-01T00:00:00.000Z',
      capsule: { profile: 'controlled', required_evidence: ['tests', 'acceptance-oracle'], input_digests: { policy: currentPolicyDigest(cwd) } },
    }));
    const resolution = resolveGateProfile(cwd, 'change-a');
    expect(resolution.source).toBe('runtime');
    expect(acceptanceOracleRequired(cwd, resolution)).toBe(true);
  });

  it('lets a capsule strengthen even a balanced profile default', () => {
    const cwd = project();
    const runId = 'change-b-run';
    mkdirSync(join(cwd, '.cdd', 'runtime', runId), { recursive: true });
    writeFileSync(join(cwd, '.cdd', 'runtime', 'current.json'), JSON.stringify({ run_id: runId, change_id: 'change-b' }));
    writeFileSync(join(cwd, '.cdd', 'runtime', runId, 'state.json'), JSON.stringify({
      change_id: 'change-b', created_at: '2026-01-01T00:00:00.000Z',
      capsule: { profile: 'balanced', required_evidence: ['acceptance-oracle'], input_digests: { policy: currentPolicyDigest(cwd) } },
    }));
    expect(acceptanceOracleRequired(cwd, resolveGateProfile(cwd, 'change-b'))).toBe(true);
  });

  it('rejects conflicting strict/profile flags', () => {
    const cwd = project();
    expect(() => resolveGateProfile(cwd, 'change-a', 'balanced', true)).toThrow(/cannot be combined/);
  });

  it('refuses to activate a runtime profile from a stale policy digest', () => {
    const cwd = project();
    const runId = 'stale-run';
    mkdirSync(join(cwd, '.cdd', 'runtime', runId), { recursive: true });
    writeFileSync(join(cwd, '.cdd', 'runtime', 'current.json'), JSON.stringify({ run_id: runId, change_id: 'stale-change' }));
    writeFileSync(join(cwd, '.cdd', 'runtime', runId, 'state.json'), JSON.stringify({
      change_id: 'stale-change', created_at: '2026-01-01T00:00:00.000Z',
      capsule: { profile: 'balanced', required_evidence: [], input_digests: { policy: `sha256:${'0'.repeat(64)}` } },
    }));
    expect(resolveGateProfile(cwd, 'stale-change').source).toBe('legacy');
  });
});
