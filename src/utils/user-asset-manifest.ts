import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { homedir } from 'os';

export type UserAssetProvider = 'claude' | 'codex';

interface UserAssetRecord {
  provider: UserAssetProvider;
  sha256: string;
}

interface UserAssetManifest {
  schema_version: 1;
  package_version: string;
  providers: UserAssetProvider[];
  assets: Record<string, UserAssetRecord>;
}

export const USER_ASSET_MANIFEST = join(homedir(), '.cdd-kit', 'install-manifest.json');

function emptyManifest(): UserAssetManifest {
  return { schema_version: 1, package_version: 'unknown', providers: [], assets: {} };
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function manifestKey(path: string): string | null {
  const rel = relative(homedir(), path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join('/');
}

export function loadUserAssetManifest(): UserAssetManifest {
  if (!existsSync(USER_ASSET_MANIFEST)) return emptyManifest();
  try {
    const parsed = JSON.parse(readFileSync(USER_ASSET_MANIFEST, 'utf8')) as Partial<UserAssetManifest>;
    if (parsed.schema_version !== 1 || !parsed.assets || typeof parsed.assets !== 'object') return emptyManifest();
    return {
      schema_version: 1,
      package_version: typeof parsed.package_version === 'string' ? parsed.package_version : 'unknown',
      providers: Array.isArray(parsed.providers)
        ? parsed.providers.filter((p): p is UserAssetProvider => p === 'claude' || p === 'codex')
        : [],
      assets: parsed.assets,
    };
  } catch {
    return emptyManifest();
  }
}

export function isOwnedAndUnmodified(path: string, manifest = loadUserAssetManifest()): boolean {
  const key = manifestKey(path);
  if (!key || !existsSync(path)) return false;
  const record = manifest.assets[key];
  return !!record && record.sha256 === hashFile(path);
}

export function mappedDestinationFiles(sourceRoot: string, destinationRoot: string): string[] {
  const files: string[] = [];
  if (!existsSync(sourceRoot)) return files;
  function walk(src: string, dest: string): void {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const source = join(src, entry.name);
      const destination = join(dest, entry.name);
      if (entry.isDirectory()) walk(source, destination);
      else if (entry.isFile() && existsSync(destination)) files.push(destination);
    }
  }
  walk(sourceRoot, destinationRoot);
  return files;
}

export function stampUserAssets(provider: UserAssetProvider, paths: string[], packageVersion: string): void {
  const manifest = loadUserAssetManifest();
  for (const path of paths) {
    const key = manifestKey(path);
    if (!key || !existsSync(path)) continue;
    manifest.assets[key] = { provider, sha256: hashFile(path) };
  }
  if (!manifest.providers.includes(provider)) manifest.providers.push(provider);
  manifest.providers.sort();
  manifest.package_version = packageVersion;
  mkdirSync(dirname(USER_ASSET_MANIFEST), { recursive: true });
  const tmp = `${USER_ASSET_MANIFEST}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmp, USER_ASSET_MANIFEST);
}
