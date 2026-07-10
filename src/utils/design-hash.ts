// Canonical-hash + baseline-lock util for the interaction-design loop (ADR 0012
// §5; mirrors src/utils/acceptance-hash.ts's ADR 0010 §3.1 role). The gate
// (src/commands/gate-design.ts) uses this to detect an agent tampering with the
// human-confirmed design after confirmation: a mismatch between the freshly
// computed hash and the recorded baseline fails with "interaction design
// modified after confirmation — human must re-confirm."
//
// Locked region: the `## Confirmed` section body only (ADR 0012 §1.7/§5) — the
// human's timestamped answers to `## Open Decisions`. Everything else in
// interaction-design.md (the derivation chain, provenance citations, Open
// Decisions questions themselves) may be reworded/reflowed without changing the
// lock; only the confirmed answers are hash-protected.
//
// Unlike acceptance-hash.ts (which projects a PARSED YAML structure),
// `## Confirmed` is human markdown prose, not YAML. The canonical projection
// here is line-based: each line is trimmed and internal whitespace runs are
// collapsed to a single space, then blank lines are dropped. This makes the
// hash insensitive to reformatting/reindentation/blank-line changes (design.md
// Open Risks: "a weak projection reintroduces false-tamper failures") while any
// wording change to an answer still changes at least one projected line, so it
// diverges the hash — this is the "parsed projection, not raw bytes" ADR 0012
// §5 requires, adapted to prose instead of structured YAML.

import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { normalizeContentForHash } from './digest.js';
import { sectionBody } from './markdown-section.js';

/** The raw `## Confirmed` section body of an interaction-design.md, or '' if absent. */
export function extractConfirmedRegion(body: string): string {
  return sectionBody(body, 'Confirmed');
}

/**
 * Canonical, reformat-insensitive projection of the `## Confirmed` region:
 * trim each line, collapse internal whitespace runs to a single space, then
 * drop blank lines. Independent of indentation, blank-line count, and
 * (via normalizeContentForHash upstream in computeDesignHash) CRLF/LF.
 */
export function projectConfirmedRegion(body: string): string {
  return extractConfirmedRegion(body)
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .filter(line => line.length > 0)
    .join('\n');
}

/** sha256 of the canonicalized `## Confirmed` projection (ADR 0012 §5). */
export function computeDesignHash(body: string): string {
  const projected = projectConfirmedRegion(body);
  const normalized = normalizeContentForHash(Buffer.from(projected, 'utf8'));
  return createHash('sha256').update(normalized).digest('hex');
}

export interface DesignLockEntry {
  hash: string;
  'locked-at'?: string;
  // Tamper-evidence CLUES only (contracts/ci/ci-gate-contract.md
  // "Tamper evidence, not prevention"; ADR 0012 §5). What the confirming
  // process CLAIMED about itself at confirm time -- every one is trivially
  // forgeable by a Bash-holding agent, and NO gate reads or verifies them:
  // "Tamper evidence is a clue, never a verdict." A lock written by older code
  // simply omits these; their absence is absent evidence, never failed
  // evidence.
  'git-author'?: string;   // the "Name <email>" git would stamp on a commit, or absent if git can't determine it
  tty?: boolean;           // whether the confirming process's stdout was a TTY
  timestamp?: string;      // ISO-8601 confirm time (same instant as locked-at)
}

export type DesignLockFile = Record<string, DesignLockEntry>;

function lockPath(cwd: string): string {
  return join(cwd, '.cdd', 'design-lock.json');
}

/**
 * The "Name <email>" identity git itself would stamp on a commit right now,
 * read the way git resolves it (`git config user.name` / `user.email`, which
 * consults local + global + system config). git cannot author a commit without
 * BOTH, so if either is unset this returns `undefined` -- absence is recorded
 * rather than a value being invented. A tamper-evidence CLUE only; never
 * verified (contracts/ci/ci-gate-contract.md).
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
 * Read the `.cdd/design-lock.json` baseline sidecar, keyed by change-id.
 * Missing or unreadable/malformed => `{}` (no baseline recorded for any
 * change) -- the caller decides how to treat an absent baseline.
 */
export function readDesignLock(cwd: string): DesignLockFile {
  const p = lockPath(cwd);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as DesignLockFile)
      : {};
  } catch {
    return {};
  }
}

/**
 * Record (merge) a change's baseline hash into `.cdd/design-lock.json`.
 *
 * `cdd-kit design confirm <change-id>` (src/commands/design.ts) is the ONLY
 * sanctioned caller: `.cdd/design-lock.json` is a hard forbidden path in
 * `.cdd/context-policy.json` (an agent cannot write it directly via Edit/
 * Write), and no gate/authoring code path may call this function
 * automatically -- only the explicit human-run confirm command may
 * (ADR 0012 §5, mirroring ADR 0010 §3.1's acceptRelock discipline).
 */
export function writeDesignLock(cwd: string, changeId: string, hash: string): void {
  const p = lockPath(cwd);
  const current = readDesignLock(cwd);
  const now = new Date().toISOString();
  const entry: DesignLockEntry = {
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
