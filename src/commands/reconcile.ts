/**
 * `cdd-kit reconcile [--plan|--yes]` -- thin wrapper over the reconciliation
 * framework (design.md `## Key Decisions`: a dedicated verb, not an overload
 * of `refresh --plan`/`upgrade --plan`).
 *
 * `--plan` is the DEFAULT and is READ-ONLY: it classifies every kit-shipped
 * surface (`KIT_SURFACES`) and prints one disposition line per surface
 * without writing anything (AC-1).
 *
 * `--yes` applies:
 *   - bucket 1 (keep) is never touched.
 *   - bucket 2 (replace) delegates to the EXISTING `refresh()` command's
 *     templates-only apply, which IP-7 already routes through the guard with
 *     its existing backup-before-overwrite -- reuse-first, no duplicated
 *     write path (AC-2/AC-4).
 *   - bucket 3 (reconcile) applies every registered reconciler through
 *     `guard.makeGuardedWrite()`. This framework ships an EMPTY registry: the
 *     four concrete reconcilers (`policy-keys`, `gate-rule-map`,
 *     `behavior-report`, `learnings-region`) are separate, out-of-scope
 *     sub-changes (design.md `## Affected Components`).
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { KIT_SURFACES } from '../reconcile/classifier.js';
import { defaultRegistry } from '../reconcile/registry.js';
import { makeGuardedWrite } from '../reconcile/guard.js';
import { refresh } from './refresh.js';
import type { Bucket } from '../schemas/reconciliation.schema.js';

export interface ReconcileOptions {
  yes?: boolean;
}

function countExisting(cwd: string, roots: string[]): number {
  let count = 0;
  for (const root of roots) {
    if (root.startsWith('~/')) continue; // home-relative roots are not counted against cwd
    if (existsSync(join(cwd, root))) count += 1;
  }
  return count;
}

function bucketLabel(bucket: Bucket): string {
  if (bucket === 'keep') return '1 keep';
  if (bucket === 'replace') return '2 replace';
  return '3 reconcile';
}

export async function reconcile(opts: ReconcileOptions): Promise<void> {
  const cwd = process.cwd();
  const apply = !!opts.yes;

  // Single plan/apply pass (AC-3): `list()` is called exactly ONCE per
  // invocation and the result reused below -- never four ad-hoc bucket-3 code
  // paths each re-querying the registry.
  const reconcilers = defaultRegistry.list();

  log.blank();
  log.info(apply ? 'cdd-kit reconcile -- applying changes' : 'cdd-kit reconcile -- plan (read-only; re-run with --yes to apply)');
  log.blank();

  for (const surface of KIT_SURFACES) {
    const label = bucketLabel(surface.bucket);
    log.info(`[${label}] ${surface.id} -- ${surface.description}`);
    const countableRoots = surface.roots.filter(r => !r.startsWith('~/'));
    if (countableRoots.length > 0) {
      log.dim(`  ${countExisting(cwd, countableRoots)}/${countableRoots.length} root(s) present`);
    }
    if (surface.bucket === 'reconcile') {
      log.dim(`  reconciler: ${surface.reconciler ?? '(none)'} -- registry slot only, no reconciler ships in this change`);
    }
  }
  log.blank();
  log.info(`registry: ${reconcilers.length} bucket-3 reconciler(s) registered`);
  log.blank();

  if (!apply) {
    log.info('Dry-run finished. Re-run with `--yes` to apply bucket-2 (kit-scaffold) changes.');
    log.dim('  bucket-1 (ground truth) is never touched.');
    log.dim('  bucket-3 has no reconciler registered yet in this framework version.');
    log.blank();
    return;
  }

  log.info('applying bucket-2 (kit-shipped scaffold) via the same guarded path as `cdd-kit refresh --yes` (templates-only)');
  await refresh({ yes: true, noUpdate: true, noUpgrade: true, noHooks: true, noCodeMap: true });

  const write = makeGuardedWrite(cwd);
  if (reconcilers.length === 0) {
    log.info('no bucket-3 reconcilers registered -- nothing to reconcile in this framework version.');
  } else {
    for (const r of reconcilers) {
      if (!r.detectNeedsReconcile({ cwd })) continue;
      const result = r.apply({ cwd }, write);
      log.info(`  ${result.surface}: ${result.applied ? 'applied' : 'skipped'} -- ${result.detail}`);
    }
  }
  log.blank();
  log.ok('reconcile complete.');
  log.blank();
}
