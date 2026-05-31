import { existsSync, readFileSync } from 'fs';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import type { FileEntry } from '../code-map/types.js';

/** Default cap on total source lines emitted by --with-source per query. */
export const DEFAULT_SOURCE_BUDGET = 400;

/** Coerce a possibly-NaN/invalid budget to a safe positive integer. */
export function resolveSourceBudget(budget: number | undefined): number {
  return Number.isFinite(budget) && (budget as number) > 0
    ? Math.floor(budget as number)
    : DEFAULT_SOURCE_BUDGET;
}

export interface IndexQueryOptions {
  map: string;
  limit: number;
  json: boolean;
  refresh: boolean;
  /**
   * When true, attach the actual source slice for each matched line range so
   * the caller does not need a separate Read. This makes the index query a
   * drop-in replacement for opening the file, not an extra step before it.
   */
  withSource?: boolean;
  /** Max total source lines to emit across all matches when withSource. */
  sourceBudget?: number;
}

export interface QueryMatch {
  kind: string;
  name: string;
  line?: number;
  lines?: string;
  detail?: string;
  score: number;
  /** Source text for this match's line range, populated only with --with-source. */
  source?: string;
  /** True when this match's source was dropped because the budget was exhausted. */
  source_truncated?: boolean;
}

export interface QueryResult {
  path: string;
  total_lines: number;
  score: number;
  matches: QueryMatch[];
}

export interface QueryPayload {
  index: string;
  query: string;
  refreshed: boolean;
  results: QueryResult[];
}

export async function indexQuery(term: string, opts: IndexQueryOptions): Promise<number> {
  const mapPath = opts.map || '.cdd/code-map.yml';
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : 10;
  let refreshed = false;

  const freshness = await ensureCodeMapFresh(mapPath, opts.refresh);
  if (freshness.error) {
    return printFailure(freshness.error, opts.json);
  }
  refreshed = freshness.refreshed;

  if (!existsSync(mapPath)) {
    return printFailure(`${mapPath} is missing; run \`cdd-kit code-map\` first.`, opts.json);
  }

  let entries: FileEntry[];
  try {
    entries = loadCodeMapEntries(mapPath);
  } catch (err) {
    return printFailure(`${mapPath} is not readable YAML: ${(err as Error).message}`, opts.json);
  }

  const results = queryEntries(entries, term).slice(0, limit);
  if (opts.withSource) {
    attachSource(results, resolveSourceBudget(opts.sourceBudget));
  }
  const payload: QueryPayload = {
    index: mapPath,
    query: term,
    refreshed,
    results,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printText(payload);
  }

  return results.length === 0 ? 1 : 0;
}

export function queryEntries(entries: FileEntry[], term: string): QueryResult[] {
  const query = term.trim().toLowerCase();
  if (!query) return [];

  const results: QueryResult[] = [];
  for (const entry of entries) {
    const matches: QueryMatch[] = [];
    addMatch(matches, 'file', entry.path, undefined, undefined, undefined, scoreText(entry.path, query, 120));

    for (const imp of entry.imports) {
      const items = Array.isArray(imp.items) ? imp.items : [];
      const imported = items.length ? ` {${items.join(', ')}}` : '';
      const score = Math.max(
        scoreText(imp.module, query, 70),
        ...items.map(item => scoreText(item, query, 80)),
      );
      addMatch(matches, 'import', imp.module, imp.line, undefined, `${imp.module}${imported}`, score);
    }

    for (const c of entry.constants) {
      addMatch(matches, 'constant', c.name, c.line, undefined, undefined, scoreText(c.name, query, 90));
    }

    for (const c of entry.classes) {
      addMatch(matches, 'class', c.name, undefined, rangeToString(c.lines), undefined, scoreText(c.name, query, 100));
      const methods = Array.isArray(c.methods) ? c.methods : [];
      for (const m of methods) {
        const methodName = m.name.replace(/^async\s+/, '');
        addMatch(
          matches,
          'method',
          `${c.name}.${m.name}`,
          undefined,
          rangeToString(m.lines),
          undefined,
          Math.max(scoreText(methodName, query, 90), scoreText(`${c.name}.${methodName}`, query, 95)),
        );
      }
    }

    for (const f of entry.functions) {
      const name = f.name.replace(/^async\s+/, '');
      addMatch(matches, 'function', f.name, undefined, rangeToString(f.lines), undefined, scoreText(name, query, 100));
    }

    for (const t of entry.interfaces ?? []) {
      addMatch(matches, 'interface', t.name, undefined, rangeToString(t.lines), undefined, scoreText(t.name, query, 100));
    }

    for (const t of entry.types ?? []) {
      addMatch(matches, 'type', t.name, undefined, rangeToString(t.lines), undefined, scoreText(t.name, query, 95));
    }

    for (const e of entry.enums ?? []) {
      const members = Array.isArray(e.members) ? e.members : [];
      const memberScore = Math.max(0, ...members.map(member => scoreText(member, query, 70)));
      addMatch(
        matches,
        'enum',
        e.name,
        undefined,
        rangeToString(e.lines),
        members.length ? `members: ${members.join(', ')}` : undefined,
        Math.max(scoreText(e.name, query, 95), memberScore),
      );
    }

    const kept = matches
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || compareMatch(a, b))
      .slice(0, 8);
    if (kept.length > 0) {
      results.push({
        path: entry.path,
        total_lines: entry.total_lines,
        score: kept.reduce((sum, m) => sum + m.score, 0),
        matches: kept,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function addMatch(
  matches: QueryMatch[],
  kind: string,
  name: string,
  line: number | undefined,
  lines: string | undefined,
  detail: string | undefined,
  score: number,
): void {
  if (score <= 0) return;
  matches.push({ kind, name, line, lines, detail, score });
}

function scoreText(text: string, query: string, weight: number): number {
  const haystack = text.toLowerCase();
  if (haystack === query) return weight + 40;
  if (haystack.endsWith(`/${query}`) || haystack.endsWith(`.${query}`)) return weight + 30;
  if (haystack.startsWith(query)) return weight + 20;
  if (haystack.includes(query)) return weight;
  return 0;
}

function rangeToString(lines: [number, number] | string | undefined): string | undefined {
  if (!lines) return undefined;
  if (typeof lines === 'string') return lines;
  return `${lines[0]}-${lines[1]}`;
}

function compareMatch(a: QueryMatch, b: QueryMatch): number {
  const lineA = a.line ?? firstLine(a.lines);
  const lineB = b.line ?? firstLine(b.lines);
  return lineA - lineB || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
}

function firstLine(lines: string | undefined): number {
  const m = lines?.match(/^\d+/);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Populate `match.source` for each match that has a known line range, reading
 * the real file once per path and honoring a global line budget. Ranges are
 * resolved from `lines` ("A-B") or a single `line`. Out-of-budget matches are
 * flagged with `source_truncated` so the caller knows to read them directly.
 */
function attachSource(results: QueryResult[], budget: number): void {
  const fileCache = new Map<string, string[] | null>();
  let used = 0;

  const readLines = (path: string): string[] | null => {
    if (fileCache.has(path)) return fileCache.get(path) ?? null;
    let lines: string[] | null = null;
    try {
      lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : null;
    } catch {
      lines = null;
    }
    fileCache.set(path, lines);
    return lines;
  };

  for (const result of results) {
    const fileLines = readLines(result.path);
    if (!fileLines) continue;
    for (const match of result.matches) {
      const range = resolveRange(match);
      if (!range) continue;
      const [start, end] = range;
      if (used >= budget) {
        match.source_truncated = true;
        continue;
      }
      const allowedEnd = Math.min(end, start + (budget - used) - 1);
      const slice = fileLines.slice(start - 1, allowedEnd);
      match.source = slice.join('\n');
      used += slice.length;
      if (allowedEnd < end) match.source_truncated = true;
    }
  }
}

function resolveRange(match: QueryMatch): [number, number] | null {
  if (match.lines) {
    const m = match.lines.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) return [Number(m[1]), Number(m[2])];
    const single = match.lines.match(/^(\d+)$/);
    if (single) return [Number(single[1]), Number(single[1])];
  }
  if (typeof match.line === 'number') return [match.line, match.line];
  return null;
}

function printText(payload: QueryPayload): void {
  if (payload.results.length === 0) {
    console.log(`No matches for "${payload.query}" in ${payload.index}.`);
    console.log('Try a symbol name, file stem, import module, enum member, or a narrower substring.');
    return;
  }

  console.log(`index: ${payload.index}${payload.refreshed ? ' (refreshed)' : ''}`);
  console.log(`query: ${payload.query}`);
  console.log(`results: ${payload.results.length}`);
  for (const result of payload.results) {
    console.log(`- ${result.path} (${result.total_lines} lines)`);
    for (const match of result.matches) {
      const loc = match.lines ? ` lines ${match.lines}` : match.line ? ` line ${match.line}` : '';
      const detail = match.detail && match.detail !== match.name ? ` - ${match.detail}` : '';
      console.log(`  - ${match.kind}: ${match.name}${loc}${detail}`);
      if (match.source !== undefined) {
        for (const srcLine of match.source.split('\n')) {
          console.log(`      | ${srcLine}`);
        }
        if (match.source_truncated) console.log('      | … (source budget reached; Read the rest directly)');
      } else if (match.source_truncated) {
        console.log('      (source budget reached; Read this range directly)');
      }
    }
  }
  console.log(payload.results.some(r => r.matches.some(m => m.source !== undefined))
    ? 'Source included above — no separate Read needed for these ranges.'
    : 'Next: read only the listed file/ranges first.');
}

function printFailure(message: string, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  } else {
    console.error(message);
  }
  return 1;
}
