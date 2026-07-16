/**
 * IP-11 -- full-journey E2E + resilience tests for the reconciliation
 * framework (specs/changes/reconcile-framework). Drives the REAL built CLI
 * (`node dist/cli/index.js reconcile [--plan|--yes]`, via `runCli`) over a
 * from-scratch fixture adopter repo containing representative bucket-1 /
 * bucket-2 / (a documented-boundary) bucket-3 surface, and injects faults
 * during classify/plan to prove the classifier FAILS OPEN to bucket-1 `keep`
 * and the plan pass never crashes
 * (contracts/upgrade/upgrade-reconciliation-contract.md INV-1/INV-2;
 * design.md `## Migration / Rollback / Fail-open`).
 *
 * SCOPE BOUNDARY (read before extending): `cdd-kit reconcile --plan`
 * (src/commands/reconcile.ts) prints ONE line per `KIT_SURFACES` catalog
 * entry (12 static rows) -- it does NOT walk the fixture repo file-by-file.
 * Per-file bucket decisions come from `classifyPath`/`classifyPolicyKey`
 * (src/reconcile/classifier.ts), which no CURRENT CLI code path calls per
 * file: the four bucket-3 reconcilers that would are OUT OF SCOPE of this
 * change and `defaultRegistry` ships EMPTY (design.md `## Affected
 * Components`, change-classification.md "the four bucket-3 reconcilers are
 * OUT OF SCOPE"). Concretely: bucket-3 is only CLI-observable as an inert
 * registry slot ("0 bucket-3 reconciler(s) registered", never applied). This
 * file therefore verifies bucket-1/2/3 per-file dispositions by calling
 * `classifyPath`/`classifyPolicyKey` directly against the SAME fixture repo
 * the CLI journeys build -- exactly what a future bucket-3 reconciler
 * (detectNeedsReconcile/apply) will do -- and documents this boundary
 * explicitly rather than silently asserting something the CLI cannot yet do.
 *
 * Complements, does not duplicate, test/cli/reconcile-plan.test.ts (unit +
 * narrow integration, same context-manifest grant, same fixture idiom via
 * runCli/makeTempDir). This file adds: (1) a full `--plan` run over a
 * richer, hand-built adopter fixture with a WHOLE-REPO content-hash snapshot
 * (not just two files), (2) failure injection during classify/plan (corrupt
 * .cdd/policy.yml, corrupt .cdd/asset-manifest.json, unreadable file -- both
 * a deterministic directory-shadowing case and a best-effort real OS
 * permission denial -- missing surface, unknown surface, garbled CLAUDE.md,
 * stale-cache) proving fail-open end to end, and (3) one full `--yes` apply
 * journey with a byte-level backup-before-overwrite assertion plus a direct
 * guard-refusal proof against this same fixture's bucket-1 paths.
 *
 * NOT-APPLICABLE Cover bullets for this CLI/filesystem SUT (recorded, not
 * silently dropped, per this change's own test-plan.md N/A convention):
 * browser back/forward, URL state restoration, hidden-tab/visibility-change,
 * slow network / 500 / 503 / abort / timeout, auth expiry. reconcile is a
 * synchronous, offline, unauthenticated local filesystem command with no
 * browser, HTTP, or auth surface (change-classification.md "no HTTP API
 * surface", "CLI-only").
 */
import { describe, it, expect } from 'vitest';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync,
  chmodSync, rmSync,
} from 'fs';
import { join, relative, sep } from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { classifyPath, classifyPolicyKey, readAdopterPolicyKeys, KIT_SURFACES } from '../../src/reconcile/classifier.js';
import { assertWritable } from '../../src/reconcile/guard.js';
import { AGENTS_HOME } from '../../src/utils/paths.js';
import type { Bucket } from '../../src/schemas/reconciliation.schema.js';

// -- generic helpers ---------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Mirrors src/commands/reconcile.ts's private bucketLabel -- the exact
 *  bracketed text --plan prints per surface. Intentionally NOT imported
 *  (not exported): this duplication is the load-bearing assertion that the
 *  CLI's printed label format has not silently drifted from the taxonomy. */
function expectedLabel(bucket: Bucket): string {
  if (bucket === 'keep') return '1 keep';
  if (bucket === 'replace') return '2 replace';
  return '3 reconcile';
}

function fileDigest(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** repo-relative-path -> sha256:size for every FILE under root (skips
 *  .git). Used to prove --plan mutates NOTHING across the WHOLE fixture
 *  tree, not just a couple of hand-picked files. */
function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.isFile()) continue;
      const rel = relative(root, p).split(sep).join('/');
      const st = statSync(p);
      out[rel] = fileDigest(p) + ':' + st.size;
    }
  }
  walk(root);
  return out;
}

function findBackupFile(root: string, basename: string): string | null {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findBackupFile(p, basename);
      if (found) return found;
    } else if (entry.isFile() && entry.name === basename) {
      return p;
    }
  }
  return null;
}

/** Parse the "<present>/<total> root(s) present" line printed directly under
 *  a given KIT_SURFACES id's disposition line (src/commands/reconcile.ts). */
function extractRootCount(stdout: string, surfaceId: string): { present: number; total: number } | null {
  const lines = stdout.split(/\r?\n/);
  const idx = lines.findIndex(l => l.includes('] ' + surfaceId + ' --'));
  if (idx === -1) return null;
  for (let i = idx + 1; i < Math.min(idx + 3, lines.length); i++) {
    const m = lines[i].match(/(\d+)\/(\d+) root\(s\) present/);
    if (m) return { present: Number(m[1]), total: Number(m[2]) };
  }
  return null;
}

// -- fixture builder ---------------------------------------------------------

interface Fixture {
  repo: string;
  home: string;
  userContractPath: string;
  acceptancePath: string;
  policyPath: string;
  userAgentPath: string;
  kitTemplatePath: string;
}

/**
 * Full adopter journey: init --local-only (first install), then
 * reconcile --yes ONCE (an adopter who has already run the framework at
 * least once, so kit-owned templates carry a real asset-manifest digest
 * baseline -- without this, specs/templates/** has no stamp and classifies
 * as bucket-1 "unknown provenance", never bucket-2 "replace" -- see
 * classifyPath's asset-manifest branch), THEN layers representative
 * adopter (bucket-1) ground truth on top: a user contract, an acceptance
 * oracle, an adopter-set .cdd/policy.yml key, and a user-authored (non-kit)
 * agent under the fixture HOME. This is the realistic "adopter mid-lifecycle,
 * about to upgrade" repo shape reconcile is designed for -- not a bare
 * init scaffold.
 */
function buildAdopterFixture(prefix: string): Fixture {
  const repo = makeTempDir('cdd-e2e-' + prefix + '-repo-');
  const home = makeTempDir('cdd-e2e-' + prefix + '-home-');

  let r = runCli(['init', '--local-only'], { cwd: repo, home });
  if (r.status !== 0) throw new Error('fixture init failed: ' + r.stderr + '\n' + r.stdout);

  r = runCli(['reconcile', '--yes'], { cwd: repo, home });
  if (r.status !== 0) throw new Error('fixture baseline reconcile --yes failed: ' + r.stderr + '\n' + r.stdout);

  // Bucket-1: user-authored contract (adopter/tool ground truth).
  const userContractPath = join(repo, 'contracts', 'billing', 'invoice-api.md');
  mkdirSync(join(repo, 'contracts', 'billing'), { recursive: true });
  writeFileSync(userContractPath, '# Invoice API contract\n\nuser-authored ground truth, never overwritten.\n', 'utf8');

  // Bucket-1: human-confirmed acceptance oracle.
  const acceptancePath = join(repo, 'acceptance.yml');
  writeFileSync(acceptancePath, 'schema-version: 0.1.0\nchange-id: fixture-adopter\ncriteria: []\n', 'utf8');

  // Bucket-1: an adopter-set .cdd/policy.yml key, appended to the shipped defaults.
  const policyPath = join(repo, '.cdd', 'policy.yml');
  const policyBefore = readFileSync(policyPath, 'utf8');
  writeFileSync(policyPath, policyBefore + '\nadopter_custom_flag: true\n', 'utf8');

  // Bucket-1: the user's own (non-kit) agent, installed under the fixture HOME.
  const userAgentDir = join(home, '.claude', 'agents');
  mkdirSync(userAgentDir, { recursive: true });
  const userAgentPath = join(userAgentDir, 'my-custom-agent.md');
  writeFileSync(userAgentPath, '---\nname: my-custom-agent\n---\n\nUser-authored agent; the kit never installed this file.\n', 'utf8');

  const kitTemplatePath = join(repo, 'specs', 'templates', 'change-classification.md');

  return { repo, home, userContractPath, acceptancePath, policyPath, userAgentPath, kitTemplatePath };
}

function cleanupFixture(f: Fixture): void {
  cleanupDir(f.repo);
  cleanupDir(f.home);
}

// -- Journey A: full --plan over the fixture adopter repo (AC-1) ------------

describe('IP-11 Journey A: full reconcile --plan over a fixture adopter repo (AC-1)', () => {
  it('every KIT_SURFACES bucket is represented and correctly labeled in a single --plan run', () => {
    const f = buildAdopterFixture('journeyA-labels');
    try {
      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/read-only/);

      for (const s of KIT_SURFACES) {
        const label = expectedLabel(s.bucket);
        const re = new RegExp('\\[' + escapeRegExp(label) + '\\]\\s+' + escapeRegExp(s.id) + '\\b');
        expect(r.stdout, 'missing/mislabeled disposition line for surface "' + s.id + '"').toMatch(re);
      }
      expect(r.stdout).toContain('[1 keep]');
      expect(r.stdout).toContain('[2 replace]');
      expect(r.stdout).toContain('[3 reconcile]');
      expect(r.stdout).toContain('registry: 3 bucket-3 reconciler(s) registered');
    } finally {
      cleanupFixture(f);
    }
  });

  it('mutates NOTHING: whole-repo content-hash snapshot is byte-identical before/after --plan', () => {
    const f = buildAdopterFixture('journeyA-snapshot');
    try {
      const before = snapshotTree(f.repo);
      const beforeMtime = statSync(f.kitTemplatePath).mtimeMs;
      expect(Object.keys(before).length, 'fixture must be non-trivial for this snapshot to mean anything').toBeGreaterThan(10);

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);

      const after = snapshotTree(f.repo);
      expect(after).toEqual(before);
      expect(statSync(f.kitTemplatePath).mtimeMs).toBe(beforeMtime);
    } finally {
      cleanupFixture(f);
    }
  });
});

describe('IP-11 Journey A (continued): per-file disposition of the SAME fixture via classifyPath/classifyPolicyKey', () => {
  it('bucket-1: user contract, acceptance.yml, adopter policy key, and the user home-agent all classify keep', () => {
    const f = buildAdopterFixture('journeyA-perfile-keep');
    try {
      expect(classifyPath('contracts/billing/invoice-api.md', f.repo).bucket).toBe('keep');
      expect(classifyPath('acceptance.yml', f.repo).bucket).toBe('keep');
      // NOTE: classifyPath(f.userAgentPath) is NOT asserted here. AGENTS_HOME
      // (src/utils/paths.ts) is `join(homedir(), '.claude', 'agents')`,
      // resolved ONCE at module import time from the REAL process
      // environment -- a fixture's fake HOME/USERPROFILE (only honored by a
      // fresh `runCli` child process) cannot retarget it for an in-process
      // call in this same vitest worker. The real "user's own home agent"
      // ownership-check branch is proven below, against the REAL AGENTS_HOME,
      // and end-to-end (across a real `--yes` apply) in Journey C.
      expect(classifyPath(join(AGENTS_HOME, '__cdd_e2e_reconcile_nonexistent__.md')).bucket).toBe('keep');

      const keys = readAdopterPolicyKeys(f.repo);
      expect(keys?.has('adopter_custom_flag')).toBe(true);
      expect(classifyPolicyKey('adopter_custom_flag', true).bucket).toBe('keep');
    } finally {
      cleanupFixture(f);
    }
  });

  it('bucket-2: the kit-owned, unmodified template (stamped by the baseline reconcile --yes) classifies replace', () => {
    const f = buildAdopterFixture('journeyA-perfile-replace');
    try {
      const d = classifyPath('specs/templates/change-classification.md', f.repo);
      expect(d.bucket).toBe('replace');
    } finally {
      cleanupFixture(f);
    }
  });

  it('bucket-3: a genuinely new .cdd/policy.yml key resolves to reconcile, and the policy-keys reconciler now acts on it', () => {
    const f = buildAdopterFixture('journeyA-perfile-reconcile');
    try {
      const keys = readAdopterPolicyKeys(f.repo);
      expect(keys?.has('brand_new_flag_from_a_future_kit_version')).toBe(false);
      const d = classifyPolicyKey('brand_new_flag_from_a_future_kit_version', false);
      expect(d.bucket).toBe('reconcile');
      expect(d.action).toBe('needs-reconcile');

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);
      // The disposition is no longer stranded: a reconciler is registered for
      // this surface and the plan says what it would do. (Before the bucket-3
      // work, --plan printed the disposition with an empty registry behind it,
      // so `needs-reconcile` was a promise nothing could honour.)
      expect(r.stdout).toContain('registry: 3 bucket-3 reconciler(s) registered');
      expect(r.stdout).toMatch(/reconciler: policy-keys/);

      // ...but only for keys this kit version actually knows. The catalog is
      // derived from cdd-policy.schema.ts, so a hypothetical future key is
      // correctly NOT invented into the adopter's file.
      expect(r.stdout).not.toContain('brand_new_flag_from_a_future_kit_version');
    } finally {
      cleanupFixture(f);
    }
  });
});

// -- Journey B: failure injection during classify/plan (AC-6, INV-1/INV-2) --

describe('IP-11 Journey B: failure injection during classify/plan fails open to keep (AC-6)', () => {
  it('corrupt .cdd/policy.yml (malformed YAML): reconcile --plan does not crash; per-key classification fails open to keep', () => {
    const f = buildAdopterFixture('faultB-corrupt-policy');
    try {
      writeFileSync(f.policyPath, '{ this is not: [valid yaml, at all', 'utf8');

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('registry: 3 bucket-3 reconciler(s) registered');

      // The registered policy-keys reconciler must say it can determine nothing
      // and offer to add nothing -- a broken file is not an empty file. Without
      // this, a corrupt policy could be "migrated" by writing every key the kit
      // knows into it.
      expect(r.stdout).toMatch(/policy-keys[\s\S]*?fail-open to keep/);
      expect(r.stdout).not.toMatch(/policy-keys -- add \d+ new key/);

      // Undeterminable adopter-key membership must fail open to keep -- never
      // be guessed as "new key => reconcile" just because the file is broken.
      expect(readAdopterPolicyKeys(f.repo)).toBeNull();
      const d = classifyPolicyKey('adopter_custom_flag', 'unknown');
      expect(d.bucket).toBe('keep');
    } finally {
      cleanupFixture(f);
    }
  });

  it('corrupt/truncated .cdd/asset-manifest.json: a previously-stamped kit template demotes to keep instead of trusting a broken cache', () => {
    const f = buildAdopterFixture('faultB-corrupt-manifest');
    try {
      const manifestPath = join(f.repo, '.cdd', 'asset-manifest.json');
      expect(existsSync(manifestPath), 'sanity: baseline reconcile --yes must have stamped this').toBe(true);
      writeFileSync(manifestPath, '{ "specs/templates/change-classification.md": { "digest": "aaaa', 'utf8');

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);

      const d = classifyPath('specs/templates/change-classification.md', f.repo);
      expect(d.bucket).toBe('keep');
    } finally {
      cleanupFixture(f);
    }
  });

  it('missing expected file: a kit-scaffold root deleted entirely -- reconcile --plan does not crash and reports the drop', () => {
    const f = buildAdopterFixture('faultB-missing-root');
    try {
      const before = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(before.status, before.stderr).toBe(0);
      const beforeCount = extractRootCount(before.stdout, 'kit-scaffold-templates');
      expect(beforeCount).not.toBeNull();

      rmSync(join(f.repo, 'specs', 'templates'), { recursive: true, force: true });

      const after = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(after.status, after.stderr).toBe(0);
      const afterCount = extractRootCount(after.stdout, 'kit-scaffold-templates');
      expect(afterCount).not.toBeNull();
      expect(afterCount!.present).toBe(beforeCount!.present - 1);
      expect(afterCount!.total).toBe(beforeCount!.total);

      const d = classifyPath('specs/templates/change-classification.md', f.repo);
      expect(d.bucket).toBe('keep');
    } finally {
      cleanupFixture(f);
    }
  });

  it('unexpected/unknown surface: a stray binary file with no matching bucket rule fails open to keep and does not crash --plan', () => {
    const f = buildAdopterFixture('faultB-unknown-surface');
    try {
      const strayDir = join(f.repo, 'legacy-migration-leftover');
      mkdirSync(strayDir, { recursive: true });
      writeFileSync(join(strayDir, 'config.dat'), Buffer.from([0x00, 0xff, 0x10, 0x20]));

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);

      expect(classifyPath('legacy-migration-leftover/config.dat', f.repo).bucket).toBe('keep');
    } finally {
      cleanupFixture(f);
    }
  });

  it('unexpected CLAUDE.md content (binary garbage): still classifies keep and --plan does not crash', () => {
    const f = buildAdopterFixture('faultB-garbled-claude-md');
    try {
      writeFileSync(join(f.repo, 'CLAUDE.md'), Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x00]));

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);
      expect(classifyPath('CLAUDE.md', f.repo).bucket).toBe('keep');
    } finally {
      cleanupFixture(f);
    }
  });

  it('deterministic unreadable-as-a-file surface (a directory sits where a file is expected): fails open to keep, --plan does not crash', () => {
    // Cross-platform, non-skippable stand-in for "the file cannot be read" --
    // an interrupted install/extraction leaving a directory instead of a file
    // at a bucket-2 target triggers the exact same EISDIR failure mode as a
    // genuinely unreadable file, without depending on OS ACL support.
    const f = buildAdopterFixture('faultB-dir-not-file');
    try {
      rmSync(f.kitTemplatePath, { force: true });
      mkdirSync(f.kitTemplatePath, { recursive: true });
      writeFileSync(join(f.kitTemplatePath, 'unexpected.txt'), 'oops', 'utf8');

      expect(() => classifyPath('specs/templates/change-classification.md', f.repo)).not.toThrow();
      const d = classifyPath('specs/templates/change-classification.md', f.repo);
      expect(d.bucket).toBe('keep');

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);
    } finally {
      cleanupFixture(f);
    }
  });

  it('classifyPath never throws for any malformed/empty input type (fail-open, not fail-crash)', () => {
    for (const bad of [undefined, null, 42, {}, [], '', '   ']) {
      expect(() => classifyPath(bad as unknown as string)).not.toThrow();
      expect(classifyPath(bad as unknown as string).bucket).toBe('keep');
    }
  });
});

// -- Journey B (continued): true OS permission-denial, best-effort ----------

function denyReadAccess(filePath: string): void {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    if (!user) throw new Error('no USERNAME in environment -- cannot simulate a Windows read denial');
    execFileSync('icacls', [filePath, '/inheritance:r'], { stdio: 'ignore' });
    execFileSync('icacls', [filePath, '/deny', user + ':(R)'], { stdio: 'ignore' });
  } else {
    chmodSync(filePath, 0o000);
  }
}

function restoreReadAccess(filePath: string): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('icacls', [filePath, '/reset'], { stdio: 'ignore' });
    } else {
      chmodSync(filePath, 0o644);
    }
  } catch {
    // Best-effort restore only -- never let a restore failure mask a real
    // assertion failure raised inside the test body's try block.
  }
}

/**
 * Collection-time capability probe (mirrors this repo's own hasPython()
 * convention in test/helpers.ts): actually apply the OS-specific denial to a
 * disposable scratch file and confirm a same-process read is genuinely
 * blocked, before trusting it for a real assertion. If the environment
 * cannot simulate this (no icacls, running with a privilege that bypasses
 * the DENY ACE, non-Windows without chmod effect, etc.) the dependent test is
 * SKIPPED via it.skipIf, never faked as a pass.
 */
const CAN_SIMULATE_READ_DENIAL: boolean = (() => {
  const probeDir = makeTempDir('cdd-e2e-permprobe-');
  const probeFile = join(probeDir, 'probe.txt');
  try {
    writeFileSync(probeFile, 'probe', 'utf8');
    denyReadAccess(probeFile);
    try {
      readFileSync(probeFile);
      return false; // read succeeded despite the simulated denial
    } catch {
      return true;
    }
  } catch {
    return false; // icacls/chmod itself failed (tool unavailable, no rights, ...)
  } finally {
    restoreReadAccess(probeFile);
    cleanupDir(probeDir);
  }
})();

if (!CAN_SIMULATE_READ_DENIAL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[reconcile-plan.e2e] real read-permission-denial simulation is unavailable on this host ' +
    '(icacls/chmod did not block a same-user read) -- the corresponding resilience test below is ' +
    'SKIPPED via it.skipIf, not faked as a pass. The deterministic directory-shadowing ' +
    'unreadable-surface test above still runs unconditionally on every host.',
  );
}

describe('IP-11 Journey B (continued): real OS permission-denial (best-effort, skip-with-reason on hosts that cannot simulate it)', () => {
  it.skipIf(!CAN_SIMULATE_READ_DENIAL)(
    'an unreadable (permission-denied) bucket-2 file fails open to keep; classifyPath never throws; --plan does not crash',
    () => {
      const f = buildAdopterFixture('faultB-unreadable');
      try {
        denyReadAccess(f.kitTemplatePath);
        try {
          // Non-vacuous precondition: confirm the fault is actually active
          // for THIS file before asserting behavior under it.
          expect(() => readFileSync(f.kitTemplatePath)).toThrow();

          expect(() => classifyPath('specs/templates/change-classification.md', f.repo)).not.toThrow();
          const d = classifyPath('specs/templates/change-classification.md', f.repo);
          expect(d.bucket).toBe('keep');

          const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
          expect(r.status, r.stderr).toBe(0);
        } finally {
          restoreReadAccess(f.kitTemplatePath);
        }
      } finally {
        cleanupFixture(f);
      }
    },
  );
});

// -- Journey B (continued): stale asset-manifest cache -----------------------

describe('IP-11 Journey B (continued): stale asset-manifest cache never wins over a real, current edit', () => {
  it('adopter edits a kit-owned template after the baseline stamp: classifier demotes it to keep, never trusts the stale digest', () => {
    const f = buildAdopterFixture('faultB-stale-cache');
    try {
      const before = classifyPath('specs/templates/change-classification.md', f.repo);
      expect(before.bucket, 'sanity: genuinely bucket-2 before the edit').toBe('replace');

      writeFileSync(f.kitTemplatePath, 'ADOPTER EDITED THIS AFTER THE BASELINE STAMP\n', 'utf8');

      const after = classifyPath('specs/templates/change-classification.md', f.repo);
      expect(after.bucket).toBe('keep');
      expect(after.reason).toContain('modified after install');

      const r = runCli(['reconcile', '--plan'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);
    } finally {
      cleanupFixture(f);
    }
  });
});

// -- Journey C: reconcile --yes apply -- bucket-1 untouched, bucket-2 -------
// backed up before overwrite (AC-2/AC-4). Exercised (not skipped): every
// fixture here is an isolated temp directory, matching the pattern already
// proven safe by test/cli/reconcile-plan.test.ts's own --yes integration
// block -- nothing in this file ever runs --yes against a real project.

describe('IP-11 Journey C: reconcile --yes apply over the fixture adopter repo (AC-2/AC-4)', () => {
  it('a tampered bucket-2 template is backed up byte-for-byte before being replaced; every bucket-1 surface -- including a garbled CLAUDE.md -- is byte-identical after apply', () => {
    const f = buildAdopterFixture('journeyC-apply');
    try {
      // Tamper the bucket-2 target so applyPlan has a real overwrite to perform.
      const tamperedTemplateContent = 'TAMPERED KIT TEMPLATE -- adopter accidentally edited this\n';
      writeFileSync(f.kitTemplatePath, tamperedTemplateContent, 'utf8');

      // Deliberately garble a bucket-1 surface's CONTENT (not just leave it
      // untouched) so the byte-identical assertion after apply is
      // non-vacuous -- wrong/garbled content is exactly the case the guard
      // must still refuse to "fix" or touch.
      const claudeMdPath = join(f.repo, 'CLAUDE.md');
      const garbledClaudeMd = '# NOT WHAT THE KIT SHIPS -- adopter-owned content, must never be touched\n';
      writeFileSync(claudeMdPath, garbledClaudeMd, 'utf8');

      const before = {
        userContract: readFileSync(f.userContractPath, 'utf8'),
        acceptance: readFileSync(f.acceptancePath, 'utf8'),
        policy: readFileSync(f.policyPath, 'utf8'),
        userAgent: readFileSync(f.userAgentPath, 'utf8'),
        claudeMd: garbledClaudeMd,
      };

      const r = runCli(['reconcile', '--yes'], { cwd: f.repo, home: f.home });
      expect(r.status, r.stderr).toBe(0);

      // Bucket-1: byte-identical, including the deliberately garbled ones.
      expect(readFileSync(f.userContractPath, 'utf8')).toBe(before.userContract);
      expect(readFileSync(f.acceptancePath, 'utf8')).toBe(before.acceptance);
      expect(readFileSync(f.policyPath, 'utf8')).toBe(before.policy);
      expect(readFileSync(f.userAgentPath, 'utf8')).toBe(before.userAgent);
      expect(readFileSync(claudeMdPath, 'utf8')).toBe(before.claudeMd);
      expect(readAdopterPolicyKeys(f.repo)?.has('adopter_custom_flag')).toBe(true);

      // Bucket-2: replaced with the real kit content (no longer the tampered text)...
      const templateAfter = readFileSync(f.kitTemplatePath, 'utf8');
      expect(templateAfter).not.toBe(tamperedTemplateContent);

      // ...and a byte-identical backup of the PRE-overwrite (tampered)
      // content was written before the overwrite happened.
      const backupRoot = join(f.repo, '.cdd', '.refresh-backup');
      expect(existsSync(backupRoot)).toBe(true);
      const backupFile = findBackupFile(backupRoot, 'change-classification.md');
      expect(backupFile, 'no backup file found for the tampered template').not.toBeNull();
      expect(readFileSync(backupFile as string, 'utf8')).toBe(tamperedTemplateContent);

      // The "Repository-specific fast gate" workflow step text survives the
      // bucket-2 refresh (AC-4).
      const wf = readFileSync(join(f.repo, '.github', 'workflows', 'contract-driven-gates.yml'), 'utf8');
      expect(wf).toContain('Repository-specific fast gate');
    } finally {
      cleanupFixture(f);
    }
  });

  it('boundary proof: the guard itself refuses a direct write attempt at every bucket-1 path in THIS fixture (complements, does not replace, the guard-refusal unit coverage)', () => {
    const f = buildAdopterFixture('journeyC-guard-boundary');
    try {
      expect(() => assertWritable(f.userContractPath, f.repo)).toThrow();
      expect(() => assertWritable(f.acceptancePath, f.repo)).toThrow();
      // f.userAgentPath (under the fixture's fake HOME) cannot be asserted
      // via a direct in-process assertWritable call -- see the NOTE in
      // Journey A (continued) above re: AGENTS_HOME's module-load-time
      // resolution. The real user-agent-under-real-AGENTS_HOME case IS
      // proven directly here instead, and the fixture's own home-agent
      // protection is proven end-to-end through a real --yes apply above
      // (byte-identical after apply).
      expect(() => assertWritable(join(AGENTS_HOME, '__cdd_e2e_reconcile_nonexistent__.md'))).toThrow();
    } finally {
      cleanupFixture(f);
    }
  });
});
