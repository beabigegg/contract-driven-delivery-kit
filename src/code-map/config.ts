import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

/**
 * Built-in include globs. Covers the source families code-map can parse.
 */
export const BUILTIN_INCLUDE: string[] = [
  '**/*.py',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.ts',
  '**/*.tsx',
  '**/*.vue',
];

/**
 * Built-in exclude globs. Includes:
 *  - dependency / build / cache directories common across stacks
 *  - cdd-kit's own scaffold directories (.claude/, specs/templates/, tests/templates/)
 *    which are template fixtures, not user source
 */
export const BUILTIN_EXCLUDE: string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/__pycache__/**',
  '**/.git/**',
  '**/.cdd/**',
  '**/.claude/**',
  '**/.venv/**',
  '**/venv/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/out/**',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  'specs/archive/**',
  'specs/templates/**',
  'tests/templates/**',
  '**/*.min.js',
];

export interface ResolvedConfig {
  include: string[];
  exclude: string[];
  /** Where the config came from — useful for `doctor`/diagnostics. */
  source: 'builtin' | 'user-file';
  /** Repo-relative path to user file when source === 'user-file'. */
  userFilePath?: string;
}

export const CONFIG_REL_PATH = '.cdd/code-map-config.yml';

interface RawConfig {
  include?: unknown;
  exclude?: unknown;
}

function asStringArray(value: unknown, key: string, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${where}: \`${key}\` must be a list of glob strings`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      throw new Error(`${where}: \`${key}[${i}]\` must be a string, got ${typeof value[i]}`);
    }
  }
  return value as string[];
}

/**
 * Load the resolved code-map config for a working directory.
 *
 * Semantics: if `.cdd/code-map-config.yml` exists, its `include` / `exclude`
 * keys REPLACE the built-in defaults (each key independently — a config that
 * sets only `include` keeps the built-in `exclude`). To partially override a
 * default list, copy the built-in list and edit it.
 *
 * Returns the resolved config; throws on parse / shape errors.
 */
export function loadCodeMapConfig(cwd: string): ResolvedConfig {
  const filePath = join(cwd, CONFIG_REL_PATH);
  if (!existsSync(filePath)) {
    return {
      include: [...BUILTIN_INCLUDE],
      exclude: [...BUILTIN_EXCLUDE],
      source: 'builtin',
    };
  }

  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`failed to read ${CONFIG_REL_PATH}: ${(err as Error).message}`);
  }

  let raw: RawConfig | null;
  try {
    raw = yamlLoad(text) as RawConfig | null;
  } catch (err) {
    throw new Error(`failed to parse ${CONFIG_REL_PATH}: ${(err as Error).message}`);
  }
  if (raw === null || raw === undefined) {
    // empty file = use defaults
    return {
      include: [...BUILTIN_INCLUDE],
      exclude: [...BUILTIN_EXCLUDE],
      source: 'user-file',
      userFilePath: CONFIG_REL_PATH,
    };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${CONFIG_REL_PATH}: top-level must be a mapping (got ${Array.isArray(raw) ? 'list' : typeof raw})`);
  }

  const include = raw.include === undefined
    ? [...BUILTIN_INCLUDE]
    : asStringArray(raw.include, 'include', CONFIG_REL_PATH);
  const exclude = raw.exclude === undefined
    ? [...BUILTIN_EXCLUDE]
    : asStringArray(raw.exclude, 'exclude', CONFIG_REL_PATH);

  return {
    include,
    exclude,
    source: 'user-file',
    userFilePath: CONFIG_REL_PATH,
  };
}
