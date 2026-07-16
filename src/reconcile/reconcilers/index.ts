/**
 * The bucket-3 reconcilers this kit version ships, registered against the
 * shared registry (contract `## Bucket 2 / Bucket 3`: a typed reconciler, never
 * an ad-hoc code path). Each writes ONLY through the `GuardedWrite` capability
 * it is handed.
 *
 * `gate-rule-map` is deliberately ABSENT. Its job is a versioned rename/remove
 * map for gate rules, and this kit has never renamed or removed one: the map
 * would ship empty, `detectNeedsReconcile` would always return false, and the
 * registry would advertise a migration that cannot run. An empty reconciler is
 * not a cheap placeholder -- it is a guarantee that does nothing, which is the
 * failure this whole framework exists to prevent. It lands with the first real
 * rename, and `KIT_SURFACES` still carries its slot so the gap is visible in
 * `reconcile --plan` rather than forgotten.
 */
import { defaultRegistry } from '../registry.js';
import { policyKeysReconciler } from './policy-keys.js';
import { behaviorReportReconciler } from './behavior-report.js';
import { learningsRegionReconciler } from './learnings-region.js';

export const SHIPPED_RECONCILERS = [
  policyKeysReconciler,
  behaviorReportReconciler,
  learningsRegionReconciler,
];

let registered = false;

/** Idempotent: `register()` throws on a duplicate surface, and both `reconcile`
 *  and the tests may call this more than once per process. */
export function registerShippedReconcilers(): void {
  if (registered) return;
  for (const r of SHIPPED_RECONCILERS) defaultRegistry.register(r);
  registered = true;
}

export { policyKeysReconciler, behaviorReportReconciler, learningsRegionReconciler };
