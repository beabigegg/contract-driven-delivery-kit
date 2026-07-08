/**
 * Unit tests for the parallel-change core (ADR 0009): semver, lane allocation,
 * and contention analysis. These exercise the pure functions directly.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSemver,
  compareSemver,
  bumpSemver,
  nextFreeVersion,
  analyzeContention,
  type ReservationsFile,
} from '../../src/commands/parallel-shared.js';

describe('semver helpers', () => {
  it('parses valid and rejects invalid', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver(' 0.0.0 ')).toEqual([0, 0, 0]);
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
  });

  it('compares correctly', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('1.3.0', '1.2.9')).toBe(1);
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
  });

  it('bumps by kind', () => {
    expect(bumpSemver('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
  });
});

describe('nextFreeVersion', () => {
  const ledger = (reservations: ReservationsFile['reservations']): ReservationsFile => ({ version: 1, reservations });

  it('bumps from current when no reservations exist', () => {
    expect(nextFreeVersion('api', '1.2.0', 'minor', ledger([]))).toBe('1.3.0');
  });

  it('bumps from the highest reserved lane so concurrent reservations are distinct', () => {
    const l = ledger([
      { 'change-id': 'a', contracts: { api: { from: '1.2.0', to: '1.3.0' } } },
    ]);
    // second reservation must not collide with 1.3.0
    expect(nextFreeVersion('api', '1.2.0', 'minor', l)).toBe('1.4.0');
  });

  it('is idempotent for the same change (excludes its own lane)', () => {
    const l = ledger([
      { 'change-id': 'a', contracts: { api: { from: '1.2.0', to: '1.3.0' } } },
    ]);
    expect(nextFreeVersion('api', '1.2.0', 'minor', l, 'a')).toBe('1.3.0');
  });

  it('ignores lanes for other contracts', () => {
    const l = ledger([
      { 'change-id': 'a', contracts: { css: { from: '5.0.0', to: '6.0.0' } } },
    ]);
    expect(nextFreeVersion('api', '1.2.0', 'patch', l)).toBe('1.2.1');
  });
});

describe('analyzeContention', () => {
  it('reports no collisions and a monotonic merge order for disjoint lanes', () => {
    const r = analyzeContention({
      version: 1,
      reservations: [
        { 'change-id': 'b', contracts: { api: { from: '1.2.0', to: '1.4.0', surfaces: ['endpoints/login'] } } },
        { 'change-id': 'a', contracts: { api: { from: '1.2.0', to: '1.3.0', surfaces: ['endpoints/export'] } } },
      ],
    });
    expect(r.safe).toBe(true);
    expect(r.surfaceCollisions).toEqual([]);
    expect(r.versionCollisions).toEqual([]);
    // lowest reserved version first
    expect(r.mergeOrder).toEqual(['a', 'b']);
  });

  it('detects a surface collision and marks unsafe', () => {
    const r = analyzeContention({
      version: 1,
      reservations: [
        { 'change-id': 'a', contracts: { business: { from: '0.1.0', to: '0.2.0', surfaces: ['rule/refund'] } } },
        { 'change-id': 'b', contracts: { business: { from: '0.1.0', to: '0.3.0', surfaces: ['rule/refund', 'rule/tax'] } } },
      ],
    });
    expect(r.safe).toBe(false);
    expect(r.surfaceCollisions).toHaveLength(1);
    expect(r.surfaceCollisions[0].contract).toBe('business');
    expect(r.surfaceCollisions[0].detail).toContain('rule/refund');
  });

  it('detects a version-lane collision from a bad manual edit', () => {
    const r = analyzeContention({
      version: 1,
      reservations: [
        { 'change-id': 'a', contracts: { api: { from: '1.2.0', to: '1.3.0' } } },
        { 'change-id': 'b', contracts: { api: { from: '1.2.0', to: '1.3.0' } } },
      ],
    });
    expect(r.versionCollisions).toHaveLength(1);
    expect(r.versionCollisions[0].detail).toContain('1.3.0');
  });

  it('orders by max reserved version across contracts, tie-broken by change-id', () => {
    const r = analyzeContention({
      version: 1,
      reservations: [
        { 'change-id': 'z', contracts: { api: { from: '1.0.0', to: '1.1.0' } } },
        { 'change-id': 'y', contracts: { api: { from: '1.0.0', to: '1.1.0' } } },
        { 'change-id': 'x', contracts: { css: { from: '1.0.0', to: '2.0.0' } } },
      ],
    });
    // z and y share max 1.1.0 → alpha; x has 2.0.0 → last
    expect(r.mergeOrder).toEqual(['y', 'z', 'x']);
  });
});
