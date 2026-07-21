import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { spawnSync } from 'child_process';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';
import { captureTargetDigest } from '../../src/boundary/adapters.js';

let repo: string;
let home: string;

const hash = (content: string) => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
function registeredCapture(contractDigest: string, producerDigest: string, body: unknown, commit = 'deadbee') {
  const variant: any = {
    id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
    capture: { path: 'tests/contract/samples/health.json', adapter: 'flask-test-client', target: 'app:app' },
  };
  variant.capture.provenance = {
    adapter_version: '1.0.0', runner_version: '3.1.2', target_digest: captureTargetDigest({ method: 'GET', path: '/health' }, variant),
    contract_digest: contractDigest, producer_digest: producerDigest, capture_digest: hash(stable(body)), commit, produced_at: new Date().toISOString(),
  };
  return variant.capture;
}

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
    // --enforce: this test is about defect DETECTION (fail-closed logic), not
    // about shadow-mode enforcement semantics (covered separately by AC-1..AC-3
    // below); the fixture policy defaults to shadow_mode: true, under which
    // `boundary check` now correctly exits 0 on an unenforced error finding.
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--enforce', '--json'], { cwd: repo, home });
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
    // --enforce: isolates defect detection from shadow-mode enforcement (see note above).
    const check = runCli(['boundary', 'check', '--operation', 'GET /health', '--enforce', '--json'], { cwd: repo, home });
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
    writeFileSync(join(repo, 'monitoring', 'health-check.ts'), `import type { Health } from '../generated/api-types';\nfetch('/health');\n`, 'utf8');
    writeFileSync(join(repo, 'generated', 'api-types.ts'), generatedContent, 'utf8');
    writeFileSync(join(repo, 'contracts', 'api', 'openapi.json'), '{}\n', 'utf8');
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    const sourceDigest = `sha256:${createHash('sha256').update(producerContent).digest('hex')}`;
    const producerDigest = `sha256:${createHash('sha256').update(`src/health.ts:${sourceDigest}`).digest('hex')}`;
    const generatedDigest = `sha256:${createHash('sha256').update(generatedContent).digest('hex')}`;
    const manifest = {
      schema_version: '1.0.0', contract_digest: digest, generated_at: new Date().toISOString(),
      operations: [{
        method: 'GET', path: '/health', variants: [{
          id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
          capture: registeredCapture(digest, producerDigest, { ok: true }),
        }],
        consumers: ['monitoring/health-check.ts'], source_files: ['src/health.ts'],
        generated_artifacts: [{
          path: 'generated/api-types.ts', digest: generatedDigest, input_contract_digest: digest,
          generator: 'openapi-typescript', generator_version: '7.0.0', input: 'contracts/api/openapi.json',
        }],
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
    manifest.operations[0].variants[0].capture.provenance.capture_digest = hash(stable({ ok: true, undeclared: 1 }));
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump(manifest), 'utf8');
    // --enforce: isolates defect detection from shadow-mode enforcement (see note above).
    const openShape = runCli(['boundary', 'check', '--operation', 'GET /health', '--enforce', '--json'], { cwd: repo, home });
    expect(openShape.status).toBe(1);
    expect(JSON.parse(openShape.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'variant-shape-mismatch' }),
    ]));
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), captureContent, 'utf8');
    manifest.operations[0].variants[0].capture.provenance.capture_digest = hash(stable({ ok: true }));
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump(manifest), 'utf8');

    writeFileSync(join(repo, 'src', 'health.ts'), producerContent + '// implementation changed\n', 'utf8');
    // --enforce: isolates defect detection from shadow-mode enforcement (see note above).
    const staleProducer = runCli(['boundary', 'check', '--operation', 'GET /health', '--enforce', '--json'], { cwd: repo, home });
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

  // Uses a POSIX `#!/bin/sh` npx shim on PATH to stand in for the real generator;
  // the shim and `:`-delimited PATH are not runnable on Windows. Behavior is covered on Linux CI.
  it.skipIf(process.platform === 'win32')('replays a registered generator from the current contract projection', () => {
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'generated'), { recursive: true });
    mkdirSync(join(repo, 'bin'), { recursive: true });
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), '{"ok":true}\n', 'utf8');
    const producer = `router.get('/health', healthHandler);\n`;
    writeFileSync(join(repo, 'src', 'health.ts'), producer, 'utf8');
    writeFileSync(join(repo, 'src', 'consumer.ts'), `import type { Health } from '../generated/api-types';\nfetch('/health');\n`, 'utf8');
    expect(runCli(['openapi', 'export', '--out', 'contracts/api/openapi.json'], { cwd: repo, home }).status).toBe(0);
    const generated = readFileSync(join(repo, 'contracts', 'api', 'openapi.json'));
    writeFileSync(join(repo, 'generated', 'api-types.ts'), generated);
    const fakeNpx = join(repo, 'bin', 'npx');
    writeFileSync(fakeNpx, '#!/bin/sh\nif [ "$3" = "--version" ]; then echo 7.0.0; exit 0; fi\ncp "$3" "$5"\n', 'utf8');
    chmodSync(fakeNpx, 0o755);
    const digest = hash(contract);
    const producerDigest = hash(`src/health.ts:${hash(producer)}`);
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
      schema_version: '1.0.0', contract_digest: digest,
      operations: [{ method: 'GET', path: '/health', variants: [{
        id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
        capture: registeredCapture(digest, producerDigest, { ok: true }),
      }], consumers: ['src/consumer.ts'], source_files: ['src/health.ts'], generated_artifacts: [{
        path: 'generated/api-types.ts', digest: hash(generated), input_contract_digest: digest,
        generator: 'openapi-typescript', generator_version: '7.0.0', input: 'contracts/api/openapi.json',
      }], discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] } }],
    }), 'utf8');
    const checked = runCli(['boundary', 'check', '--operation', 'GET /health', '--verify-generated', '--json'], {
      cwd: repo, home, env: { PATH: `${join(repo, 'bin')}:${process.env.PATH}` },
    });
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  });

  it('catches a real response-shape mutation instead of accepting an existing capture file', () => {
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), '{"healthy":"yes"}\n', 'utf8');
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
      schema_version: '1.0.0', contract_digest: digest,
      operations: [{ method: 'GET', path: '/health', variants: [{
        id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
        capture: registeredCapture(digest, hash('missing-producer'), { healthy: 'yes' }),
      }], consumers: ['monitor'], source_files: ['src/health.ts'], discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] } }],
    }), 'utf8');
    // --enforce: isolates defect detection from shadow-mode enforcement (see note above).
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--enforce', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'variant-shape-mismatch' })]));
  });

  it('rejects capture paths that escape the repository boundary', () => {
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
      schema_version: '1.0.0', contract_digest: digest,
      operations: [{ method: 'GET', path: '/health', variants: [{
        id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
        capture: { path: '../../private.json', adapter: 'flask-test-client', target: 'app:app' },
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
    if (spawnSync('python', ['-c', 'import flask'], { stdio: 'ignore' }).status !== 0) return;
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    writeFileSync(join(repo, 'app.py'), `from flask import Flask, jsonify\napp = Flask(__name__)\n@app.get('/health')\ndef health(): return jsonify(ok=True)\n`, 'utf8');
    const digest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
      schema_version: '1.0.0', contract_digest: digest,
      operations: [{ method: 'GET', path: '/health', variants: [{
        id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
        capture: {
          path: 'tests/contract/samples/health.json', adapter: 'flask-test-client', target: 'app:app',
        },
      }], consumers: [], source_files: ['app.py'], discovery: { adapter: 'flask-test-client', completeness: 'complete', unknown_reasons: [] } }],
    }), 'utf8');
    const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']); git(['add', '.']); git(['commit', '-m', 'producer']);
    const capture = runCli(['boundary', 'capture', 'GET /health', '--json'], { cwd: repo, home });
    expect(capture.status, capture.stderr).toBe(0);
    const manifest = yaml.load(readFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), 'utf8')) as any;
    expect(manifest.operations[0].variants[0].capture.provenance.capture_digest).toMatch(/^sha256:/);
    expect(manifest.operations[0].variants[0].capture.provenance.producer_digest).toMatch(/^sha256:/);
    expect(manifest.operations[0].variants[0].capture.provenance.produced_at).toBeTruthy();
    const replay = runCli(['boundary', 'capture', 'GET /health', '--verify', '--json'], { cwd: repo, home });
    expect(replay.status, replay.stderr).toBe(0);
    const guardReplay = runCli(['boundary', 'check', '--operation', 'GET /health', '--verify-captures', '--json'], { cwd: repo, home });
    expect(guardReplay.status, guardReplay.stderr).toBe(0);
    writeFileSync(join(repo, 'app.py'), `from flask import Flask, jsonify\napp = Flask(__name__)\n@app.get('/health')\ndef health(): return jsonify(ok=False)\n`, 'utf8');
    // --enforce: isolates defect detection from shadow-mode enforcement (see note above).
    const forged = runCli(['boundary', 'check', '--operation', 'GET /health', '--verify-captures', '--enforce', '--json'], { cwd: repo, home });
    expect(forged.status).toBe(1);
    expect(JSON.parse(forged.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'variant-capture-replay-failed' }),
    ]));
  });

  it('uses the CI base revision on a clean committed checkout', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
    const sourcePath = join(repo, 'src', 'health.ts');
    const captureContent = '{"ok":true}\n';
    writeFileSync(sourcePath, `router.get('/health', healthHandler);\n`, 'utf8');
    writeFileSync(join(repo, 'tests', 'contract', 'samples', 'health.json'), captureContent, 'utf8');
    const contractDigest = `sha256:${createHash('sha256').update(contract).digest('hex')}`;
    const writeManifest = (source: string, commit: string) => {
      const sourceDigest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
      const producerDigest = `sha256:${createHash('sha256').update(`src/health.ts:${sourceDigest}`).digest('hex')}`;
      writeFileSync(join(repo, '.cdd', 'boundary-manifest.yml'), yaml.dump({
        schema_version: '1.0.0', contract_digest: contractDigest,
        operations: [{ method: 'GET', path: '/health', variants: [{
          id: 'healthy-200', status: 200, content_type: 'application/json', schema: 'Health', required: true,
          capture: registeredCapture(contractDigest, producerDigest, { ok: true }, commit),
        }], consumers: [], source_files: ['src/health.ts'], discovery: { adapter: 'test', completeness: 'complete', unknown_reasons: [] } }],
      }), 'utf8');
    };
    const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']); git(['add', '.']); git(['commit', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']).stdout.trim();
    const changedSource = `router.get('/health', healthHandler);\n// changed producer\n`;
    writeFileSync(sourcePath, changedSource, 'utf8');
    git(['add', 'src/health.ts']); git(['commit', '-m', 'change producer']);
    const producerCommit = git(['rev-parse', 'HEAD']).stdout.trim();
    writeManifest(changedSource, producerCommit);
    git(['add', '.cdd/boundary-manifest.yml']); git(['commit', '-m', 'record boundary provenance']);

    const result = runCli(['boundary', 'check', '--json'], { cwd: repo, home, env: { CI: 'true', CDD_BASE_SHA: base } });
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.changed_files).toContain('src/health.ts');
    expect(json.changed_operations).toContain('GET /health');
  });

  // ── boundary-ci-adopter-parity: AC-1..AC-4 (contracts/ci/ci-gate-contract.md
  // `## Boundary Guard Enforcement Semantics`) ────────────────────────────────

  it('AC-1: shadow_mode:true (default) prints an error finding as advisory [shadow] and exits 0', () => {
    // No .cdd/boundary-manifest.yml is written, so the explicitly-selected
    // "GET /health" operation deterministically produces exactly one
    // error-level 'operation-manifest-missing' finding (same fixture as the
    // very first test in this file).
    const r = runCli(['boundary', 'check', '--operation', 'GET /health'], { cwd: repo, home });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('Boundary Guard [shadow]: GET /health: Changed operation has no Boundary Guard manifest entry.');
    // The stream matters, not only the exit code (CLAUDE.md "vacuous tests"
    // lesson): a shadow finding must not silently disappear onto stderr as a
    // blocking error.
    expect(r.stderr).not.toContain('Changed operation has no Boundary Guard manifest entry.');
  });

  it('AC-2: boundary check --enforce overrides shadow_mode and exits 1 on the same finding', () => {
    const r = runCli(['boundary', 'check', '--operation', 'GET /health', '--enforce'], { cwd: repo, home });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain('Boundary Guard: GET /health: Changed operation has no Boundary Guard manifest entry.');
    // A finding --enforce makes blocking must not still read as advisory.
    expect(r.stderr).not.toContain('[shadow]');
  });

  it('AC-3: boundary check and gate derive the identical shadow/enforce decision for the same finding', () => {
    // Both callers select "GET /health" the same way here: neither passes
    // --operation/--base, so both derive it from `git status` reporting the
    // untracked contract file as changed (no manifest entry exists for it).
    spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
    const changeId = 'ac3-boundary-parity';
    mkdirSync(join(repo, 'specs', 'changes', changeId), { recursive: true });
    const expectedMessage = 'Boundary Guard [shadow]: GET /health: Changed operation has no Boundary Guard manifest entry.';

    const shadowCheck = runCli(['boundary', 'check'], { cwd: repo, home });
    const shadowGate = runCli(['gate', changeId], { cwd: repo, home });
    expect(shadowCheck.status, `stdout: ${shadowCheck.stdout}\nstderr: ${shadowCheck.stderr}`).toBe(0);
    expect(shadowCheck.stdout).toContain(expectedMessage);
    expect(shadowGate.stdout).toContain(expectedMessage);

    writeFileSync(join(repo, '.cdd', 'policy.yml'), policy.replace('shadow_mode: true', 'shadow_mode: false'), 'utf8');
    const blockingMessage = 'Boundary Guard: GET /health: Changed operation has no Boundary Guard manifest entry.';

    const enforcedCheck = runCli(['boundary', 'check'], { cwd: repo, home });
    const enforcedGate = runCli(['gate', changeId], { cwd: repo, home });
    expect(enforcedCheck.status, `stdout: ${enforcedCheck.stdout}\nstderr: ${enforcedCheck.stderr}`).toBe(1);
    expect(enforcedCheck.stderr).toContain(blockingMessage);
    expect(enforcedCheck.stderr).not.toContain('[shadow]');
    expect(enforcedGate.stderr).toContain(blockingMessage);
    expect(enforcedGate.stderr).not.toContain('[shadow]');
  });

  it('AC-4: a CDD_BASE_SHA-only run selects only the actually-changed contract operations', () => {
    const contractV1 = `---
contract: api
schema-version: 1.0.0
---
# API Contract
## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /health | public | - | Health | - | test/health.test.ts |
| GET | /status | public | - | Health | - | test/status.test.ts |
| GET | /version | public | - | Health | - | test/version.test.ts |

## Schemas
### Health
| field | type | required | format | notes |
|---|---|---|---|---|
| ok | boolean | yes | | health state |
`;
    // Only the "GET /status" row actually changes (its errors column).
    const contractV2 = contractV1.replace(
      '| GET | /status | public | - | Health | - | test/status.test.ts |',
      '| GET | /status | public | - | Health | 500 | test/status.test.ts |',
    );
    writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), contractV1, 'utf8');
    const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']);
    git(['add', '.']); git(['commit', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']).stdout.trim();
    writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), contractV2, 'utf8');
    git(['add', '.']); git(['commit', '-m', 'change status errors column']);

    // Only CDD_BASE_SHA is set (no --base flag).
    const result = runCli(['boundary', 'check', '--json'], { cwd: repo, home, env: { CI: 'true', CDD_BASE_SHA: base } });
    const json = JSON.parse(result.stdout);
    expect(json.changed_files, result.stdout).toContain('contracts/api/api-contract.md');
    expect(json.changed_operations).toEqual(['GET /status']);
  });
});
