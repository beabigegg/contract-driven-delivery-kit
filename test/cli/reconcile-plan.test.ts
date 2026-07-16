/**
 * Unit + integration coverage for the reconciliation framework
 * (specs/changes/reconcile-framework). Unit-level guard/classifier/registry
 * coverage lives here as distinct describe() blocks (direct imports of
 * src/reconcile/*.ts), not through the CLI, per test-plan.md's note that this
 * is the one new file the context manifest grants for this module.
 *
 * The two linchpin tests -- named 'guard-refusal' and 'fail-open' below -- are
 * mutation-red-proven per contracts/upgrade/upgrade-reconciliation-contract.md
 * `## Mechanical Enforcement` and are also what
 * `enforceReconciliationInvariants` (src/reconcile/invariants.ts) statically
 * scans this file's source for at gate time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { assertWritable, isBucket1, isWithinDir, bucket1ContractRows } from '../../src/reconcile/guard.js';
import { classifyPath, classifyPolicyKey, readAdopterPolicyKeys, KIT_SURFACES } from '../../src/reconcile/classifier.js';
import { ReconcileRegistry } from '../../src/reconcile/registry.js';
import { checkReconciliationInvariants, extractBucket1ContractRows } from '../../src/reconcile/invariants.js';
import { stampAssetManifest } from '../../src/utils/asset-manifest.js';
import { AGENTS_HOME } from '../../src/utils/paths.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('KIT_SURFACES catalog (AC-1: every kit-shipped surface maps to exactly one bucket)', () => {
  it('every surface has a unique id (no dupe)', () => {
    const ids = KIT_SURFACES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every surface has exactly one valid bucket (no gap)', () => {
    for (const s of KIT_SURFACES) {
      expect(['keep', 'replace', 'reconcile']).toContain(s.bucket);
    }
  });

  it('covers all three buckets (no bucket is empty)', () => {
    const buckets = new Set(KIT_SURFACES.map(s => s.bucket));
    expect(buckets).toEqual(new Set(['keep', 'replace', 'reconcile']));
  });
});

describe('guard.assertWritable -- bucket-1 refusal (AC-2, INV-2 linchpin)', () => {
  const BUCKET_1_SAMPLES = [
    'contracts/foo.md',
    'src/index.ts',
    'tests/unit/foo.test.ts',
    'specs/changes/some-change/tasks.yml',
    'specs/archive/2026/old-change/tasks.yml',
    'CLAUDE.md',
    'AGENTS.md',
    'CODEX.md',
    'package.json',
    '.cdd/policy.yml',
    '.cdd/context-policy.json',
    '.cdd/code-map-config.yml',
    'acceptance.yml',
    'interaction-design.md',
    '.cdd/design-lock.json',
    '.cdd/acceptance-lock.json',
  ];

  for (const p of BUCKET_1_SAMPLES) {
    it('guard-refusal: assertWritable throws for bucket-1 path ' + p, () => {
      expect(() => assertWritable(p, REPO_ROOT)).toThrow();
    });
  }

  it('guard-refusal: a non-existent path under the real ~/.claude/agents/ is bucket-1 (not owned -> user content, AC-2/row 5)', () => {
    const p = join(AGENTS_HOME, '__cdd_reconcile_framework_test_nonexistent__.md');
    expect(() => assertWritable(p)).toThrow();
  });

  it('guard-refusal: the thrown error names the contract rule', () => {
    expect(() => assertWritable('CLAUDE.md', REPO_ROOT)).toThrow(/bucket-1/);
  });

  it('does NOT refuse a bucket-2 kit-scaffold path', () => {
    expect(() => assertWritable('specs/templates/change-classification.md', REPO_ROOT)).not.toThrow();
  });

  it('tests/templates/ is explicitly excluded from the tests/** bucket-1 rule', () => {
    expect(() => assertWritable('tests/templates/refresh.test.ts', REPO_ROOT)).not.toThrow();
  });

  it('isBucket1 returns the matching rule (used by the classifier, not reinvented)', () => {
    const result = isBucket1('CLAUDE.md', REPO_ROOT);
    expect(result.blocked).toBe(true);
    expect(result.rule?.contractRow).toContain('CLAUDE.md');
  });
});

describe('isWithinDir (pure path-containment helper)', () => {
  it('a direct child is within the parent', () => {
    expect(isWithinDir(join('C:', 'home', '.claude', 'agents', 'x.md'), join('C:', 'home', '.claude', 'agents'))).toBe(true);
  });

  it('a sibling directory is not within the parent', () => {
    expect(isWithinDir(join('C:', 'home', '.claude', 'skills', 'x.md'), join('C:', 'home', '.claude', 'agents'))).toBe(false);
  });

  it('the parent itself is not "within" (child === parent)', () => {
    expect(isWithinDir(join('C:', 'home', '.claude', 'agents'), join('C:', 'home', '.claude', 'agents'))).toBe(false);
  });
});

describe('classifyPath fail-open (AC-6, INV-1 linchpin)', () => {
  it('fail-open: malformed (non-string) input classifies as keep', () => {
    const d = classifyPath(undefined, REPO_ROOT);
    expect(d.bucket).toBe('keep');
  });

  it('fail-open: empty-string path classifies as keep', () => {
    const d = classifyPath('', REPO_ROOT);
    expect(d.bucket).toBe('keep');
  });

  it('fail-open: unknown/unrecognized path with no asset-manifest stamp classifies as keep', () => {
    const d = classifyPath('some-totally-unrecognized-file.md', REPO_ROOT);
    expect(d.bucket).toBe('keep');
  });

  it('fail-open: a bucket-1 path classifies as keep, never replace', () => {
    const d = classifyPath('CLAUDE.md', REPO_ROOT);
    expect(d.bucket).toBe('keep');
  });
});

describe('classifyPath against a fixture repo', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTempDir('cdd-classify-'); });
  afterEach(() => { cleanupDir(tmp); });

  it('fail-open: a file with no asset-manifest stamp classifies as keep even though it exists', () => {
    writeFileSync(join(tmp, 'random.md'), 'hello', 'utf8');
    const d = classifyPath('random.md', tmp);
    expect(d.bucket).toBe('keep');
  });

  it('kit-owned-and-unmodified project file classifies as replace (AC-7: delegated to asset-manifest/digest)', () => {
    mkdirSync(join(tmp, 'specs', 'templates'), { recursive: true });
    writeFileSync(join(tmp, 'specs', 'templates', 'foo.md'), 'kit content', 'utf8');
    stampAssetManifest(tmp, '9.9.9', ['specs/templates/foo.md']);
    const d = classifyPath('specs/templates/foo.md', tmp);
    expect(d.bucket).toBe('replace');
  });

  it('kit-owned file modified after install demotes to keep (AC-7 delegated digest check, never reinvented)', () => {
    mkdirSync(join(tmp, 'specs', 'templates'), { recursive: true });
    const p = join(tmp, 'specs', 'templates', 'foo.md');
    writeFileSync(p, 'kit content', 'utf8');
    stampAssetManifest(tmp, '9.9.9', ['specs/templates/foo.md']);
    writeFileSync(p, 'USER EDITED THIS', 'utf8');
    const d = classifyPath('specs/templates/foo.md', tmp);
    expect(d.bucket).toBe('keep');
    expect(d.reason).toContain('modified after install');
  });
});

describe('.cdd/policy.yml per-key classification (AC-2/AC-6)', () => {
  it('adopter-set key stays keep, never flipped', () => {
    const d = classifyPolicyKey('shadow_mode', true);
    expect(d.bucket).toBe('keep');
  });

  it('genuinely-new key reconciles with a safe default (not keep, not replace)', () => {
    const d = classifyPolicyKey('brand_new_feature_flag', false);
    expect(d.bucket).toBe('reconcile');
    expect(d.action).toBe('needs-reconcile');
  });

  it('fail-open: undeterminable adopter-file state classifies as keep', () => {
    const d = classifyPolicyKey('anything', 'unknown');
    expect(d.bucket).toBe('keep');
  });

  it('fail-open: malformed key classifies as keep', () => {
    const d = classifyPolicyKey(undefined, true);
    expect(d.bucket).toBe('keep');
  });
});

describe('readAdopterPolicyKeys', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTempDir('cdd-policykeys-'); mkdirSync(join(tmp, '.cdd'), { recursive: true }); });
  afterEach(() => { cleanupDir(tmp); });

  it('returns null when .cdd/policy.yml is missing (fail-open: undeterminable)', () => {
    expect(readAdopterPolicyKeys(tmp)).toBeNull();
  });

  it('returns null for malformed YAML (fail-open: undeterminable)', () => {
    writeFileSync(join(tmp, '.cdd', 'policy.yml'), '{ not: valid: yaml: [', 'utf8');
    expect(readAdopterPolicyKeys(tmp)).toBeNull();
  });

  it('returns the top-level key set for a valid mapping', () => {
    writeFileSync(join(tmp, '.cdd', 'policy.yml'), 'shadow_mode: true\nfoo: bar\n', 'utf8');
    const keys = readAdopterPolicyKeys(tmp);
    expect(keys).not.toBeNull();
    expect(Array.from(keys ?? []).sort()).toEqual(['foo', 'shadow_mode']);
  });
});

describe('ReconcileRegistry (AC-3)', () => {
  it('register + list round-trips a typed reconciler', () => {
    const registry = new ReconcileRegistry();
    const r = {
      surface: 'demo',
      detectNeedsReconcile: () => true,
      planDescription: () => 'demo plan',
      apply: () => ({ surface: 'demo', applied: true, detail: 'ok' }),
    };
    registry.register(r);
    expect(registry.list()).toEqual([r]);
  });

  it('rejects a duplicate surface id', () => {
    const registry = new ReconcileRegistry();
    const r = {
      surface: 'dup',
      detectNeedsReconcile: () => false,
      planDescription: () => '',
      apply: () => ({ surface: 'dup', applied: false, detail: '' }),
    };
    registry.register(r);
    expect(() => registry.register(r)).toThrow();
  });

  it('list() returns a defensive copy (mutating it does not affect the registry)', () => {
    const registry = new ReconcileRegistry();
    const list1 = registry.list() as unknown[];
    list1.push({});
    expect(registry.list().length).toBe(0);
  });
});

describe('AC-3: reconcile.ts calls registry.list() exactly once per invocation (single plan/apply pass)', () => {
  it('reconcile.ts source calls defaultRegistry.list() exactly once', () => {
    const src = readFileSync(join(REPO_ROOT, 'src', 'commands', 'reconcile.ts'), 'utf8');
    const count = src.split('defaultRegistry.list()').length - 1;
    expect(count).toBe(1);
  });
});

describe('single-writer static scan (AC-2/AC-3, contract Mechanical Enforcement #2)', () => {
  it('src/reconcile/** and refresh.ts applyPlan() have zero raw fs-write call sites outside guard.ts', () => {
    const findings = checkReconciliationInvariants(REPO_ROOT);
    const writeFindings = findings.filter(f =>
      f.message.includes('raw filesystem write call') || f.message.includes('calls a raw filesystem write function'));
    expect(writeFindings).toEqual([]);
  });
});

describe('bucket-1 matcher coverage (AC-5, contract Mechanical Enforcement #1)', () => {
  it('guard.ts BUCKET_1_RULES exactly matches the contract enumeration (no gap, no drift)', () => {
    const contractText = readFileSync(join(REPO_ROOT, 'contracts', 'upgrade', 'upgrade-reconciliation-contract.md'), 'utf8');
    const contractRows = extractBucket1ContractRows(contractText).slice().sort();
    const guardRows = bucket1ContractRows().slice().sort();
    expect(guardRows).toEqual(contractRows);
  });

  it('extractBucket1ContractRows finds all 5 enumerated bucket-1 rows', () => {
    const contractText = readFileSync(join(REPO_ROOT, 'contracts', 'upgrade', 'upgrade-reconciliation-contract.md'), 'utf8');
    expect(extractBucket1ContractRows(contractText).length).toBe(5);
  });
});

describe('enforceReconciliationInvariants -- full check against this repo (AC-5)', () => {
  it('reports zero findings once the linchpin tests exist in this file (self-referential closure)', () => {
    const findings = checkReconciliationInvariants(REPO_ROOT);
    expect(findings.map(f => f.message)).toEqual([]);
  });

  it("is a no-op outside this kit's own repo (an adopter project has no src/reconcile/)", () => {
    const tmp = makeTempDir('cdd-invariants-noop-');
    try {
      expect(checkReconciliationInvariants(tmp)).toEqual([]);
    } finally {
      cleanupDir(tmp);
    }
  });
});

describe('cdd-kit reconcile -- CLI integration (isolated fixture repo)', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-reconcile-repo-');
    tmpHome = makeTempDir('cdd-reconcile-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error('init failed: ' + r.stderr);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('AC-1: default invocation (no flags) is the read-only plan and mutates nothing', () => {
    const tplPath = join(tmpRepo, 'specs', 'templates', 'change-classification.md');
    const before = readFileSync(tplPath, 'utf8');
    const beforeMtime = statSync(tplPath).mtimeMs;
    const claudeMdBefore = readFileSync(join(tmpRepo, 'CLAUDE.md'), 'utf8');

    const r = runCli(['reconcile'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/read-only/);

    expect(readFileSync(tplPath, 'utf8')).toBe(before);
    expect(statSync(tplPath).mtimeMs).toBe(beforeMtime);
    expect(readFileSync(join(tmpRepo, 'CLAUDE.md'), 'utf8')).toBe(claudeMdBefore);
    expect(existsSync(join(tmpRepo, '.cdd', '.refresh-backup'))).toBe(false);
  });

  it('AC-1: --plan prints one disposition line per KIT_SURFACES id', () => {
    const r = runCli(['reconcile', '--plan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    for (const s of KIT_SURFACES) {
      expect(r.stdout).toContain(s.id);
    }
  });

  it('AC-2 integration: --yes never overwrites a tampered bucket-1 file', () => {
    mkdirSync(join(tmpRepo, 'contracts', 'demo'), { recursive: true });
    const userContract = join(tmpRepo, 'contracts', 'demo', 'api.md');
    writeFileSync(userContract, '# my contract\n', 'utf8');
    const claudeMdPath = join(tmpRepo, 'CLAUDE.md');
    const claudeBefore = readFileSync(claudeMdPath, 'utf8');

    const r = runCli(['reconcile', '--yes'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(userContract, 'utf8')).toBe('# my contract\n');
    expect(readFileSync(claudeMdPath, 'utf8')).toBe(claudeBefore);
  });

  it('AC-4: --yes bucket-2 apply overwrites a tampered kit-scaffold template with a backup', () => {
    const tplPath = join(tmpRepo, 'specs', 'templates', 'change-classification.md');
    writeFileSync(tplPath, 'TAMPERED\n', 'utf8');
    const r = runCli(['reconcile', '--yes'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(tplPath, 'utf8')).not.toBe('TAMPERED\n');
    expect(existsSync(join(tmpRepo, '.cdd', '.refresh-backup'))).toBe(true);
  });

  it('AC-4: bucket-2 refresh preserves the "Repository-specific fast gate" workflow step text', () => {
    const r = runCli(['reconcile', '--yes'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const wf = readFileSync(join(tmpRepo, '.github', 'workflows', 'contract-driven-gates.yml'), 'utf8');
    expect(wf).toContain('Repository-specific fast gate');
  });

  it('registry: reports the bucket-3 reconcilers this kit version ships', () => {
    const r = runCli(['reconcile', '--plan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('3 bucket-3 reconciler(s) registered');
  });

  it('registry: gate-rule-map still shows its slot with no reconciler behind it (the gap stays visible)', () => {
    // A surface whose reconciler does not ship must still be printed. Dropping
    // the slot would hide the gap instead of reporting it.
    const r = runCli(['reconcile', '--plan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout).toContain('gate-rule-map');
    expect(r.stdout).toMatch(/gate-rule-map[\s\S]*?registry slot only, none ships in this kit version/);
  });
});
