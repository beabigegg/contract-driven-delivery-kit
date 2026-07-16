/**
 * Bucket-3 reconciler: the `CLAUDE.md` `cdd-kit:learnings` region.
 *
 * `CLAUDE.md` is loaded into every session, so every line in it is a recurring
 * token cost, and upgrades accrete lessons that duplicate each other or point at
 * files that no longer exist. The region between the `cdd-kit:learnings` markers
 * is the only part the kit manages; the template's own words -- "Anything you
 * write outside the markers is yours and is never edited or evicted" -- are the
 * promise this reconciler must not break, which is why every write goes through
 * `replaceMarkedRegion` (it proves from disk that the bytes outside the markers
 * survived).
 *
 * SCOPE IS DELIBERATELY MECHANICAL. It removes EXACT duplicate entries and
 * reports entries whose `contracts/…`/`docs/…` pointer no longer resolves. It
 * does NOT decide that a lesson is "obsolete" or "contract-superseded" -- that
 * is a semantic judgement, and a reconciler that silently deleted a lesson on
 * its own reading of the prose would be destroying the user's ground truth on a
 * guess. Orphan pointers are surfaced for a human, never auto-evicted.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { GuardedWrite, ReconcileContext, ReconcileResult, Reconciler } from '../../schemas/reconciliation.schema.js';
import { readFileSync } from 'fs';

export const LEARNINGS_START = '<!-- cdd-kit:learnings:start -->';
export const LEARNINGS_END = '<!-- cdd-kit:learnings:end -->';
const CLAUDE_REL = 'CLAUDE.md';

/** A `- ` bullet inside the region. Anything else (blank lines, prose) is kept verbatim. */
function isEntry(line: string): boolean {
  return /^\s*-\s+\S/.test(line);
}

/** Pointers a promoted lesson may carry, per the CLAUDE.md template's own rule
 *  ("a rule + a pointer to where the detail lives"). */
const POINTER = /(?:^|[\s(`])((?:contracts|docs)\/[A-Za-z0-9._/-]+)/g;

export interface LearningsPlan {
  /** region located and readable? */
  available: boolean;
  reason: string;
  entries: number;
  duplicates: string[];
  orphanPointers: Array<{ entry: string; pointer: string }>;
  nextBody?: string;
}

function regionBody(content: string): string | null {
  const start = content.indexOf(LEARNINGS_START);
  const end = content.indexOf(LEARNINGS_END, start + LEARNINGS_START.length);
  if (start < 0 || end < 0) return null;
  if (content.indexOf(LEARNINGS_START, start + LEARNINGS_START.length) >= 0) return null;
  return content.slice(start + LEARNINGS_START.length, end);
}

export function planLearningsRegion(cwd: string): LearningsPlan {
  const abs = resolve(cwd, CLAUDE_REL);
  if (!existsSync(abs)) {
    return { available: false, reason: 'CLAUDE.md does not exist -- nothing to reconcile', entries: 0, duplicates: [], orphanPointers: [] };
  }
  let content: string;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    return { available: false, reason: 'CLAUDE.md is unreadable -- fail-open to keep (INV-1)', entries: 0, duplicates: [], orphanPointers: [] };
  }
  const body = regionBody(content);
  if (body === null) {
    return {
      available: false,
      reason: `CLAUDE.md has no single complete ${LEARNINGS_START}/${LEARNINGS_END} region -- left untouched (INV-1)`,
      entries: 0, duplicates: [], orphanPointers: [],
    };
  }

  const lines = body.split('\n');
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const orphanPointers: Array<{ entry: string; pointer: string }> = [];
  const kept: string[] = [];
  let entries = 0;

  for (const line of lines) {
    if (!isEntry(line)) { kept.push(line); continue; }
    entries += 1;
    const key = line.trim();
    if (seen.has(key)) { duplicates.push(key); continue; } // exact duplicate -- dropped
    seen.add(key);
    kept.push(line);
    for (const m of key.matchAll(POINTER)) {
      const pointer = m[1];
      if (!existsSync(resolve(cwd, pointer))) orphanPointers.push({ entry: key, pointer });
    }
  }

  return {
    available: true,
    reason: 'region located',
    entries,
    duplicates,
    orphanPointers,
    nextBody: kept.join('\n'),
  };
}

export const learningsRegionReconciler: Reconciler = {
  surface: 'learnings-region',

  detectNeedsReconcile(ctx: ReconcileContext): boolean {
    const plan = planLearningsRegion(ctx.cwd);
    return plan.available && plan.duplicates.length > 0;
  },

  planDescription(ctx: ReconcileContext): string {
    const plan = planLearningsRegion(ctx.cwd);
    if (!plan.available) return plan.reason;
    const parts = [`${plan.entries} promoted lesson(s) in the region`];
    parts.push(plan.duplicates.length > 0
      ? `remove ${plan.duplicates.length} exact duplicate(s)`
      : 'no exact duplicate to remove');
    if (plan.orphanPointers.length > 0) {
      parts.push(`${plan.orphanPointers.length} lesson(s) point at a path that no longer exists -- REPORTED for a human, never auto-evicted: ` +
        plan.orphanPointers.map(o => o.pointer).join(', '));
    }
    parts.push('everything outside the markers is yours and is never touched');
    return parts.join('; ');
  },

  apply(ctx: ReconcileContext, write: GuardedWrite): ReconcileResult {
    const plan = planLearningsRegion(ctx.cwd);
    if (!plan.available || plan.nextBody === undefined) {
      return { surface: 'learnings-region', applied: false, detail: plan.reason };
    }
    if (plan.duplicates.length === 0) {
      const note = plan.orphanPointers.length > 0
        ? `no exact duplicate; ${plan.orphanPointers.length} orphan pointer(s) need a human decision: ${plan.orphanPointers.map(o => o.pointer).join(', ')}`
        : 'no exact duplicate to remove';
      return { surface: 'learnings-region', applied: false, detail: note };
    }
    const result = write.replaceMarkedRegion(CLAUDE_REL, LEARNINGS_START, LEARNINGS_END, plan.nextBody);
    if (!result.replaced) return { surface: 'learnings-region', applied: false, detail: result.reason };
    const parts = [`removed ${plan.duplicates.length} exact duplicate lesson(s)`];
    if (plan.orphanPointers.length > 0) {
      parts.push(`${plan.orphanPointers.length} orphan pointer(s) reported, not evicted: ${plan.orphanPointers.map(o => o.pointer).join(', ')}`);
    }
    return { surface: 'learnings-region', applied: true, detail: parts.join('; ') };
  },
};
