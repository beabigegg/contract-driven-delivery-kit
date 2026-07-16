/**
 * Types for the reconciliation framework (design.md `## Registry Interface`).
 * `contracts/upgrade/upgrade-reconciliation-contract.md` `## Bucket Taxonomy`
 * is the binding source; these are its TypeScript shapes, not a restatement.
 */

/** `1 keep` (never overwrite) | `2 replace` (force-refresh with backup) |
 *  `3 reconcile` (typed migration, human-reviewable plan). */
export type Bucket = 'keep' | 'replace' | 'reconcile';

export type DispositionAction = 'keep' | 'add' | 'overwrite-with-backup' | 'needs-reconcile';

/**
 * One row of a `reconcile --plan` report: what a surface IS and what would
 * happen to it on `--yes`. Producing one is READ-ONLY -- classification never
 * writes (AC-1).
 */
export interface SurfaceDisposition {
  /** stable identifier for the surface (a `KIT_SURFACES` id, a file path, or
   *  `.cdd/policy.yml#<key>` for a per-key policy disposition). */
  surface: string;
  bucket: Bucket;
  /** the concrete repo-relative path (or container file) this disposition governs. */
  target: string;
  action: DispositionAction;
  /** human-readable justification, printed by `--plan` and used in test assertions. */
  reason: string;
}

export interface ReconcileContext {
  cwd: string;
}

/**
 * The ONLY filesystem-write capability handed to a `Reconciler` (design.md
 * `## Registry Interface`). Every implementation routes through
 * `src/reconcile/guard.ts`'s single bucket-1 chokepoint -- see
 * `enforceReconciliationInvariants` check 2 (no `fs.write*`/`copyFile*`/`rm*`
 * anywhere in `src/reconcile/**` outside `guard.ts`).
 */
export interface GuardedWrite {
  copyFile(src: string, dest: string): void;
  writeFile(dest: string, content: string | Buffer): void;
}

export interface ReconcileResult {
  surface: string;
  applied: boolean;
  detail: string;
}

/**
 * Bucket-3 registry extension point. The four concrete reconcilers
 * (`policy-keys`, `gate-rule-map`, `behavior-report`, `learnings-region`) are
 * OUT OF SCOPE of this change -- it ships only the registry slots they plug
 * into (design.md `## Affected Components`).
 */
export interface Reconciler {
  /** unique surface id -- `ReconcileRegistry.register` rejects a duplicate. */
  surface: string;
  /** READ-ONLY: does this project currently need this reconciler to run? */
  detectNeedsReconcile(ctx: ReconcileContext): boolean;
  /** READ-ONLY: human-readable plan description, printed by `--plan`. */
  planDescription(ctx: ReconcileContext): string;
  /** writes ONLY through the guarded capability -- never `fs` directly. */
  apply(ctx: ReconcileContext, write: GuardedWrite): ReconcileResult;
}
