// Install/content-digest stamping for kit-shipped assets (ADR 0010 SS6; design.md
// Q3). `refresh`/`upgrade`/`install-agent-hooks` write `.cdd/asset-manifest.json`
// -- a single sidecar `{relpath: {version, digest}}` -- after each copy, instead
// of stamping content into the asset itself (design.md Q3 rejects per-asset
// frontmatter: it cannot be added to `.sh` hooks or `settings.json`, and
// stamping an asset changes that asset's own digest). `doctor` reads this
// sidecar to detect post-install drift (installed vs manifest) and a stale or
// partial install (installed vs the currently packaged asset), AC-8.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { sha256OfFileNormalized } from './digest.js';

export interface AssetManifestEntry {
  version: string;
  digest: string;
}

export type AssetManifest = Record<string, AssetManifestEntry>;

function manifestPath(cwd: string): string {
  return join(cwd, '.cdd', 'asset-manifest.json');
}

/** Read `.cdd/asset-manifest.json`. Missing or malformed => `{}` (no stamps recorded). */
export function readAssetManifest(cwd: string): AssetManifest {
  const p = manifestPath(cwd);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as AssetManifest)
      : {};
  } catch {
    return {};
  }
}

/**
 * Record (merge) install stamps for the given repo-relative paths, keyed by
 * their forward-slash relpath. Each installed file's digest is recomputed from
 * the file ON DISK at the destination (not the source asset), so the manifest
 * always reflects what was actually written. A path that does not exist on
 * disk is skipped (nothing to stamp). Called by refresh/upgrade/
 * install-agent-hooks immediately after each copy.
 */
export function stampAssetManifest(cwd: string, version: string, installedRelPaths: string[]): void {
  if (installedRelPaths.length === 0) return;
  const current = readAssetManifest(cwd);
  for (const rel of installedRelPaths) {
    const relNormalized = rel.replace(/\\/g, '/');
    const abs = join(cwd, relNormalized);
    if (!existsSync(abs)) continue;
    current[relNormalized] = { version, digest: sha256OfFileNormalized(abs) };
  }
  const p = manifestPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}
