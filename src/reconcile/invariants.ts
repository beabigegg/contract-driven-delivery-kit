/**
 * `enforceReconciliationInvariants` (ci-gates.md `### enforceReconciliationInvariants`;
 * contracts/upgrade/upgrade-reconciliation-contract.md `## Mechanical Enforcement`).
 * Hosted by BOTH `cdd-kit gate` and `cdd-kit validate`, `ci-or-strict` (hard
 * error inside CI or under --strict, advisory warning locally), NOT gated on
 * isNewChange, no shadow-mode knob (INV-2 is contract-binding).
 *
 * This check is about THIS KIT'S OWN implementation source and test suite
 * (src/reconcile/**, refresh.ts's bucket-2 apply, this contract's text, this
 * kit's own tests) -- an adopter project has no `src/reconcile/` directory of
 * its own, so the check is a no-op there (mirrors validate.ts's opt-in policy
 * bone-audit, which only runs when `.cdd/policy.yml` exists).
 *
 * Four checks, per the contract's `## Mechanical Enforcement`:
 *   1. guard.ts's bucket-1 matcher COVERS every contract-enumerated surface;
 *   2. no raw fs write call in src/reconcile/** or refresh.ts's applyPlan()
 *      (bucket-2 apply path) outside guard.ts's guarded writer;
 *   3. a recorded guard-refusal test exists (asserts assertWritable throws);
 *   4. a recorded fail-open test exists (asserts the classifier defaults to keep).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { bucket1ContractRows } from './guard.js';
import { isCiEnvironment } from '../commands/gate-shared.js';

export interface ReconciliationFinding {
  message: string;
}

const WRITE_FUNCS = ['writeFileSync', 'writeFile', 'copyFileSync', 'copyFile', 'rmSync', 'rmdirSync', 'unlinkSync', 'appendFileSync', 'renameSync'];

function lineHasRawWrite(line: string): boolean {
  return WRITE_FUNCS.some(fn => line.includes(fn + '('));
}

function isSeparatorRow(inner: string): boolean {
  const cells = inner.split('|');
  for (const cell of cells) {
    const t = cell.trim();
    if (t.length === 0) return false;
    for (const ch of t) {
      if (ch !== '-' && ch !== ':') return false;
    }
  }
  return true;
}

/**
 * Extract the `surface` column of every row in the contract's
 * `## Bucket 1 -- Never-Overwrite Ground Truth` table. Regex-free string scan
 * (heading/row detection by `startsWith`) so this stays trivially reviewable
 * against the actual markdown table shape.
 */
export function extractBucket1ContractRows(contractText: string): string[] {
  const lines = contractText.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## Bucket 1')) { start = i + 1; break; }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  const rows: string[] = [];
  for (let i = start; i < end; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const inner = line.slice(1, -1);
    if (isSeparatorRow(inner)) continue;
    const cells = inner.split('|').map(c => c.trim());
    if (cells.length < 2) continue;
    if (cells[0].toLowerCase() === 'surface') continue;
    rows.push(cells[0]);
  }
  return rows;
}

/**
 * Every `.ts` file directly under `dir` (recursively) whose lines call a raw
 * `fs` write function, EXCLUDING `excludeAbsPath` (guard.ts's own writer).
 */
function scanDirForRawWrites(dir: string, excludeAbsPath: string): { file: string; line: number }[] {
  const hits: { file: string; line: number }[] = [];
  if (!existsSync(dir)) return hits;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...scanDirForRawWrites(full, excludeAbsPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (full === excludeAbsPath) continue;
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (lineHasRawWrite(l)) hits.push({ file: full, line: i + 1 });
    });
  }
  return hits;
}

/**
 * Brace-matched body of `function <functionName>(...)` in `source`, or `null`
 * if the marker is not found. Used to scope the single-writer scan to
 * `refresh.ts`'s bucket-2 `applyPlan()` specifically -- other functions in
 * that file (model-policy resync, gitignore stamping) legitimately write
 * directly and are out of this check's scope.
 */
function extractFunctionBody(source: string, functionName: string): string | null {
  const marker = 'function ' + functionName + '(';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) return null;
  let depth = 1;
  let i = braceStart + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(braceStart + 1, i - 1);
}

function isWhitespaceChar(c: string): boolean {
  return c === ' ' || c === '\n' || c === '\t' || c === '\r';
}

/** Every `it('<title>', ...)` call in `source`, in order, with its match index. */
function findTestTitles(source: string): { title: string; index: number }[] {
  const results: { title: string; index: number }[] = [];
  const marker = 'it(';
  let searchFrom = 0;
  while (true) {
    const idx = source.indexOf(marker, searchFrom);
    if (idx === -1) break;
    let i = idx + marker.length;
    while (i < source.length && isWhitespaceChar(source[i])) i++;
    const quote = source[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      const end = source.indexOf(quote, i + 1);
      if (end !== -1) results.push({ title: source.slice(i + 1, end), index: idx });
    }
    searchFrom = idx + marker.length;
  }
  return results;
}

/**
 * True when `source` has an `it(...)` test whose title contains
 * `titleSubstring` (case-insensitive) AND whose body (up to the next `it(`)
 * contains every string in `bodyIncludes`. This is a static PRESENCE check --
 * "a recorded test proving X exists in source" -- not a re-run of vitest; the
 * full-vitest-suite gate (ci-gates.md) is what proves it currently passes.
 */
function hasNamedTestWithBodyMatch(source: string, titleSubstring: string, bodyIncludes: string[]): boolean {
  const tests = findTestTitles(source);
  for (let k = 0; k < tests.length; k++) {
    if (!tests[k].title.toLowerCase().includes(titleSubstring.toLowerCase())) continue;
    const bodyStart = tests[k].index;
    const bodyEnd = k + 1 < tests.length ? tests[k + 1].index : source.length;
    const body = source.slice(bodyStart, bodyEnd);
    if (bodyIncludes.every(s => body.includes(s))) return true;
  }
  return false;
}

function walkDirText(dir: string): string {
  let combined = '';
  if (!existsSync(dir)) return combined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { combined += walkDirText(full); continue; }
    if (entry.isFile() && entry.name.endsWith('.ts')) combined += readFileSync(full, 'utf8') + '\n';
  }
  return combined;
}

function readTestSources(cwd: string, relPaths: string[]): string {
  let combined = '';
  for (const rel of relPaths) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    combined += statSync(abs).isDirectory() ? walkDirText(abs) : readFileSync(abs, 'utf8') + '\n';
  }
  return combined;
}

/**
 * Compute every finding, or `[]` when this project is not this kit's own
 * repository (an adopter's `src/` is unrelated application code, not
 * cdd-kit's internals -- there is nothing here for this check to inspect).
 */
export function checkReconciliationInvariants(cwd: string): ReconciliationFinding[] {
  const guardPath = join(cwd, 'src', 'reconcile', 'guard.ts');
  const contractPath = join(cwd, 'contracts', 'upgrade', 'upgrade-reconciliation-contract.md');
  if (!existsSync(guardPath) || !existsSync(contractPath)) return [];

  const findings: ReconciliationFinding[] = [];

  // Check 1: bucket-1 matcher coverage (contract ## Mechanical Enforcement #1).
  const contractRows = extractBucket1ContractRows(readFileSync(contractPath, 'utf8'));
  const guardRows = bucket1ContractRows();
  for (const row of contractRows) {
    if (!guardRows.includes(row)) {
      findings.push({
        message: 'enforceReconciliationInvariants: contracts/upgrade/upgrade-reconciliation-contract.md enumerates a bucket-1 surface with no matching src/reconcile/guard.ts rule: "' + row + '" -- coverage gap (contract ## Mechanical Enforcement #1)',
      });
    }
  }
  for (const row of guardRows) {
    if (!contractRows.includes(row)) {
      findings.push({
        message: 'enforceReconciliationInvariants: src/reconcile/guard.ts declares a bucket-1 rule not present in the contract enumeration: "' + row + '" -- guard/contract drift',
      });
    }
  }

  // Check 2: single-writer static scan (contract ## Mechanical Enforcement #2).
  const reconcileDir = join(cwd, 'src', 'reconcile');
  for (const hit of scanDirForRawWrites(reconcileDir, guardPath)) {
    findings.push({
      message: 'enforceReconciliationInvariants: raw filesystem write call in ' + hit.file + ':' + hit.line + ' outside src/reconcile/guard.ts -- every write must route through the single guarded writer (contract ## Mechanical Enforcement #2)',
    });
  }
  const refreshPath = join(cwd, 'src', 'commands', 'refresh.ts');
  if (existsSync(refreshPath)) {
    const body = extractFunctionBody(readFileSync(refreshPath, 'utf8'), 'applyPlan');
    if (body && WRITE_FUNCS.some(fn => body.includes(fn + '('))) {
      findings.push({
        message: 'enforceReconciliationInvariants: src/commands/refresh.ts applyPlan() (bucket-2 apply path) calls a raw filesystem write function outside the guarded writer (contract ## Mechanical Enforcement #2)',
      });
    }
  }

  // Checks 3/4: recorded linchpin tests (contract ## Mechanical Enforcement #3/#4).
  const combined = readTestSources(cwd, ['test/cli/reconcile-plan.test.ts', 'test/reconcile']);
  if (!hasNamedTestWithBodyMatch(combined, 'guard-refusal', ['toThrow'])) {
    findings.push({
      message: 'enforceReconciliationInvariants: no recorded guard-refusal test found under test/cli/reconcile-plan.test.ts or test/reconcile/** proving guard.assertWritable throws for a bucket-1 path (contract ## Mechanical Enforcement #3)',
    });
  }
  if (!hasNamedTestWithBodyMatch(combined, 'fail-open', ['keep'])) {
    findings.push({
      message: 'enforceReconciliationInvariants: no recorded fail-open test found under test/cli/reconcile-plan.test.ts or test/reconcile/** proving the classifier defaults malformed/unknown input to bucket keep (contract ## Mechanical Enforcement #4)',
    });
  }

  return findings;
}

/**
 * `ci-or-strict` wrapper (ci-gates.md `### enforceReconciliationInvariants`):
 * a HARD failure (errors) inside CI or under --strict, a WARNING (warnings)
 * in a default local run. NOT gated on isNewChange, no shadow-mode knob.
 */
export function enforceReconciliationInvariants(
  cwd: string,
  strict: boolean,
  errors: string[],
  warnings: string[],
): void {
  const hard = isCiEnvironment() || strict;
  for (const f of checkReconciliationInvariants(cwd)) {
    (hard ? errors : warnings).push(f.message);
  }
}
