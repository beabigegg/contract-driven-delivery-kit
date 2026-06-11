/**
 * A bounded reader for GitHub-flavored markdown pipe tables, used by
 * `cdd-kit metadata` to derive the trace index from `test-plan.md` (the
 * Acceptance Criteria → Test Mapping table) and `ci-gates.md` (the Required
 * Gates table).
 *
 * This is deliberately a small, forgiving parser — not a full markdown engine.
 * It never throws: a malformed or absent table yields `[]`, so a generator
 * built on it degrades to an empty section rather than failing. It is read-only
 * input parsing for a DERIVED file; it does not influence any gate pass/fail.
 */

import { stripHtmlComments } from './markdown-section.js';

export type PipeTableRow = Record<string, string>;

/** Split one `| a | b |` row into trimmed cells, tolerating missing edge pipes. */
function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim());
}

/** A separator row is the `|---|:--:|` line under the header. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}

/**
 * Parse a pipe table out of a section body. The header row's cells become the
 * (lower-cased) column keys; each subsequent data row maps key → cell value.
 * The `|---|` separator row is skipped. Rows with fewer cells than the header
 * get empty strings for the missing trailing columns.
 */
export function parsePipeTable(body: string): PipeTableRow[] {
  const lines = stripHtmlComments(body)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('|'));
  if (lines.length < 2) return [];

  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  // The line after the header is usually the `---` separator; skip it when present.
  let dataStart = 1;
  if (isSeparatorRow(splitRow(lines[1]))) dataStart = 2;

  const rows: PipeTableRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (isSeparatorRow(cells)) continue;
    const row: PipeTableRow = {};
    header.forEach((key, j) => { row[key] = (cells[j] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}
