import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

let repo: string;
let home: string;

beforeEach(() => {
  repo = makeTempDir('cdd-policy-');
  home = makeTempDir('cdd-policy-home-');
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  writeFileSync(join(repo, '.cdd', 'policy.yml'), readFileSync(join(process.cwd(), '.cdd', 'policy.yml')));
});

afterEach(() => { cleanupDir(repo); cleanupDir(home); });

describe('cdd-kit policy check', () => {
  it('accepts the shipped shadow/strict compatibility policy', () => {
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('passed');
  });

  it('rejects a policy that removes the strict legacy fallback', () => {
    const path = join(repo, '.cdd', 'policy.yml');
    writeFileSync(path, readFileSync(path, 'utf8').replace('legacy_workflow: true', 'legacy_workflow: false'));
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors.join(' ')).toContain('legacy_workflow must remain true');
  });

  it('rejects expired boundary exceptions', () => {
    const path = join(repo, '.cdd', 'policy.yml');
    writeFileSync(path, readFileSync(path, 'utf8').replace('exceptions: []', `exceptions:\n  - id: legacy-health\n    operation: GET /health\n    class: legacy\n    reason: legacy compatibility window\n    owner: platform\n    expires: 2000-01-01`));
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors.join(' ')).toContain('expired on 2000-01-01');
  });

  it('rejects attempts to weaken strict acceptance provenance', () => {
    const path = join(repo, '.cdd', 'policy.yml');
    writeFileSync(path, readFileSync(path, 'utf8').replace('acceptance_oracle: required', 'acceptance_oracle: not-required'));
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors.join(' ')).toContain('cannot be weaker than required');
  });

  it('errors when a bone protection is disabled without a loosening acknowledgment', () => {
    const path = join(repo, '.cdd', 'policy.yml');
    const policy = yaml.load(readFileSync(path, 'utf8')) as any;
    policy.approvals.breaking_api = 'optional';
    writeFileSync(path, yaml.dump(policy));
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors.join(' ')).toContain('approvals.breaking_api');
  });

  it('allows a disabled bone with a recorded loosening acknowledgment (warns, does not fail)', () => {
    const path = join(repo, '.cdd', 'policy.yml');
    const policy = yaml.load(readFileSync(path, 'utf8')) as any;
    policy.boundary_guard.fail_on_zero_coverage = false;
    policy.loosening = [{
      id: 'boundary_guard.fail_on_zero_coverage',
      reason: 'repo has no API surface this quarter; boundary coverage is not applicable',
      reversible: true,
      evidence: 'mutation corpus run #12: no boundary defect escaped',
    }];
    writeFileSync(path, yaml.dump(policy));
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.status).toBe('passed');
    expect(out.warnings.join(' ')).toContain('loosened bone boundary_guard.fail_on_zero_coverage');
  });

  it('still errors when a disabled bone is only half-acknowledged (reason too short)', () => {
    const path = join(repo, '.cdd', 'policy.yml');
    const policy = yaml.load(readFileSync(path, 'utf8')) as any;
    policy.approvals.destructive_migration = 'optional';
    policy.loosening = [{ id: 'approvals.destructive_migration', reason: 'meh' }];
    writeFileSync(path, yaml.dump(policy));
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    // schema requires reason >= 10 chars, so this fails validation before the audit.
    expect(result.status).toBe(1);
  });

  it('warns about a stale loosening entry for an intact protection', () => {
    const path = join(repo, '.cdd', 'policy.yml');
    const policy = yaml.load(readFileSync(path, 'utf8')) as any;
    policy.loosening = [{ id: 'boundary_guard.enabled', reason: 'left over from an earlier experiment' }];
    writeFileSync(path, yaml.dump(policy));
    const result = runCli(['policy', 'check', '--json'], { cwd: repo, home });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).warnings.join(' ')).toContain('stale');
  });
});
