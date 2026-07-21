/**
 * Bucket-3 reconciler: `.cdd/policy.yml` new-key migration.
 *
 * The problem it exists for (#63, #65): a kit upgrade adds a policy key, the
 * adopter's `.cdd/policy.yml` predates it, and because `cdd-policy.schema.ts`
 * is `additionalProperties: false` with a `required` list, "just upgrade" can
 * leave an adopter's policy failing validation -- or, worse, silently running a
 * new gate at an enforcing default they never chose. Contract
 * `## .cdd/policy.yml is classified PER-KEY` binds the split: an adopter-set key
 * is bucket 1 and is never flipped; a genuinely new key is bucket 3 and arrives
 * with a fail-open safe default (INV-1).
 *
 * The key catalog is DERIVED from `cddPolicySchema`, never hand-maintained here.
 * A second hand-written list would be a second source of truth that drifts the
 * first time someone adds a key to the schema and forgets this file -- exactly
 * the drift class `enforceReconciliationInvariants` exists to prevent. The
 * schema's own `default:` annotation IS the kit author's declaration of the safe
 * value, so a key with no declared default is REPORTED, never guessed at.
 */
import { readAdopterPolicyKeys } from '../classifier.js';
import { cddPolicySchema } from '../../schemas/cdd-policy.schema.js';
import type { GuardedWrite, ReconcileContext, ReconcileResult, Reconciler } from '../../schemas/reconciliation.schema.js';

export interface PolicyKeyCandidate {
  key: string;
  /** the schema-declared safe default; `undefined` when the schema declares none. */
  safeDefault?: unknown;
  hasDeclaredDefault: boolean;
  required: boolean;
}

/**
 * Every top-level policy key this kit version knows about, read straight off the
 * schema. `hasDeclaredDefault: false` means the schema does not say what a safe
 * value is -- such a key is surfaced to the human, never auto-added.
 */
export function policyKeyCatalog(): PolicyKeyCandidate[] {
  const schema = cddPolicySchema as unknown as { properties?: Record<string, unknown>; required?: readonly string[] };
  const props = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  return Object.entries(props).map(([key, spec]) => {
    const hasDeclaredDefault = !!spec && typeof spec === 'object' && 'default' in (spec as object);
    return {
      key,
      hasDeclaredDefault,
      safeDefault: hasDeclaredDefault ? (spec as { default: unknown }).default : undefined,
      required: required.has(key),
    };
  });
}

/**
 * Split the catalog against the adopter's actual file.
 *
 * `keys === null` (file missing, unreadable, or not a mapping) yields an EMPTY
 * addable set, not "every key is new": an undeterminable file state must not be
 * treated as a blank slate to write into (INV-2's never-guess rule, mirroring
 * `classifyPolicyKey(key, 'unknown')`).
 */
export function planPolicyKeys(cwd: string): {
  addable: PolicyKeyCandidate[];
  undeclared: PolicyKeyCandidate[];
  adopterState: 'readable' | 'undeterminable';
} {
  const keys = readAdopterPolicyKeys(cwd);
  if (keys === null) return { addable: [], undeclared: [], adopterState: 'undeterminable' };
  const absent = policyKeyCatalog().filter(c => !keys.has(c.key));
  return {
    addable: absent.filter(c => c.hasDeclaredDefault),
    undeclared: absent.filter(c => !c.hasDeclaredDefault),
    adopterState: 'readable',
  };
}

export const policyKeysReconciler: Reconciler = {
  surface: 'policy-keys',

  detectNeedsReconcile(ctx: ReconcileContext): boolean {
    const { addable, undeclared } = planPolicyKeys(ctx.cwd);
    return addable.length > 0 || undeclared.length > 0;
  },

  planDescription(ctx: ReconcileContext): string {
    const { addable, undeclared, adopterState } = planPolicyKeys(ctx.cwd);
    if (adopterState === 'undeterminable') {
      return '.cdd/policy.yml missing/unreadable/not a mapping -- fail-open to keep; no key will be added (INV-1)';
    }
    const lines: string[] = [];
    if (addable.length > 0) {
      lines.push(`add ${addable.length} new key(s) at their schema-declared safe default: ` +
        addable.map(c => `${c.key}=${JSON.stringify(c.safeDefault)}`).join(', '));
    }
    if (undeclared.length > 0) {
      lines.push(`${undeclared.length} key(s) absent with NO schema-declared default -- reported, not guessed: ` +
        undeclared.map(c => c.key + (c.required ? ' (required)' : '')).join(', '));
    }
    if (lines.length === 0) lines.push('every known policy key is already present -- nothing to reconcile');
    lines.push('adopter-set keys are bucket 1 and are never flipped (INV-2)');
    return lines.join('; ');
  },

  apply(ctx: ReconcileContext, write: GuardedWrite): ReconcileResult {
    const { addable, undeclared, adopterState } = planPolicyKeys(ctx.cwd);
    if (adopterState === 'undeterminable') {
      return { surface: 'policy-keys', applied: false, detail: '.cdd/policy.yml state undeterminable -- fail-open to keep, nothing written (INV-1)' };
    }
    if (addable.length === 0) {
      const note = undeclared.length > 0
        ? `nothing auto-addable; ${undeclared.length} key(s) need a human decision: ${undeclared.map(c => c.key).join(', ')}`
        : 'every known policy key already present';
      return { surface: 'policy-keys', applied: false, detail: note };
    }

    const additions: Record<string, unknown> = {};
    for (const c of addable) additions[c.key] = c.safeDefault;

    // The guard is what makes this safe, not this call site: `addPolicyKeys`
    // adds only genuinely-absent keys and proves from disk that every
    // adopter-set key survived byte-for-byte.
    const result = write.addPolicyKeys(additions);
    const parts = [`added ${result.added.length} new key(s) at their safe default: ${result.added.join(', ')}`];
    if (result.skipped.length > 0) parts.push(`left ${result.skipped.length} adopter-set key(s) untouched: ${result.skipped.join(', ')}`);
    if (undeclared.length > 0) parts.push(`${undeclared.length} key(s) still need a human decision (no schema default): ${undeclared.map(c => c.key).join(', ')}`);
    return { surface: 'policy-keys', applied: result.added.length > 0, detail: parts.join('; ') };
  },
};
