import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
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
});
