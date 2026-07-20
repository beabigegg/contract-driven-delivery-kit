/**
 * The shared vocabulary for reading the plan's tables: how a table is located,
 * and which column headers mean "criterion", "target" and "gate".
 *
 * This lives here, owned by neither side, because the gate and the selector must
 * agree and a cycle is not a way to make them. `gate-artifacts.ts` needs the
 * matchers so it can require a real criterion→test row; `test-select.ts` needs
 * them to pick the commands to run; `metadata.ts` needs them to build the trace.
 * Having the gate import them from the selector — while the selector already
 * imported `readPlanSourceText` from the gate — created a circular dependency
 * between the two modules, which works only because the bundler happens to order
 * it favourably. A shared leaf module has no such dependence on luck.
 *
 * The rule these support: a header the SELECTOR accepts must never be one the
 * GATE rejects. Duplicating the regexes is precisely how that guarantee broke
 * (the copies were retyped, and the `\b` escapes were silently corrupted into
 * literal control characters), so there is exactly one copy and both sides read
 * it.
 */

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

/** Header matchers, ordered most- to least-specific. */
export const GATE_COLUMN = [/^gate$/, /\bgate\b/];
export const TARGET_COLUMN = [/test file/, /test path/, /node ?id/, /\btarget\b/, /\bpath\b/, /\bcommand\b/];
export const CRITERION_COLUMN = [/criterion/, /acceptance/, /\bac\b/, /^id$/];

export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

export function isSeparatorRow(line: string): boolean {
  const s = line.trim();
  return /^[\s|:-]+$/.test(s) && s.includes('-') && s.includes('|');
}

export function columnIndex(headers: string[], matchers: RegExp[]): number {
  for (let k = 0; k < headers.length; k++) {
    const h = headers[k].toLowerCase();
    if (matchers.some((m) => m.test(h))) return k;
  }
  return -1;
}

/**
 * Parse the first GitHub-style pipe table that appears after the first heading
 * matching `headingRe`. Returns null when the heading or a well-formed table
 * (header row + separator row) is not found before the next heading.
 */
export function parseMarkdownTable(text: string, headingRe: RegExp): MarkdownTable | null {
  const lines = text.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    if (headingRe.test(lines[i])) break;
  }
  if (i >= lines.length) return null;

  for (i += 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) return null; // next heading first -> no table
    if (lines[i].trim().startsWith('|')) break;
  }
  if (i + 1 >= lines.length || !isSeparatorRow(lines[i + 1])) return null;

  return readTableAt(lines, i);
}

/** Header + data rows of the table whose header row is at `lines[i]`. */
function readTableAt(lines: string[], i: number): MarkdownTable {
  const headers = splitTableRow(lines[i]);
  const rows: string[][] = [];
  for (let j = i + 2; j < lines.length; j++) {
    if (!lines[j].trim().startsWith('|')) break;
    rows.push(splitTableRow(lines[j]));
  }
  return { headers, rows };
}

/**
 * Find a table by its COLUMN SIGNATURE rather than by proximity to a heading.
 *
 * `parseMarkdownTable` bails the moment it meets another heading before a table,
 * which is right when it is scoped by a heading and wrong inside a folded
 * section: `## Test Plan` legitimately contains subheadings (the test-strategist
 * prompt documents a `### Acceptance Criteria → Test Mapping` one) and may carry
 * more than one table. Matching on the header row finds the right table wherever
 * it sits, and ignores the sibling ones.
 */
export function findTableByColumns(text: string, required: RegExp[][]): MarkdownTable | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparatorRow(lines[i + 1])) continue;
    const headers = splitTableRow(lines[i]);
    if (required.every(matchers => columnIndex(headers, matchers) >= 0)) return readTableAt(lines, i);
  }
  return null;
}

/** The acceptance-criterion → test mapping table. */
export function findMappingTable(text: string): MarkdownTable | null {
  return findTableByColumns(text, [TARGET_COLUMN]);
}

/** The CI-gate table: a gate name plus a runnable command/workflow column. */
export function findGateTable(text: string): MarkdownTable | null {
  return findTableByColumns(text, [GATE_COLUMN, [/command/, /workflow/]]);
}
