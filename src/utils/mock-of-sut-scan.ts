// Mock-of-SUT + hardcoded-expect scan for acceptance drivers (ADR 0010 SS3.3;
// design.md Q2, Open Risks).
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join, relative } from 'path';
import { sectionBody } from './markdown-section.js';
import { parsePipeTable } from './markdown-table.js';
import { loadCodeMapEntries } from '../code-map/index-reader.js';

export function resolveChangeSutFiles(cwd: string, changeDir: string): string[] {
  const planPath = join(changeDir, 'implementation-plan.md');
  if (!existsSync(planPath)) return [];

  const body = sectionBody(readFileSync(planPath, 'utf8'), 'File-Level Plan');
  if (!body.trim()) return [];

  const rows = parsePipeTable(body);
  const declared = rows
    .map((r) => (r['path or glob'] ?? r['path'] ?? '').trim())
    .filter((p) => p && !p.includes('*'))
    .map((p) => p.replace(/\\/g, '/'));
  if (declared.length === 0) return [];

  const mapPath = join(cwd, '.cdd', 'code-map.yml');
  if (!existsSync(mapPath)) return [];

  let entries;
  try {
    entries = loadCodeMapEntries(mapPath);
  } catch {
    return [];
  }
  const indexed = new Set(entries.map((e) => e.path.replace(/\\/g, '/')));
  return declared.filter((p) => indexed.has(p));
}

export function sutMatchTokens(sutFiles: string[]): string[] {
  const tokens = new Set<string>();
  for (const file of sutFiles) {
    const noExt = file.replace(/\.(tsx?|jsx?|mjs|cjs|py)$/i, '');
    tokens.add(noExt);
    tokens.add(noExt.replace(/\//g, '.'));
    const base = basename(noExt);
    if (base.length >= 4) tokens.add(base);
  }
  return [...tokens];
}

function targetMatchesSut(target: string, sutTokens: string[]): string | null {
  const normalized = target.replace(/^\.\//, '').replace(/\\/g, '/');
  for (const token of sutTokens) {
    if (normalized === token || normalized.endsWith(`/${token}`) || normalized.includes(token)) {
      return token;
    }
  }
  return null;
}

export interface MockOfSutViolation {
  match: string;
  target: string;
}

const PYTEST_PATCH_RE = /(?:unittest\.mock\.patch|mock\.patch|mocker\.patch)(?:\.object)?\(\s*["']([^"']+)["']/g;
const PYTEST_MONKEYPATCH_RE = /monkeypatch\.setattr\(\s*["']([^"']+)["']/g;
const VITEST_MOCK_RE = /vi\.(?:mock|doMock)\(\s*["']([^"']+)["']/g;
const VITEST_SPYON_RE = /vi\.spyOn\(\s*([A-Za-z_$][\w$]*)/g;
const JS_IMPORT_RE = /import\s+(?:\*\s+as\s+(\w+)|\{[^}]*\}|(\w+))\s+from\s+["']([^"']+)["']/g;

export function scanDriverForMockOfSut(content: string, sutTokens: string[]): MockOfSutViolation[] {
  if (sutTokens.length === 0) return [];
  const violations: MockOfSutViolation[] = [];

  for (const re of [PYTEST_PATCH_RE, PYTEST_MONKEYPATCH_RE, VITEST_MOCK_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const target = m[1];
      const hit = targetMatchesSut(target, sutTokens);
      if (hit) violations.push({ match: m[0], target });
    }
  }

  const imports = new Map<string, string>();
  JS_IMPORT_RE.lastIndex = 0;
  let im: RegExpExecArray | null;
  while ((im = JS_IMPORT_RE.exec(content))) {
    const name = im[1] || im[2];
    if (name) imports.set(name, im[3]);
  }
  VITEST_SPYON_RE.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = VITEST_SPYON_RE.exec(content))) {
    const source = imports.get(sm[1]);
    if (!source) continue;
    const hit = targetMatchesSut(source, sutTokens);
    if (hit) violations.push({ match: sm[0], target: source });
  }

  return violations;
}

export interface HardcodedExpectViolation {
  caseId: string;
  literal: string;
}

// Generic status/boolean words are excluded regardless of length: a gate/scan
// domain inherently talks about pass/fail/true/false/ok/error, so treating any
// of these as "the hardcoded answer key" would false-fail nearly every driver
// that so much as names its own outcome. Real answer-key leaves (domain values
// like "credit-limit-exceeded", "placeholder", "re-confirm") are unaffected.
const GENERIC_LEAF_STOPWORDS = new Set([
  'true', 'false', 'pass', 'passed', 'fail', 'failed', 'ok', 'okay', 'yes', 'no',
  'null', 'none', 'error', 'errors', 'done', 'unknown', 'skip', 'skipped',
  'warn', 'warning', 'info', 'debug',
]);

function collectLeafLiterals(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length >= 4 && !GENERIC_LEAF_STOPWORDS.has(trimmed.toLowerCase())) out.add(value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.add(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectLeafLiterals(v, out);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectLeafLiterals(v, out);
  }
}

/** Every [start, end) byte range where `needle` occurs verbatim in `haystack`. */
function findAllOccurrences(haystack: string, needle: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (!needle) return ranges;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    ranges.push([idx, idx + needle.length]);
    idx = haystack.indexOf(needle, idx + 1);
  }
  return ranges;
}

function isFullyContainedInAny(range: [number, number], containers: Array<[number, number]>): boolean {
  return containers.some(([cs, ce]) => range[0] >= cs && range[1] <= ce);
}

// A leaf literal is only a genuine "hardcoded answer" occurrence when it
// stands as its own token -- not merely a substring of a longer identifier or
// hyphenated field name (e.g. the leaf "reason" must not match inside the
// SUT's own `applicability-reason` field name, which a driver legitimately
// writes as fixture/input text). Hyphen and underscore count as word
// characters for this purpose since kebab-case/snake_case identifiers are the
// exact shape this guards against (`applicability-reason`, `reason_contains`).
const WORD_CHAR_RE = /[A-Za-z0-9_-]/;

function isWordBoundaryOccurrence(haystack: string, start: number, end: number): boolean {
  const before = start > 0 ? haystack[start - 1] : '';
  const after = end < haystack.length ? haystack[end] : '';
  if (before && WORD_CHAR_RE.test(before)) return false;
  if (after && WORD_CHAR_RE.test(after)) return false;
  return true;
}

/**
 * Scan one driver file's source for a literal occurrence of any case's
 * `expect` value -- the driver should read `expect` from the emitted
 * acceptance loader, never hardcode the answer key (design.md Q2).
 *
 * A case's own `id` is often a short human description of the scenario (e.g.
 * `placeholder-oracle-blocks-gate`) that a driver legitimately names its test
 * after, and that description can itself contain a leaf word from `expect`
 * (e.g. `reason_contains: "placeholder"`). An occurrence of a leaf literal is
 * only counted when it is both (a) a whole-token match -- not embedded inside
 * a longer identifier the SUT itself defines, e.g. `applicability-reason` --
 * and (b) sits OUTSIDE every occurrence of the case's own id string -- so
 * referencing the case by name never trips the scan, but a genuine standalone
 * hardcoded comparison still does.
 */
export function scanDriverForHardcodedExpect(
  content: string,
  cases: Array<{ id?: unknown; expect?: unknown }>,
): HardcodedExpectViolation[] {
  const violations: HardcodedExpectViolation[] = [];
  for (const c of cases) {
    const idStr = c.id !== undefined && c.id !== null ? String(c.id) : '';
    const idRanges = idStr.length >= 4 ? findAllOccurrences(content, idStr) : [];
    const leaves = new Set<string>();
    collectLeafLiterals(c.expect, leaves);
    for (const literal of leaves) {
      const occurrences = findAllOccurrences(content, literal)
        .filter(([s, e]) => isWordBoundaryOccurrence(content, s, e));
      if (occurrences.length === 0) continue;
      const genuine = occurrences.some((r) => !isFullyContainedInAny(r, idRanges));
      if (genuine) {
        violations.push({ caseId: idStr, literal });
      }
    }
  }
  return violations;
}

const DRIVER_DIRS = ['tests/acceptance', 'test/acceptance'];
const DRIVER_EXT_RE = /\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;
const SKIP_DIR_NAMES = new Set(['node_modules', '__pycache__', '.pytest_cache', 'dist', 'build']);

function walkDriverFiles(dir: string, found: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDriverFiles(full, found);
    } else if (entry.isFile() && DRIVER_EXT_RE.test(entry.name)) {
      found.push(full);
    }
  }
}

export function findAcceptanceDriverFiles(cwd: string): string[] {
  const found: string[] = [];
  for (const rel of DRIVER_DIRS) {
    const dir = join(cwd, rel);
    if (existsSync(dir)) walkDriverFiles(dir, found);
  }
  return found;
}

export interface DriverScanFinding {
  file: string;
  kind: 'mock-of-sut' | 'hardcoded-expect';
  detail: string;
}

// Matches a call to either loader's "read one/all cases for this change id"
// entry point -- TS/vitest (`loadCase`/`loadAllCases`, camelCase) and Python/
// pytest (`load_case`/`load_all_cases`, snake_case) -- capturing the first
// argument, which is always the change id. The argument is either a quoted
// literal (`loadCase('my-change', ...)`) or an identifier bound to one
// earlier in the file (the universal `const CHANGE_ID = 'my-change'` /
// `CHANGE_ID = "my-change"` convention every existing driver uses).
const LOADER_CALL_RE = /\bload(?:_all_cases|_case|AllCases|Case)\s*\(\s*(['"][^'"]*['"]|[A-Za-z_$][\w$]*)/g;
// `const X = 'y'` (TS/JS) or `X = "y"` (Python module-level constant).
const STRING_BINDING_RE = /\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2/g;

/** The set of change ids a driver file's loader calls resolve to. */
function extractLoaderChangeIds(content: string): Set<string> {
  const bindings = new Map<string, string>();
  STRING_BINDING_RE.lastIndex = 0;
  let bm: RegExpExecArray | null;
  while ((bm = STRING_BINDING_RE.exec(content))) bindings.set(bm[1], bm[3]);

  const ids = new Set<string>();
  LOADER_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LOADER_CALL_RE.exec(content))) {
    const arg = m[1];
    if (arg[0] === '"' || arg[0] === "'") {
      ids.add(arg.slice(1, -1));
    } else {
      const bound = bindings.get(arg);
      if (bound !== undefined) ids.add(bound);
    }
  }
  return ids;
}

/**
 * True when `filePath` (with source `content`) is a driver FOR `changeId` --
 * either by the established naming convention (`<change-id>.driver.*`, the
 * shape every existing driver already uses) or, more robustly, because its
 * source calls the emitted loader pointed at THIS change's acceptance.yml
 * (`loadCase`/`loadAllCases`/`load_case`/`load_all_cases` resolving to
 * `changeId`). A driver satisfying neither test was written for a different
 * change and must never be scanned against this change's mock-of-SUT tokens
 * or expect literals (cross-change contamination) -- and, symmetrically, a
 * driver that does not reference the loader at all (e.g. a fixture used only
 * to prove the mock-of-SUT scan fires) still matches via the filename rule.
 */
export function driverBelongsToChange(content: string, filePath: string, changeId: string): boolean {
  const base = basename(filePath);
  if (base === `${changeId}.driver` || base.startsWith(`${changeId}.driver.`)) return true;
  return extractLoaderChangeIds(content).has(changeId);
}

export function scanAcceptanceDrivers(
  cwd: string,
  changeDir: string,
  changeId: string,
  cases: Array<{ id?: unknown; expect?: unknown }>,
): DriverScanFinding[] {
  const allDriverFiles = findAcceptanceDriverFiles(cwd);
  if (allDriverFiles.length === 0) return [];

  const sutFiles = resolveChangeSutFiles(cwd, changeDir);
  const sutTokens = sutMatchTokens(sutFiles);

  const findings: DriverScanFinding[] = [];
  for (const file of allDriverFiles) {
    const content = readFileSync(file, 'utf8');
    // Cross-change isolation (BUG 1): a driver written for a DIFFERENT change
    // must never be scanned against THIS change's SUT tokens or expect
    // literals -- otherwise an unrelated driver elsewhere under
    // test(s)/acceptance/ that happens to share vocabulary with this change's
    // oracle is falsely flagged for a change it has nothing to do with.
    if (!driverBelongsToChange(content, file, changeId)) continue;

    const rel = relative(cwd, file).replace(/\\/g, '/');

    for (const v of scanDriverForMockOfSut(content, sutTokens)) {
      findings.push({
        file: rel,
        kind: 'mock-of-sut',
        detail: 'mocks the system under test (' + v.target + ', matched ' + v.match + ') -- ' +
          '"acceptance test mocks the thing it is supposed to verify" (AC-4; ADR 0010 section 3.3)',
      });
    }
    for (const v of scanDriverForHardcodedExpect(content, cases)) {
      findings.push({
        file: rel,
        kind: 'hardcoded-expect',
        detail: 'hardcodes case ' + v.caseId + ' expect value (' + v.literal + ')',
      });
    }
  }
  return findings;
}
