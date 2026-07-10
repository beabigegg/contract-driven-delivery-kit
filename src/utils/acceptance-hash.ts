// Canonical-hash + baseline-lock util for the acceptance oracle (ADR 0010 §3.1;
// design.md Q1). The gate (src/commands/gate-acceptance.ts) uses this to detect
// an agent tampering with the human-authored answer key after authoring: a
// mismatch between the freshly computed hash and the recorded baseline fails
// with "acceptance oracle modified after authoring — human must re-confirm."
//
// Locked region: `cases[].{id,input,expect}` and `rules[].{id,statement}` only.
// `given/when/then`, `oracle-version`, and `authored-by` are excluded — they are
// human narrative/metadata the author may reword without changing the oracle
// (design.md Q1); locking them would produce false tamper alarms and discourage
// clarifying prose.
//
// The hash is computed over the PARSED, canonicalized structure -- not the raw
// file bytes -- so it is inherently independent of key order, whitespace, and
// quoting style (design.md Q1 rejects a raw-file digest for exactly this
// reason: reformatting a semantically identical file would false-alarm).

import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { normalizeContentForHash } from './digest.js';

export interface AcceptanceCase {
  id?: unknown;
  input?: unknown;
  expect?: unknown;
  [key: string]: unknown;
}

export interface AcceptanceRule {
  id?: unknown;
  statement?: unknown;
  [key: string]: unknown;
}

export interface AcceptanceFile {
  'oracle-version'?: unknown;
  'authored-by'?: unknown;
  cases?: AcceptanceCase[];
  rules?: AcceptanceRule[];
  [key: string]: unknown;
}

/** Recursively sort object keys so the canonical JSON is key-order independent. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = sortKeysDeep(src[key]);
    }
    return out;
  }
  return value;
}

/** Stable sort by string `id` (join key binding a case/rule to its driver + evidence). */
function byId(a: { id?: unknown }, b: { id?: unknown }): number {
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

/**
 * Project the locked human region of a parsed `acceptance.yml` (design.md Q1):
 * `cases[].{id,input,expect}` + `rules[].{id,statement}`, with keys recursively
 * sorted and cases/rules sorted by `id` so the projection is independent of
 * source ordering.
 */
export function projectLockedRegion(data: AcceptanceFile): unknown {
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const projectedCases = cases
    .map((c) => ({ id: c?.id, input: c?.input, expect: c?.expect }))
    .sort(byId);
  const projectedRules = rules
    .map((r) => ({ id: r?.id, statement: r?.statement }))
    .sort(byId);
  return sortKeysDeep({ cases: projectedCases, rules: projectedRules });
}

/** sha256 of the canonicalized locked region (design.md Q1). */
export function computeAcceptanceHash(data: AcceptanceFile): string {
  const projected = projectLockedRegion(data);
  const canonicalJson = JSON.stringify(projected);
  const normalized = normalizeContentForHash(Buffer.from(canonicalJson, 'utf8'));
  return createHash('sha256').update(normalized).digest('hex');
}

export interface AcceptanceLockEntry {
  hash: string;
  'locked-at'?: string;
  // Tamper-evidence CLUES only (contracts/ci/ci-gate-contract.md
  // "Tamper evidence, not prevention" names BOTH .cdd/design-lock.json AND
  // .cdd/acceptance-lock.json; ADR 0010 §3.1). What the relocking process
  // CLAIMED about itself -- trivially forgeable, and NO gate reads or verifies
  // them: "Tamper evidence is a clue, never a verdict." A lock written by older
  // code simply omits these; their absence is absent evidence, never failed
  // evidence. Mirrors DesignLockEntry (src/utils/design-hash.ts).
  'git-author'?: string;   // the "Name <email>" git would stamp on a commit, or absent if git can't determine it
  tty?: boolean;           // whether the relocking process's stdout was a TTY
  timestamp?: string;      // ISO-8601 relock time (same instant as locked-at)
}

export type AcceptanceLockFile = Record<string, AcceptanceLockEntry>;

function lockPath(cwd: string): string {
  return join(cwd, '.cdd', 'acceptance-lock.json');
}

/**
 * The "Name <email>" identity git itself would stamp on a commit right now,
 * read the way git resolves it (`git config user.name` / `user.email`). git
 * cannot author a commit without BOTH, so if either is unset this returns
 * `undefined` -- absence is recorded rather than a value invented. A
 * tamper-evidence CLUE only, never verified. Mirrors design-hash.ts's
 * gitAuthorIdentity (kept as an independent copy: the two lock utils are
 * deliberate peers, neither importing the other).
 */
export function gitAuthorIdentity(cwd: string): string | undefined {
  try {
    const name = spawnSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' });
    const email = spawnSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8' });
    const n = name.status === 0 ? (name.stdout ?? '').trim() : '';
    const e = email.status === 0 ? (email.stdout ?? '').trim() : '';
    return n && e ? `${n} <${e}>` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the `.cdd/acceptance-lock.json` baseline sidecar (design.md Q1), keyed
 * by change-id. Missing or unreadable/malformed => `{}` (no baseline recorded
 * for any change) -- the caller decides how to treat an absent baseline.
 */
export function readAcceptanceLock(cwd: string): AcceptanceLockFile {
  const p = lockPath(cwd);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as AcceptanceLockFile)
      : {};
  } catch {
    return {};
  }
}

/**
 * Record (merge) a change's baseline hash into `.cdd/acceptance-lock.json`.
 *
 * This is a HUMAN-run relock, never an agent side effect (design.md Maintainer
 * Decisions, 2026-07-08): `.cdd/acceptance-lock.json` is a hard forbidden path
 * in `.cdd/context-policy.json`, so an agent cannot write it directly, and no
 * gate/authoring code path may call this function automatically -- only an
 * explicit human-run relock command may.
 */
export function writeAcceptanceLock(cwd: string, changeId: string, hash: string): void {
  const p = lockPath(cwd);
  const current = readAcceptanceLock(cwd);
  const now = new Date().toISOString();
  const entry: AcceptanceLockEntry = {
    hash,
    'locked-at': now,
    tty: Boolean(process.stdout.isTTY),
    timestamp: now,
  };
  // Omit git-author entirely when git cannot determine it (record absence, not
  // an invented value). These three are audit clues, never verified.
  const author = gitAuthorIdentity(cwd);
  if (author !== undefined) entry['git-author'] = author;
  current[changeId] = entry;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}
