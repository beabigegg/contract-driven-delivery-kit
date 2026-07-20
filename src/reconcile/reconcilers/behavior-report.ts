/**
 * Bucket-3 reconciler: behaviour-change report on upgrade.
 *
 * The problem it exists for (#64, the sharpest real-world evidence this whole
 * framework has): gate SEMANTICS change on `npm install`, not on a file the
 * adopter edits. npm served 3.6.0 and then 3.13.1 with nothing in between, so a
 * single upgrade silently introduced the entire ADR 0010 acceptance oracle. The
 * adopter had no way to learn that AC-5 was new, hit a wall that looked like a
 * contradiction, and filed a bug that cost three reviewers -- all because a
 * behaviour change arrived unannounced.
 *
 * Sourcing: the kit's OWN shipped `assets/contracts/CHANGELOG.md`, compared
 * against a snapshot of what this adopter was last shown. Snapshot-diffing is
 * what makes the report a genuine DELTA without inventing a mapping from kit
 * versions to per-contract entry versions (the changelog is versioned per
 * contract type -- `[ci 0.12.0]`, `[upgrade 0.1.0]` -- so no such mapping
 * exists to read). It also costs no new changelog format.
 *
 * Everything this reconciler writes lives under `.cdd/migration/`, which is not
 * bucket 1: the report is derived, regenerable output, never adopter ground
 * truth.
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { ASSET, readKitVersion } from '../../utils/paths.js';
import { readAssetManifest } from '../../utils/asset-manifest.js';
import type { GuardedWrite, ReconcileContext, ReconcileResult, Reconciler } from '../../schemas/reconciliation.schema.js';

const MIGRATION_DIR = '.cdd/migration';
export const SEEN_SNAPSHOT_REL = `${MIGRATION_DIR}/contract-changelog.seen.md`;
export const REPORT_REL = `${MIGRATION_DIR}/behavior-change-report.md`;

/** `## [ci 0.12.0] — 2026-07-14` -> `[ci 0.12.0] — 2026-07-14`. */
const ENTRY_HEADER = /^##\s+(\[[^\]]+\].*)$/gm;

export function changelogEntries(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ENTRY_HEADER)) out.push(m[1].trim());
  return out;
}

/** The body of one entry: its header line through to the next `## ` header. */
export function entryBody(text: string, header: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.startsWith('## ') && l.slice(3).trim() === header);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

function readShipped(): string | null {
  const p = join(ASSET.contracts, 'CHANGELOG.md');
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function readSeen(cwd: string): string | null {
  const p = resolve(cwd, SEEN_SNAPSHOT_REL);
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/** The kit version that last installed into this repo, per `.cdd/asset-manifest.json`. */
export function lastInstalledKitVersion(cwd: string): string | null {
  try {
    const manifest = readAssetManifest(cwd);
    const versions = Object.values(manifest)
      .map(v => (v as { version?: string })?.version)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (versions.length === 0) return null;
    // The oldest stamp is the honest answer: any asset still stamped at an old
    // version means that is the last version to have written it.
    return versions.sort()[0];
  } catch {
    return null;
  }
}

export interface BehaviorDelta {
  unseen: string[];
  firstRun: boolean;
  shippedAvailable: boolean;
}

export function planBehaviorReport(cwd: string): BehaviorDelta {
  const shipped = readShipped();
  if (shipped === null) return { unseen: [], firstRun: false, shippedAvailable: false };
  const shippedEntries = changelogEntries(shipped);
  const seen = readSeen(cwd);
  if (seen === null) return { unseen: shippedEntries, firstRun: true, shippedAvailable: true };
  const seenEntries = new Set(changelogEntries(seen));
  return { unseen: shippedEntries.filter(e => !seenEntries.has(e)), firstRun: false, shippedAvailable: true };
}

function renderReport(cwd: string, delta: BehaviorDelta, shipped: string, previousKitVersion?: string | null): string {
  const from = previousKitVersion ?? lastInstalledKitVersion(cwd);
  const to = readKitVersion();
  const lines: string[] = [
    '# Behaviour-change report',
    '',
    'Gate semantics change when you upgrade the kit, not when you edit a file.',
    'This report lists contract changes that landed since you were last shown one,',
    'so a new or changed gate never arrives unannounced.',
    '',
    `- kit version that last installed here: ${from ?? '(unknown — no .cdd/asset-manifest.json stamp)'}`,
    `- kit version now installed: ${to}`,
    '',
  ];
  if (delta.firstRun) {
    lines.push(
      'This is the first behaviour-change report for this repo, so it lists every',
      'contract change the kit records rather than a delta. Later upgrades will',
      'report only what is new.',
      '',
    );
  }
  if (delta.unseen.length === 0) {
    lines.push('No contract changes since the last report.', '');
    return lines.join('\n');
  }
  lines.push(`## ${delta.unseen.length} contract change(s) you have not been shown`, '');
  for (const header of delta.unseen) {
    lines.push(entryBody(shipped, header), '');
  }
  lines.push(
    '---',
    '',
    'Source: this kit version\'s own `contracts/CHANGELOG.md`.',
    'Re-run `cdd-kit reconcile --plan` to see the current state without writing.',
    '',
  );
  return lines.join('\n');
}

export const behaviorReportReconciler: Reconciler = {
  surface: 'behavior-report',

  detectNeedsReconcile(ctx: ReconcileContext): boolean {
    const delta = planBehaviorReport(ctx.cwd);
    return delta.shippedAvailable && delta.unseen.length > 0;
  },

  planDescription(ctx: ReconcileContext): string {
    const delta = planBehaviorReport(ctx.cwd);
    if (!delta.shippedAvailable) return 'kit contract changelog not readable -- no report can be produced (nothing written)';
    if (delta.unseen.length === 0) return 'no contract change since the last report -- nothing to report';
    const from = ctx.previousKitVersion ?? lastInstalledKitVersion(ctx.cwd);
    const scope = delta.firstRun ? 'first report for this repo, so every recorded change is listed' : 'delta since the last report';
    return `write ${REPORT_REL}: ${delta.unseen.length} unseen contract change(s) (${scope}; last installed by ${from ?? 'unknown'} -> now ${readKitVersion()})`;
  },

  apply(ctx: ReconcileContext, write: GuardedWrite): ReconcileResult {
    const shipped = readShipped();
    if (shipped === null) {
      return { surface: 'behavior-report', applied: false, detail: 'kit contract changelog not readable -- nothing written' };
    }
    const delta = planBehaviorReport(ctx.cwd);
    if (delta.unseen.length === 0) {
      return { surface: 'behavior-report', applied: false, detail: 'no contract change since the last report' };
    }
    write.writeInto(resolve(ctx.cwd, REPORT_REL), renderReport(ctx.cwd, delta, shipped, ctx.previousKitVersion));
    // Snapshot AFTER the report: if the report write throws, the next run must
    // still see these entries as unseen rather than silently swallowing them.
    write.writeInto(resolve(ctx.cwd, SEEN_SNAPSHOT_REL), shipped);
    return {
      surface: 'behavior-report',
      applied: true,
      detail: `wrote ${REPORT_REL} with ${delta.unseen.length} unseen contract change(s); snapshot updated`,
    };
  },
};
