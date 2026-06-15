/**
 * Tests for the data-shape conformance validator
 * (.claude/skills/contract-driven-delivery/scripts/validate_response_shape.py).
 *
 * This is the body-level net (ADR 0007): it asserts a captured response sample
 * matches the response schema the contract declares for that endpoint — the gap
 * the route-level conformance validator leaves open. Invoked directly here to
 * isolate it from the rest of the contract chain.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '.claude', 'skills', 'contract-driven-delivery', 'scripts', 'validate_response_shape.py',
);

function python(): string {
  for (const cmd of ['python3', 'python']) {
    if (spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0) return cmd;
  }
  return 'python3';
}

/** True when the resolved interpreter can import jsonschema (validation needs it). */
function hasJsonSchema(): boolean {
  return spawnSync(python(), ['-c', 'import jsonschema'], { stdio: 'ignore' }).status === 0;
}

function run(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(python(), [SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A minimal openapi.json with one POST endpoint whose response is a typed schema. */
function writeOpenApi(repo: string, opts: { requireTopReasons?: boolean } = {}): void {
  const required = ['totalLots', 'totalQty', ...(opts.requireTopReasons ? ['topReasons'] : [])];
  const doc = {
    openapi: '3.1.0',
    info: { title: 'API', version: '1.0.0' },
    paths: {
      '/api/summary': {
        post: {
          summary: 'POST /api/summary',
          responses: {
            '201': {
              description: 'Contract response: Summary',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Summary' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Summary: {
          type: 'object',
          required,
          properties: {
            totalLots: { type: 'integer' },
            totalQty: { type: 'integer' },
            topReasons: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  };
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(repo, 'contracts', 'api', 'openapi.json'), JSON.stringify(doc, null, 2));
}

function writeManifest(repo: string, manifest: unknown): void {
  mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
  writeFileSync(join(repo, 'tests', 'contract', 'response-samples.json'), JSON.stringify(manifest, null, 2));
}

function writeSample(repo: string, name: string, body: unknown): void {
  mkdirSync(join(repo, 'tests', 'contract', 'samples'), { recursive: true });
  writeFileSync(join(repo, 'tests', 'contract', 'samples', name), JSON.stringify(body));
}

const py = hasPython();
const js = py && hasJsonSchema();

describe.skipIf(!py)('validate_response_shape.py', () => {
  let repo: string;
  beforeEach(() => { repo = makeTempDir('cdd-rshape-'); });
  afterEach(() => { cleanupDir(repo); });

  it('skips (exit 0) when no sample manifest exists — opt-in by adoption', () => {
    writeOpenApi(repo);
    const { status, out } = run(repo);
    expect(status).toBe(0);
    expect(out).toMatch(/skipped \(no tests\/contract\/response-samples\.json/);
  });

  it('skips when responseShape.enabled is false in conformance config', () => {
    writeOpenApi(repo);
    writeManifest(repo, { 'POST /api/summary': 'samples/s.json' });
    writeSample(repo, 's.json', { totalLots: 1, totalQty: 2, topReasons: [] });
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, '.cdd', 'conformance.json'),
      JSON.stringify({ responseShape: { enabled: false } }));
    const { status, out } = run(repo);
    expect(status).toBe(0);
    expect(out).toMatch(/responseShape\.enabled is false/);
  });

  it('fails (exit 1) when a manifest exists but openapi.json does not', () => {
    writeManifest(repo, { 'POST /api/summary': 'samples/s.json' });
    writeSample(repo, 's.json', { totalLots: 1, totalQty: 2 });
    const { status, out } = run(repo);
    expect(status).toBe(1);
    expect(out).toMatch(/openapi export/);
  });

  it('warns (not error) for an endpoint whose contract response is still prose', () => {
    writeOpenApi(repo);
    writeManifest(repo, { 'GET /api/not-typed': 'samples/s.json' });
    writeSample(repo, 's.json', { anything: true });
    const { status, out } = run(repo);
    expect(status).toBe(0);
    expect(out).toMatch(/no resolved response schema/);
  });

  describe.skipIf(!js)('with jsonschema available', () => {
    it('passes (exit 0) when the sample matches the contract schema', () => {
      writeOpenApi(repo, { requireTopReasons: true });
      writeManifest(repo, { 'POST /api/summary': 'samples/s.json' });
      writeSample(repo, 's.json', { totalLots: 42, totalQty: 1380, topReasons: [{ reason: 'QC' }] });
      const { status, out } = run(repo);
      expect(status).toBe(0);
      expect(out).toMatch(/Response-shape validation passed/);
    });

    it('fails (exit 1) when the sample is missing a required contract field', () => {
      writeOpenApi(repo, { requireTopReasons: true });
      writeManifest(repo, { 'POST /api/summary': 'samples/s.json' });
      writeSample(repo, 's.json', { totalLots: 42, totalQty: 1380 }); // no topReasons
      const { status, out } = run(repo);
      expect(status).toBe(1);
      expect(out).toMatch(/'topReasons' is a required property/);
    });

    it('drills into an envelope via dataPath before validating', () => {
      writeOpenApi(repo, { requireTopReasons: true });
      writeManifest(repo, { 'POST /api/summary': { sample: 'samples/s.json', dataPath: 'data' } });
      writeSample(repo, 's.json', { success: true, data: { totalLots: 1, totalQty: 2 } }); // drift inside data
      const { status, out } = run(repo);
      expect(status).toBe(1);
      expect(out).toMatch(/'topReasons' is a required property/);
    });

    it('downgrades violations to non-blocking when severity=warning', () => {
      writeOpenApi(repo, { requireTopReasons: true });
      writeManifest(repo, { 'POST /api/summary': 'samples/s.json' });
      writeSample(repo, 's.json', { totalLots: 1, totalQty: 2 }); // drift
      mkdirSync(join(repo, '.cdd'), { recursive: true });
      writeFileSync(join(repo, '.cdd', 'conformance.json'),
        JSON.stringify({ responseShape: { severity: 'warning' } }));
      const { status, out } = run(repo);
      expect(status).toBe(0);
      expect(out).toMatch(/severity=warning, not blocking/);
    });
  });
});
