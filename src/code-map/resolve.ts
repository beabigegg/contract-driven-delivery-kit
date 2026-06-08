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

/** Convert a Python dotted submodule (`pkg.sub`) into a path fragment (`pkg/sub`). */
function dottedModuleToPath(dotted: string): string {
  return dotted.replace(/^\./, '').replace(/\./g, '/');
}

export function resolvePythonRelativeImport(importerPath: string, moduleName: string): string {
  const match = moduleName.match(/^(\.+)(.*)$/);
  if (!match) return moduleName;

  const upLevels = Math.max(0, match[1].length - 1);
  let baseDir = posix.dirname(importerPath);
  for (let i = 0; i < upLevels; i++) {
    baseDir = posix.dirname(baseDir);
  }

  const rest = dottedModuleToPath(match[2]);
  return rest ? posix.normalize(posix.join(baseDir, rest)) : baseDir;
}

/** Candidates for a base WITH an extension (plus JS->TS/Vue fallbacks). */
function baseWithExtCandidates(base: string, ext: string): string[] {
  const candidates = [base];
  const withoutExt = base.slice(0, -ext.length);
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    candidates.push(`${withoutExt}.ts`, `${withoutExt}.tsx`, `${withoutExt}.vue`);
  }
  return candidates;
}

/** Candidates for an extension-less base: try each known extension. */
function baseWithoutExtCandidates(base: string): string[] {
  return RESOLUTION_EXTENSIONS.map((ext) => `${base}${ext}`);
}

/** Directory-style fallbacks: `<base>/index.<ext>` and the Python `__init__.py`. */
function indexAndInitCandidates(base: string): string[] {
  return [
    ...RESOLUTION_EXTENSIONS.map((ext) => posix.join(base, `index${ext}`)),
    posix.join(base, '__init__.py'),
  ];
}

export function resolutionCandidates(base: string): string[] {
  const ext = posix.extname(base);
  const baseCandidates = ext ? baseWithExtCandidates(base, ext) : baseWithoutExtCandidates(base);
  return [...baseCandidates, ...indexAndInitCandidates(base)];
}
