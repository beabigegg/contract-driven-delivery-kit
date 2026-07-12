import { describe, expect, it } from 'vitest';
import { detectRiskSignals, requiredApprovals, selectCapabilitiesAndDoctrine, selectProfile } from '../../src/runtime/router.js';

describe('objective-aware runtime routing', () => {
  it.each([
    ['Add a new API endpoint', 'api-boundary', 'controlled'],
    ['Modify login permissions', 'authorization-policy', 'controlled'],
    ['Add an async Redis queue worker', 'operations-runtime', 'controlled'],
    ['Run a database migration backfill', 'data-migration', 'controlled'],
    ['Destroy production data irreversibly', 'destructive-intent', 'strict'],
  ] as const)('routes a clean tree objective %s', (objective, signalId, expectedProfile) => {
    const signals = detectRiskSignals([], [], objective);
    expect(signals.map(signal => signal.id)).toContain(signalId);
    expect(selectProfile('balanced', signals)).toBe(expectedProfile);
  });

  it('attaches security doctrine and a human approval to authorization intent', () => {
    const signals = detectRiskSignals([], [], 'Modify login permissions');
    expect(requiredApprovals(signals)).toContain('auth_policy');
    const composition = selectCapabilitiesAndDoctrine(signals, selectProfile('balanced', signals));
    expect(composition.doctrine).toContain('security-authorization');
    expect(composition.independentReview).toBe(true);
  });
});
