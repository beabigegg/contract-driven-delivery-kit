/**
 * Pure logic + IO helpers for parallel-change integration (ADR 0009).
 *
 * Split from the command entry points so the semver/lane/contention core is
 * exercised directly by unit tests without spawning the CLI. The command files
 * (reserve.ts, integrate.ts) own only argument parsing, file writes, and
 * console output; every decision that could be wrong lives here.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripFrontmatter } from '../contracts/parser.js';
import { CONTRACT_PATHS, type ContractKey } from '../schemas/reservations.schema.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type BumpKind = 'major' | 'minor' | 'patch';

export interface ContractLane {
  from: string;
  to: string;
  surfaces?: string[];
}

export interface Reservation {
  'change-id': string;
  branch?: string;
  contracts: Partial<Record<ContractKey, ContractLane>>;
  'changelog-fragment'?: string;
}

export interface ReservationsFile {
  version: 1;
  reservations: Reservation[];
}

export interface Collision {
  contract: ContractKey;
  changeIds: [string, string];
  detail: string;
}

export interface ContentionReport {
  /** Two reservations targeting the same `to` version on the same contract. */
  versionCollisions: Collision[];
  /** Two reservations editing an overlapping named surface — needs a human. */
  surfaceCollisions: Collision[];
  /** Change-ids in a safe, monotonic merge order (lowest reserved version first). */
  mergeOrder: string[];
  /** True when no surface collisions exist (integration can be automated). */
  safe: boolean;
}

// ── Semver ──────────────────────────────────────────────────────────────────

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(s: string): [number, number, number] | null {
  const m = SEMVER_RE.exec(s.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Invalid semver comparison: ${a} vs ${b}`);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function bumpSemver(v: string, kind: BumpKind): string {
  const p = parseSemver(v);
  if (!p) throw new Error(`Invalid semver: ${v}`);
  let [major, minor, patch] = p;
  if (kind === 'major') { major += 1; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor += 1; patch = 0; }
  else { patch += 1; }
  return `${major}.${minor}.${patch}`;
}

// ── Contract version reading ──────────────────────────────────────────────────

/**
 * Read the current `schema-version` from a contract's frontmatter. Returns
 * '0.0.0' when the contract file or field is absent so a first reservation
 * still gets a sane lane rather than throwing.
 */
export function readContractVersion(repoRoot: string, contract: ContractKey): string {
  const p = join(repoRoot, CONTRACT_PATHS[contract]);
  if (!existsSync(p)) return '0.0.0';
  const { frontmatter } = stripFrontmatter(readFileSync(p, 'utf8'));
  const v = frontmatter['schema-version'];
  return v && parseSemver(v) ? v : '0.0.0';
}

// ── Lane allocation ────────────────────────────────────────────────────────

/**
 * Compute the next free target version for a contract. Bumps from the highest
 * of (current on-disk version, every already-reserved `to` for that contract),
 * so each concurrent reservation lands on a distinct, ascending lane. Excludes
 * `excludeChangeId` so re-reserving an existing change is idempotent rather than
 * leapfrogging its own prior lane.
 */
export function nextFreeVersion(
  contract: ContractKey,
  currentVersion: string,
  kind: BumpKind,
  existing: ReservationsFile,
  excludeChangeId?: string,
): string {
  let highest = currentVersion;
  for (const r of existing.reservations) {
    if (excludeChangeId && r['change-id'] === excludeChangeId) continue;
    const lane = r.contracts[contract];
    if (lane?.to && compareSemver(lane.to, highest) > 0) highest = lane.to;
  }
  return bumpSemver(highest, kind);
}

// ── Contention analysis ──────────────────────────────────────────────────────

function overlap(a: string[] | undefined, b: string[] | undefined): string[] {
  if (!a || !b) return [];
  const setB = new Set(b);
  return a.filter(x => setB.has(x));
}

/**
 * Analyse a reservation ledger for merge-time contention and derive a safe
 * merge order. Version collisions are lane-allocation bugs (or a bad manual
 * edit); surface collisions are genuine semantic overlap that must be resolved
 * by a human before parallel merge. The merge order sorts by each change's
 * maximum reserved version across all contracts (ascending), tie-broken by
 * change-id, so bumps apply monotonically and the version validator never sees
 * a skip.
 */
export function analyzeContention(res: ReservationsFile): ContentionReport {
  const versionCollisions: Collision[] = [];
  const surfaceCollisions: Collision[] = [];
  const rs = res.reservations;

  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      const contracts = Object.keys(a.contracts) as ContractKey[];
      for (const c of contracts) {
        const la = a.contracts[c];
        const lb = b.contracts[c];
        if (!la || !lb) continue;
        if (la.to === lb.to) {
          versionCollisions.push({
            contract: c,
            changeIds: [a['change-id'], b['change-id']],
            detail: `both reserve ${c} → ${la.to}`,
          });
        }
        const shared = overlap(la.surfaces, lb.surfaces);
        if (shared.length > 0) {
          surfaceCollisions.push({
            contract: c,
            changeIds: [a['change-id'], b['change-id']],
            detail: `both edit ${c} surface(s): ${shared.join(', ')}`,
          });
        }
      }
    }
  }

  const maxVersion = (r: Reservation): string => {
    let hi = '0.0.0';
    for (const lane of Object.values(r.contracts)) {
      if (lane?.to && compareSemver(lane.to, hi) > 0) hi = lane.to;
    }
    return hi;
  };

  const mergeOrder = [...rs]
    .sort((a, b) => {
      const cmp = compareSemver(maxVersion(a), maxVersion(b));
      return cmp !== 0 ? cmp : a['change-id'].localeCompare(b['change-id']);
    })
    .map(r => r['change-id']);

  return {
    versionCollisions,
    surfaceCollisions,
    mergeOrder,
    safe: surfaceCollisions.length === 0,
  };
}

// ── Ledger IO ────────────────────────────────────────────────────────────────

export const RESERVATIONS_PATH = '.cdd/reservations.yml';

export function emptyLedger(): ReservationsFile {
  return { version: 1, reservations: [] };
}
