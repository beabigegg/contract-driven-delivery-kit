import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { spawnSync } from 'child_process';
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
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'monitoring'), { recursive: true });
    mkdirSync(join(repo, 'generated'), { recursive: true });
    const captureContent = '{"ok":true}\n';
    const producerContent = `router.get('/health', healthHandler);\n`;
    const generatedContent = 'export interface Health { ok: boolean }\n';
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), captureContent, 'utf8');
    writeFileSync(join(repo, 'src', 'health.ts'), producerContent, 'utf8');
    writeFileSync(join(repo, 'monitoring', 'health-check.ts'), `fetch('/health');\n`, 'utf8');
    writeFileSync(join(repo, 'generated', 'api-types.ts'), generatedContent, 'utf8');
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    const captureDigest = `sha256:${createHash('sha256').update(captureContent).digest('hex')}`;
    const sourceDigest = `sha256:${createHash('sha256').update(producerContent).digest('hex')}`;
    const producerDigest = `sha256:${createHash('sha256').update(`src/health.ts:${sourceDigest}`).digest('hex')}`;
    const generatedDigest = `sha256:${createHash('sha256').update(generatedContent).digest('hex')}`;
    const manifest = {
      schema_version: '1.0.0', contract_digest: digest, generated_at: new Date().toISOString(),
      operations: [{
        method: 'GET', path: '/health', variants: [{
          id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
          capture: { path: 'tests/contract/samples/health.json', source: 'framework-test-client', digest: captureDigest, producer_digest: producerDigest },
        }],
        consumers: ['monitoring/health-check.ts'], source_files: ['src/health.ts'],
        generated_artifacts: [{ path: 'generated/api-types.ts', digest: generatedDigest }],
        discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] },
      }],
    };
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump(manifest), 'utf8');
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.status).toBe('passed');
    expect(result.coverage_non_vacuous).toBe(true);

    const extraFieldCapture = '{"ok":true,"undeclared":1}\n';
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), extraFieldCapture, 'utf8');
    manifest.operations[0].variants[0].capture.digest = `sha256:${createHash('sha256').update(extraFieldCapture).digest('hex')}`;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump(manifest), 'utf8');
    const openShape = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(openShape.status).toBe(1);
    expect(JSON.parse(openShape.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'variant-shape-mismatch' }),
    ]));
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), captureContent, 'utf8');
    manifest.operations[0].variants[0].capture.digest = captureDigest;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump(manifest), 'utf8');

    writeFileSync(join(repo, 'src', 'health.ts'), producerContent + '// implementation changed\n', 'utf8');
    const staleProducer = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(staleProducer.status).toBe(1);
    expect(JSON.parse(staleProducer.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'variant-producer-stale' }),
    ]));

    writeFileSync(join(repo, 'monitoring', 'health-check.ts'), `fetch('/other');\n`, 'utf8');
    const staleConsumer = runCli(['boundary', 'check', '--operation', 'GET /health', '--json'], { cwd: repo, home });
    expect(JSON.parse(staleConsumer.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'consumer-call-mismatch' }),
    ]));
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

  it('scaffolds typed path/query parameters and flags broad response schemas', () => {
    const parameterized = contract.replace('/health', '/health/{tenant}?verbose?=true').replace('Health | - |', 'GenericResponse | - |')
      + `\n### GenericResponse\n\`\`\`json-schema\n{"type":"object","additionalProperties":true}\n\`\`\`\n`;
    writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), parameterized, 'utf8');
    const init = runCli(['boundary', 'init'], { cwd: repo, home });
    expect(init.status, init.stderr).toBe(0);
    const manifest = yaml.load(readFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), 'utf8')) as any;
    expect(manifest.operations[0].parameters).toEqual([
      { name: 'tenant', in: 'path', schema: 'string', required: true },
      { name: 'verbose', in: 'query', schema: 'string', required: true },
    ]);
    const check = runCli(['boundary', 'check', '--operation', 'GET /health/{tenant}', '--json'], { cwd: repo, home });
    expect(JSON.parse(check.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'generic-response-schema', level: 'warning' }),
    ]));
  });

  it('runs a configured capture adapter and binds the sample to current producer sources', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    writeFileSync(join(repo, 'src', 'health.ts'), `router.get('/health', healthHandler);\n`, 'utf8');
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
      schema_version: '1.0.0', contract_digest: digest,
      operations: [{ method: 'GET', path: '/health', variants: [{
        id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
        capture: {
          path: 'tests/contract/samples/health.json', source: 'framework-test-client',
          command: `node -e "require('fs').writeFileSync('tests/contract/samples/health.json','{\\"ok\\":true}\\n')"`,
        },
      }], consumers: [], source_files: ['src/health.ts'], discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] } }],
    }), 'utf8');
    const capture = runCli(['boundary', 'capture', 'GET /health', '--json'], { cwd: repo, home });
    expect(capture.status, capture.stderr).toBe(0);
    const manifest = yaml.load(readFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), 'utf8')) as any;
    expect(manifest.operations[0].variants[0].capture.digest).toMatch(/^sha256:/);
    expect(manifest.operations[0].variants[0].capture.producer_digest).toMatch(/^sha256:/);
    expect(manifest.operations[0].variants[0].capture.produced_at).toBeTruthy();
  });

  it('uses the CI base revision on a clean committed checkout', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    const sourcePath = join(repo, 'src', 'health.ts');
    const captureContent = '{"ok":true}\n';
    writeFileSync(sourcePath, `router.get('/health', healthHandler);\n`, 'utf8');
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), captureContent, 'utf8');
    const contractDigest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    const captureDigest = `sha256:${createHash('sha256').update(captureContent).digest('hex')}`;
    const writeManifest = (source: string) => {
      const sourceDigest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
      const producerDigest = `sha256:${createHash('sha256').update(`src/health.ts:${sourceDigest}`).digest('hex')}`;
      writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
        schema_version: '1.0.0', contract_digest: contractDigest,
        operations: [{ method: 'GET', path: '/health', variants: [{
          id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
          capture: { path: 'tests/contract/samples/health.json', source: 'framework-test-client', digest: captureDigest, producer_digest: producerDigest },
        }], consumers: [], source_files: ['src/health.ts'], discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] } }],
      }), 'utf8');
    };
    writeManifest(`router.get('/health', healthHandler);\n`);
    const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']); git(['add', '.']); git(['commit', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']).stdout.trim();
    const changedSource = `router.get('/health', healthHandler);\n// changed producer\n`;
    writeFileSync(sourcePath, changedSource, 'utf8');
    writeManifest(changedSource);
    git(['add', '.']); git(['commit', '-m', 'change producer']);

    const result = runCli(['boundary', 'check', '--json'], { cwd: repo, home, env: { CI: 'true', CDD_BASE_SHA: base } });
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.changed_files).toContain('src/health.ts');
    expect(json.changed_operations).toContain('GET /health');
  });
});
