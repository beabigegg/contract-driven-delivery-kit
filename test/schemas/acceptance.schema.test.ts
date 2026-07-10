import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { acceptanceSchema, acceptanceLockSchema } from '../../src/schemas/acceptance.schema.js';

const root = process.cwd();
const TEMPLATE_PATH = join(root, 'specs', 'templates', 'acceptance.yml');

// Validate under the same Ajv configuration the gate uses (gate-shared.ts) so
// this unit test exercises the schema under the rules `enforceAcceptanceOracle`
// (src/commands/gate-acceptance.ts) will apply.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(acceptanceSchema);

function validOracle(): Record<string, unknown> {
  return {
    'oracle-version': '0.1.0',
    'authored-by': 'human',
    cases: [
      {
        id: 'over-limit-order-rejected',
        given: 'a customer whose credit limit is 1000',
        when: 'they submit an order for 1500',
        then: "the order is rejected with reason 'credit-limit-exceeded'",
        input: { customer_limit: 1000, order_amount: 1500 },
        expect: { status: 'rejected', reason: 'credit-limit-exceeded' },
      },
    ],
    rules: [
      { id: 'refund-never-exceeds-payment', statement: 'a refund amount can never exceed the original payment' },
    ],
  };
}

describe('acceptance.schema', () => {
  it('accepts a well-formed oracle with oracle-version/authored-by/cases/rules', () => {
    expect(validate(validOracle()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts a well-formed oracle with no rules (rules is optional)', () => {
    const doc = validOracle();
    delete (doc as { rules?: unknown }).rules;
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects a missing oracle-version', () => {
    const doc = validOracle();
    delete doc['oracle-version'];
    expect(validate(doc)).toBe(false);
  });

  it('rejects a missing authored-by', () => {
    const doc = validOracle();
    delete doc['authored-by'];
    expect(validate(doc)).toBe(false);
  });

  it('rejects a missing cases array', () => {
    const doc = validOracle();
    delete doc['cases'];
    expect(validate(doc)).toBe(false);
  });

  it('rejects an empty cases array (minItems)', () => {
    const doc = validOracle();
    doc['cases'] = [];
    expect(validate(doc)).toBe(false);
  });

  it.each(['id', 'given', 'when', 'then', 'input', 'expect'])('rejects a case missing its required `%s`', (field) => {
    const doc = validOracle();
    delete (doc['cases'] as Record<string, unknown>[])[0][field];
    expect(validate(doc), `missing case.${field} should fail`).toBe(false);
  });

  it.each(['id', 'statement'])('rejects a rule missing its required `%s`', (field) => {
    const doc = validOracle();
    delete (doc['rules'] as Record<string, unknown>[])[0][field];
    expect(validate(doc), `missing rule.${field} should fail`).toBe(false);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const doc = validOracle();
    doc['totally-unknown'] = true;
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown field on a case (additionalProperties: false)', () => {
    const doc = validOracle();
    (doc['cases'] as Record<string, unknown>[])[0]['bogus'] = true;
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown field on a rule (additionalProperties: false)', () => {
    const doc = validOracle();
    (doc['rules'] as Record<string, unknown>[])[0]['bogus'] = true;
    expect(validate(doc)).toBe(false);
  });

  it('rejects a malformed oracle-version', () => {
    const doc = validOracle();
    doc['oracle-version'] = 'not-a-version';
    expect(validate(doc)).toBe(false);
  });

  it('accepts non-string input/expect values (objects, arrays, scalars)', () => {
    const doc = validOracle();
    (doc['cases'] as Record<string, unknown>[])[0]['input'] = [1, 2, 3];
    (doc['cases'] as Record<string, unknown>[])[0]['expect'] = 42;
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('shipped specs/templates/acceptance.yml validates against the schema (IP-10)', () => {
    const data = yaml.load(readFileSync(TEMPLATE_PATH, 'utf8'));
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });
});

// `.cdd/acceptance-lock.json` SIDECAR shape -- parity with design-lock.schema
// (contract's "Tamper evidence" names BOTH lock sidecars). Mirrors
// test/schemas/design-lock.schema.test.ts. The provenance fields are CLUES only;
// the schema fixes their shape and asserts nothing about authenticity.
describe('acceptance-lock.schema', () => {
  const validateLock = ajv.compile(acceptanceLockSchema);
  const LOCK_HASH = 'a'.repeat(64);

  it('accepts an empty lock file (no changes recorded yet)', () => {
    expect(validateLock({}), JSON.stringify(validateLock.errors)).toBe(true);
  });

  it('accepts a well-formed entry with hash + locked-at', () => {
    const doc = { 'my-change': { hash: LOCK_HASH, 'locked-at': '2026-07-09T00:00:00.000Z' } };
    expect(validateLock(doc), JSON.stringify(validateLock.errors)).toBe(true);
  });

  it('accepts an entry carrying the provenance clue fields (git-author/tty/timestamp)', () => {
    const doc = {
      'my-change': {
        hash: LOCK_HASH,
        'locked-at': '2026-07-09T00:00:00.000Z',
        'git-author': 'Test Author <test@example.com>',
        tty: true,
        timestamp: '2026-07-09T00:00:00.000Z',
      },
    };
    expect(validateLock(doc), JSON.stringify(validateLock.errors)).toBe(true);
  });

  it('accepts an entry with NO provenance fields (absent evidence is not failed evidence)', () => {
    expect(validateLock({ 'my-change': { hash: LOCK_HASH } }), JSON.stringify(validateLock.errors)).toBe(true);
  });

  it('rejects an entry missing hash', () => {
    expect(validateLock({ 'my-change': { 'locked-at': '2026-07-09T00:00:00.000Z' } })).toBe(false);
  });

  it('rejects a malformed hash', () => {
    expect(validateLock({ 'my-change': { hash: 'not-a-hash' } })).toBe(false);
  });

  it('rejects a non-boolean tty (the clue is typed, though never verified)', () => {
    expect(validateLock({ 'my-change': { hash: LOCK_HASH, tty: 'yes' } })).toBe(false);
  });

  it('rejects an unknown field on an entry (additionalProperties: false)', () => {
    expect(validateLock({ 'my-change': { hash: LOCK_HASH, bogus: true } })).toBe(false);
  });

  it('rejects a top-level array', () => {
    expect(validateLock([])).toBe(false);
  });
});
