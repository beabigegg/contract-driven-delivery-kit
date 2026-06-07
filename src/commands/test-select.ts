import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { getTouchedPaths } from '../utils/git-paths.js';
import { loadCodeMapEntries } from '../code-map/index-reader.js';
import { resolveLocalModule } from '../code-map/resolve.js';
import type { FileEntry } from '../code-map/types.js';

// Deterministic, static test selection (ADR 0005 §3). `cdd-kit test select`
// reads test-plan.md (then implementation-plan.md as fallback), the change's
// touched files, and the code-map, and emits the bounded command for each ladder
// phase -- or `needs-test-plan-update` when no bounded target can be selected
// safely, rather than searching the repository indefinitely. It never executes
// tests: it only plans the commands that `cdd-kit test run` will execute.

// Parity with test-run.ts / new-change.ts: rejects path-escape ids like `..`.
const SAFE_CHANGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// pytest-first (ADR "Scope of initial implementation"): every emitted command is
// a pytest invocation or `cdd-kit validate`. Other runners get adapters later.
const PYTEST = 'python -m pytest';
const PYTEST_TAIL = '-q --maxfail=1 --tb=short -ra';

export type Phase = 'collect' | 'targeted' | 'changed-area' | 'contract' | 'full';
const PHASE_ORDER: Phase[] = ['collect', 'targeted', 'changed-area', 'contract', 'full'];

export interface SelectionEntry {
  reason: string;
  target?: string;
  command: string;
}

export interface TestSelectOptions {
  json: boolean;
}

interface MappedTarget {
  target: string;
  reason: string;
}

// ── target recognition ────────────────────────────────────────────────────────

// A concrete pytest file/node id (optionally a parametrized [id]) ...
const TARGET_FILE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.py(::[A-Za-z0-9_./[\]:=,+-]+)?$/;
// ... or a directory target (trailing slash), e.g. `tests/orders/`.
const TARGET_DIR = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\/$/;

/**
 * True when a cell is still a scaffold placeholder rather than a real target, so
 * an unfilled test-plan.md yields no targets (and therefore `needs-test-plan-
 * update`) instead of emitting commands against the template's example paths
 * (`tests/unit/test_xxx.py`, `tests/example/...`, `<id>`).
 */
export function isPlaceholderTarget(value: string): boolean {
  const v = value.trim();
  if (!v || v === '-' || v === '—' || /^n\/?a$/i.test(v)) return true;
  if (v.includes('<') || v.includes('>')) return true;
  if (/xxx|\/example\/|^example\/|your[_-]|\btbd\b|\btodo\b/i.test(v)) return true;
  return false;
}

/** A real, bounded pytest target (file, node id, or directory) we can run. */
export function isUsablePytestTarget(value: string): boolean {
  const v = value.trim();
  if (isPlaceholderTarget(v)) return false;
  return TARGET_FILE.test(v) || TARGET_DIR.test(v);
}

/**
 * Render a target into a command. A parametrized node id contains `[`/`]`, which
 * the shell would glob-expand, so quote those; everything else is restricted to
 * a shell-safe character set and emitted bare to match the ADR's examples.
 */
export function formatTarget(value: string): string {
  return /[[\]]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value;
}

/** A pytest test file by filename convention (`test_*.py` / `*_test.py`). */
export function isPytestTestFile(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return /^test_.+\.py$/.test(base) || /_test\.py$/.test(base);
}

// ── markdown table parsing ────────────────────────────────────────────────────

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  const s = line.trim();
  return /^[\s|:-]+$/.test(s) && s.includes('-') && s.includes('|');
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

  const headers = splitTableRow(lines[i]);
  const rows: string[][] = [];
  for (let j = i + 2; j < lines.length; j++) {
    if (!lines[j].trim().startsWith('|')) break;
    rows.push(splitTableRow(lines[j]));
  }
  return { headers, rows };
}

function columnIndex(headers: string[], matchers: RegExp[]): number {
  for (let k = 0; k < headers.length; k++) {
    const h = headers[k].toLowerCase();
    if (matchers.some((m) => m.test(h))) return k;
  }
  return -1;
}

const TARGET_COLUMN = [/test file/, /test path/, /node ?id/, /\btarget\b/, /\bpath\b/, /\bcommand\b/];
const CRITERION_COLUMN = [/criterion/, /acceptance/, /\bac\b/, /^id$/];

/**
 * Pull usable targets out of an acceptance->test mapping table, paired with the
 * criterion id (used only for the human-readable `reason`). Placeholder rows and
 * non-pytest cells are skipped; order and de-duplication are caller's concern.
 */
export function extractMappedTargets(table: MarkdownTable | null, source: string): MappedTarget[] {
  if (!table) return [];
  const ti = columnIndex(table.headers, TARGET_COLUMN);
  if (ti < 0) return [];
  const ci = columnIndex(table.headers, CRITERION_COLUMN);

  const out: MappedTarget[] = [];
  for (const row of table.rows) {
    const target = (row[ti] ?? '').trim();
    if (!isUsablePytestTarget(target)) continue;
    const criterion = ci >= 0 ? (row[ci] ?? '').trim() : '';
    out.push({ target, reason: `${criterion ? `${criterion} ` : ''}mapped in ${source}` });
  }
  return out;
}

function dedupeByTarget(targets: MappedTarget[]): MappedTarget[] {
  const seen = new Set<string>();
  const out: MappedTarget[] = [];
  for (const t of targets) {
    if (seen.has(t.target)) continue;
    seen.add(t.target);
    out.push(t);
  }
  return out;
}

// ── contract phase trigger ────────────────────────────────────────────────────

/**
 * Whether the change affects contracts, so the `contract` phase should run.
 * Triggers on a touched path under any `contracts/` directory, or on a non-empty
 * bullet in implementation-plan.md's `## Contract Updates` section (the template
 * ships those bullets empty, so empty means "not affected").
 */
export function detectContractAffected(touched: string[], implPlanText: string): string | null {
  if (touched.some((p) => /(^|\/)contracts\//.test(p))) return 'contract files changed';

  const section = implPlanText.match(/##\s*Contract Updates\s*\n([\s\S]*?)(?:\n#{1,6}\s|$)/i);
  if (section) {
    for (const line of section[1].split('\n')) {
      const m = line.match(/^\s*-\s*([A-Za-z/ ]+?)\s*:\s*(\S.*?)\s*$/);
      if (m && m[2].trim()) return 'implementation-plan.md declares contract updates';
    }
  }
  return null;
}

// ── changed-area (changed-file + graph-impact heuristics) ─────────────────────

/** Code-map test files whose local imports resolve to `sourcePath`. */
export function findTestDependents(entries: FileEntry[], sourcePath: string, pathSet: Set<string>): string[] {
  const deps: string[] = [];
  for (const entry of entries) {
    if (entry.path === sourcePath || !isPytestTestFile(entry.path)) continue;
    for (const imp of entry.imports) {
      if (resolveLocalModule(entry.path, imp.module, pathSet) === sourcePath) {
        deps.push(entry.path);
        break;
      }
    }
  }
  return deps;
}

function loadCodeMapSafe(cwd: string): FileEntry[] {
  const mapPath = join(cwd, '.cdd', 'code-map.yml');
  if (!existsSync(mapPath)) return [];
  try {
    return loadCodeMapEntries(mapPath);
  } catch {
    return []; // an unreadable map just means no graph-impact signal
  }
}

/** Parent directory (with trailing slash) of a file target, ignoring node ids. */
function targetDirectory(target: string): string | null {
  const file = target.split('::')[0];
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(0, slash + 1) : null;
}

/**
 * Bounded changed-area targets, in priority order: changed test files run
 * directly; changed Python sources pull in their code-map test dependents
 * (graph-impact); otherwise fall back to the directories of the explicitly
 * mapped targets so the change's area is still exercised. Only the change's own
 * specs/ artifacts are excluded; results are sorted for deterministic output.
 */
function deriveChangedArea(cwd: string, changeId: string, targeted: MappedTarget[]): SelectionEntry[] {
  const touched = getTouchedPaths(cwd)
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => !p.startsWith(`specs/changes/${changeId}/`));

  const found = new Map<string, string>(); // target -> reason

  for (const p of touched) {
    if (isPytestTestFile(p) && existsSync(join(cwd, p))) {
      if (!found.has(p)) found.set(p, 'changed test file');
    }
  }

  const sources = touched.filter((p) => p.endsWith('.py') && !isPytestTestFile(p));
  if (sources.length) {
    const entries = loadCodeMapSafe(cwd);
    if (entries.length) {
      const pathSet = new Set(entries.map((e) => e.path));
      for (const src of sources) {
        for (const dep of findTestDependents(entries, src, pathSet)) {
          if (!found.has(dep)) found.set(dep, `imports changed source ${src} (code-map)`);
        }
      }
    }
  }

  if (found.size === 0) {
    // No git/graph signal: re-run the directory around each mapped file target.
    for (const t of targeted) {
      const dir = targetDirectory(t.target);
      if (dir && !found.has(dir)) found.set(dir, 'directory of test-plan targets');
    }
  }

  return [...found.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([target, reason]) => ({
      reason,
      target,
      command: `${PYTEST} ${formatTarget(target)} ${PYTEST_TAIL}`,
    }));
}

// ── selection ─────────────────────────────────────────────────────────────────

type Selection =
  | { change_id: string; status: 'selected'; phases: Partial<Record<Phase, SelectionEntry[]>> }
  | { change_id: string; status: 'needs-test-plan-update'; reason: string }
  | { change_id: string; status: 'error'; reason: string };

function collectEntry(t: MappedTarget): SelectionEntry {
  return { reason: t.reason, target: t.target, command: `${PYTEST} --collect-only -q ${formatTarget(t.target)}` };
}

function targetedEntry(t: MappedTarget): SelectionEntry {
  return { reason: t.reason, target: t.target, command: `${PYTEST} ${formatTarget(t.target)} ${PYTEST_TAIL}` };
}

function buildSelection(cwd: string, changeId: string, changeDir: string): Selection {
  const readIf = (name: string): string => {
    const p = join(changeDir, name);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };

  const testPlanExists = existsSync(join(changeDir, 'test-plan.md'));
  const testPlanText = readIf('test-plan.md');
  const implPlanText = readIf('implementation-plan.md');

  // Explicit mapping first: test-plan.md, then implementation-plan.md.
  let targeted = dedupeByTarget(
    extractMappedTargets(
      parseMarkdownTable(testPlanText, /acceptance criteria.*test mapping/i),
      'test-plan.md',
    ),
  );
  if (targeted.length === 0) {
    targeted = dedupeByTarget(
      extractMappedTargets(
        parseMarkdownTable(implPlanText, /test execution plan/i),
        'implementation-plan.md',
      ),
    );
  }

  const changedArea = deriveChangedArea(cwd, changeId, targeted);

  if (targeted.length === 0 && changedArea.length === 0) {
    const reason = !testPlanExists
      ? `test-plan.md not found at specs/changes/${changeId}/test-plan.md`
      : 'test-plan.md does not provide target commands or node IDs, and no changed-area tests could be inferred safely';
    return { change_id: changeId, status: 'needs-test-plan-update', reason };
  }

  const phases: Partial<Record<Phase, SelectionEntry[]>> = {};

  // collect = --collect-only of what we will actually run (mapped targets, or the
  // changed-area set when nothing was explicitly mapped).
  const collectSource = targeted.length
    ? targeted
    : changedArea.map((e) => ({ target: e.target as string, reason: e.reason }));
  if (collectSource.length) phases.collect = collectSource.map(collectEntry);
  if (targeted.length) phases.targeted = targeted.map(targetedEntry);
  if (changedArea.length) phases['changed-area'] = changedArea;

  const contractReason = detectContractAffected(getTouchedPaths(cwd).map((p) => p.replace(/\\/g, '/')), implPlanText);
  if (contractReason) {
    phases.contract = [{ reason: contractReason, command: 'cdd-kit validate --contracts' }];
  }

  phases.full = [{ reason: 'final bounded full-suite smoke', command: `${PYTEST} ${PYTEST_TAIL}` }];

  return { change_id: changeId, status: 'selected', phases };
}

// ── reporting ─────────────────────────────────────────────────────────────────

function report(sel: Selection): void {
  log.blank();
  if (sel.status === 'selected') {
    log.ok(`test select: selected for ${sel.change_id}`);
    for (const phase of PHASE_ORDER) {
      const entries = sel.phases[phase];
      if (!entries || entries.length === 0) continue;
      log.info(`  ${phase}:`);
      for (const e of entries) {
        process.stdout.write(`    ${e.command}\n`);
        log.dim(`      reason: ${e.reason}`);
      }
    }
  } else if (sel.status === 'needs-test-plan-update') {
    log.warn(`test select: needs-test-plan-update for ${sel.change_id}`);
    log.dim(`  ${sel.reason}`);
  } else {
    log.error(`test select: ${sel.reason}`);
  }
  log.blank();
}

// ── main ──────────────────────────────────────────────────────────────────────

export async function testSelect(changeId: string, opts: TestSelectOptions): Promise<number> {
  const cwd = process.cwd();
  const emit = (sel: Selection): void => {
    if (opts.json) console.log(JSON.stringify(sel, null, 2));
    else report(sel);
  };

  if (!SAFE_CHANGE_ID.test(changeId)) {
    emit({ change_id: changeId, status: 'error', reason: 'invalid change id' });
    return 2;
  }

  const changeDir = join(cwd, 'specs', 'changes', changeId);
  if (!existsSync(changeDir)) {
    emit({ change_id: changeId, status: 'error', reason: `change not found: specs/changes/${changeId}` });
    return 2;
  }

  const selection = buildSelection(cwd, changeId, changeDir);
  emit(selection);
  return selection.status === 'selected' ? 0 : 1;
}
