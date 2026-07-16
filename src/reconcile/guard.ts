/**
 * The single bucket-1 write guard (design.md `## Key Decisions`, ADR 0014).
 *
 * INV-2 (`contracts/upgrade/upgrade-reconciliation-contract.md`): every write
 * in the reconcile/refresh apply path passes through ONE bucket-1 guard that
 * physically refuses a never-overwrite path. `assertWritable` is that refusal
 * point; `guardedCopyFile`/`guardedWriteFile` are the ONLY functions in
 * `src/reconcile/**` (and `refresh.ts`'s bucket-2 apply path) allowed to call a
 * raw `fs` write primitive -- `enforceReconciliationInvariants` statically
 * scans for a second write site and fails the gate if one appears.
 *
 * `BUCKET_1_RULES` below is a 1:1 port of
 * `contracts/upgrade/upgrade-reconciliation-contract.md`
 * `## Bucket 1 — Never-Overwrite Ground Truth`. Each rule's `contractRow`
 * field is the EXACT text of that row's `surface` column cell; the
 * `enforceReconciliationInvariants` validator diffs this list against the
 * contract text so the two cannot silently drift (dropping a row here is a
 * HARD gate failure, not a silent hole).
 */
import { mkdirSync, copyFileSync, writeFileSync, existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { isOwnedAndUnmodified } from '../utils/user-asset-manifest.js';
import { AGENTS_HOME, SKILLS_HOME, CODEX_SKILLS_HOME } from '../utils/paths.js';
import type { GuardedWrite } from '../schemas/reconciliation.schema.js';

interface Bucket1MatchCtx {
  /** absolute, OS-native destination path. */
  absDest: string;
  /** destination path relative to `cwd`, forward-slash normalized. */
  relPosix: string;
  /**
   * Case-folded (lowercased) form of `relPosix`, used for the ACTUAL rule
   * matching below. A never-overwrite guard must fail SAFE: comparing
   * case-insensitively can only ever over-refuse a differently-cased path
   * (never under-refuse), and over-refusing has no safety cost -- refusing a
   * write never corrupts ground truth. On a case-insensitive filesystem
   * (Windows NTFS, default macOS) a case-differing spelling of a bucket-1
   * path is the SAME physical file, so case-sensitive matching alone is a
   * real hole there; comparing case-insensitively unconditionally (not only
   * when the host filesystem happens to be case-insensitive) is a deliberate,
   * safe over-approximation on case-sensitive Linux too (monkey-test-engineer
   * Finding A, contracts/upgrade/upgrade-reconciliation-contract.md INV-2).
   */
  relPosixLower: string;
}

export interface Bucket1Rule {
  /** verbatim `surface` column cell from the contract's bucket-1 enumeration. */
  contractRow: string;
  test: (ctx: Bucket1MatchCtx) => boolean;
}

/** `child` is inside (or equal to) `parent`, drive-letter/relative-escape safe. */
export function isWithinDir(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function relPosixFromCwd(absDest: string, cwd: string): string {
  return relative(resolve(cwd), absDest).split(sep).join('/');
}

const BUCKET_1_RULES: readonly Bucket1Rule[] = [
  {
    contractRow: '`contracts/**`, `src/**`, `tests/**` (excluding `tests/templates/**`), `specs/changes/**`, `specs/archive/**`',
    test: ({ relPosixLower }) =>
      relPosixLower === 'contracts' || relPosixLower.startsWith('contracts/') ||
      relPosixLower === 'src' || relPosixLower.startsWith('src/') ||
      relPosixLower === 'tests' ||
      (relPosixLower.startsWith('tests/') && !relPosixLower.startsWith('tests/templates/')) ||
      relPosixLower === 'specs/changes' || relPosixLower.startsWith('specs/changes/') ||
      relPosixLower === 'specs/archive' || relPosixLower.startsWith('specs/archive/'),
  },
  {
    contractRow: '`CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `package.json`',
    test: ({ relPosixLower }) => ['claude.md', 'agents.md', 'codex.md', 'package.json'].includes(relPosixLower),
  },
  {
    contractRow: '`.cdd/policy.yml` (user-set key values only — see per-key rule below), `.cdd/context-policy.json`, `.cdd/code-map-config.yml`',
    test: ({ relPosixLower }) =>
      relPosixLower === '.cdd/policy.yml' ||
      relPosixLower === '.cdd/context-policy.json' ||
      relPosixLower === '.cdd/code-map-config.yml',
  },
  {
    contractRow: '`acceptance.yml`, `interaction-design.md`, `.cdd/*-lock.json` (e.g. `.cdd/design-lock.json`, `.cdd/acceptance-lock.json`)',
    test: ({ relPosixLower }) =>
      relPosixLower === 'acceptance.yml' || relPosixLower.endsWith('/acceptance.yml') ||
      relPosixLower === 'interaction-design.md' || relPosixLower.endsWith('/interaction-design.md') ||
      /^\.cdd\/[^/]+-lock\.json$/.test(relPosixLower),
  },
  {
    // Dynamic: NOT a static path pattern. Any path under a kit agent/skill
    // home directory that the delegated ownership check (AC-7 -- never
    // reinvented here) does not report as kit-owned-and-unmodified is the
    // user's own content.
    contractRow: "the user's own agents/skills — any agent/skill file the ownership check reports as NOT kit-owned-and-unmodified",
    test: ({ absDest }) => {
      const homeDirs = [AGENTS_HOME, SKILLS_HOME, CODEX_SKILLS_HOME];
      if (!homeDirs.some(h => isWithinDir(absDest, h))) return false;
      return !isOwnedAndUnmodified(absDest);
    },
  },
];

/** The exact contract-row text every `BUCKET_1_RULES` entry ports, in order --
 *  read by `enforceReconciliationInvariants` for its coverage diff. */
export function bucket1ContractRows(): string[] {
  return BUCKET_1_RULES.map(r => r.contractRow);
}

function matchRule(absDest: string, cwd: string): Bucket1Rule | undefined {
  const relPosix = relPosixFromCwd(absDest, cwd);
  const ctx: Bucket1MatchCtx = { absDest, relPosix, relPosixLower: relPosix.toLowerCase() };
  for (const rule of BUCKET_1_RULES) {
    if (rule.test(ctx)) return rule;
  }
  return undefined;
}

/**
 * Resolve `target` through the REAL filesystem (following any symlink,
 * directory junction, or other reparse point), WITHOUT requiring `target`
 * itself to already exist -- most guarded writes are creating a file that
 * does not exist yet. Walks up to the longest EXISTING ancestor directory,
 * `fs.realpathSync.native`s that ancestor (so any reparse point in ITS
 * ancestry is followed too), then re-appends the remaining not-yet-existing
 * segments verbatim.
 *
 * Returns `null` when realpath resolution fails on an existing ancestor
 * (unreadable directory, permission denied, broken/circular reparse point) --
 * the caller MUST treat `null` as "cannot verify safety" and fail OPEN TO
 * REFUSE, never open to allow (monkey-test-engineer Finding B; INV-2's
 * "never guess" applies here exactly as it does to classification).
 */
function realpathOfLongestExistingAncestor(target: string): string | null {
  let current = target;
  const remaining: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      // Reached the filesystem root without finding an existing ancestor --
      // nothing on disk to alias through; the path is safe to return verbatim.
      return target;
    }
    remaining.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  try {
    const realBase = realpathSync.native(current);
    return remaining.length > 0 ? join(realBase, ...remaining) : realBase;
  } catch {
    return null;
  }
}

export interface Bucket1Result {
  blocked: boolean;
  rule?: Bucket1Rule;
  /** set when blocked via the realpath/junction safety check rather than a
   *  direct pattern match on the literal `dest` spelling. */
  reason?: string;
}

/**
 * Two-layer check, both required for INV-2 (monkey-test-engineer Findings A/B):
 *   1. the literal `dest` spelling against `BUCKET_1_RULES` (case-insensitively --
 *      Finding A);
 *   2. `dest` resolved through the real filesystem, in case a symlink/
 *      junction/reparse point makes it alias a bucket-1 path under a
 *      bucket-2/unclassified-looking spelling (Finding B). Realpath
 *      resolution failure fails OPEN TO REFUSE.
 */
export function isBucket1(dest: string, cwd: string = process.cwd()): Bucket1Result {
  const absDest = resolve(cwd, dest);

  const directRule = matchRule(absDest, cwd);
  if (directRule) return { blocked: true, rule: directRule };

  const real = realpathOfLongestExistingAncestor(absDest);
  if (real === null) {
    return {
      blocked: true,
      reason: 'realpath resolution failed while checking for a symlink/junction alias -- cannot verify this destination does not resolve into bucket-1 ground truth; failing open to refuse',
    };
  }
  if (real !== absDest) {
    const realRule = matchRule(real, cwd);
    if (realRule) {
      return {
        blocked: true,
        rule: realRule,
        reason: 'destination resolves through a symlink/junction/reparse point to a bucket-1 path',
      };
    }
  }

  return { blocked: false };
}

/**
 * THROWS when `dest` is a bucket-1 never-overwrite path. This is the LINCHPIN
 * of INV-2: every reconcile/refresh apply write calls this (via
 * `guardedCopyFile`/`guardedWriteFile`) before touching disk, and AGAIN
 * immediately before the actual write (TOCTOU re-check).
 */
export function assertWritable(dest: string, cwd: string = process.cwd()): void {
  const result = isBucket1(dest, cwd);
  if (result.blocked) {
    const ruleText = result.rule ? result.rule.contractRow : 'symlink/junction realpath safety check';
    throw new Error(
      `guard refused write to "${dest}": bucket-1 ground truth (${ruleText})` +
      (result.reason ? ` -- ${result.reason}` : '') + '. ' +
      'See contracts/upgrade/upgrade-reconciliation-contract.md ## Bucket 1 — Never-Overwrite Ground Truth (INV-2).',
    );
  }
}

/** The sole `fs`-write chokepoint for a file copy. */
export function guardedCopyFile(src: string, dest: string, cwd: string = process.cwd()): void {
  assertWritable(dest, cwd);
  mkdirSync(dirname(dest), { recursive: true });
  // TOCTOU re-check (monkey-test-engineer Finding B): a symlink/junction
  // could have been created at `dest` (or an ancestor) between the check
  // above and this write -- re-verify immediately before touching disk.
  assertWritable(dest, cwd);
  copyFileSync(src, dest);
}

/** The sole `fs`-write chokepoint for writing content directly. */
export function guardedWriteFile(dest: string, content: string | Buffer, cwd: string = process.cwd()): void {
  assertWritable(dest, cwd);
  mkdirSync(dirname(dest), { recursive: true });
  // TOCTOU re-check -- see guardedCopyFile above.
  assertWritable(dest, cwd);
  writeFileSync(dest, content);
}

/** `GuardedWrite` capability handed to a `Reconciler` (design.md `## Registry Interface`). */
export function makeGuardedWrite(cwd: string = process.cwd()): GuardedWrite {
  return {
    copyFile: (src, dest) => guardedCopyFile(src, dest, cwd),
    writeFile: (dest, content) => guardedWriteFile(dest, content, cwd),
  };
}
