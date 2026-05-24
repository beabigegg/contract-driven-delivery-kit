import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { checkCodeMapFreshness } from './freshness.js';
import type { FileEntry } from './types.js';

type RawObject = Record<string, unknown>;

export interface EnsureCodeMapResult {
  refreshed: boolean;
  error?: string;
}

export async function ensureCodeMapFresh(mapPath: string, refresh: boolean): Promise<EnsureCodeMapResult> {
  if (!refresh) return { refreshed: false };

  const freshness = checkCodeMapFreshness(process.cwd(), mapPath);
  if (freshness.status === 'config-error') {
    return {
      refreshed: false,
      error: `.cdd/code-map-config.yml is invalid: ${freshness.configError}`,
    };
  }

  if (freshness.status === 'missing-with-sources' || freshness.status === 'missing-greenfield' || freshness.status === 'stale') {
    const { codeMap } = await import('../commands/code-map.js');
    const exit = await codeMap({
      path: '.',
      out: mapPath,
      include: [],
      exclude: [],
      check: false,
      maxLines: 100000,
      silent: true,
    });
    if (exit !== 0) {
      return {
        refreshed: false,
        error: `could not refresh ${mapPath}; run \`cdd-kit code-map\` for details.`,
      };
    }
    return { refreshed: true };
  }

  return { refreshed: false };
}

/**
 * Path of the parsed JSON sidecar that sits next to a code-map. `cdd-kit
 * code-map` writes it so `index query` / `index impact` can JSON.parse the
 * entries instead of re-running the much slower `yaml.load` on a large map.
 */
export function sidecarPathFor(mapPath: string): string {
  return `${mapPath.replace(/\.ya?ml$/i, '')}.index.json`;
}

/**
 * Try the JSON sidecar fast path. Returns parsed entries only when the sidecar
 * exists and its embedded `sourcesDigest` matches the map's
 * `# sources-digest:` header — otherwise null so the caller falls back to the
 * authoritative YAML. The sidecar is a derived, deletable local cache; the
 * `.yml` always wins on any mismatch.
 */
function tryLoadSidecar(mapPath: string, mapText: string): FileEntry[] | null {
  const sidecarPath = sidecarPathFor(mapPath);
  if (!existsSync(sidecarPath)) return null;
  const headerDigest = mapText.match(/^# sources-digest:\s*([a-f0-9]+)/m)?.[1];
  if (!headerDigest) return null;
  try {
    const raw = JSON.parse(readFileSync(sidecarPath, 'utf8')) as {
      sourcesDigest?: string;
      entries?: unknown;
    };
    if (raw && raw.sourcesDigest === headerDigest && Array.isArray(raw.entries)) {
      return raw.entries as FileEntry[];
    }
  } catch {
    // corrupt sidecar — fall back to YAML
  }
  return null;
}

export function loadCodeMapEntries(mapPath: string): FileEntry[] {
  if (!existsSync(mapPath)) {
    throw new Error(`${mapPath} is missing; run \`cdd-kit code-map\` first.`);
  }

  const text = readFileSync(mapPath, 'utf8');

  const fromSidecar = tryLoadSidecar(mapPath, text);
  if (fromSidecar) return fromSidecar;

  const totalLinesByPath = extractTotalLines(text);
  const raw = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as RawObject | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];

  const entries: FileEntry[] = [];
  for (const [path, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const obj = value as Partial<FileEntry>;
    entries.push({
      path,
      total_lines: totalLinesByPath.get(path) ?? (typeof obj.total_lines === 'number' ? obj.total_lines : 0),
      imports: Array.isArray(obj.imports) ? obj.imports : [],
      constants: Array.isArray(obj.constants) ? obj.constants : [],
      classes: Array.isArray(obj.classes) ? obj.classes : [],
      functions: Array.isArray(obj.functions) ? obj.functions : [],
      interfaces: Array.isArray(obj.interfaces) ? obj.interfaces : [],
      types: Array.isArray(obj.types) ? obj.types : [],
      enums: Array.isArray(obj.enums) ? obj.enums : [],
    });
  }
  return entries;
}

function extractTotalLines(text: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^((?:'[^']*(?:''[^']*)*')|[^#:\s][^#]*?):\s*#\s*(\d+)\s+lines\b/);
    if (!m) continue;
    totals.set(unquoteYamlKey(m[1].trim()), Number(m[2]));
  }
  return totals;
}

function unquoteYamlKey(key: string): string {
  if (key.startsWith("'") && key.endsWith("'")) {
    return key.slice(1, -1).replace(/''/g, "'");
  }
  return key;
}
