import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { designLockSchema } from '../../src/schemas/design-lock.schema.js';

// Mirrors test/schemas/acceptance.schema.test.ts, but for the `.cdd/design-lock.json`
// SIDECAR shape (a change-id keyed map of hash-lock baselines), not a
// human-authored answer key. See src/schemas/design-lock.schema.ts header.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(designLockSchema);

const HASH = 'a'.repeat(64);

describe('design-lock.schema', () => {
  it('accepts an empty lock file (no changes recorded yet)', () => {
    expect(validate({}), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts a well-formed single-change entry with hash + locked-at', () => {
    const doc = { 'my-change': { hash: HASH, 'locked-at': '2026-07-09T00:00:00.000Z' } };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts an entry with hash only (locked-at optional)', () => {
    const doc = { 'my-change': { hash: HASH } };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts multiple change-id entries', () => {
    const doc = {
      'change-a': { hash: HASH, 'locked-at': '2026-07-09T00:00:00.000Z' },
      'change-b': { hash: 'b'.repeat(64), 'locked-at': '2026-07-09T00:00:00.000Z' },
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an entry missing hash', () => {
    const doc = { 'my-change': { 'locked-at': '2026-07-09T00:00:00.000Z' } };
    expect(validate(doc)).toBe(false);
  });

  it('rejects a malformed (non-hex or wrong-length) hash', () => {
    expect(validate({ 'my-change': { hash: 'not-a-hash' } })).toBe(false);
    expect(validate({ 'my-change': { hash: 'a'.repeat(63) } })).toBe(false);
    expect(validate({ 'my-change': { hash: 'A'.repeat(64) } })).toBe(false); // uppercase hex rejected
  });

  it('rejects an unknown field on an entry (additionalProperties: false)', () => {
    const doc = { 'my-change': { hash: HASH, bogus: true } };
    expect(validate(doc)).toBe(false);
  });

  // Provenance CLUE fields (contracts/ci/ci-gate-contract.md "Tamper evidence,
  // not prevention"). The schema only fixes their SHAPE; it does not -- and must
  // not -- assert anything about who wrote them or whether they are authentic.
  it('accepts an entry carrying the provenance clue fields (git-author/tty/timestamp)', () => {
    const doc = {
      'my-change': {
        hash: HASH,
        'locked-at': '2026-07-09T00:00:00.000Z',
        'git-author': 'Test Author <test@example.com>',
        tty: false,
        timestamp: '2026-07-09T00:00:00.000Z',
      },
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts an entry with NO provenance fields (absent evidence is not failed evidence)', () => {
    const doc = { 'my-change': { hash: HASH, 'locked-at': '2026-07-09T00:00:00.000Z' } };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects a non-boolean tty (the clue is typed, though never verified)', () => {
    expect(validate({ 'my-change': { hash: HASH, tty: 'yes' } })).toBe(false);
  });

  it('rejects a top-level array', () => {
    expect(validate([])).toBe(false);
  });

  it('rejects a non-object entry value', () => {
    expect(validate({ 'my-change': 'not-an-object' })).toBe(false);
  });
});
