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

export function loadCodeMapEntries(mapPath: string): FileEntry[] {
  if (!existsSync(mapPath)) {
    throw new Error(`${mapPath} is missing; run \`cdd-kit code-map\` first.`);
  }

  const text = readFileSync(mapPath, 'utf8');
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
