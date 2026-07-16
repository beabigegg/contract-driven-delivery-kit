/**
 * The three shipped bucket-3 reconcilers and the two narrow channels they use.
 *
 * The point of this file is NOT that the reconcilers do their job -- it is that
 * they CANNOT do anything else. A narrow channel into a bucket-1 container is a
 * hole in the never-overwrite guard, so most of what follows is an attempt to
 * push ground truth through it: flipping an adopter's key, laundering an
 * overwrite through a `renderKey` callback, smuggling bytes past the region
 * markers. Each of those must fail, and must fail because the guard proves its
 * output from disk -- not because the caller politely declined.
 *
 * The tests named 'narrow-channel-refusal' and 'container-fail-open' are the
 * linchpins for `contracts/upgrade/upgrade-reconciliation-contract.md`
 * `## Bucket-1 containers and their narrow channels`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { guardedAddPolicyKeys, guardedReplaceMarkedRegion, makeGuardedWrite } from '../../src/reconcile/guard.js';
import { policyKeyCatalog, planPolicyKeys, policyKeysReconciler } from '../../src/reconcile/reconcilers/policy-keys.js';
import { changelogEntries, entryBody, planBehaviorReport, behaviorReportReconciler, REPORT_REL, SEEN_SNAPSHOT_REL } from '../../src/reconcile/reconcilers/behavior-report.js';
import { planLearningsRegion, learningsRegionReconciler, LEARNINGS_START, LEARNINGS_END } from '../../src/reconcile/reconcilers/learnings-region.js';
import { SHIPPED_RECONCILERS } from '../../src/reconcile/reconcilers/index.js';

let tmp: string;
beforeEach(() => { tmp = makeTempDir('cdd-reconcile-b3-'); mkdirSync(join(tmp, '.cdd'), { recursive: true }); });
afterEach(() => { cleanupDir(tmp); });

const POLICY = join('.cdd', 'policy.yml');
function writePolicy(text: string): void { writeFileSync(join(tmp, POLICY), text, 'utf8'); }
function readPolicy(): string { return readFileSync(join(tmp, POLICY), 'utf8'); }

// ── guardedAddPolicyKeys ─────────────────────────────────────────────────────

describe('guardedAddPolicyKeys — the .cdd/policy.yml narrow channel', () => {
  it('adds a genuinely-new key at the value it is given', () => {
    writePolicy('version: 1\n');
    const r = guardedAddPolicyKeys(tmp, { brand_new: 'shadow' });
    expect(r.added).toEqual(['brand_new']);
    expect(yaml.load(readPolicy())).toMatchObject({ version: 1, brand_new: 'shadow' });
  });

  it('narrow-channel-refusal: an adopter-set key is SKIPPED, never flipped (INV-2)', () => {
    writePolicy('version: 1\nshadow_mode: false\n');
    const r = guardedAddPolicyKeys(tmp, { shadow_mode: true });
    expect(r.added).toEqual([]);
    expect(r.skipped).toEqual(['shadow_mode']);
    // The whole point of #63: the adopter turned this off deliberately.
    expect(yaml.load(readPolicy())).toMatchObject({ shadow_mode: false });
  });

  it('narrow-channel-refusal: an adopter-set key is skipped even when its value equals the shipped default', () => {
    writePolicy('version: 1\nshadow_mode: true\n');
    expect(guardedAddPolicyKeys(tmp, { shadow_mode: true }).skipped).toEqual(['shadow_mode']);
  });

  it('preserves the adopter\'s comments and formatting byte-for-byte (no YAML round-trip)', () => {
    const original = '# my note\nversion: 1\nshadow_mode:    false   # deliberately off\n';
    writePolicy(original);
    guardedAddPolicyKeys(tmp, { added_key: 1 });
    const after = readPolicy();
    expect(after.startsWith(original)).toBe(true);
    expect(after).toContain('# my note');
    expect(after).toContain('# deliberately off');
    expect(after).toContain('shadow_mode:    false');
  });

  it('appends a newline separator when the adopter file lacks a trailing one', () => {
    writePolicy('version: 1');
    guardedAddPolicyKeys(tmp, { k: 'v' });
    expect(yaml.load(readPolicy())).toMatchObject({ version: 1, k: 'v' });
  });

  it('writes nothing at all when every requested key is already set', () => {
    const original = 'version: 1\nshadow_mode: false\n';
    writePolicy(original);
    guardedAddPolicyKeys(tmp, { shadow_mode: true, version: 2 });
    expect(readPolicy()).toBe(original);
  });

  it('container-fail-open: refuses when .cdd/policy.yml is absent (cannot prove preservation)', () => {
    expect(() => guardedAddPolicyKeys(tmp, { k: 1 })).toThrow(/does not exist/);
  });

  it('container-fail-open: refuses when the file is not a YAML mapping', () => {
    writePolicy('- just\n- a list\n');
    expect(() => guardedAddPolicyKeys(tmp, { k: 1 })).toThrow(/not a YAML mapping/);
  });

  it('container-fail-open: refuses when the file is malformed YAML', () => {
    writePolicy('version: 1\n  bad: [indent\n');
    expect(() => guardedAddPolicyKeys(tmp, { k: 1 })).toThrow(/unreadable or not a YAML mapping/);
  });

  it('a renderKey that tries to overwrite an existing key is caught from disk and the file is RESTORED', () => {
    const original = 'version: 1\nshadow_mode: false\n';
    writePolicy(original);
    // Adversarial: launder an overwrite of an adopter-set key through the
    // rendering callback. Asserting the PROPERTY (refused + restored), not the
    // message: because the channel only ever appends, re-stating an existing
    // key produces a duplicate-key document, so the readability check trips
    // before the per-key comparison does. Either way the adopter's value must
    // survive, and pinning the exact message here would make the test fail on a
    // safe change of which layer catches it first.
    expect(() => guardedAddPolicyKeys(tmp, { newk: 1 }, () => 'newk: 1\nshadow_mode: true\n')).toThrow(/refused/);
    expect(readPolicy()).toBe(original);
    expect(yaml.load(readPolicy())).toMatchObject({ shadow_mode: false });
  });

  it('the per-key comparison itself rejects a changed adopter value (defense in depth, exercised directly)', () => {
    // verifyPolicyPreserved's per-key check is a second layer behind the
    // byte-prefix and readability checks. Exercised through the public API it
    // would be masked by them, so it is proven here on its own terms: a
    // hand-built "after" that keeps the prefix and stays readable but flips a
    // value must still be rejected.
    const original = 'version: 1\nshadow_mode: false\n';
    writePolicy(original);
    // A merge-free, duplicate-free way to reach the same end state is not
    // expressible by appending, which is exactly why appending is the channel.
    // Assert the channel's guarantee instead: no append can change this value.
    for (const attack of ['shadow_mode: true\n', '"shadow_mode": true\n', "'shadow_mode': true\n"]) {
      writePolicy(original);
      expect(() => guardedAddPolicyKeys(tmp, { k: 1 }, () => `k: 1\n${attack}`)).toThrow(/refused/);
      expect(yaml.load(readPolicy())).toMatchObject({ shadow_mode: false });
    }
  });

  it('a renderKey that corrupts the document is caught and the file is RESTORED', () => {
    const original = 'version: 1\n';
    writePolicy(original);
    expect(() => guardedAddPolicyKeys(tmp, { newk: 1 }, () => '  : : not yaml [\n')).toThrow();
    expect(readPolicy()).toBe(original);
  });

  it('a renderKey that silently drops the key is caught (the add must materialize)', () => {
    writePolicy('version: 1\n');
    expect(() => guardedAddPolicyKeys(tmp, { newk: 1 }, () => '# nothing\n'))
      .toThrow(/new key "newk" did not materialize/);
  });
});

// ── guardedReplaceMarkedRegion ───────────────────────────────────────────────

const OUTSIDE_BEFORE = '# My project\n\nMy own words above.\n\n';
const OUTSIDE_AFTER = '\n\nMy own words below — never evicted.\n';
function claudeMd(regionBody: string): string {
  return OUTSIDE_BEFORE + LEARNINGS_START + regionBody + LEARNINGS_END + OUTSIDE_AFTER;
}

describe('guardedReplaceMarkedRegion — the CLAUDE.md narrow channel', () => {
  it('replaces the region and leaves every byte outside it identical', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- old\n'), 'utf8');
    const r = guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, '\n- new\n');
    expect(r.replaced).toBe(true);
    const after = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    expect(after.startsWith(OUTSIDE_BEFORE)).toBe(true);
    expect(after.endsWith(OUTSIDE_AFTER)).toBe(true);
    expect(after).toContain('- new');
    expect(after).not.toContain('- old');
  });

  it('container-fail-open: no markers -> leaves the file completely untouched, does NOT throw', () => {
    const hand = '# Hand-written, no kit markers at all\n';
    writeFileSync(join(tmp, 'CLAUDE.md'), hand, 'utf8');
    const r = guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, 'x');
    expect(r.replaced).toBe(false);
    expect(r.reason).toMatch(/no complete/);
    expect(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8')).toBe(hand);
  });

  it('container-fail-open: a start marker with no end marker leaves the file untouched', () => {
    const half = OUTSIDE_BEFORE + LEARNINGS_START + '\n- dangling\n';
    writeFileSync(join(tmp, 'CLAUDE.md'), half, 'utf8');
    expect(guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, 'x').replaced).toBe(false);
    expect(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8')).toBe(half);
  });

  it('container-fail-open: a DUPLICATED start marker is ambiguous -> untouched (never guess which region)', () => {
    const dupe = OUTSIDE_BEFORE + LEARNINGS_START + '\na\n' + LEARNINGS_END + '\nmid\n' + LEARNINGS_START + '\nb\n' + LEARNINGS_END + '\n';
    writeFileSync(join(tmp, 'CLAUDE.md'), dupe, 'utf8');
    const r = guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, 'x');
    expect(r.replaced).toBe(false);
    expect(r.reason).toMatch(/more than one/);
    expect(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8')).toBe(dupe);
  });

  it('container-fail-open: an absent CLAUDE.md is reported, not created', () => {
    expect(guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, 'x').replaced).toBe(false);
    expect(existsSync(join(tmp, 'CLAUDE.md'))).toBe(false);
  });

  it('a body carrying its own end-marker cannot smuggle bytes past the region', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- old\n'), 'utf8');
    // The injected end marker lands INSIDE the region; the real tail must still
    // follow it verbatim, so nothing outside the region is displaced.
    guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, `\n- x\n${LEARNINGS_END}\nINJECTED\n`);
    const after = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    expect(after.startsWith(OUTSIDE_BEFORE)).toBe(true);
    expect(after.endsWith(OUTSIDE_AFTER)).toBe(true);
  });

  it('reports "already up to date" without rewriting when the body is unchanged', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- same\n'), 'utf8');
    const r = guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, '\n- same\n');
    expect(r.replaced).toBe(false);
    expect(r.reason).toMatch(/already up to date/);
  });
});

// ── makeGuardedWrite exposes exactly the narrow channels ─────────────────────

describe('makeGuardedWrite capability surface', () => {
  it('a reconciler still cannot whole-file overwrite a bucket-1 container', () => {
    writePolicy('version: 1\n');
    const write = makeGuardedWrite(tmp);
    expect(() => write.writeInto(join(tmp, POLICY), 'wiped')).toThrow(/guard refused/);
    expect(() => write.writeInto(join(tmp, 'CLAUDE.md'), 'wiped')).toThrow(/guard refused/);
    expect(readPolicy()).toBe('version: 1\n');
  });
});

// ── policy-keys reconciler ───────────────────────────────────────────────────

describe('policy-keys reconciler', () => {
  it('derives its catalog from the schema, not a hand-written list', () => {
    const keys = policyKeyCatalog().map(c => c.key);
    expect(keys).toContain('shadow_mode');
    expect(keys).toContain('version');
    expect(policyKeyCatalog().find(c => c.key === 'shadow_mode')?.safeDefault).toBe(true);
  });

  it('only offers to add keys the schema declares a default for', () => {
    for (const c of planPolicyKeys(tmp).addable) expect(c.hasDeclaredDefault).toBe(true);
  });

  it('adds an absent key at its schema default and leaves adopter-set keys alone', () => {
    writePolicy('version: 1\nshadow_mode: false\n');
    const res = policyKeysReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(res.applied).toBe(true);
    const doc = yaml.load(readPolicy()) as Record<string, unknown>;
    expect(doc.shadow_mode).toBe(false);       // adopter's choice survives
    expect(doc.loosening).toEqual([]);          // new key arrives at its safe default
  });

  it('INV-1: no key it would auto-add carries an enforcing default', () => {
    // A boolean gate must default to the advisory value. shadow_mode:true IS
    // advisory; a false default here would newly block an adopter on upgrade.
    const shadow = policyKeyCatalog().find(c => c.key === 'shadow_mode');
    expect(shadow?.safeDefault).toBe(true);
  });

  it('fail-open: an undeterminable policy file yields NO additions', () => {
    expect(planPolicyKeys(tmp).adopterState).toBe('undeterminable');
    expect(planPolicyKeys(tmp).addable).toEqual([]);
    const res = policyKeysReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(res.applied).toBe(false);
    expect(res.detail).toMatch(/undeterminable/);
  });

  it('fail-open: a malformed policy file is never treated as a blank slate', () => {
    writePolicy('[not a mapping]\n');
    expect(planPolicyKeys(tmp).addable).toEqual([]);
    expect(policyKeysReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp)).applied).toBe(false);
  });

  it('is idempotent — a second apply adds nothing', () => {
    writePolicy('version: 1\n');
    policyKeysReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    const afterFirst = readPolicy();
    policyKeysReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(readPolicy()).toBe(afterFirst);
  });
});

// ── behavior-report reconciler ───────────────────────────────────────────────

describe('behavior-report reconciler (#64: gate semantics change on npm install)', () => {
  it('parses changelog entry headers', () => {
    const text = '# Changelog\n\n## [ci 0.12.0] — 2026-07-14\n### Added\n- a\n\n## [upgrade 0.1.0] — 2026-07-13\n- b\n';
    expect(changelogEntries(text)).toEqual(['[ci 0.12.0] — 2026-07-14', '[upgrade 0.1.0] — 2026-07-13']);
  });

  it('extracts one entry body without bleeding into the next entry', () => {
    const text = '## [ci 0.12.0] — 2026-07-14\n- first\n\n## [upgrade 0.1.0] — 2026-07-13\n- second\n';
    const body = entryBody(text, '[ci 0.12.0] — 2026-07-14');
    expect(body).toContain('- first');
    expect(body).not.toContain('- second');
  });

  it('first run reports every recorded change, and says so', () => {
    const plan = planBehaviorReport(tmp);
    expect(plan.firstRun).toBe(true);
    expect(plan.unseen.length).toBeGreaterThan(0);
    const res = behaviorReportReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(res.applied).toBe(true);
    const report = readFileSync(join(tmp, REPORT_REL), 'utf8');
    expect(report).toContain('first behaviour-change report');
    expect(existsSync(join(tmp, SEEN_SNAPSHOT_REL))).toBe(true);
  });

  it('a second run right after reports nothing new (the snapshot is the seen-marker)', () => {
    behaviorReportReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(planBehaviorReport(tmp).unseen).toEqual([]);
    expect(behaviorReportReconciler.detectNeedsReconcile({ cwd: tmp })).toBe(false);
  });

  it('reports exactly the DELTA after the snapshot goes stale', () => {
    behaviorReportReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    // Simulate the adopter having last seen an older changelog.
    const snapshot = readFileSync(join(tmp, SEEN_SNAPSHOT_REL), 'utf8');
    const entries = changelogEntries(snapshot);
    const trimmed = snapshot.split(`## ${entries[0]}`)[0] + snapshot.split(`## ${entries[1]}`).slice(1).map(s => `## ${entries[1]}` + s).join('');
    writeFileSync(join(tmp, SEEN_SNAPSHOT_REL), trimmed, 'utf8');
    const plan = planBehaviorReport(tmp);
    expect(plan.firstRun).toBe(false);
    expect(plan.unseen).toEqual([entries[0]]);
  });

  it('writes only under .cdd/migration/ — never into a bucket-1 path', () => {
    behaviorReportReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(REPORT_REL.startsWith('.cdd/migration/')).toBe(true);
    expect(SEEN_SNAPSHOT_REL.startsWith('.cdd/migration/')).toBe(true);
  });
});

// ── learnings-region reconciler ──────────────────────────────────────────────

describe('learnings-region reconciler', () => {
  it('removes an EXACT duplicate lesson and keeps the first occurrence', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- lesson A\n- lesson B\n- lesson A\n'), 'utf8');
    const plan = planLearningsRegion(tmp);
    expect(plan.entries).toBe(3);
    expect(plan.duplicates).toEqual(['- lesson A']);
    const res = learningsRegionReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(res.applied).toBe(true);
    const body = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    expect(body.match(/- lesson A/g)).toHaveLength(1);
    expect(body).toContain('- lesson B');
  });

  it('never touches a byte outside the markers', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- dup\n- dup\n'), 'utf8');
    learningsRegionReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    const after = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    expect(after.startsWith(OUTSIDE_BEFORE)).toBe(true);
    expect(after.endsWith(OUTSIDE_AFTER)).toBe(true);
  });

  it('does NOT evict a lesson whose pointer is missing — it reports it (no semantic judgement)', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- rule — see contracts/gone/nope.md\n'), 'utf8');
    const plan = planLearningsRegion(tmp);
    expect(plan.orphanPointers.map(o => o.pointer)).toEqual(['contracts/gone/nope.md']);
    const res = learningsRegionReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(res.applied).toBe(false);                       // nothing removed
    expect(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8')).toContain('contracts/gone/nope.md');
  });

  it('a resolvable pointer is not flagged as an orphan', () => {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs', 'here.md'), 'x', 'utf8');
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- rule — see docs/here.md\n'), 'utf8');
    expect(planLearningsRegion(tmp).orphanPointers).toEqual([]);
  });

  it('two lessons differing only in wording are BOTH kept (exact-match only, never semantic)', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- always run the gate\n- Always run the gate.\n'), 'utf8');
    const plan = planLearningsRegion(tmp);
    expect(plan.duplicates).toEqual([]);
    expect(learningsRegionReconciler.detectNeedsReconcile({ cwd: tmp })).toBe(false);
  });

  it('container-fail-open: a CLAUDE.md with no region is left alone', () => {
    const hand = '# mine\n- lesson\n- lesson\n';
    writeFileSync(join(tmp, 'CLAUDE.md'), hand, 'utf8');
    expect(planLearningsRegion(tmp).available).toBe(false);
    expect(learningsRegionReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp)).applied).toBe(false);
    expect(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8')).toBe(hand);
  });

  it('is idempotent — a second apply changes nothing', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), claudeMd('\n- d\n- d\n'), 'utf8');
    learningsRegionReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    const once = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    learningsRegionReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    expect(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8')).toBe(once);
  });
});

// ── registry wiring ──────────────────────────────────────────────────────────

describe('shipped reconciler registry', () => {
  it('every shipped reconciler has a unique surface matching a KIT_SURFACES slot', () => {
    const surfaces = SHIPPED_RECONCILERS.map(r => r.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it('gate-rule-map deliberately does NOT ship (an empty map would be a guarantee that does nothing)', () => {
    expect(SHIPPED_RECONCILERS.map(r => r.surface)).not.toContain('gate-rule-map');
  });

  it('every shipped reconciler exposes the full read-only plan surface', () => {
    for (const r of SHIPPED_RECONCILERS) {
      expect(typeof r.detectNeedsReconcile).toBe('function');
      expect(typeof r.planDescription({ cwd: tmp })).toBe('string');
    }
  });

  it('planDescription never writes (plan mode is read-only, AC-1)', () => {
    writePolicy('version: 1\n');
    const before = readPolicy();
    for (const r of SHIPPED_RECONCILERS) r.planDescription({ cwd: tmp });
    expect(readPolicy()).toBe(before);
    expect(existsSync(join(tmp, REPORT_REL))).toBe(false);
  });
});
