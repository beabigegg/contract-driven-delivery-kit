import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { loadTierPolicy, computeTierFloor } from '../utils/tier-floor.js';

export interface ClassifyCheckOptions {
  /** Inline intent text to scan instead of reading a change directory. */
  text?: string;
  json?: boolean;
}

/**
 * Mechanical pre-classification check. Surfaces the deterministic tier floor for
 * a change so the (AI) classifier can be steered *before* it writes
 * change-classification.md, rather than only being caught later by the gate.
 *
 * Usage:
 *   cdd-kit classify-check add-jwt-auth          # scan the change's intent
 *   cdd-kit classify-check --text "add stripe checkout"
 *
 * Exit code is always 0 — this is an advisory probe, not a gate. The blocking
 * enforcement lives in `cdd-kit gate`.
 */
export async function classifyCheck(changeId: string | undefined, opts: ClassifyCheckOptions = {}): Promise<number> {
  const cwd = process.cwd();
  const policy = loadTierPolicy(cwd);

  let intent = opts.text ?? '';
  let source = 'inline --text';

  if (!intent && changeId) {
    // Scan the user's own words (change-request.md) — the same ground-truth
    // source the gate enforces against — so the advisory matches the gate.
    const requestPath = join(cwd, 'specs', 'changes', changeId, 'change-request.md');
    if (existsSync(requestPath)) intent = readFileSync(requestPath, 'utf8');
    source = `specs/changes/${changeId}/change-request.md`;
  }

  const floor = computeTierFloor(intent, policy);

  if (opts.json) {
    console.log(JSON.stringify({
      enabled: policy.enabled,
      source,
      floorTier: floor.floorTier,
      label: floor.label,
      matched: floor.matched,
    }, null, 2));
    return 0;
  }

  if (!policy.enabled) {
    log.info('tier-floor policy is disabled (.cdd/tier-policy.json enabled:false) — no floor enforced.');
    return 0;
  }

  if (!intent) {
    log.warn('no intent text found to scan (pass --text "<description>" or a change-id with change-request.md).');
    return 0;
  }

  if (floor.floorTier === null) {
    log.ok('no sensitive surface matched — classifier may assign any tier on merit.');
    return 0;
  }

  log.warn(`mechanical tier floor: ${floor.floorTier} (or stricter)`);
  log.info(`  reason: ${floor.label}`);
  log.info(`  matched: ${floor.matched.join(', ')}`);
  log.info(`  → change-classification.md must declare tier ${floor.floorTier} or stricter; the gate enforces this.`);
  return 0;
}
