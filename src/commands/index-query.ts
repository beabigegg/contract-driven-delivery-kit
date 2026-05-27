import { existsSync } from 'fs';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import type { FileEntry } from '../code-map/types.js';

export interface IndexQueryOptions {
  map: string;
  limit: number;
  json: boolean;
  refresh: boolean;
}

export interface QueryMatch {
  kind: string;
  name: string;
  line?: number;
  lines?: string;
  detail?: string;
  score: number;
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
    }
  }
  console.log('Next: read only the listed file/ranges first.');
}

function printFailure(message: string, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  } else {
    console.error(message);
  }
  return 1;
}
