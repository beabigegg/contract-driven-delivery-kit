/**
 * Surface -> bucket classifier (design.md `## Key Decisions`). FAILS OPEN to
 * bucket `keep` on any malformed, unknown, or unreadable input -- never
 * `replace` (INV-2). Kit-vs-user ownership is delegated wholesale to the
 * existing digest/asset-manifest utilities (AC-7); nothing here reinvents
 * hashing or ownership detection.
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import { isBucket1, isWithinDir } from './guard.js';
import { isOwnedAndUnmodified } from '../utils/user-asset-manifest.js';
import { readAssetManifest } from '../utils/asset-manifest.js';
import { sha256OfFileNormalized } from '../utils/digest.js';
import { AGENTS_HOME, SKILLS_HOME, CODEX_SKILLS_HOME } from '../utils/paths.js';
import type { Bucket, SurfaceDisposition } from '../schemas/reconciliation.schema.js';

/**
 * Static catalog mirroring design.md `## Surface -> Bucket Taxonomy`.
 * `reconcile --plan` iterates this list exactly once, printing one
 * disposition line per surface (AC-1) -- never a per-file walk of the whole
 * repo. `roots` is informational (what the plan's file-count covers); it is
 * NOT the bucket-1 routing logic -- `guard.ts`'s `BUCKET_1_RULES` is.
 */
export interface KitSurface {
  id: string;
  bucket: Bucket;
  description: string;
  roots: string[];
  reconciler?: string;
}

export const KIT_SURFACES: readonly KitSurface[] = [
  {
    id: 'ground-truth-code-contracts', bucket: 'keep',
    roots: ['contracts', 'src', 'tests', 'specs/changes', 'specs/archive'],
    description: 'adopter/tool ground truth (contracts/, src/, tests/ excl. tests/templates/, specs/changes/, specs/archive/)',
  },
  {
    id: 'user-guidance-manifests', bucket: 'keep',
    roots: ['CLAUDE.md', 'AGENTS.md', 'CODEX.md', 'package.json'],
    description: 'user-owned guidance and manifests',
  },
  {
    id: 'adopter-policy', bucket: 'keep',
    roots: ['.cdd/policy.yml', '.cdd/context-policy.json', '.cdd/code-map-config.yml'],
    description: 'adopter policy (.cdd/policy.yml user-set keys only -- see per-key rule)',
  },
  {
    id: 'human-confirmed-oracle', bucket: 'keep',
    roots: ['acceptance.yml', 'interaction-design.md', '.cdd/acceptance-lock.json', '.cdd/design-lock.json'],
    description: 'human-confirmed oracle/design and their tamper-evident locks',
  },
  {
    id: 'user-agents-skills', bucket: 'keep',
    roots: ['~/.claude/agents', '~/.claude/skills', '~/.agents/skills'],
    description: "the user's own (non-kit-owned or modified) agents/skills",
  },
  {
    id: 'kit-scaffold-templates', bucket: 'replace',
    roots: ['specs/templates', 'tests/templates', 'tests/contract', 'ci-templates', '.github/workflows/contract-driven-gates.yml'],
    description: 'kit-shipped scaffold; force-refreshed with a backup first',
  },
  {
    id: 'kit-owned-agents-skills', bucket: 'replace',
    roots: ['~/.claude/agents', '~/.claude/skills', '~/.agents/skills'],
    description: 'digest-owned-and-unmodified kit agents/skills; overwritten with a backup first',
  },
  {
    id: 'derived-artifacts', bucket: 'replace',
    roots: ['.cdd/code-map.yml', '.git/hooks/pre-commit'],
    description: 'regenerable/derived, not adopter source',
  },
  {
    id: 'policy-keys', bucket: 'reconcile',
    roots: ['.cdd/policy.yml', '.cdd/model-policy.json'],
    description: '.cdd/policy.yml / model-policy.json key migration',
    reconciler: 'policy-keys',
  },
  {
    id: 'gate-rule-map', bucket: 'reconcile',
    roots: [],
    description: 'gate rule map migration',
    reconciler: 'gate-rule-map',
  },
  {
    id: 'behavior-report', bucket: 'reconcile',
    roots: [],
    description: 'behavior-change report migration',
    reconciler: 'behavior-report',
  },
  {
    id: 'learnings-region', bucket: 'reconcile',
    roots: ['CLAUDE.md'],
    description: 'CLAUDE.md promoted-learnings region migration',
    reconciler: 'learnings-region',
  },
];

function failOpenKeep(surface: string, target: string, reason: string): SurfaceDisposition {
  return { surface, bucket: 'keep', target, action: 'keep', reason };
}

/**
 * Classify a single repo-relative path. Fails open to `keep` for anything
 * malformed, unclassifiable, or of unknown provenance (INV-1/INV-2). Never
 * reinvents hashing -- delegates to `isOwnedAndUnmodified` (user-level) and
 * `readAssetManifest` + `sha256OfFileNormalized` (project-level), AC-7.
 */
export function classifyPath(path: unknown, cwd: string = process.cwd()): SurfaceDisposition {
  try {
    if (typeof path !== 'string' || path.trim() === '') {
      return failOpenKeep(String(path), String(path ?? ''), 'malformed/empty path -- fail-open to keep (INV-1)');
    }

    const bucket1Result = isBucket1(path, cwd);
    if (bucket1Result.blocked) {
      const why = bucket1Result.rule ? 'bucket-1 ground truth (' + bucket1Result.rule.contractRow + ')' : (bucket1Result.reason ?? 'bucket-1 ground truth');
      return failOpenKeep(path, path, why);
    }

    const abs = resolve(cwd, path);
    const homeDirs = [AGENTS_HOME, SKILLS_HOME, CODEX_SKILLS_HOME];
    if (homeDirs.some(h => isWithinDir(abs, h))) {
      const owned = isOwnedAndUnmodified(abs);
      return owned
        ? { surface: path, bucket: 'replace', target: path, action: existsSync(abs) ? 'overwrite-with-backup' : 'add', reason: 'kit-owned and unmodified (delegated ownership check)' }
        : failOpenKeep(path, path, 'ownership check did not confirm kit-owned-and-unmodified -- fail-open to keep (INV-1)');
    }

    const manifest = readAssetManifest(cwd);
    const rel = path.split('\\').join('/');
    const stamp = manifest[rel];
    if (stamp && existsSync(abs)) {
      const current = sha256OfFileNormalized(abs);
      return current === stamp.digest
        ? { surface: path, bucket: 'replace', target: path, action: 'overwrite-with-backup', reason: 'kit-owned and unmodified (asset-manifest digest match)' }
        : failOpenKeep(path, path, 'kit-owned copy was modified after install (asset-manifest digest mismatch) -- demoted to keep');
    }

    return failOpenKeep(path, path, existsSync(abs)
      ? 'no asset-manifest stamp -- unknown provenance, fail-open to keep (INV-1)'
      : 'absent and unclassified -- fail-open to keep (INV-1)');
  } catch {
    return failOpenKeep(String(path), String(path ?? ''), 'classification error -- fail-open to keep (INV-1)');
  }
}

/**
 * `.cdd/policy.yml` is classified PER-KEY, never per-file (contract
 * `## .cdd/policy.yml is classified PER-KEY`). `adopterHasKey === 'unknown'`
 * covers the case where the adopter's file state itself could not be
 * determined (missing/unreadable/malformed) -- the safest possible
 * disposition (keep) applies rather than guessing either way.
 */
export function classifyPolicyKey(key: unknown, adopterHasKey: boolean | 'unknown'): SurfaceDisposition {
  if (typeof key !== 'string' || key.trim() === '' || adopterHasKey === 'unknown') {
    return failOpenKeep(
      '.cdd/policy.yml#' + (typeof key === 'string' ? key : '(malformed)'),
      '.cdd/policy.yml',
      'policy key or adopter-file state could not be determined -- fail-open to keep (INV-1)',
    );
  }
  if (adopterHasKey) {
    return {
      surface: '.cdd/policy.yml#' + key, bucket: 'keep', target: '.cdd/policy.yml',
      action: 'keep', reason: 'adopter-set key -- never flipped or overwritten (INV-2)',
    };
  }
  return {
    surface: '.cdd/policy.yml#' + key, bucket: 'reconcile', target: '.cdd/policy.yml',
    action: 'needs-reconcile',
    reason: 'genuinely new key -- reconciled with a safe, non-blocking default (INV-1), never silently defaulted to enforcing',
  };
}

/**
 * Read the adopter's `.cdd/policy.yml` top-level keys. Returns `null` when
 * the file is missing, unreadable, or not a YAML mapping -- callers must
 * treat `null` as "adopter-file state undeterminable" and fail open per key
 * (`classifyPolicyKey(key, 'unknown')`), never assume every key is new.
 */
export function readAdopterPolicyKeys(cwd: string): Set<string> | null {
  const policyPath = join(cwd, '.cdd', 'policy.yml');
  if (!existsSync(policyPath)) return null;
  try {
    const doc = yaml.load(readFileSync(policyPath, 'utf8'), { schema: yaml.JSON_SCHEMA });
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return new Set(Object.keys(doc as Record<string, unknown>));
  } catch {
    return null;
  }
}
