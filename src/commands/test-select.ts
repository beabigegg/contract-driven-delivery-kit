import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { getTouchedPaths } from '../utils/git-paths.js';
import { isPytestCommand } from './test-run.js';
import { detectStack, type StackKind } from '../utils/stack-detect.js';
import { SAFE_CHANGE_ID } from '../utils/change-id.js';
import { findAcceptanceDriverFiles } from '../utils/mock-of-sut-scan.js';

// Deterministic, static test selection (ADR 0005 §3). `cdd-kit test select` reads
// test-plan.md (then implementation-plan.md as fallback), the change's touched
// files, and emits the bounded command for each ladder phase -- or
// `needs-test-plan-update` when no bounded target can be selected safely. It
// never executes tests: it only plans the commands `cdd-kit test run` will run.
//
// Two deliberate rules keep selection deterministic instead of guessing:
//   1. A mapping cell is used only when it is EITHER a bare target that EXISTS on
//      disk (so the scaffold's `tests/unit/test_xxx.py` placeholder is filtered
//      by reality, not by word-matching) OR a full pytest command, which is
//      trusted and emitted VERBATIM (the runner already executes arbitrary
//      commands -- same trust boundary). We never dissect a command, so option
//      flags, quoting, and multiple targets are the author's concern, not ours.
//   2. Anything else -> the row is skipped, and if nothing is selectable the
//      command returns `needs-test-plan-update` rather than searching the repo.

// Bare targets are rendered through a stack-specific runner plan. Python targets
// stay pytest-first; JS/TS targets use Vitest only when the repo clearly opts
// into it. Otherwise the selector asks for explicit test-plan commands instead
// of guessing a runner.
const PYTEST = 'python -m pytest';
const PYTEST_TAIL = '-q --maxfail=1 --tb=short -ra';
const JS_STACKS = new Set<StackKind>(['pnpm', 'bun', 'yarn', 'npm']);

export type Phase = 'collect' | 'targeted' | 'changed-area' | 'contract' | 'quality' | 'full' | 'acceptance';
const PHASE_ORDER: Phase[] = ['collect', 'targeted', 'changed-area', 'contract', 'quality', 'full', 'acceptance'];

export interface SelectionEntry {
  reason: string;
  target?: string;
  command: string;
}

export interface TestSelectOptions {
  json: boolean;
}

interface MappedRow {
  reason: string;
  target?: string;
  command?: string;
}

interface RunnerPlan {
  stack: StackKind;
  jsPackageManager?: Extract<StackKind, 'pnpm' | 'bun' | 'yarn' | 'npm'>;
  hasVitest: boolean;
}

// ── target recognition ────────────────────────────────────────────────────────

// A bare test file/node id (`path.py`, optional `::nodeid`; JS/TS test file path
// only, because there is no portable JS node-id syntax across runners).
const PY_TARGET_FILE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.py(::[A-Za-z0-9_./[\]:=,+-]+)?$/;
const JS_TARGET_FILE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:test|spec)\.(?:js|jsx|mjs|cjs|ts|tsx|vue)$/;
// ... or a plain path that could be a directory (validated against the FS below).
const PATHISH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\/?$/;

/** A `..` path segment escapes the repo-relative test area; never accept it. */
function hasTraversal(value: string): boolean {
  return value.split('/').some((seg) => seg === '..');
}

/**
 * Whether a cell *looks like* a bare pytest target (a `.py` file/node id, or a
 * plain path with no shell-special characters). This is a shape check only; real
 * selection additionally requires the target to exist on disk.
 */
export function isBareTargetShape(value: string): boolean {
  const v = value.trim();
  if (!v || hasTraversal(v)) return false;
  return PY_TARGET_FILE.test(v) || JS_TARGET_FILE.test(v) || PATHISH.test(v);
}

/**
 * Classify a bare target against the filesystem: an existing `.py` file (for
 * `file` / `file::node`), or an existing directory. Returns null otherwise -- so
 * the template's `tests/unit/test_xxx.py` (which does not exist) is filtered by
 * reality, and a real `tests/todo/` or `tests/example/` package is accepted.
 */
function targetKind(cwd: string, value: string): 'file' | 'dir' | null {
  if (hasTraversal(value)) return null;
  if (PY_TARGET_FILE.test(value)) {
    return existsSync(join(cwd, value.split('::')[0])) ? 'file' : null;
  }
  if (JS_TARGET_FILE.test(value)) return existsSync(join(cwd, value)) ? 'file' : null;
  if (PATHISH.test(value)) {
    try {
      if (statSync(join(cwd, value.replace(/\/$/, ''))).isDirectory()) return 'dir';
    } catch {
      /* not a directory on disk */
    }
  }
  return null;
}

/** Strip Markdown inline-code backticks (`` `x` ``) wrapping a whole cell. */
function stripInlineCode(value: string): string {
  const m = value.match(/^`+(.*?)`+$/);
  return m ? m[1].trim() : value;
}

/**
 * Classify a mapping cell into a bare target (must exist on disk) or a trusted
 * verbatim pytest command, or null when it is empty / a placeholder / not usable.
 */
function classifyCell(cwd: string, cell: string): { target?: string; command?: string } | null {
  const v = stripInlineCode(cell.trim());
  if (!v || v === '-' || v === '—' || /^n\/?a$/i.test(v) || v.includes('<') || v.includes('>')) return null;
  if (targetKind(cwd, v)) return { target: v };
  if (isPytestCommand(v)) return { command: v }; // trusted, emitted verbatim
  if (looksLikeJsTestCommand(v)) return { command: v }; // trusted, emitted verbatim
  return null;
}

/**
 * Render a bare target into a command argument. A parametrized node id contains
 * `[`/`]`, which the shell would glob-expand, so quote those for the host
 * platform (`cmd.exe` ignores single quotes); everything else is a restricted
 * safe character set and emitted bare to match the ADR's examples.
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

/** JS/TS test file by common runner filename conventions. */
export function isJsTestFile(path: string): boolean {
  return /\.(test|spec)\.(js|jsx|mjs|cjs|ts|tsx|vue)$/.test(path);
}

/** Directory (trailing slash) to run for a target; a dir target maps to itself. */
function targetDirectory(target: string): string {
  const file = target.split('::')[0].replace(/\/$/, '');
  if (/\.(py|js|jsx|mjs|cjs|ts|tsx|vue)$/.test(file)) {
    const slash = file.lastIndexOf('/');
    return slash >= 0 ? file.slice(0, slash + 1) : '.';
  }
  return `${file}/`;
}

function readPackageJson(cwd: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function detectRunnerPlan(cwd: string): RunnerPlan {
  const detected = detectStack(cwd);
  const jsCandidate = detected.candidates.find((c) => JS_STACKS.has(c));
  const js = jsCandidate === 'pnpm' || jsCandidate === 'bun' || jsCandidate === 'yarn' || jsCandidate === 'npm'
    ? jsCandidate
    : undefined;
  const pkg = readPackageJson(cwd);
  const scripts = stringRecord(pkg?.scripts);
  const deps = { ...stringRecord(pkg?.dependencies), ...stringRecord(pkg?.devDependencies) };
  const hasVitest =
    /\bvitest\b/.test(scripts.test ?? '') ||
    Object.prototype.hasOwnProperty.call(deps, 'vitest') ||
    existsSync(join(cwd, 'vitest.config.ts')) ||
    existsSync(join(cwd, 'vitest.config.js')) ||
    existsSync(join(cwd, 'vitest.config.mjs'));
  return { stack: detected.primary, jsPackageManager: js, hasVitest };
}

function appendTestArgs(pm: RunnerPlan['jsPackageManager'], args: string): string {
  const trimmed = args.trim();
  if (!pm) return '';
  if (!trimmed) return pm === 'bun' ? 'bun run test' : `${pm} test`;
  if (pm === 'yarn') return `yarn test ${trimmed}`;
  if (pm === 'bun') return `bun run test -- ${trimmed}`;
  return `${pm} test -- ${trimmed}`;
}

function looksLikeJsTestCommand(command: string): boolean {
  return /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/.test(command) ||
    /(^|\s)(vitest|jest)\b/.test(command);
}

function targetRunner(target: string, plan: RunnerPlan): 'pytest' | 'vitest' | null {
  const file = target.split('::')[0].replace(/\/$/, '');
  if (/\.py$/.test(file)) return 'pytest';
  if (isJsTestFile(file)) return plan.hasVitest && plan.jsPackageManager ? 'vitest' : null;
  if (target.endsWith('/') || !/\.[A-Za-z0-9]+$/.test(file)) {
    if (JS_STACKS.has(plan.stack) && plan.hasVitest && plan.jsPackageManager) return 'vitest';
    return 'pytest';
  }
  return null;
}

function commandForTarget(target: string, phase: 'collect' | 'targeted' | 'changed-area', plan: RunnerPlan): string | null {
  const runner = targetRunner(target, plan);
  const quoted = formatTarget(target);
  if (runner === 'pytest') {
    if (phase === 'collect') return `${PYTEST} --collect-only -q ${quoted}`;
    return `${PYTEST} ${quoted} ${PYTEST_TAIL}`;
  }
  if (runner === 'vitest') {
    if (phase === 'collect') return null;
    const args = `--run ${quoted}`;
    return appendTestArgs(plan.jsPackageManager, args);
  }
  return null;
}

function fullCommand(plan: RunnerPlan): string {
  if (JS_STACKS.has(plan.stack) && plan.hasVitest && plan.jsPackageManager) {
    return appendTestArgs(plan.jsPackageManager, '--run');
  }
  return `${PYTEST} ${PYTEST_TAIL}`;
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
 * Pull usable rows out of an acceptance->test mapping table, paired with the
 * criterion id (used only for the human-readable `reason`). A cell is either a
 * bare target that exists on disk or a trusted verbatim pytest command; anything
 * else is skipped. De-duplicated by the cell value, preserving document order.
 */
function extractMappedRows(table: MarkdownTable | null, source: string, cwd: string): MappedRow[] {
  if (!table) return [];
  const ti = columnIndex(table.headers, TARGET_COLUMN);
  if (ti < 0) return [];
  const ci = columnIndex(table.headers, CRITERION_COLUMN);

  const out: MappedRow[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const classified = classifyCell(cwd, row[ti] ?? '');
    if (!classified) continue;
    const key = classified.target ?? classified.command ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    const criterion = ci >= 0 ? (row[ci] ?? '').trim() : '';
    out.push({ ...classified, reason: `${criterion ? `${criterion} ` : ''}mapped in ${source}` });
  }
  return out;
}

// ── contract phase trigger ────────────────────────────────────────────────────

/**
 * Whether the change affects contracts, and the exact `cdd-kit validate` command
 * to run. Triggers on a touched path under any `contracts/` directory, or on any
 * non-empty bullet in implementation-plan.md's `## Contract Updates` section (the
 * template ships those bullets empty, so empty means "not affected"). `--contracts`
 * is always included (it checks the contract *files*); env/CI-contract changes add
 * `--env` / `--ci` so those family validators are not skipped.
 */
export function detectContractAffected(touched: string[], implPlanText: string): { reason: string; command: string } | null {
  const extra = new Set<string>(); // family validators beyond the base --contracts
  let touchedContracts = false;
  let planDeclares = false;

  for (const p of touched) {
    if (!/(^|\/)contracts\//.test(p)) continue;
    touchedContracts = true;
    if (/(^|\/)contracts\/env\//.test(p) || /env-contract\.md$/.test(p)) extra.add('--env');
    else if (/(^|\/)contracts\/ci\//.test(p)) extra.add('--ci');
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
        if (/env/.test(label)) extra.add('--env');
        else if (/\bci\b|ci\/cd/.test(label)) extra.add('--ci');
      } else if (bullet[1].trim()) {
        planDeclares = true; // free-form bullet with content
      }
    }
  }

  if (!touchedContracts && !planDeclares) return null;

  const flags = ['--contracts', ...['--env', '--ci'].filter((f) => extra.has(f))];
  const reason = touchedContracts && planDeclares
    ? 'contract files changed; implementation-plan.md declares contract updates'
    : touchedContracts
      ? 'contract files changed'
      : 'implementation-plan.md declares contract updates';
  return { reason, command: `cdd-kit validate ${flags.join(' ')}` };
}

// ── quality phase (configured gates) ──────────────────────────────────────────

// The lint/typecheck/build family from ADR 0005 §2 ("quality | if configured").
const QUALITY_GATES = /^(lint|typecheck|type-check|build|format|fmt|style|mypy|ruff|eslint|tsc)$/i;
// A bare workflow-file reference (`ci.yml`, `.github/workflows/ci.yml`) is not a
// runnable lint/build command, so it must not become a quality command.
const WORKFLOW_REF = /(^|\/)[\w.-]+\.ya?ml$/i;

/**
 * Quality-phase commands sourced from the change's `ci-gates.md` Required Gates
 * table (the ADR's named "command source"). A gate is selected when it names a
 * lint/typecheck/build-family check, is not explicitly `required: no`, and has a
 * runnable COMMAND cell (not an empty template cell, an angle-placeholder, or a
 * workflow-file reference). A real `command` column is preferred over `workflow`.
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
    const command = stripInlineCode((row[cmdi] ?? '').trim());
    if (!command || command.includes('<') || WORKFLOW_REF.test(command) || seen.has(command)) continue;
    seen.add(command);
    out.push({ reason: `${gate} gate configured in ci-gates.md`, command });
  }
  return out;
}

// ── acceptance phase (ADR 0010 §3.4) ──────────────────────────────────────────

/**
 * Bounded acceptance-phase command(s): one entry per stack that actually has
 * driver files under the conventional directories
 * (findAcceptanceDriverFiles, src/utils/mock-of-sut-scan.ts -- the same
 * tests/acceptance/ | test/acceptance/ discovery `enforceAcceptanceOracle`'s
 * AC-4 scan uses, so selection and enforcement never drift apart). No driver
 * files at all -> no acceptance entry, mirroring how `contract`/`quality` stay
 * conditional; a change without an acceptance oracle is never forced to plan
 * this phase.
 */
export function detectAcceptancePhase(cwd: string, plan: RunnerPlan): SelectionEntry[] {
  const driverFiles = findAcceptanceDriverFiles(cwd).map((f) => f.replace(/\\/g, '/'));
  if (driverFiles.length === 0) return [];

  const entries: SelectionEntry[] = [];
  if (driverFiles.some((f) => f.endsWith('.py'))) {
    entries.push({
      reason: 'acceptance driver(s) found under tests/acceptance/',
      target: 'tests/acceptance/',
      command: `${PYTEST} tests/acceptance ${PYTEST_TAIL}`,
    });
  }
  if (driverFiles.some((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)) && plan.hasVitest && plan.jsPackageManager) {
    entries.push({
      reason: 'acceptance driver(s) found under test/acceptance/',
      target: 'test/acceptance/',
      command: appendTestArgs(plan.jsPackageManager, '--run test/acceptance'),
    });
  }
  return entries;
}

// ── changed-area (changed-file heuristic) ─────────────────────────────────────

/**
 * Bounded changed-area targets from the change's touched files: a changed test
 * file runs directly; a changed `conftest.py` runs its directory (pytest
 * discovers its fixtures without an import edge). When git reports nothing
 * usable, fall back to the directories of the explicitly mapped targets so the
 * change's area is still exercised. Deleted paths (no longer on disk) are skipped
 * -- the selector only plans commands that can actually run. Graph-impact via the
 * code-map is intentionally deferred (see ADR 0005 "Revisit when").
 */
function deriveChangedArea(cwd: string, changeId: string, targetDirs: string[], plan: RunnerPlan): SelectionEntry[] {
  const found = new Map<string, string>(); // target -> reason

  for (const p of getTouchedPaths(cwd).map((x) => x.replace(/\\/g, '/'))) {
    if (p.startsWith(`specs/changes/${changeId}/`) || !existsSync(join(cwd, p))) continue;
    const base = p.split('/').pop() ?? '';
    if (isPytestTestFile(p) || isJsTestFile(p)) {
      if (!found.has(p)) found.set(p, 'changed test file');
    } else if (base === 'conftest.py') {
      const dir = p.slice(0, p.length - base.length) || '.';
      if (!found.has(dir)) found.set(dir, 'changed conftest');
    }
  }

  if (found.size === 0) {
    for (const d of targetDirs) if (!found.has(d)) found.set(d, 'directory of test-plan targets');
  }

  return [...found.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([target, reason]) => {
      const command = commandForTarget(target, 'changed-area', plan);
      return command ? { reason, target, command } : null;
    })
    .filter((entry): entry is SelectionEntry & { target: string } => entry !== null);
}

// ── selection ─────────────────────────────────────────────────────────────────

type Selection =
  | { change_id: string; status: 'selected'; phases: Partial<Record<Phase, SelectionEntry[]>> }
  | { change_id: string; status: 'needs-test-plan-update'; reason: string }
  | { change_id: string; status: 'error'; reason: string };

function buildSelection(cwd: string, changeId: string, changeDir: string): Selection {
  const readIf = (name: string): string => {
    const p = join(changeDir, name);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };

  const testPlanExists = existsSync(join(changeDir, 'test-plan.md'));
  const testPlanText = readIf('test-plan.md');
  const implPlanText = readIf('implementation-plan.md');
  const touched = getTouchedPaths(cwd).map((p) => p.replace(/\\/g, '/'));
  const runnerPlan = detectRunnerPlan(cwd);

  // Explicit mapping first: test-plan.md, then implementation-plan.md.
  let rows = extractMappedRows(parseMarkdownTable(testPlanText, /acceptance criteria.*test mapping/i), 'test-plan.md', cwd);
  if (rows.length === 0) {
    rows = extractMappedRows(parseMarkdownTable(implPlanText, /test execution plan/i), 'implementation-plan.md', cwd);
  }
  const targets = rows.filter((r): r is MappedRow & { target: string } => r.target !== undefined);
  const commands = rows.filter((r): r is MappedRow & { command: string } => r.command !== undefined);

  const targetDirs = [...new Set(targets.map((r) => targetDirectory(r.target)))];
  const changedArea = deriveChangedArea(cwd, changeId, targetDirs, runnerPlan);

  if (rows.length === 0 && changedArea.length === 0) {
    const reason = !testPlanExists
      ? `test-plan.md not found at specs/changes/${changeId}/test-plan.md`
      : 'test-plan.md does not provide target commands or node IDs, and no changed-area tests could be inferred safely';
    return { change_id: changeId, status: 'needs-test-plan-update', reason };
  }

  const unsupportedTargets = targets.filter((r) => commandForTarget(r.target, 'targeted', runnerPlan) === null);
  if (unsupportedTargets.length > 0) {
    return {
      change_id: changeId,
      status: 'needs-test-plan-update',
      reason: `test-plan.md maps target(s) ${unsupportedTargets.map(t => t.target).join(', ')} but cdd-kit cannot infer a bounded runner for this stack; provide an explicit command in the mapping table`,
    };
  }

  const phases: Partial<Record<Phase, SelectionEntry[]>> = {};

  // collect = --collect-only of what we will actually run: the bare mapped
  // targets, or (when nothing was explicitly mapped) the changed-area set.
  // Verbatim commands cannot be safely turned into a --collect-only form, so they
  // do not contribute a collect entry.
  const collectSource = targets.length
    ? targets.map((r) => ({ target: r.target, reason: r.reason }))
    : changedArea.map((e) => ({ target: e.target as string, reason: e.reason }));
  if (collectSource.length) {
    const collect = collectSource
      .map((r) => {
        const command = commandForTarget(r.target, 'collect', runnerPlan);
        return command ? { reason: r.reason, target: r.target, command } : null;
      })
      .filter((entry): entry is SelectionEntry & { target: string } => entry !== null);
    if (collect.length) phases.collect = collect;
  }

  const targeted: SelectionEntry[] = [
    ...targets.map((r) => ({ reason: r.reason, target: r.target, command: commandForTarget(r.target, 'targeted', runnerPlan) as string })),
    ...commands.map((r) => ({ reason: r.reason, command: r.command })),
  ];
  if (targeted.length) phases.targeted = targeted;
  if (changedArea.length) phases['changed-area'] = changedArea;

  const contract = detectContractAffected(touched, implPlanText);
  if (contract) phases.contract = [{ reason: contract.reason, command: contract.command }];

  const quality = extractQualityGates(readIf('ci-gates.md'));
  if (quality.length) phases.quality = quality;

  const acceptance = detectAcceptancePhase(cwd, runnerPlan);
  if (acceptance.length) phases.acceptance = acceptance;

  phases.full = [{ reason: 'final bounded full-suite smoke', command: fullCommand(runnerPlan) }];

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
