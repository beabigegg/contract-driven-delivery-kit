/**
 * Typed reconciler registry (design.md `## Registry Interface`). The plan/
 * apply pass iterates `list()` EXACTLY ONCE (AC-3) -- never four ad-hoc
 * bucket-3 code paths. Empty in this change: the four concrete reconcilers
 * (`policy-keys`, `gate-rule-map`, `behavior-report`, `learnings-region`) are
 * separate, out-of-scope sub-changes that will call `register()` when they
 * land (design.md `## Surface -> Bucket Taxonomy`).
 */
import type { Reconciler } from '../schemas/reconciliation.schema.js';

export class ReconcileRegistry {
  private reconcilers: Reconciler[] = [];

  register(reconciler: Reconciler): void {
    if (this.reconcilers.some(r => r.surface === reconciler.surface)) {
      throw new Error(`reconciler already registered for surface "${reconciler.surface}"`);
    }
    this.reconcilers.push(reconciler);
  }

  list(): readonly Reconciler[] {
    return this.reconcilers.slice();
  }
}

/** Process-wide default registry -- `reconcile.ts`'s plan/apply pass calls
 *  `list()` on this exactly once per invocation. */
export const defaultRegistry = new ReconcileRegistry();
