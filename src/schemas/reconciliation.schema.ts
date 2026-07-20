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
  /**
   * The kit version stamped in `.cdd/asset-manifest.json` BEFORE this run
   * refreshed anything, when the caller captured it.
   *
   * `reconcile --yes` applies bucket 2 — which re-stamps that manifest at the
   * CURRENT version — before running bucket-3 reconcilers, so a reconciler that
   * reads the manifest afterwards sees `current` on both sides and reports no
   * delta. For the behaviour-change report the delta IS the report, so the
   * caller captures this once, up front, and passes it down.
   */
  previousKitVersion?: string | null;
}

/**
 * The ONLY filesystem-write capability handed to a `Reconciler` (design.md
 * `## Registry Interface`). Every implementation routes through
 * `src/reconcile/guard.ts`'s single bucket-1 chokepoint -- see
 * `enforceReconciliationInvariants` check 2 (no `fs.write*`/`copyFile*`/`rm*`
 * anywhere in `src/reconcile/**` outside `guard.ts`).
 */
/**
 * Method names here deliberately do NOT mirror the `fs` API (`copyInto`, not
 * `copyFile`). `enforceReconciliationInvariants` check 2 finds a second write
 * site by scanning `src/reconcile/**` for raw `fs` write calls by NAME, and a
 * capability method called `writeFile` is textually indistinguishable from the
 * `fs` primitive it exists to replace -- the scan flagged the guarded call as a
 * violation, and the fix that keeps the scan trustworthy is to remove the
 * collision, not to teach the scan to guess which `writeFile(` is which. A
 * check that cannot be fooled beats a check that is clever.
 */
export interface GuardedWrite {
  copyInto(src: string, dest: string): void;
  writeInto(dest: string, content: string | Buffer): void;
  /**
   * The ONLY way into `.cdd/policy.yml`, a bucket-1 CONTAINER whose contract
   * row protects "user-set key values only". Adds solely the keys absent from
   * the adopter's file and proves, from disk, that every key they had already
   * set survived byte-for-byte. An adopter-set key comes back in `skipped`.
   */
  addPolicyKeys(
    additions: Record<string, unknown>,
    renderKey?: (key: string, value: unknown) => string,
  ): AddPolicyKeysResult;
  /**
   * The ONLY way into a marker-delimited managed region of a bucket-1 file
   * (today: `CLAUDE.md`'s `cdd-kit:learnings` region). Proves, from disk, that
   * every byte outside the markers survived. Reports `replaced: false` rather
   * than throwing when the region is missing or ambiguous -- an unlocatable
   * region is treated as hand-edited and left alone.
   */
  replaceMarkedRegion(
    relFile: string,
    startMarker: string,
    endMarker: string,
    newBody: string,
  ): ReplaceRegionResult;
}

export interface AddPolicyKeysResult {
  added: string[];
  skipped: string[];
}

export interface ReplaceRegionResult {
  replaced: boolean;
  reason: string;
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
