import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  computeAcceptanceHash,
  readAcceptanceLock,
  writeAcceptanceLock,
  type AcceptanceFile,
} from '../../src/utils/acceptance-hash.js';
import { makeTempDir, cleanupDir } from '../helpers.js';

function baseOracle(): AcceptanceFile {
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
      {
        id: 'under-limit-order-accepted',
        given: 'a customer whose credit limit is 1000',
        when: 'they submit an order for 500',
        then: 'the order is accepted',
        input: { customer_limit: 1000, order_amount: 500 },
        expect: { status: 'accepted' },
      },
    ],
    rules: [
      { id: 'refund-never-exceeds-payment', statement: 'a refund amount can never exceed the original payment' },
    ],
  };
}

describe('acceptance-hash: computeAcceptanceHash', () => {
  it('is stable across cases/rules key order (recursive key sort)', () => {
    const a = baseOracle();
    const b: AcceptanceFile = {
      // Same content, different key order at every level.
      cases: [
        {
          expect: { reason: 'credit-limit-exceeded', status: 'rejected' },
          input: { order_amount: 1500, customer_limit: 1000 },
          then: "the order is rejected with reason 'credit-limit-exceeded'",
          when: 'they submit an order for 1500',
          given: 'a customer whose credit limit is 1000',
          id: 'over-limit-order-rejected',
        },
        {
          id: 'under-limit-order-accepted',
          given: 'a customer whose credit limit is 1000',
          when: 'they submit an order for 500',
          then: 'the order is accepted',
          input: { order_amount: 500, customer_limit: 1000 },
          expect: { status: 'accepted' },
        },
      ],
      rules: [{ statement: 'a refund amount can never exceed the original payment', id: 'refund-never-exceeds-payment' }],
      'authored-by': 'human',
      'oracle-version': '0.1.0',
    };
    expect(computeAcceptanceHash(a)).toBe(computeAcceptanceHash(b));
  });

  it('is stable when cases/rules array order changes (sorted by id)', () => {
    const a = baseOracle();
    const b = baseOracle();
    b.cases = [...(b.cases ?? [])].reverse();
    expect(computeAcceptanceHash(a)).toBe(computeAcceptanceHash(b));
  });

  it('is unchanged when given/when/then is reworded', () => {
    const a = baseOracle();
    const b = baseOracle();
    (b.cases ?? [])[0].given = 'a totally reworded narrative sentence';
    (b.cases ?? [])[0].then = 'a differently phrased outcome';
    expect(computeAcceptanceHash(a)).toBe(computeAcceptanceHash(b));
  });

  it('is unchanged when oracle-version or authored-by changes', () => {
    const a = baseOracle();
    const b = baseOracle();
    b['oracle-version'] = '0.2.0';
    b['authored-by'] = 'someone-else';
    expect(computeAcceptanceHash(a)).toBe(computeAcceptanceHash(b));
  });

  it('diverges when a case input changes', () => {
    const a = baseOracle();
    const b = baseOracle();
    (b.cases ?? [])[0].input = { customer_limit: 1000, order_amount: 9999 };
    expect(computeAcceptanceHash(a)).not.toBe(computeAcceptanceHash(b));
  });

  it('diverges when a case expect changes', () => {
    const a = baseOracle();
    const b = baseOracle();
    (b.cases ?? [])[0].expect = { status: 'accepted' };
    expect(computeAcceptanceHash(a)).not.toBe(computeAcceptanceHash(b));
  });

  it('diverges when a case id changes', () => {
    const a = baseOracle();
    const b = baseOracle();
    (b.cases ?? [])[0].id = 'renamed-case-id';
    expect(computeAcceptanceHash(a)).not.toBe(computeAcceptanceHash(b));
  });

  it('diverges when a rule id changes', () => {
    const a = baseOracle();
    const b = baseOracle();
    (b.rules ?? [])[0].id = 'renamed-rule-id';
    expect(computeAcceptanceHash(a)).not.toBe(computeAcceptanceHash(b));
  });

  it('diverges when a rule statement changes', () => {
    const a = baseOracle();
    const b = baseOracle();
    (b.rules ?? [])[0].statement = 'a completely different invariant statement';
    expect(computeAcceptanceHash(a)).not.toBe(computeAcceptanceHash(b));
  });
});

describe('acceptance-hash: .cdd/acceptance-lock.json baseline', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-acceptance-lock-');
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
  });

  it('readAcceptanceLock returns {} when the sidecar does not exist', () => {
    expect(readAcceptanceLock(tmpRepo)).toEqual({});
  });

  it('writeAcceptanceLock then readAcceptanceLock round-trips the baseline hash', () => {
    const hash = computeAcceptanceHash(baseOracle());
    writeAcceptanceLock(tmpRepo, 'my-change', hash);
    const lock = readAcceptanceLock(tmpRepo);
    expect(lock['my-change']?.hash).toBe(hash);
  });

  it('writeAcceptanceLock merges into an existing sidecar (does not clobber other change-ids)', () => {
    writeAcceptanceLock(tmpRepo, 'change-a', 'hash-a');
    writeAcceptanceLock(tmpRepo, 'change-b', 'hash-b');
    const lock = readAcceptanceLock(tmpRepo);
    expect(lock['change-a']?.hash).toBe('hash-a');
    expect(lock['change-b']?.hash).toBe('hash-b');
  });

  it('the sidecar is written under .cdd/acceptance-lock.json', () => {
    writeAcceptanceLock(tmpRepo, 'my-change', 'deadbeef');
    expect(existsSync(join(tmpRepo, '.cdd', 'acceptance-lock.json'))).toBe(true);
    const raw = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'acceptance-lock.json'), 'utf8'));
    expect(raw['my-change'].hash).toBe('deadbeef');
  });

  it('readAcceptanceLock returns {} for malformed JSON (does not throw)', () => {
    writeFileSync(join(tmpRepo, '.cdd', 'acceptance-lock.json'), 'not json{', 'utf8');
    expect(readAcceptanceLock(tmpRepo)).toEqual({});
  });
});
