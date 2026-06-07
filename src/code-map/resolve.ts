import { posix } from 'path';

// Local-import resolution shared by `cdd index impact` and `cdd test select`, so
// both turn a code-map import specifier into the same indexed repo path. Kept in
// one place to avoid two copies drifting apart.

/** File extensions tried when resolving an extension-less local import. */
export const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.py'] as const;

/** A module specifier is "local" (repo-resolvable) only when it is relative. */
export function isLocalImport(moduleName: string): boolean {
  return moduleName.startsWith('.');
}

/**
 * Resolve a relative import specifier to a repo-relative path present in
 * `pathSet`, or undefined when it cannot be resolved locally. Handles JS/TS
 * `./`, `../` and Python leading-dot relative imports. Absolute / package
 * imports are intentionally NOT resolved -- a miss is safe, a false match is not.
 */
export function resolveLocalModule(importerPath: string, moduleName: string, pathSet: Set<string>): string | undefined {
  if (!isLocalImport(moduleName)) return undefined;

  const base = moduleName.startsWith('./') || moduleName.startsWith('../')
    ? posix.normalize(posix.join(posix.dirname(importerPath), moduleName))
    : resolvePythonRelativeImport(importerPath, moduleName);

  for (const candidate of resolutionCandidates(base)) {
    if (pathSet.has(candidate)) return candidate;
  }
  return undefined;
}

export function resolvePythonRelativeImport(importerPath: string, moduleName: string): string {
  const match = moduleName.match(/^(\.+)(.*)$/);
  if (!match) return moduleName;
  const upLevels = Math.max(0, match[1].length - 1);
  let baseDir = posix.dirname(importerPath);
  for (let i = 0; i < upLevels; i++) {
    baseDir = posix.dirname(baseDir);
  }
  const rest = match[2].replace(/^\./, '').replace(/\./g, '/');
  return rest ? posix.normalize(posix.join(baseDir, rest)) : baseDir;
}

export function resolutionCandidates(base: string): string[] {
  const ext = posix.extname(base);
  const candidates: string[] = [];
  if (ext) {
    candidates.push(base);
    const withoutExt = base.slice(0, -ext.length);
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      candidates.push(`${withoutExt}.ts`, `${withoutExt}.tsx`, `${withoutExt}.vue`);
    }
  } else {
    for (const candidateExt of RESOLUTION_EXTENSIONS) {
      candidates.push(`${base}${candidateExt}`);
    }
  }

  for (const candidateExt of RESOLUTION_EXTENSIONS) {
    candidates.push(posix.join(base, `index${candidateExt}`));
  }
  candidates.push(posix.join(base, '__init__.py'));
  return [...new Set(candidates)];
}
