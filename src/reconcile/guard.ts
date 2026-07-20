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
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import yaml from 'js-yaml';
import { isOwnedAndUnmodified } from '../utils/user-asset-manifest.js';
import { AGENTS_HOME, SKILLS_HOME, CODEX_SKILLS_HOME, ASSET } from '../utils/paths.js';
import type { GuardedWrite, AddPolicyKeysResult, ReplaceRegionResult } from '../schemas/reconciliation.schema.js';

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
  // Normalize BOTH separators, not just the host's. On Windows `path.resolve`
  // already folds `\` into the separator, so `contracts\api.md` reaches the
  // rules as `contracts/api.md`; on POSIX `\` is a legal filename character, so
  // the same string stays one flat filename and every bucket-1 rule misses it.
  //
  // A path string does not always originate on the machine that consumes it --
  // a Windows-authored manifest, config, or tool payload read on Linux CI still
  // means `contracts/api.md`. This is the same fail-safe reasoning as the
  // case-folding above (over-refusing costs nothing; refusing a write never
  // corrupts ground truth) and the same precedent the acceptance/design
  // write-block hooks already set by normalizing Windows separators explicitly.
  // The cost is refusing a POSIX file whose name genuinely contains a
  // backslash; the alternative is a real cross-platform hole.
  return relative(resolve(cwd), absDest).split(sep).join('/').split('\\').join('/');
}

/**
 * Whether a `tests/contract/...` path is one of the files the KIT ships in
 * `contract-harness/`, as opposed to the adopter's own captured data.
 *
 * `tests/contract/` is mixed ownership, which is why neither "all bucket 1" nor
 * "all bucket 2" is right. The kit ships a README, an example JSON, and a
 * `samples/.gitkeep`; `tests/contract/samples/*.json` holds the adopter's
 * captured real responses (`docs/boundary-guard.md`: `path:
 * tests/contract/samples/health.json`) and is ground truth that must never be
 * force-refreshed.
 *
 * The membership test is DERIVED from what the package actually ships rather
 * than a hardcoded filename list, mirroring how the agents/skills rule delegates
 * to the ownership check: if the harness grows a file, this follows, and an
 * adopter file that merely shares a directory with it never becomes writable.
 * An unreadable asset directory yields `false` -- fail safe, i.e. keep treating
 * the path as bucket 1.
 */
function isKitShippedHarnessFile(relPosixLower: string): boolean {
  if (!relPosixLower.startsWith('tests/contract/')) return false;
  const rel = relPosixLower.slice('tests/contract/'.length);
  try {
    return listRelFiles(ASSET.contractHarness).some(f => f.toLowerCase() === rel);
  } catch {
    return false;
  }
}

/** Repo-relative POSIX paths of every file under `root` (recursive). */
function listRelFiles(root: string, prefix = ''): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listRelFiles(join(root, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const BUCKET_1_RULES: readonly Bucket1Rule[] = [
  {
    contractRow: '`contracts/**`, `src/**`, `tests/**` (excluding `tests/templates/**` and the kit-shipped files of `tests/contract/**`), `specs/changes/**`, `specs/archive/**`',
    test: ({ relPosixLower }) =>
      relPosixLower === 'contracts' || relPosixLower.startsWith('contracts/') ||
      relPosixLower === 'src' || relPosixLower.startsWith('src/') ||
      relPosixLower === 'tests' ||
      (relPosixLower.startsWith('tests/')
        && !relPosixLower.startsWith('tests/templates/')
        && !isKitShippedHarnessFile(relPosixLower)) ||
      relPosixLower === 'specs/changes' || relPosixLower.startsWith('specs/changes/') ||
      relPosixLower === 'specs/archive' || relPosixLower.startsWith('specs/archive/'),
  },
  {
    contractRow: '`CLAUDE.md` (everything OUTSIDE its `cdd-kit:learnings` markers — see per-region rule below), `AGENTS.md`, `CODEX.md`, `package.json`',
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
 * THROWS when `dest` is a bucket-1 never-overwrite path. This is where INV-2 is enforced;
 * every reconcile/refresh apply write calls this (via
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

// ─────────────────────────────────────────────────────────────────────────────
// Narrow channels into a bucket-1 CONTAINER.
//
// `assertWritable` refuses a bucket-1 path outright, which is correct for a
// whole-file overwrite and WRONG for the two surfaces the contract classifies
// per-region rather than per-file:
//
//   - `.cdd/policy.yml` -- contract `## Bucket 1` row 3 protects "user-set key
//     values only", and `## .cdd/policy.yml is classified PER-KEY` REQUIRES that
//     a genuinely new key be added with a fail-open safe default (INV-1). A
//     whole-file refusal makes that clause unimplementable.
//   - `CLAUDE.md` -- contract `## Bucket 1` row 2, narrowed to everything
//     OUTSIDE the `cdd-kit:learnings` markers (the region the CLAUDE.md template
//     already declares kit-managed: "Anything you write outside the markers is
//     yours and is never edited or evicted").
//
// These two functions are the ONLY sanctioned way in, and they are built so the
// protected part CANNOT change rather than so a caller merely intends not to
// change it: each one re-reads its own output and PROVES, byte-for-byte, that
// the protected bytes survived -- throwing (after restoring the original) if
// they did not. A caller cannot opt out of that proof. They live in `guard.ts`
// because it is the only module allowed to call a raw `fs` write primitive
// (`enforceReconciliationInvariants` check 2).
// ─────────────────────────────────────────────────────────────────────────────

const POLICY_REL = '.cdd/policy.yml';

function parsePolicyMapping(text: string): Record<string, unknown> | null {
  try {
    const doc = yaml.load(text, { schema: yaml.JSON_SCHEMA });
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return doc as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Add ONLY keys absent from the adopter's `.cdd/policy.yml`. An adopter-set key
 * is bucket 1 and is never flipped, reordered, reformatted, or re-serialized.
 *
 * The file is extended by APPENDING text -- never by `yaml.dump`-ing a parsed
 * document back out. Round-tripping would silently drop the adopter's comments
 * and rewrite their formatting, which is itself a mutation of ground truth even
 * when every key/value survives.
 *
 * Throws when the adopter's file is missing, unreadable, or not a YAML mapping:
 * the prior content cannot be verified as preserved, so the safe action is to
 * refuse rather than to guess (INV-2's "never guess", same rule the classifier
 * follows by failing open to keep).
 */
export function guardedAddPolicyKeys(
  cwd: string,
  additions: Record<string, unknown>,
  renderKey: (key: string, value: unknown) => string = defaultRenderPolicyKey,
): AddPolicyKeysResult {
  const abs = resolve(cwd, POLICY_REL);
  if (!existsSync(abs)) {
    throw new Error(
      `guardedAddPolicyKeys refused: ${POLICY_REL} does not exist -- cannot prove existing adopter keys are preserved. ` +
      'See contracts/upgrade/upgrade-reconciliation-contract.md ## .cdd/policy.yml is classified PER-KEY (INV-2).',
    );
  }

  // The narrow channel must still resolve through the real filesystem. If
  // `.cdd/policy.yml` -- or `.cdd/` itself -- is a symlink or junction, this
  // append lands on whatever it points at, and the byte-level proof below does
  // NOT catch it: the "original" was read through the same alias, so a prefix
  // check on the aliased target passes while a bucket-1 file elsewhere is being
  // extended. The generic guarded writers get this from `isBucket1`; this
  // channel bypassed them and needed its own (codex review, PR #69).
  // Both sides are resolved so a cwd that is itself under a symlinked path (a
  // macOS temp dir, say) is not mistaken for an aliased policy file: only a
  // genuine alias OF THE POLICY FILE changes the relative result.
  const realPolicy = realpathOfLongestExistingAncestor(abs);
  const realCwd = realpathOfLongestExistingAncestor(resolve(cwd));
  if (realPolicy === null || realCwd === null
      || relPosixFromCwd(realPolicy, realCwd).toLowerCase() !== POLICY_REL) {
    throw new Error(
      `guardedAddPolicyKeys refused: ${POLICY_REL} resolves to "${realPolicy ?? '(unresolvable)'}" -- ` +
      'this channel may only extend the adopter\'s own policy file, never whatever a symlink/junction ' +
      'aliases it to. See contracts/upgrade/upgrade-reconciliation-contract.md INV-2.',
    );
  }
  const original = readFileSync(abs, 'utf8');
  const before = parsePolicyMapping(original);
  if (before === null) {
    throw new Error(
      `guardedAddPolicyKeys refused: ${POLICY_REL} is unreadable or not a YAML mapping -- cannot prove existing adopter keys are preserved. ` +
      'See contracts/upgrade/upgrade-reconciliation-contract.md ## .cdd/policy.yml is classified PER-KEY (INV-2).',
    );
  }

  const added: string[] = [];
  const skipped: string[] = [];
  for (const key of Object.keys(additions)) {
    (Object.prototype.hasOwnProperty.call(before, key) ? skipped : added).push(key);
  }
  if (added.length === 0) return { added, skipped };

  const separator = original.length === 0 || original.endsWith('\n') ? '' : '\n';
  const appended = added.map(k => renderKey(k, additions[k])).join('');
  const next = original + separator + appended;

  // Byte-level proof, not intent: everything the adopter already had is a
  // literal PREFIX of what we are about to write.
  if (!next.startsWith(original)) {
    throw new Error(`guardedAddPolicyKeys refused: computed content would alter existing ${POLICY_REL} bytes (INV-2).`);
  }

  writeFileSync(abs, next);

  // Re-read our own output and prove it. A bug in `renderKey` (an injected
  // newline, a duplicated key) must fail loudly here, not corrupt the adopter's
  // policy silently.
  const verify = readFileSync(abs, 'utf8');
  const after = parsePolicyMapping(verify);
  const failure = verifyPolicyPreserved(original, verify, before, after, added);
  if (failure) {
    writeFileSync(abs, original); // restore before surfacing
    throw new Error(`guardedAddPolicyKeys refused: ${failure} -- ${POLICY_REL} restored unchanged (INV-2).`);
  }
  return { added, skipped };
}

function verifyPolicyPreserved(
  original: string,
  verify: string,
  before: Record<string, unknown>,
  after: Record<string, unknown> | null,
  added: string[],
): string | null {
  if (!verify.startsWith(original)) return 'existing bytes changed on disk';
  if (after === null) return 'result is no longer a readable YAML mapping';
  for (const key of Object.keys(before)) {
    if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
      return `existing adopter key "${key}" changed value`;
    }
  }
  for (const key of added) {
    if (!Object.prototype.hasOwnProperty.call(after, key)) return `new key "${key}" did not materialize`;
  }
  return null;
}

/** Default YAML rendering for an added policy key. */
function defaultRenderPolicyKey(key: string, value: unknown): string {
  return yaml.dump({ [key]: value }, { schema: yaml.JSON_SCHEMA, lineWidth: -1 });
}

/**
 * Replace ONLY the text between `startMarker` and `endMarker` in a bucket-1
 * file, proving byte-for-byte that everything outside the markers survived.
 *
 * Returns `{ replaced: false }` -- it does NOT throw -- when the markers are
 * absent, out of order, or duplicated. A file whose managed region cannot be
 * located unambiguously is indistinguishable from a file the user hand-edited,
 * so the safe disposition is to leave it entirely alone and report why (the
 * same fail-open-to-keep shape `mergeManaged` in `guidance.ts` already uses).
 * Throwing here would turn a hand-edited CLAUDE.md into a failed upgrade.
 */
export function guardedReplaceMarkedRegion(
  cwd: string,
  relFile: string,
  startMarker: string,
  endMarker: string,
  newBody: string,
): ReplaceRegionResult {
  const abs = resolve(cwd, relFile);
  if (!existsSync(abs)) return { replaced: false, reason: `${relFile} does not exist -- nothing to reconcile` };

  // Same alias hole the policy channel had: if the file (or a directory above
  // it) is a symlink/junction, this rewrites whatever it points at, and the
  // byte-prefix/suffix proof does NOT catch it -- the head and tail were read
  // through the same alias. A CLAUDE.md pointing at shared guidance, or at a
  // contracts/** file that happens to carry the markers, would be mutated.
  const realFile = realpathOfLongestExistingAncestor(abs);
  const realCwd = realpathOfLongestExistingAncestor(resolve(cwd));
  if (realFile === null || realCwd === null
      || relPosixFromCwd(realFile, realCwd).toLowerCase() !== relFile.split(String.fromCharCode(92)).join("/").toLowerCase()) {
    return {
      replaced: false,
      reason: `${relFile} resolves to "${realFile ?? "(unresolvable)"}" through a symlink/junction -- this channel may only rewrite the marked region of the repo's own file, left untouched (INV-2)`,
    };
  }

  let original: string;
  try {
    original = readFileSync(abs, 'utf8');
  } catch {
    return { replaced: false, reason: `${relFile} is unreadable -- fail-open to keep (INV-1)` };
  }

  const start = original.indexOf(startMarker);
  const end = original.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    return { replaced: false, reason: `${relFile} has no complete ${startMarker}/${endMarker} region -- left untouched (INV-1)` };
  }
  if (original.indexOf(startMarker, start + startMarker.length) >= 0) {
    return { replaced: false, reason: `${relFile} has more than one ${startMarker} -- region is ambiguous, left untouched (INV-1)` };
  }
  // A second END marker is just as ambiguous as a second START: the region would
  // silently be taken as ending at the first one, and everything between the two
  // would be rewritten as if it were inside. Checking only the start marker made
  // the "duplicated markers fail open" promise in this function's contract half
  // true (codex review, PR #69).
  if (original.indexOf(endMarker, end + endMarker.length) >= 0) {
    return { replaced: false, reason: `${relFile} has more than one ${endMarker} -- region is ambiguous, left untouched (INV-1)` };
  }

  const head = original.slice(0, start + startMarker.length);
  const tail = original.slice(end);
  const next = head + newBody + tail;
  if (next === original) return { replaced: false, reason: `${relFile} ${startMarker} region already up to date` };

  writeFileSync(abs, next);

  // Prove the untouched parts are untouched, from disk -- not from the string
  // we happen to hold in memory.
  const verify = readFileSync(abs, 'utf8');
  if (!verify.startsWith(head) || !verify.endsWith(tail)) {
    writeFileSync(abs, original);
    throw new Error(
      `guardedReplaceMarkedRegion refused: content outside the ${startMarker} region changed -- ${relFile} restored unchanged (INV-2). ` +
      'See contracts/upgrade/upgrade-reconciliation-contract.md ## Bucket 1 — Never-Overwrite Ground Truth.',
    );
  }
  return { replaced: true, reason: `${relFile} ${startMarker} region reconciled` };
}

/** `GuardedWrite` capability handed to a `Reconciler` (design.md `## Registry Interface`). */
export function makeGuardedWrite(cwd: string = process.cwd()): GuardedWrite {
  return {
    copyInto: (src, dest) => guardedCopyFile(src, dest, cwd),
    writeInto: (dest, content) => guardedWriteFile(dest, content, cwd),
    addPolicyKeys: (additions, renderKey) => guardedAddPolicyKeys(cwd, additions, renderKey),
    replaceMarkedRegion: (relFile, startMarker, endMarker, newBody) =>
      guardedReplaceMarkedRegion(cwd, relFile, startMarker, endMarker, newBody),
  };
}
