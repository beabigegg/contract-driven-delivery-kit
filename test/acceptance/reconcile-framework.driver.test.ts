/**
 * Acceptance driver for specs/changes/reconcile-framework/acceptance.yml
 * (ADR 0010). Answers are read LIVE from the oracle via the emitted loader —
 * never typed here — and every case exercises the REAL guard, classifier, and
 * CLI. No mocking of the system under test.
 *
 * Authoring constraints this file honours (they are scanned mechanically):
 * the word-for-word answer-key leaves of the oracle must not appear as
 * standalone tokens, so success/failure is asserted structurally
 * (`toEqual(loaded.expect)`) and counts are computed, not typed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { makeTempDir, cleanupDir, runCli } from '../helpers.js';
import { loadCase } from '../../specs/templates/acceptance-driver/acceptance.loader.js';
import { makeGuardedWrite } from '../../src/reconcile/guard.js';
import { classifyPolicyKey, classifyPath } from '../../src/reconcile/classifier.js';
import { policyKeysReconciler } from '../../src/reconcile/reconcilers/policy-keys.js';
import { checkReconciliationInvariants } from '../../src/reconcile/invariants.js';

const CHANGE_ID = 'reconcile-framework';

let tmp: string;
let tmpHome: string;
beforeEach(() => {
  tmp = makeTempDir('cdd-rf-driver-');
  tmpHome = makeTempDir('cdd-rf-driver-home-');
});
afterEach(() => { cleanupDir(tmp); cleanupDir(tmpHome); });

describe('reconcile-framework acceptance driver (specs/changes/reconcile-framework/acceptance.yml)', () => {
  it('guard-refuses-bucket1-write', () => {
    const loaded = loadCase(CHANGE_ID, 'guard-refuses-bucket1-write');
    const input = loaded.input as { write_target: string };

    const target = join(tmp, input.write_target);
    mkdirSync(join(target, '..'), { recursive: true });
    const sentinel = 'ground truth the upgrade path must never touch';
    writeFileSync(target, sentinel, 'utf8');

    let refused = false;
    try {
      makeGuardedWrite(tmp).writeInto(target, 'overwritten by an apply step');
    } catch {
      refused = true;
    }
    const actual = {
      refused,
      file_overwritten: readFileSync(target, 'utf8') !== sentinel,
    };
    expect(actual).toEqual(loaded.expect);
  });

  it('new-policy-key-fails-open-safe', () => {
    const loaded = loadCase(CHANGE_ID, 'new-policy-key-fails-open-safe');
    const input = loaded.input as { new_policy_key: string; adopter_has_key: boolean };

    // Classification of the input's own key, straight from the real classifier.
    const disposition = classifyPolicyKey(input.new_policy_key, input.adopter_has_key);

    // "default is safe" is proven by the real apply path: a policy file missing
    // a schema-declared key gains it at the schema's advisory default, which
    // must never be an enforcing value (INV-1). shadow_mode's advisory value is
    // `true` (shadowing = observe, don't block).
    mkdirSync(join(tmp, '.cdd'), { recursive: true });
    writeFileSync(join(tmp, '.cdd', 'policy.yml'), 'version: 1\n', 'utf8');
    policyKeysReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    const doc = yaml.load(readFileSync(join(tmp, '.cdd', 'policy.yml'), 'utf8')) as Record<string, unknown>;

    const actual = {
      classification: disposition.bucket,
      default_is_safe: doc.shadow_mode === true,
    };
    expect(actual).toEqual(loaded.expect);
  });

  it('user-set-policy-value-preserved', () => {
    const loaded = loadCase(CHANGE_ID, 'user-set-policy-value-preserved');
    const input = loaded.input as { policy_key: string; adopter_set_value: boolean };

    const disposition = classifyPolicyKey(input.policy_key, true);

    // Real apply over a file where the adopter has pinned a value: it must
    // survive byte-for-byte semantics-wise (read back equals what they set).
    mkdirSync(join(tmp, '.cdd'), { recursive: true });
    const policyPath = join(tmp, '.cdd', 'policy.yml');
    writeFileSync(policyPath, `version: 1\n${input.policy_key}: ${JSON.stringify(input.adopter_set_value)}\n`, 'utf8');
    policyKeysReconciler.apply({ cwd: tmp }, makeGuardedWrite(tmp));
    const doc = yaml.load(readFileSync(policyPath, 'utf8')) as Record<string, unknown>;

    const actual = {
      classification: disposition.bucket,
      value_changed: doc[input.policy_key] !== input.adopter_set_value,
    };
    expect(actual).toEqual(loaded.expect);
  });

  it('malformed-input-fails-open-to-keep', () => {
    const loaded = loadCase(CHANGE_ID, 'malformed-input-fails-open-to-keep');

    let crashed = false;
    let bucket = '';
    try {
      // Malformed classifier input in both senses the oracle names: a
      // non-string path and an unreadable/unknown surface state.
      bucket = classifyPath(12345 as unknown as string, tmp).bucket;
      const alsoUnknown = classifyPolicyKey(undefined, 'unknown').bucket;
      expect(alsoUnknown).toBe(bucket);
    } catch {
      crashed = true;
    }
    const actual = { bucket, crashed };
    expect(actual).toEqual(loaded.expect);
  });

  it('plan-mode-mutates-nothing', () => {
    const loaded = loadCase(CHANGE_ID, 'plan-mode-mutates-nothing');

    // An adopter repo with surfaces in all three buckets.
    mkdirSync(join(tmp, 'contracts'), { recursive: true });
    mkdirSync(join(tmp, 'specs', 'templates'), { recursive: true });
    mkdirSync(join(tmp, '.cdd'), { recursive: true });
    writeFileSync(join(tmp, 'contracts', 'api.md'), 'adopter ground truth', 'utf8');
    writeFileSync(join(tmp, 'specs', 'templates', 'tasks.yml'), 'kit template', 'utf8');
    writeFileSync(join(tmp, '.cdd', 'policy.yml'), 'version: 1\n', 'utf8');
    writeFileSync(join(tmp, 'CLAUDE.md'), 'guidance', 'utf8');

    const before = snapshot(tmp);
    const r = runCli(['reconcile', '--plan'], { cwd: tmp, home: tmpHome });
    expect(Boolean(r.status), r.stderr).toBe(false);
    const after = snapshot(tmp);

    const mutatedPaths: string[] = [];
    for (const [p, digest] of after) {
      if (before.get(p) !== digest) mutatedPaths.push(p);
    }
    for (const p of before.keys()) {
      if (!after.has(p)) mutatedPaths.push(p);
    }
    const actual = { files_mutated: mutatedPaths.length };
    expect(actual, mutatedPaths.join(', ')).toEqual(loaded.expect);
  });

  it('rule single-guarded-writer-chokepoint: every apply-path write routes through the one guard', () => {
    // The rule is cross-cutting, so its evidence is the mechanical single-writer
    // scan over THIS repo's real sources (contract ## Mechanical Enforcement
    // #2): zero raw fs-write call sites in the reconciliation module or the
    // bucket-2 apply path outside the guarded writer. The invariants check also
    // enforces matcher coverage and the recorded-evidence set; a clean run here
    // is the rule holding on the shipped tree, not a fixture.
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const findings = checkReconciliationInvariants(repoRoot);
    expect(findings.map((f) => f.message)).toEqual([]);
  });
});

/** content digest of every file under `root`, keyed by relative path. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  walk(root, '');
  return out;

  function walk(abs: string, rel: string): void {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const nextAbs = join(abs, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(nextAbs, nextRel);
      } else if (entry.isFile()) {
        const digest = createHash('sha256').update(readFileSync(nextAbs)).digest('hex');
        out.set(nextRel, `${digest}:${statSync(nextAbs).size}`);
      }
    }
  }
}
