import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { getTouchedPaths } from '../utils/git-paths.js';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import { resolveLocalModule } from '../code-map/resolve.js';
import { isPytestCommand } from './test-run.js';
import type { FileEntry } from '../code-map/types.js';

// Deterministic, static test selection (ADR 0005 §3). `cdd-kit test select`
// reads test-plan.md (then implementation-plan.md as fallback), the change's
// touched files, and the code-map, and emits the bounded command for each ladder
// phase -- or `needs-test-plan-update` when no bounded target can be selected
// safely, rather than searching the repository indefinitely. It never executes
// tests: it only plans the commands that `cdd-kit test run` will execute.

// Parity with test-run.ts / new-change.ts: rejects path-escape ids like `..`.
const SAFE_CHANGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// pytest-first (ADR "Scope of initial implementation"): every emitted test
// command is a pytest invocation; the `quality` phase passes through the
// operator's configured commands verbatim. Other runners get adapters later.
const PYTEST = 'python -m pytest';
const PYTEST_TAIL = '-q --maxfail=1 --tb=short -ra';
const CODE_MAP_PATH = '.cdd/code-map.yml';

export type Phase = 'collect' | 'targeted' | 'changed-area' | 'contract' | 'quality' | 'full';
const PHASE_ORDER: Phase[] = ['collect', 'targeted', 'changed-area', 'contract', 'quality', 'full'];

export interface SelectionEntry {
  reason: string;
  target?: string;
  command: string;
}

export interface TestSelectOptions {
  json: boolean;
  refresh: boolean;
}

interface MappedTarget {
  target: string;
  reason: string;
}

// ── target recognition ────────────────────────────────────────────────────────

// A concrete pytest file/node id (optionally a parametrized [id]) ...
const TARGET_FILE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.py(::[A-Za-z0-9_./[\]:=,+-]+)?$/;
// ... or a safe path with a separator (a directory target, with or without a
// trailing slash: `tests/orders` and `tests/orders/` are both valid pytest
// targets). A bare word with no separator is rejected so a "test family" cell
// like `unit` is never mistaken for a runnable target.
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

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

/** Reject any path target that contains a `..` segment (escapes the repo area). */
function hasTraversal(value: string): boolean {
  return value.split('/').some((seg) => seg === '..');
}

/** A real, bounded pytest target: a file/node id, or a path-with-separator dir. */
export function isUsablePytestTarget(value: string): boolean {
  const v = value.trim();
  if (isPlaceholderTarget(v) || hasTraversal(v)) return false;
  if (TARGET_FILE.test(v)) return true;
  return SAFE_PATH.test(v) && v.includes('/'); // directory target (slash present)
}

/** Strip one layer of matching surrounding single/double quotes from a token. */
function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const q = token[0];
    if ((q === '"' || q === "'") && token[token.length - 1] === q) return token.slice(1, -1);
  }
  return token;
}

// pytest options that take a SEPARATE operand (`--opt value`); the operand is not
// a test target, so it must be skipped when scanning a command cell. The `--opt=value`
// form is a single `-`-prefixed token and needs no special handling.
const VALUE_OPTIONS = new Set([
  '-c', '-p', '-o', '-k', '-m', '-n', '-W', '-r',
  '--ignore', '--ignore-glob', '--deselect', '--rootdir', '--confcutdir', '--basetemp',
  '--junitxml', '--junit-xml', '--resultlog', '--result-log', '--import-mode',
  '--cache-dir', '--override-ini', '--maxfail', '--durations', '--tb', '--log-file',
]);

/** Index of the first argument after the `pytest` / `python -m pytest` program. */
function pytestArgsStart(tokens: string[]): number {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1; // env assignments
  const base = (tokens[i] ?? '').replace(/.*[/\\]/, '');
  if (base === 'pytest' || base === 'py.test') return i + 1;
  if (/^(python[0-9.]*|py)$/.test(base) && tokens[i + 1] === '-m' && tokens[i + 2] === 'pytest') return i + 3;
  return i;
}

/**
 * Reduce a mapping cell to a bounded target. The cell may already be a bare
 * target, or -- since the implementation-plan template names the column
 * "test file / command" -- a full pytest command (`python -m pytest <target>
 * -q`). In the command case the program prefix is skipped, value-option operands
 * (e.g. `--ignore <path>`) are stepped over, and the first positional pytest
 * target (quotes stripped) is returned, so the row is selected instead of being
 * dropped as unusable.
 */
export function cellToTarget(value: string): string | null {
  const bare = stripQuotes(value.trim());
  if (isUsablePytestTarget(bare)) return bare;
  if (!isPytestCommand(value)) return null;

  const tokens = value.trim().split(/\s+/);
  for (let i = pytestArgsStart(tokens); i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('-')) {
      if (!tok.includes('=') && VALUE_OPTIONS.has(tok)) i += 1; // skip `--opt value` operand
      continue;
    }
    const candidate = stripQuotes(tok);
    if (isUsablePytestTarget(candidate)) return candidate;
  }
  return null;
}

/**
 * Render a target into a command. A parametrized node id contains `[`/`]`, which
 * the shell would glob-expand, so quote those for the platform the runner will
 * use (`cmd.exe` ignores single quotes); everything else is restricted to a
 * shell-safe character set and emitted bare to match the ADR's examples.
 */
export function formatTarget(value: string): string {
  if (!/[[\]]/.test(value)) return value;
  return process.platform === 'win32'
    ? `"${value.replace(/"/g, '""')}"`
    : `'${value.replace(/'/g, "'\\''")}'`;
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
 * criterion id (used only for the human-readable `reason`). Cells may be bare
 * targets or full pytest commands; placeholder rows and non-pytest cells are
 * skipped. Order and de-duplication are the caller's concern.
 */
export function extractMappedTargets(table: MarkdownTable | null, source: string): MappedTarget[] {
  if (!table) return [];
  const ti = columnIndex(table.headers, TARGET_COLUMN);
  if (ti < 0) return [];
  const ci = columnIndex(table.headers, CRITERION_COLUMN);

  const out: MappedTarget[] = [];
  for (const row of table.rows) {
    const target = cellToTarget(row[ti] ?? '');
    if (!target) continue;
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
 * Whether the change affects contracts, and the exact `cdd-kit validate` command
 * to run. Triggers on a touched path under any `contracts/` directory, or on any
 * non-empty bullet in implementation-plan.md's `## Contract Updates` section
 * (the template ships those bullets empty, so empty means "not affected").
 * Env-contract and CI/CD-contract changes add the matching validator flag
 * (`--env` / `--ci`) so the env/CI checks are not skipped; everything else uses
 * `--contracts`. Free-form bullets (no `Label:`) count as a generic contract
 * update.
 */
export function detectContractAffected(touched: string[], implPlanText: string): { reason: string; command: string } | null {
  const flags = new Set<string>();
  let touchedContracts = false;
  let planDeclares = false;

  for (const p of touched) {
    if (!/(^|\/)contracts\//.test(p)) continue;
    touchedContracts = true;
    if (/(^|\/)contracts\/env\//.test(p) || /env-contract\.md$/.test(p)) flags.add('--env');
    else if (/(^|\/)contracts\/ci\//.test(p)) flags.add('--ci');
    else flags.add('--contracts');
  }

  const section = implPlanText.match(/##\s*Contract Updates\s*\n([\s\S]*?)(?:\n#{1,6}\s|$)/i);
  if (section) {
    for (const raw of section[1].split('\n')) {
      const bullet = raw.match(/^\s*-\s*(.+?)\s*$/);
      if (!bullet) continue;
      const labeled = bullet[1].match(/^([A-Za-z][\w/ -]*?):\s*(.*)$/);
      if (labeled) {
        if (!labeled[2].trim()) continue; // unfilled template label, e.g. `- API:`
        planDeclares = true;
        const label = labeled[1].toLowerCase();
        if (/env/.test(label)) flags.add('--env');
        else if (/\bci\b|ci\/cd/.test(label)) flags.add('--ci');
        else flags.add('--contracts');
      } else if (bullet[1].trim()) {
        planDeclares = true; // free-form bullet with content
        flags.add('--contracts');
      }
    }
  }

  if (flags.size === 0) return null;
  const command = `cdd-kit validate ${['--contracts', '--env', '--ci'].filter((f) => flags.has(f)).join(' ')}`;
  const reason = touchedContracts && planDeclares
    ? 'contract files changed; implementation-plan.md declares contract updates'
    : touchedContracts
      ? 'contract files changed'
      : 'implementation-plan.md declares contract updates';
  return { reason, command };
}

// ── quality phase (configured gates) ──────────────────────────────────────────

// The lint/typecheck/build family from ADR 0005 §2 ("quality | if configured").
const QUALITY_GATES = /^(lint|typecheck|type-check|build|format|fmt|style|mypy|ruff|eslint|tsc)$/i;
// A bare workflow-file reference (`ci.yml`, `.github/workflows/ci.yml`) is not a
// runnable lint/build command, so it must not become a quality command.
const WORKFLOW_REF = /(^|\/)[\w.-]+\.ya?ml$/i;

/**
 * Quality-phase commands sourced from the change's `ci-gates.md` Required Gates
 * table (the ADR's named "command source" for the quality phase). A gate is
 * selected when it names a lint/typecheck/build-family check, is not explicitly
 * `required: no`, and has a non-empty COMMAND cell that is an actual command
 * (not an empty template cell or a workflow-file reference). A real `command`
 * column is preferred over a `workflow`-only column.
 */
export function extractQualityGates(ciGatesText: string): SelectionEntry[] {
  const table = parseMarkdownTable(ciGatesText, /required gates/i);
  if (!table) return [];
  const gi = columnIndex(table.headers, [/^gate$/, /\bgate\b/]);
  let cmdi = columnIndex(table.headers, [/command/]);
  if (cmdi < 0) cmdi = columnIndex(table.headers, [/workflow/]);
  if (gi < 0 || cmdi < 0) return [];
  const ri = columnIndex(table.headers, [/required/]);

  const out: SelectionEntry[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const gate = (row[gi] ?? '').trim();
    if (!QUALITY_GATES.test(gate)) continue;
    if (ri >= 0 && /^no$/i.test((row[ri] ?? '').trim())) continue;
    const command = (row[cmdi] ?? '').trim();
    if (!command || isPlaceholderTarget(command) || WORKFLOW_REF.test(command) || seen.has(command)) continue;
    seen.add(command);
    out.push({ reason: `${gate} gate configured in ci-gates.md`, command });
  }
  return out;
}

// ── changed-area (changed-file + graph-impact heuristics) ─────────────────────

/** Whether an absolute (non-relative) dotted module resolves to `sourcePath`. */
function dottedMatchesSource(dotted: string, sourcePath: string): boolean {
  if (!dotted || dotted.startsWith('.')) return false;
  const p = dotted.replace(/\./g, '/');
  const candidates = [`${p}.py`, `${p}/__init__.py`];
  // Exact match, or a suffix match for multi-segment modules so a `src/`-layout
  // source (`src/orders/service.py`) is found from `from orders.service import x`.
  return candidates.some((c) => sourcePath === c || (p.includes('/') && sourcePath.endsWith(`/${c}`)));
}

/**
 * Code-map test files whose imports resolve to `sourcePath`. Both the import
 * module and its imported names are considered (so `from . import service` and
 * `from pkg import service` resolve to `.../service.py`), and both relative
 * imports (via the shared resolver) and absolute package imports (via dotted
 * path match) are handled.
 */
export function findTestDependents(entries: FileEntry[], sourcePath: string, pathSet: Set<string>): string[] {
  const deps: string[] = [];
  for (const entry of entries) {
    if (entry.path === sourcePath || !isPytestTestFile(entry.path)) continue;
    const hit = entry.imports.some((imp) => {
      const mods = [imp.module];
      const sep = imp.module.startsWith('.') ? (imp.module.endsWith('.') ? '' : '.') : '.';
      for (const item of imp.items ?? []) mods.push(`${imp.module}${sep}${item}`);
      return mods.some(
        (m) => resolveLocalModule(entry.path, m, pathSet) === sourcePath || dottedMatchesSource(m, sourcePath),
      );
    });
    if (hit) deps.push(entry.path);
  }
  return deps;
}

function loadCodeMapSafe(): FileEntry[] {
  if (!existsSync(CODE_MAP_PATH)) return [];
  try {
    return loadCodeMapEntries(CODE_MAP_PATH);
  } catch {
    return []; // an unreadable map just means no graph-impact signal
  }
}

/** Parent directory (trailing slash) of a target; a dir target maps to itself. */
function targetDirectory(target: string): string | null {
  const file = target.split('::')[0];
  if (!/\.py$/.test(file)) return file.endsWith('/') ? file : `${file}/`;
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(0, slash + 1) : null;
}

/**
 * Bounded changed-area targets, in priority order: changed test files run
 * directly; changed Python sources pull in their code-map test dependents
 * (graph-impact); otherwise fall back to the directories of the explicitly
 * mapped targets so the change's area is still exercised. Only the change's own
 * specs/ artifacts are excluded; results are sorted for deterministic output.
 * When sources changed, the code-map is refreshed first (like `index impact`)
 * so a mid-change add/edit is not missed -- unless `refresh` is false.
 */
async function deriveChangedArea(
  changeId: string,
  targeted: MappedTarget[],
  touched: string[],
  refresh: boolean,
): Promise<SelectionEntry[]> {
  const inScope = touched.filter((p) => !p.startsWith(`specs/changes/${changeId}/`));
  const found = new Map<string, string>(); // target -> reason

  for (const p of inScope) {
    if (isPytestTestFile(p) && existsSync(p) && !found.has(p)) found.set(p, 'changed test file');
  }

  const sources = inScope.filter((p) => p.endsWith('.py') && !isPytestTestFile(p));
  if (sources.length) {
    if (refresh) {
      try {
        await ensureCodeMapFresh(CODE_MAP_PATH, true);
      } catch {
        /* best-effort: a refresh failure just means we use the map as-is */
      }
    }
    const entries = loadCodeMapSafe();
    if (entries.length) {
      const pathSet = new Set(entries.map((e) => e.path));
      for (const src of sources) {
        for (const dep of findTestDependents(entries, src, pathSet)) {
          if (!found.has(dep) && existsSync(dep)) found.set(dep, `imports changed source ${src} (code-map)`);
        }
      }
    }
  }

  if (found.size === 0) {
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

async function buildSelection(cwd: string, changeId: string, changeDir: string, refresh: boolean): Promise<Selection> {
  const readIf = (name: string): string => {
    const p = join(changeDir, name);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };

  const testPlanExists = existsSync(join(changeDir, 'test-plan.md'));
  const testPlanText = readIf('test-plan.md');
  const implPlanText = readIf('implementation-plan.md');
  const touched = getTouchedPaths(cwd).map((p) => p.replace(/\\/g, '/'));

  // Explicit mapping first: test-plan.md, then implementation-plan.md.
  let targeted = dedupeByTarget(
    extractMappedTargets(parseMarkdownTable(testPlanText, /acceptance criteria.*test mapping/i), 'test-plan.md'),
  );
  if (targeted.length === 0) {
    targeted = dedupeByTarget(
      extractMappedTargets(parseMarkdownTable(implPlanText, /test execution plan/i), 'implementation-plan.md'),
    );
  }

  const changedArea = await deriveChangedArea(changeId, targeted, touched, refresh);

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

  const contract = detectContractAffected(touched, implPlanText);
  if (contract) phases.contract = [{ reason: contract.reason, command: contract.command }];

  const quality = extractQualityGates(readIf('ci-gates.md'));
  if (quality.length) phases.quality = quality;

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

  const selection = await buildSelection(cwd, changeId, changeDir, opts.refresh);
  emit(selection);
  return selection.status === 'selected' ? 0 : 1;
}
