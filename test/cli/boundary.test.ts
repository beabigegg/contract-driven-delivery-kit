import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

let repo: string;
let home: string;

const contract = `---
contract: api
schema-version: 1.0.0
---
# API Contract
## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /health | public | - | Health | - | test/health.test.ts |

## Schemas
### Health
| field | type | required | format | notes |
|---|---|---|---|---|
| ok | boolean | yes | | health state |
`;

const policy = `version: 1
default_profile: balanced
shadow_mode: true
boundary_guard:
  enabled: true
  fail_on_zero_coverage: true
  changed_api_requires_typed_request: true
  changed_api_requires_typed_response: true
  require_complete_variant_discovery: true
  generic_schema_policy: controlled
approvals:
  breaking_api: required
  destructive_migration: required
  auth_policy: required
  production_operation: required
profiles:
  balanced:
    validators: [boundary]
    independent_review: false
    state_persistence: runtime
    fail_on_unknown: true
exceptions: []
`;

beforeEach(() => {
  repo = makeTempDir('cdd-boundary-');
  home = makeTempDir('cdd-boundary-home-');
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), contract, 'utf8');
  writeFileSync(join(repo, '.cdd', 'policy.yml'), policy, 'utf8');
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit boundary', () => {
  it('fails closed when an explicitly changed operation has no manifest entry', () => {
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    const result = JSON.parse(r.stdout);
    expect(result.status).toBe('failed');
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'operation-manifest-missing' })]));
  });

  it('generates a fail-closed manifest scaffold', () => {
    const r = runCli(['boundary', 'init'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const path = join(repo, '.cdd', 'boundary-manifest.yml');
    expect(existsSync(path)).toBe(true);
    const value = yaml.load(readFileSync(path, 'utf8')) as any;
    expect(value.operations[0].discovery.completeness).toBe('unknown');
    const check = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(check.status).toBe(1);
    expect(JSON.parse(check.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'variant-capture-missing' }),
      expect.objectContaining({ code: 'variant-discovery-incomplete' }),
    ]));
  });

  it('passes with fresh digest, complete discovery, and a real capture pointer', () => {
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), '{"ok":true}\n', 'utf8');
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    const manifest = {
      schema_version: '1.0.0', contract_digest: digest, generated_at: new Date().toISOString(),
      operations: [{
        method: 'GET', path: '/health', variants: [{
          id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
          capture: { path: 'tests/contract/samples/health.json', source: 'framework-test-client' },
        }],
        consumers: ['monitoring/health-check'], source_files: ['src/health.ts'],
        discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] },
      }],
    };
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump(manifest), 'utf8');
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.status).toBe('passed');
    expect(result.coverage_non_vacuous).toBe(true);
  });

  it('catches a real response-shape mutation instead of accepting an existing capture file', () => {
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), '{"healthy":"yes"}\n', 'utf8');
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
      schema_version: '1.0.0', contract_digest: digest,
      operations: [{ method: 'GET', path: '/health', variants: [{
        id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
        capture: { path: 'tests/contract/samples/health.json', source: 'framework-test-client' },
      }], consumers: ['monitor'], source_files: ['src/health.ts'], discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] } }],
    }), 'utf8');
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'variant-shape-mismatch' })]));
  });

  it('rejects capture paths that escape the repository boundary', () => {
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
      schema_version: '1.0.0', contract_digest: digest,
      operations: [{ method: 'GET', path: '/health', variants: [{
        id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
        capture: { path: '../../private.json', source: 'untrusted-path' },
      }], consumers: [], source_files: [], discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] } }],
    }), 'utf8');
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toContain('Invalid boundary manifest');
  });
});
