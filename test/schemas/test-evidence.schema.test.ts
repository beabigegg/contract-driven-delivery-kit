import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { testEvidenceSchema } from '../../src/schemas/test-evidence.schema.js';

// Validate under the same Ajv configuration the gate uses (src/commands/gate.ts)
// so this unit test exercises evidence under the rules ADR 0005 gate enforcement
// will apply. Compiling here also proves the schema is Ajv-strict clean before a
// later phase wires it into the gate.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(testEvidenceSchema);

const root = process.cwd();
const TEMPLATES = [
  join(root, 'specs', 'templates', 'test-evidence.yml'),
  join(root, '.claude', 'skills', 'contract-driven-delivery', 'templates', 'test-evidence.yml'),
];

// ADR 0005 §7: these may never appear in evidence.
const WAIVER_FIELDS = [
  'known-failures',
  'pre-existing-failures',
  'allowed-failures',
  'waived-failures',
  'ignored-failures',
];

function validEvidence(): Record<string, unknown> {
  return {
    'change-id': 'add-order-filter',
    'schema-version': '0.1.0',
    'generated-by': 'cdd-kit test run',
    'required-phases': ['collect', 'targeted', 'changed-area', 'contract'],
    runs: [
      {
        phase: 'collect',
        status: 'passed',
        command: 'python -m pytest --collect-only -q tests/orders/test_filter.py',
        summary: 'specs/changes/add-order-filter/test-runs/1/summary.json',
      },
      {
        phase: 'targeted',
        status: 'passed',
        command: 'python -m pytest tests/orders/test_filter.py -q --maxfail=1 --tb=short -ra',
        summary: 'specs/changes/add-order-filter/test-runs/2/summary.json',
        junit: 'specs/changes/add-order-filter/test-runs/2/junit.xml',
      },
    ],
    'final-status': 'passed',
  };
}

describe('test-evidence.schema', () => {
  it('accepts a well-formed evidence object', () => {
    expect(validate(validEvidence()), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(TEMPLATES)('shipped template validates against the schema: %s', (path) => {
    const data = yaml.load(readFileSync(path, 'utf8'));
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(WAIVER_FIELDS)('rejects known-failure waiver field: %s', (field) => {
    const doc = validEvidence();
    doc[field] = ['tests/orders/test_filter.py::test_status_filter_options'];
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const doc = validEvidence();
    doc['totally-unknown'] = true;
    expect(validate(doc)).toBe(false);
  });

  it('requires change-id, schema-version, required-phases, runs, final-status', () => {
    for (const key of ['change-id', 'schema-version', 'required-phases', 'runs', 'final-status']) {
      const doc = validEvidence();
      delete doc[key];
      expect(validate(doc), `missing ${key} should fail`).toBe(false);
    }
  });

  it('accepts the acceptance phase in required-phases and runs (ADR 0010 AC-5 groundwork)', () => {
    const doc = validEvidence();
    (doc['required-phases'] as string[]).push('acceptance');
    (doc.runs as Record<string, unknown>[]).push({
      phase: 'acceptance',
      status: 'passed',
      command: 'python -m pytest tests/acceptance -q',
      summary: 'specs/changes/add-order-filter/test-runs/3/summary.json',
    });
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an unknown phase name', () => {
    const doc = validEvidence();
    (doc['required-phases'] as string[]).push('smoke');
    expect(validate(doc)).toBe(false);
  });

  it('rejects a run missing its required summary pointer', () => {
    const doc = validEvidence();
    delete (doc.runs as Record<string, unknown>[])[0].summary;
    expect(validate(doc)).toBe(false);
  });

  it('rejects a malformed change-id', () => {
    const doc = validEvidence();
    doc['change-id'] = '<change-id>';
    expect(validate(doc)).toBe(false);
  });

  it('rejects evidence with an empty runs array (minItems)', () => {
    const doc = validEvidence();
    doc.runs = [];
    expect(validate(doc)).toBe(false);
  });

  it('rejects a passed final-status when a recorded run failed', () => {
    const doc = validEvidence();
    (doc.runs as Record<string, unknown>[])[1].status = 'failed';
    // final-status stays "passed" -- a green result over a failed run is invalid.
    expect(validate(doc)).toBe(false);
  });

  it('accepts a failed final-status that contains a failed run (negative control)', () => {
    const doc = validEvidence();
    doc['final-status'] = 'failed';
    (doc.runs as Record<string, unknown>[])[0].status = 'failed';
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });
});
