import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';
import yaml from 'js-yaml';
import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { log } from '../utils/logger.js';
import { validate } from './validate.js';
import { tasksSchema } from '../schemas/tasks.schema.js';
import { testEvidenceSchema, PROHIBITED_WAIVER_FIELDS, DEFAULT_REQUIRED_PHASES } from '../schemas/test-evidence.schema.js';
import { agentLogSchema } from '../schemas/agent-log.schema.js';
import { BEHAVIOR_FIX_REPRODUCTION_STATUSES } from '../schemas/bug-fix-evidence.schema.js';
import { loadTierPolicy, computeTierFloor } from '../utils/tier-floor.js';
import { getStagedPaths } from '../utils/git-paths.js';
import {
  stripFrontmatter,
  parseEndpointTableRows,
  DEFAULT_CONTRACT_PATH,
} from '../contracts/parser.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateTasks = ajv.compile(tasksSchema);
const validateTestEvidence = ajv.compile(testEvidenceSchema);

const TASKS_STATUS_ENUM = new Set([
  'in-progress', 'completed', 'complete', 'done',
  'gate-blocked', 'abandoned', 'needs-review',
]);

const REQUIRED_FILES = [
  'change-request.md',
  'change-classification.md',
  'implementation-plan.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.yml',
  'context-manifest.md',
];

const TIER_PATTERN = /\b(tier\s*[0-5]|low|medium|high|critical)\b/i;

const MIN_CHARS: Record<string, number> = {
  'change-classification.md': 200,
  'implementation-plan.md': 200,
  'test-plan.md': 200,
  'ci-gates.md': 150,
  'change-request.md': 100,
  'context-manifest.md': 50,
};

const DEFAULT_ARCHIVE_TASKS = ['7.1', '7.2'];

interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'done' | 'skipped';
  section?: string;
}

interface TasksFile {
  'change-id': string;
  status: string;
  tier?: number | null;
  'context-governance'?: 'v1';
  'archive-tasks'?: string[];
  'depends-on'?: string[];
  'tier-floor-override'?: string;
  'test-evidence-not-applicable'?: string;
  tasks: TaskItem[];
}

export interface GateOptions {
  strict?: boolean;
}

function meaningfulChars(text: string): number {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l)
    .filter(l => !l.startsWith('#'))
    .filter(l => !/^[|\s\-:]+$/.test(l))
    .filter(l => !l.startsWith('<!--'))
    .join('').length;
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * The exact angle-bracket fill-in tokens the scaffold templates ship with (see
 * assets/skills/contract-driven-delivery/templates/*). A change that still
 * contains them was never actually filled in. The MIN_CHARS stub check cannot
 * catch this because a template's own instructional prose (900+ chars) clears
 * the threshold while every field is still a placeholder.
 *
 * This is a closed allowlist rather than a generic `<...-...>` pattern: a broad
 * pattern would also flag legitimate hyphenated HTML/custom elements (e.g.
 * `<my-element>`, `<date-picker>`) that a real frontend-facing artifact may
 * mention in prose. Templates only use these three, so an allowlist is both
 * sufficient and false-positive-free.
 */
const PLACEHOLDER_LITERALS = ['<id>', '<date>', '<change-id>'];

const RE_META = /[.*+?^${}()|[\]\\]/g;

/** Unfilled template placeholder tokens still present in an artifact body. */
function findPlaceholders(text: string): string[] {
  const clean = stripHtmlComments(text);
  return PLACEHOLDER_LITERALS.filter(token => {
    // A template fill-in is always a colon-led, line-final value — frontmatter
    // (`change-id: <id>`, `last-changed: <date>`) or a heading title
    // (`# Implementation Plan: <change-id>`). Anchoring on `: <token>` at end of
    // line distinguishes it from an inline XML/markup element such as
    // `<id>123</id>` or `<date>2026-06-01</date>`, which is never the colon-led
    // line-final value. So a single artifact may carry BOTH an unfilled
    // `change-id: <id>` and a legitimate `<id>123</id>` example, and only the
    // real placeholder is flagged (and a partial scaffold cannot slip through).
    const re = new RegExp(`:[ \\t]*${token.replace(RE_META, '\\$&')}[ \\t]*\\r?$`, 'm');
    return re.test(clean);
  }).sort();
}

function countPendingExpansions(sectionBody: string): number {
  if (!sectionBody.trim()) return 0;
  let count = 0;
  const blocks = sectionBody.split(/(?=^\s*-\s*request-id:\s*)/m);
  for (const block of blocks) {
    if (!/^\s*-\s*request-id:\s*\S/m.test(block)) continue;
    const statusMatch = block.match(/^\s*status:\s*(\S+)/im);
    if (statusMatch && statusMatch[1].trim().toLowerCase() === 'pending') count += 1;
  }
  return count;
}

function countPendingContextRequests(content: string): number {
  const clean = stripHtmlComments(content);
  const requestMatch = clean.match(/## Context Expansion Requests\s*\n([\s\S]*?)(?:\n## |$)/);
  return requestMatch ? countPendingExpansions(requestMatch[1]) : 0;
}

function loadYamlFile<T>(path: string): { data: T | null; parseError: string | null } {
  try {
    const raw = readFileSync(path, 'utf8');
    return { data: yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as T, parseError: null };
  } catch (err) {
    return { data: null, parseError: (err as Error).message };
  }
}

function ajvErrorsToMessages(
  errors: ErrorObject[] | null | undefined,
  prefix: string,
  knownKeys?: string[],
): { errors: string[]; warnings: string[] } {
  const out = { errors: [] as string[], warnings: [] as string[] };
  for (const e of errors ?? []) {
    if (e.keyword === 'additionalProperties') {
      const key = (e.params as { additionalProperty: string }).additionalProperty;
      const lower = key.toLowerCase();
      const suggestion = knownKeys?.includes(lower) ? ` (did you mean \`${lower}\`?)` : '';
      out.warnings.push(`${prefix}: unknown key \`${key}\`${suggestion}`);
      continue;
    }
    if (e.keyword === 'required') {
      const missing = (e.params as { missingProperty: string }).missingProperty;
      out.errors.push(`${prefix}: missing required \`${missing}\``);
      continue;
    }
    if (e.keyword === 'enum') {
      const allowed = (e.params as { allowedValues: string[] }).allowedValues.join(', ');
      out.errors.push(`${prefix}: invalid value at ${e.instancePath || '/'} (expected one of: ${allowed})`);
      continue;
    }
    out.errors.push(`${prefix}: ${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
  }
  return out;
}

function isContextGovernedChange(changeDir: string): boolean {
  const tasksPath = join(changeDir, 'tasks.yml');
  if (!existsSync(tasksPath)) return false;
  const { data } = loadYamlFile<TasksFile>(tasksPath);
  return data?.['context-governance'] === 'v1';
}

function lintTasksFile(tasksPath: string, errors: string[], warnings: string[]): TasksFile | null {
  const { data, parseError } = loadYamlFile<TasksFile>(tasksPath);
  if (parseError) {
    errors.push(`tasks.yml: invalid YAML: ${parseError}`);
    return null;
  }
  if (!data || typeof data !== 'object') {
    errors.push('tasks.yml: file is empty or not a YAML mapping');
    return null;
  }

  const ok = validateTasks(data);
  const known = Object.keys(tasksSchema.properties);
  if (!ok) {
    const out = ajvErrorsToMessages(validateTasks.errors, 'tasks.yml frontmatter', known);
    errors.push(...out.errors);
    warnings.push(...out.warnings);
  }

  if (data.status && !TASKS_STATUS_ENUM.has(data.status)) {
    errors.push(`tasks.yml frontmatter: invalid status \`${data.status}\` (expected one of: ${[...TASKS_STATUS_ENUM].join(', ')})`);
  }

  return data;
}

interface TierResolution {
  tier: number | null;
  source: 'tasks-frontmatter' | 'classification-structured' | 'classification-bold' | 'none';
  classificationPresent: boolean;
  classificationHasLooseMarker: boolean;
}

function resolveTier(changeDir: string): TierResolution {
  const classifPath = join(changeDir, 'change-classification.md');
  const classificationPresent = existsSync(classifPath);
  const classificationText = classificationPresent ? readFileSync(classifPath, 'utf8') : '';
  const classificationHasLooseMarker = classificationPresent && TIER_PATTERN.test(classificationText);

  const tasksPath = join(changeDir, 'tasks.yml');
  if (existsSync(tasksPath)) {
    const { data } = loadYamlFile<TasksFile>(tasksPath);
    const t = data?.tier;
    if (typeof t === 'number' && t >= 0 && t <= 5) {
      return { tier: t, source: 'tasks-frontmatter', classificationPresent, classificationHasLooseMarker };
    }
  }

  if (classificationPresent) {
    const structured = classificationText.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
    if (structured) {
      const n = parseInt(structured[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 5) {
        return { tier: n, source: 'classification-structured', classificationPresent, classificationHasLooseMarker };
      }
    }
    const bold = classificationText.match(/\*\*Tier:\*\*\s*Tier\s*(\d)\b/i);
    if (bold) {
      const n = parseInt(bold[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 5) {
        return { tier: n, source: 'classification-bold', classificationPresent, classificationHasLooseMarker };
      }
    }
  }

  return { tier: null, source: 'none', classificationPresent, classificationHasLooseMarker };
}

function getArchiveTaskIds(tasks: TasksFile | null): string[] {
  const fromFile = tasks?.['archive-tasks'];
  return fromFile && fromFile.length > 0 ? fromFile : DEFAULT_ARCHIVE_TASKS;
}

function enforceTierConsistency(changeDir: string, errors: string[], warnings: string[]): void {
  const resolution = resolveTier(changeDir);

  if (resolution.tier === null) {
    if (resolution.classificationPresent && !resolution.classificationHasLooseMarker) {
      errors.push(
        'change-classification.md: missing tier marker. Set `tier: <0-5>` in tasks.yml frontmatter (preferred) or include `## Tier\\n- N` in change-classification.md.',
      );
    }
    return;
  }

  if (resolution.source === 'classification-bold') {
    warnings.push(
      'tier marker is bold-text only (legacy format); set `tier: <0-5>` in tasks.yml frontmatter for machine-readable classification.',
    );
    return;
  }

  if (resolution.source === 'tasks-frontmatter' && resolution.classificationPresent) {
    const text = readFileSync(join(changeDir, 'change-classification.md'), 'utf8');
    const structured = text.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
    const bold = text.match(/\*\*Tier:\*\*\s*Tier\s*(\d)\b/i);
    const classifTier = structured ? parseInt(structured[1], 10) : (bold ? parseInt(bold[1], 10) : NaN);
    if (!Number.isNaN(classifTier) && classifTier !== resolution.tier) {
      warnings.push(
        `tier mismatch: tasks.yml frontmatter says ${resolution.tier}, change-classification.md says ${classifTier} (frontmatter wins; reconcile classification).`,
      );
    }
  }
}

/**
 * Mechanical risk-tier floor — the deterministic safety net under the AI
 * classifier. Scans the change's stated intent in `change-request.md` (the
 * user's own words, not the classification it is checking against) and the
 * change's touched file paths (against the critical tier-0 rules only) for
 * sensitive surfaces, and fails the gate when the declared tier is weaker
 * (numerically higher) than the matched floor. A change may bypass with
 * `tier-floor-override: "<reason>"` in tasks.yml frontmatter, which downgrades
 * the error to an audit warning.
 */
function enforceTierFloor(changeDir: string, errors: string[], warnings: string[]): void {
  const cwd = process.cwd();
  const policy = loadTierPolicy(cwd);
  if (!policy.enabled) return;

  // Intent is scanned from the user's own words (change-request.md), not the
  // classification we are checking against — scanning the classification would
  // let "this is NOT an auth change" trip the net, and would make the floor
  // circular. The request is the ground truth of what was asked for. Staged
  // paths add a path-only signal so a generic request ("refactor middleware")
  // whose staged work lives under auth/ or payments/ still trips the floor. We
  // scan only the STAGED change (not the whole worktree) so an unrelated
  // unstaged auth/ edit can't trip the floor and reject a low-risk commit.
  const requestPath = join(changeDir, 'change-request.md');
  const requestText = existsSync(requestPath) ? readFileSync(requestPath, 'utf8') : '';
  const staged = getStagedPaths(cwd);

  // The pre-commit hook gates each staged change separately, but the staged
  // path list is global to the commit. When a single commit stages more than
  // one change directory, a source path can't be attributed to a specific
  // change — including another change's staged auth/ path would wrongly raise
  // THIS change's floor. In that case drop the path signal and fall back to the
  // request text alone; single-change commits keep the full staged-path floor.
  const stagedChangeIds = new Set(
    staged
      .map(p => /^specs\/changes\/([^/]+)\//.exec(p)?.[1])
      .filter((id): id is string => id !== undefined),
  );
  const touched = stagedChangeIds.size > 1 ? [] : staged;

  const floor = computeTierFloor(requestText, policy, { paths: touched });
  if (floor.floorTier === null) return;

  const declared = resolveTier(changeDir).tier;
  // A missing tier is already reported elsewhere; don't double-report. But do
  // leave a breadcrumb so the operator knows the floor that will apply.
  if (declared === null) {
    warnings.push(
      `tier floor: ${floor.label} detected (matched: ${floor.matched.join(', ')}); classification must declare tier ${floor.floorTier} or stricter.`,
    );
    return;
  }

  if (declared <= floor.floorTier) return; // declared is at least as strict — OK

  // Declared tier is weaker than the floor requires.
  const overrideRaw = (() => {
    const { data } = loadYamlFile<TasksFile>(join(changeDir, 'tasks.yml'));
    const o = data?.['tier-floor-override'];
    return typeof o === 'string' ? o.trim() : '';
  })();

  const detail =
    `${floor.label} detected (matched: ${floor.matched.join(', ')}) requires tier ${floor.floorTier} or stricter, ` +
    `but classification declared tier ${declared}.`;

  if (overrideRaw) {
    warnings.push(`tier floor override: ${detail} Bypassed by tier-floor-override: "${overrideRaw}".`);
  } else {
    errors.push(
      `tier floor violation: ${detail} Re-classify to tier ${floor.floorTier} (or stricter), ` +
      `or record \`tier-floor-override: "<reason>"\` in tasks.yml frontmatter to bypass with an audit trail. ` +
      `Disable entirely in .cdd/tier-policy.json.`,
    );
  }
}

// ── substantive contract check (ADR 0004 §5) ─────────────────────────────────

/**
 * Substantive contract check (ADR 0004 §5). Beyond the structural validators, the
 * gate makes a mechanical, contract-substance assertion via the shared parser,
 * directly addressing the "gate passes placeholders / self-reported done"
 * weakness. It reads the repo's API contract (contracts are repo-global, like the
 * validators the gate runs) and no-ops on an empty/freshly-scaffolded table.
 *
 *   - Declared test coverage (warning; error under --strict): when the endpoint
 *     table has a `tests` column, no row may leave it blank — a row must not be
 *     silent about the coverage it claims. A table with no `tests` column is left
 *     alone (it is not tracking tests in the contract). --strict (release
 *     readiness) escalates the warning to a failure, mirroring how the gate
 *     already escalates pending tasks under --strict.
 *
 * Deliberately MINIMAL and CONSERVATIVE — a false positive here would break ADR
 * 0002's no-migration guarantee. In particular it does NOT flag unresolved
 * request/response schema references: `openapi export` resolves a cell only when
 * it matches a defined *typed* schema and otherwise preserves it as unresolved
 * Tier C prose WITHOUT error, so at read time a bare label (`UserList`, `object`,
 * a prose name) is indistinguishable from a real-but-missing reference. Flagging
 * those would force migration of valid Tier C rows the moment any schema is added,
 * and would mis-fire on every legacy prose label during incremental adoption.
 * Reference integrity is therefore enforced where intent is explicit — on the
 * WRITE side by `contract set`, which refuses to write an undefined reference —
 * and a read-side form keyed to the rows a change actually touches is left to a
 * later, diff-aware pass (ADR 0004 §5, "the rule set starts minimal and grows").
 */
function enforceContractSubstance(cwd: string, errors: string[], warnings: string[], strict: boolean): void {
  const contractPath = join(cwd, DEFAULT_CONTRACT_PATH);
  if (!existsSync(contractPath)) return;

  let body: string;
  try {
    body = stripFrontmatter(readFileSync(contractPath, 'utf8')).body;
  } catch {
    return; // an unreadable contract is the structural validators' concern, not this one
  }

  const rows = parseEndpointTableRows(body);
  if (rows.length === 0) return; // empty / freshly-scaffolded table — nothing to assert
  const label = DEFAULT_CONTRACT_PATH;

  // Declared test coverage — only when the table actually has a `tests` column.
  for (const row of rows) {
    const tests = row.cells['tests'];
    if (tests === undefined || tests.trim() !== '') continue;
    const msg =
      `${label}: endpoint ${row.method.toUpperCase()} ${row.path} has an empty tests cell — ` +
      `name its contract test(s), or "-" if intentionally none.`;
    if (strict) errors.push(msg);
    else warnings.push(msg);
  }
}

function isArchivedChange(cwd: string, changeId: string): boolean {
  const archiveRoot = join(cwd, 'specs', 'archive');
  if (!existsSync(archiveRoot)) return false;

  const years = readdirSync(archiveRoot, { withFileTypes: true }).filter(d => d.isDirectory());
  return years.some(year => existsSync(join(archiveRoot, year.name, changeId)));
}

function detectDependencyCycle(cwd: string, startChangeId: string): string[] | null {
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    if (stack.includes(id)) {
      return [...stack.slice(stack.indexOf(id)), id];
    }
    if (visited.has(id)) return null;
    visited.add(id);
    stack.push(id);

    const tasksPath = join(cwd, 'specs', 'changes', id, 'tasks.yml');
    if (existsSync(tasksPath)) {
      const { data } = loadYamlFile<TasksFile>(tasksPath);
      const deps = data?.['depends-on'] ?? [];
      for (const dep of deps) {
        const found = visit(dep);
        if (found) return found;
      }
    }

    stack.pop();
    return null;
  }

  return visit(startChangeId);
}

function validateDependencies(cwd: string, changeId: string, changeDir: string): string[] {
  const tasksPath = join(changeDir, 'tasks.yml');
  if (!existsSync(tasksPath)) return [];

  const { data } = loadYamlFile<TasksFile>(tasksPath);
  const dependencies = data?.['depends-on'] ?? [];
  const errors: string[] = [];

  const cycle = detectDependencyCycle(cwd, changeId);
  if (cycle) {
    errors.push(`depends-on cycle detected: ${cycle.join(' -> ')}`);
  }

  for (const dep of dependencies) {
    if (dep === changeId) {
      errors.push(`tasks.yml: change cannot depend on itself (${dep})`);
      continue;
    }

    const upstreamDir = join(cwd, 'specs', 'changes', dep);
    if (existsSync(upstreamDir)) {
      const upstreamTasks = join(upstreamDir, 'tasks.yml');
      if (!existsSync(upstreamTasks)) {
        errors.push(`dependency ${dep}: missing tasks.yml`);
        continue;
      }
      const { data: upstreamData } = loadYamlFile<TasksFile>(upstreamTasks);
      const status = (upstreamData?.status ?? 'in-progress').toLowerCase();
      if (!['complete', 'completed', 'done'].includes(status)) {
        errors.push(`dependency ${dep}: upstream change is not completed (status: ${status})`);
      }
      continue;
    }

    if (!isArchivedChange(cwd, dep)) {
      errors.push(`dependency ${dep}: upstream change not found in specs/changes/ or specs/archive/`);
    }
  }

  return errors;
}

// ── test evidence enforcement (ADR 0005 §6/§7) ───────────────────────────────

// PROHIBITED_WAIVER_FIELDS (ADR 0005 §7) is owned by the schema module and
// imported above: the schema rejects these fields, and the gate scans for them
// by name so the operator gets an actionable, ADR-traceable message instead of a
// generic "must NOT be valid".

/**
 * Shared guidance for a blocked required-test failure (ADR 0005 §7). A required
 * failure cannot be waived; the operator's only valid moves are spelled out once
 * here so every evidence error gives the same advice.
 */
const BLOCKED_FAILURE_GUIDANCE =
  "fix it, expand this change's scope to cover the fix, or open a separate tracked change";

interface EvidenceRun {
  phase: string;
  status: string;
  command: string;
  summary: string;
  junit?: string;
}

interface TestEvidenceFile {
  'change-id': string;
  'schema-version': string;
  'generated-by'?: string;
  'required-phases': string[];
  runs: EvidenceRun[];
  'final-status': string;
}

/**
 * Cross-field evidence semantics that static JSON Schema cannot express (the
 * schema comment in test-evidence.schema.ts defers these to the gate):
 *   1. Every declared required phase has at least one passing run.
 *   2. No recorded run failed — a required failure blocks and cannot be waived
 *      (the schema only enforces this when `final-status` is `passed`).
 *   3. `final-status` must be `passed`.
 * Runs only on a schema-valid file, so the shape is already trustworthy.
 */
function enforceEvidenceSemantics(data: TestEvidenceFile, errors: string[]): void {
  const runs = data.runs ?? [];

  for (const run of runs) {
    if (run.status === 'failed') {
      errors.push(
        `test-evidence.yml: phase \`${run.phase}\` has a failed run (${run.command}) — ` +
        `a required test failure blocks the gate and cannot be waived (${BLOCKED_FAILURE_GUIDANCE}).`,
      );
    }
  }

  if (data['final-status'] !== 'passed') {
    errors.push(
      `test-evidence.yml: final-status is \`${data['final-status']}\` — required test evidence ` +
      `is not green; the gate cannot pass until every required phase has a passing run.`,
    );
  }

  const passedPhases = new Set(runs.filter(r => r.status === 'passed').map(r => r.phase));
  // A present file's own `required-phases` can be weakened by hand, so the
  // always-required ladder floor is merged in: a change that records evidence at
  // all cannot drop collect/targeted/changed-area to pass on fewer runs.
  const required = [...new Set([...DEFAULT_REQUIRED_PHASES, ...(data['required-phases'] ?? [])])];
  const missing = required.filter(p => !passedPhases.has(p));
  if (missing.length > 0) {
    errors.push(
      `test-evidence.yml: required phase(s) without a passing run: ${missing.join(', ')} — ` +
      `run them with \`cdd-kit test run <change-id> --phase <phase>\` before the gate can pass ` +
      `(collect, targeted, and changed-area are always required).`,
    );
  }
}

/** True iff childAbs is a real descendant of parentAbs (no `..` escape, not equal). */
function isWithinDir(parentAbs: string, childAbs: string): boolean {
  const rel = relative(parentAbs, childAbs);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Verify a referenced summary.json actually records THIS run. `cdd-kit test run`
 * writes the run's own `change_id`, `phase`, `status`, and `command` into
 * summary.json, so a real artifact cannot be reused across phases, copied from
 * another change, or back a run whose command was widened without those fields
 * disagreeing with the declared run. Returns a mismatch detail, or null when the
 * summary matches. A bounded, verbatim comparison of structured fields — no
 * inference.
 */
function summaryMismatch(summaryAbs: string, run: EvidenceRun, changeId: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(summaryAbs, 'utf8'));
  } catch {
    return 'is not a readable JSON run summary';
  }
  if (!parsed || typeof parsed !== 'object') return 'is not a valid run summary object';
  const s = parsed as { change_id?: unknown; phase?: unknown; status?: unknown; command?: unknown };
  if (s.change_id !== changeId) return `was produced for change \`${String(s.change_id)}\`, not \`${changeId}\``;
  if (s.phase !== run.phase) return `records phase \`${String(s.phase)}\`, not the declared \`${run.phase}\``;
  if (s.status !== run.status) return `records status \`${String(s.status)}\`, not the declared \`${run.status}\``;
  if (s.command !== run.command) return `records command \`${String(s.command)}\`, not the declared \`${run.command}\``;
  return null;
}

/**
 * ADR 0005 §6 durability — an otherwise-green evidence file must reference REAL
 * run artifacts under this change's own `test-runs/` directory, and each
 * summary.json must actually record its declared run. `cdd-kit test run` writes
 * summary.json (and junit.xml for pytest) before it records a run, with the run's
 * own change_id/phase/status, and the recorded paths are repo-root-relative — so
 * legitimately generated evidence always resolves and matches; a hand-authored
 * file with invented, out-of-tree, or reused paths does not. Bounded existence +
 * containment + structured-field checks — no path guessing, no inference. Called
 * only when the evidence is otherwise green, so a failing file is not buried
 * under additional artifact errors.
 */
function enforceArtifactPresence(data: TestEvidenceFile, cwd: string, changeDir: string, changeId: string, errors: string[]): void {
  const testRunsDir = resolve(changeDir, 'test-runs');
  for (const run of data.runs ?? []) {
    const refs: ReadonlyArray<readonly [string, string | undefined]> = [
      ['summary', run.summary],
      ['junit', run.junit],
    ];
    for (const [field, value] of refs) {
      if (!value) continue; // summary is schema-required; junit is optional
      if (isAbsolute(value)) {
        errors.push(
          `test-evidence.yml: phase \`${run.phase}\` ${field} path \`${value}\` is absolute — ` +
          `evidence must record repo-root-relative paths (as \`cdd-kit test run\` does) so it ` +
          `stays portable across checkouts.`,
        );
        continue;
      }
      const abs = resolve(cwd, value);
      if (!isWithinDir(testRunsDir, abs)) {
        errors.push(
          `test-evidence.yml: phase \`${run.phase}\` ${field} path \`${value}\` is not under this ` +
          `change's test-runs/ directory — evidence must reference artifacts produced by ` +
          `\`cdd-kit test run\`, not hand-written paths.`,
        );
        continue;
      }
      if (!existsSync(abs)) {
        errors.push(
          `test-evidence.yml: phase \`${run.phase}\` ${field} artifact \`${value}\` does not exist — ` +
          `record evidence with \`cdd-kit test run <change-id> --phase ${run.phase}\` so the run ` +
          `output is durable; do not hand-write evidence paths.`,
        );
        continue;
      }
      // summary.json is our structured per-run record; confirm it is THIS run's,
      // not a real artifact reused across phases or copied from another change.
      if (field === 'summary') {
        const mismatch = summaryMismatch(abs, run, changeId);
        if (mismatch) {
          errors.push(
            `test-evidence.yml: phase \`${run.phase}\` summary artifact \`${value}\` ${mismatch} — ` +
            `each run must reference its own summary.json from \`cdd-kit test run\`.`,
          );
        }
      }
    }
  }
}

/**
 * Validate a present `test-evidence.yml`: schema (incl. waiver-field rejection),
 * then change-id binding and cross-field semantics, then — when the file is
 * otherwise green — artifact durability.
 */
function lintTestEvidence(
  evidencePath: string,
  cwd: string,
  changeDir: string,
  changeId: string,
  errors: string[],
): void {
  const { data, parseError } = loadYamlFile<TestEvidenceFile>(evidencePath);
  if (parseError) {
    errors.push(`test-evidence.yml: invalid YAML: ${parseError}`);
    return;
  }
  if (!data || typeof data !== 'object') {
    errors.push('test-evidence.yml: file is empty or not a YAML mapping');
    return;
  }

  // ADR 0005 §7 — name any prohibited waiver field explicitly.
  for (const field of PROHIBITED_WAIVER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      errors.push(
        `test-evidence.yml: prohibited waiver field \`${field}\` — ADR 0005 §7 forbids excluding ` +
        `known or pre-existing failures. A required test failure blocks the gate: ${BLOCKED_FAILURE_GUIDANCE}.`,
      );
    }
  }

  const ok = validateTestEvidence(data);
  if (!ok) {
    for (const e of validateTestEvidence.errors ?? []) {
      // The `not` clause and a waiver field's additionalProperties echo are both
      // already reported above with a clearer message.
      if (e.keyword === 'not') continue;
      if (e.keyword === 'additionalProperties') {
        const key = (e.params as { additionalProperty: string }).additionalProperty;
        if (PROHIBITED_WAIVER_FIELDS.includes(key)) continue;
        errors.push(`test-evidence.yml: unknown key \`${key}\``);
        continue;
      }
      if (e.keyword === 'required') {
        const miss = (e.params as { missingProperty: string }).missingProperty;
        errors.push(`test-evidence.yml: missing required \`${miss}\``);
        continue;
      }
      if (e.keyword === 'enum') {
        const allowed = (e.params as { allowedValues: string[] }).allowedValues.join(', ');
        errors.push(`test-evidence.yml: invalid value at ${e.instancePath || '/'} (expected one of: ${allowed})`);
        continue;
      }
      errors.push(`test-evidence.yml: ${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
    }
    return; // schema-invalid evidence can't be trusted for cross-field checks
  }

  // The evidence must belong to THIS change (a copied or renamed evidence file
  // is rejected), and — when otherwise green — must reference real run artifacts.
  // Both are bounded, verbatim checks on the already-validated structure.
  const before = errors.length;
  if (data['change-id'] !== changeId) {
    errors.push(
      `test-evidence.yml: change-id \`${data['change-id']}\` does not match the change being gated ` +
      `(\`${changeId}\`) — this evidence was generated for (or copied from) a different change.`,
    );
  }
  enforceEvidenceSemantics(data, errors);
  if (errors.length === before) {
    enforceArtifactPresence(data, cwd, changeDir, changeId, errors);
  }
}

/**
 * ADR 0005 §6 / PR-5 — the gate validates test evidence, not assistant claims.
 *   - present → validate it (schema + cross-field + change-id + artifacts), always.
 *   - missing → implementation changes must record evidence. Mirrors the
 *     context-manifest migration window: a context-governed (v1) change, or any
 *     change under --strict, errors; a legacy change only warns. A change that is
 *     genuinely not an implementation change opts out auditably via
 *     `test-evidence-not-applicable: "<reason>"` in tasks.yml frontmatter.
 *
 * The opt-out is read from the tasks.yml the gate already parsed (`tasksData`),
 * not re-read here: a tasks.yml that failed to parse is already a gate error
 * (lintTasksFile), so a broken config surfaces that error instead of being
 * silently treated as "no opt-out".
 */
function enforceTestEvidence(
  cwd: string,
  changeDir: string,
  changeId: string,
  tasksData: TasksFile | null,
  isNewChange: boolean,
  strict: boolean,
  errors: string[],
  warnings: string[],
): void {
  const evidencePath = join(changeDir, 'test-evidence.yml');
  if (existsSync(evidencePath)) {
    lintTestEvidence(evidencePath, cwd, changeDir, changeId, errors);
    return;
  }

  // No evidence file. The opt-out lives in tasks.yml; if tasks.yml itself failed
  // to parse (tasksData === null) that is already reported, so don't pile on.
  if (tasksData === null) return;

  const rawOptOut = tasksData['test-evidence-not-applicable'];
  const optOut = typeof rawOptOut === 'string' ? rawOptOut.trim() : '';
  if (optOut) {
    warnings.push(`test evidence not applicable: ${optOut} (declared in tasks.yml; no test-evidence.yml required).`);
    return;
  }

  if (isNewChange || strict) {
    errors.push(
      'missing required artifact: test-evidence.yml (implementation changes must record bounded test ' +
      'evidence — generate it with `cdd-kit test run`, or, for a non-implementation change, record ' +
      '`test-evidence-not-applicable: "<reason>"` in tasks.yml frontmatter).',
    );
  } else {
    warnings.push('missing test-evidence.yml (legacy change; run `cdd-kit test run` to record bounded test evidence)');
  }
}

// ── bug-fix lane evidence enforcement (ADR 0006 §7) ──────────────────────────

// Validates the bug-fix-engineer repair log: the standard agent-log envelope
// plus, when present, the nested `bug-fix:` evidence block (the schema makes the
// block optional; enforceBugFixEvidence requires it for `lane: bug-fix`).
const validateAgentLog = ajv.compile(agentLogSchema);

/**
 * The lane the classifier recorded in change-classification.md (ADR 0006 §1):
 * structured `## Lane\n- bug-fix`, mirroring how resolveTier reads `## Tier`.
 * Returns null when absent — a change with no explicit lane (legacy or feature
 * work) is NOT subject to bug-fix evidence enforcement, so existing changes are
 * unaffected.
 */
function readLane(changeDir: string): 'feature' | 'bug-fix' | null {
  const classifPath = join(changeDir, 'change-classification.md');
  if (!existsSync(classifPath)) return null;
  // The value must be exactly `feature` or `bug-fix` (anchored at end of line): a
  // both-options stub (`- feature | bug-fix`) or a typo (`- bugfix`) does not
  // match, so the null result + laneSectionPresent drive an invalid-lane error
  // instead of silently skipping enforcement.
  const m = readFileSync(classifPath, 'utf8').match(/^##\s+Lane\s*\n\s*-\s*(feature|bug-fix)\s*$/im);
  // Lowercase the match: the regex is case-insensitive, so `- Bug-Fix` matches —
  // returning it verbatim would fail the `=== 'bug-fix'` comparison and silently
  // skip the whole bug-fix gate for that change.
  return m ? (m[1].toLowerCase() as 'feature' | 'bug-fix') : null;
}

/** True when change-classification.md has a `## Lane` heading (regardless of value). */
function laneSectionPresent(changeDir: string): boolean {
  const classifPath = join(changeDir, 'change-classification.md');
  if (!existsSync(classifPath)) return false;
  return /^##\s+Lane\s*$/im.test(readFileSync(classifPath, 'utf8'));
}

/** Collect any prohibited waiver-field key appearing anywhere in the log (ADR 0006 §7). */
function collectWaiverFields(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectWaiverFields(v, found);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PROHIBITED_WAIVER_FIELDS.includes(k)) found.add(k);
      collectWaiverFields(v, found);
    }
  }
}

/** The classifier's `## Diagnostic Only` decision (ADR 0006 §10), or null if absent. */
function readClassifierDiagnosticOnly(changeDir: string): boolean | null {
  const classifPath = join(changeDir, 'change-classification.md');
  if (!existsSync(classifPath)) return null;
  const m = readFileSync(classifPath, 'utf8').match(/^##\s+Diagnostic Only\s*\n\s*-\s*(yes|no)\b/im);
  return m ? m[1].toLowerCase() === 'yes' : null;
}

/**
 * ADR 0006 §7 — when the classifier set `lane: bug-fix`, the bug-fix-engineer's
 * repair record (agent-log/bug-fix-engineer.yml) must exist and carry a valid
 * `bug-fix:` evidence block. The schema (bug-fix-evidence.schema.ts, embedded in
 * agent-log.schema.ts) already enforces the structural shape — symptom /
 * expected / actual / reproduction status / hypotheses, and, for a behavior-
 * changing fix, the full repair shape with a passing regression and a behavior-
 * fix reproduction status. This adds the checks static schema cannot express: the
 * log is authored by bug-fix-engineer, complete, and bound to this change; a
 * reproduced symptom names a `confirmed` hypothesis; referenced run summaries are
 * this change's real `cdd-kit test run` artifacts (matching change_id, status, and
 * command, with the reproduction run failing before the fix); a behavior fix
 * carries durable, command-tied regression proof plus a present test-evidence.yml;
 * and the diagnostic-only exemption is honored only with explicit classifier
 * approval and never alongside a fix claim. Fires only for `lane: bug-fix`;
 * feature/legacy changes are untouched.
 */
function enforceBugFixEvidence(
  changeDir: string,
  changeId: string,
  cwd: string,
  tasksData: TasksFile | null,
  errors: string[],
  warnings: string[],
): void {
  const lane = readLane(changeDir);
  if (lane !== 'bug-fix') {
    // A `## Lane` section present with an unrecognized value (a typo like
    // `bugfix`, or the unfilled `feature | bug-fix` stub) must fail, not silently
    // skip bug-fix enforcement (ADR 0006 §1).
    if (lane === null && laneSectionPresent(changeDir)) {
      errors.push(
        'change-classification.md: `## Lane` has an unrecognized value — use exactly `feature` or ' +
        '`bug-fix`. An invalid lane must not silently skip bug-fix evidence enforcement (ADR 0006 §1).',
      );
    }
    return;
  }

  const logPath = join(changeDir, 'agent-log', 'bug-fix-engineer.yml');
  if (!existsSync(logPath)) {
    errors.push(
      'lane: bug-fix requires agent-log/bug-fix-engineer.yml with a `bug-fix:` evidence block ' +
      '(ADR 0006 §7) — none found. The bug-fix-engineer records the repair evidence there.',
    );
    return;
  }

  const { data, parseError } = loadYamlFile<Record<string, unknown>>(logPath);
  if (parseError) {
    errors.push(`agent-log/bug-fix-engineer.yml: invalid YAML: ${parseError}`);
    return;
  }
  if (!data || typeof data !== 'object') {
    errors.push('agent-log/bug-fix-engineer.yml: file is empty or not a YAML mapping');
    return;
  }

  // ADR 0006 §7 — a repair record may not waive failures anywhere, top-level OR
  // nested inside `bug-fix:`. The agent-log's additionalProperties:false
  // downgrades unknown keys to warnings, so the prohibited waiver fields are
  // scanned explicitly at every depth (as the test-evidence path does) and
  // rejected outright.
  const waived = new Set<string>();
  collectWaiverFields(data, waived);
  for (const field of [...waived].sort()) {
    errors.push(
      `agent-log/bug-fix-engineer.yml: prohibited waiver field \`${field}\` — a bug-fix repair record may ` +
      `not exclude known or pre-existing failures (ADR 0006 §7): ${BLOCKED_FAILURE_GUIDANCE}.`,
    );
  }

  if (!validateAgentLog(data)) {
    const out = ajvErrorsToMessages(
      validateAgentLog.errors,
      'agent-log/bug-fix-engineer.yml',
      Object.keys(agentLogSchema.properties),
    );
    errors.push(...out.errors);
    // A waiver field is already reported as an error above; don't also echo its
    // additionalProperties downgrade as a warning.
    warnings.push(...out.warnings.filter((w) => !PROHIBITED_WAIVER_FIELDS.some((f) => w.includes(`\`${f}\``))));
    // Only hard schema errors mean the shape can't be trusted. A warning-only
    // result (e.g. an unknown extra key → additionalProperties) must NOT skip the
    // required-block and cross-field checks below, or a log with the envelope and
    // a stray key but no bug-fix evidence would pass the gate on a warning alone.
    if (out.errors.length > 0) return;
  }

  // The repair record must be authored by the bug-fix-engineer (ADR 0006 §2) and
  // belong to THIS change — a copied/renamed/wrong-agent log is rejected. The
  // generic agent-log schema accepts any non-empty `agent`, so the lane pins it.
  const loggedAgent = (data as { agent?: unknown }).agent;
  if (loggedAgent !== 'bug-fix-engineer') {
    errors.push(
      `agent-log/bug-fix-engineer.yml: agent is \`${String(loggedAgent)}\`, not \`bug-fix-engineer\` — ` +
      'the bug-fix repair record must be authored by the bug-fix-engineer (ADR 0006 §2).',
    );
  }
  const loggedId = (data as { 'change-id'?: unknown })['change-id'];
  if (loggedId !== changeId) {
    errors.push(
      `agent-log/bug-fix-engineer.yml: change-id \`${String(loggedId)}\` does not match the change being ` +
      `gated (\`${changeId}\`) — this repair record was generated for (or copied from) a different change.`,
    );
  }
  // The repair record must be a completed handoff — the schema's `status` enum
  // also allows `blocked` / `needs-review`, which mean the bug-fix-engineer did
  // not finish, so the lane must not pass on them (ADR 0006 §7).
  const loggedStatus = (data as { status?: unknown }).status;
  if (loggedStatus !== 'complete' && loggedStatus !== 'done' && loggedStatus !== 'approved') {
    errors.push(
      `agent-log/bug-fix-engineer.yml: status is \`${String(loggedStatus)}\` — a bug-fix lane change needs a ` +
      'completed bug-fix-engineer repair record (status: complete / done / approved), not a blocked or ' +
      'needs-review one (ADR 0006 §7).',
    );
  }

  const block = (data as { 'bug-fix'?: Record<string, unknown> })['bug-fix'];
  if (!block || typeof block !== 'object') {
    errors.push(
      'agent-log/bug-fix-engineer.yml: lane is bug-fix but no `bug-fix:` evidence block is present ' +
      '(ADR 0006 §2/§7) — record symptom, expected/actual behavior, reproduction, hypotheses, root ' +
      'cause, and a passing regression as a nested `bug-fix:` block.',
    );
    return;
  }

  // 1. A reproduced symptom must name a confirmed root-cause hypothesis (§7).
  const reproduction = block.reproduction as
    { status?: string; command?: unknown; failing_before_fix?: unknown; summary?: unknown } | undefined;
  const status = reproduction?.status;
  if (typeof status === 'string' && (BEHAVIOR_FIX_REPRODUCTION_STATUSES as readonly string[]).includes(status)) {
    const hyps = Array.isArray(block.hypotheses) ? block.hypotheses : [];
    const confirmed = hyps.some((h) => (h as { result?: unknown })?.result === 'confirmed');
    if (!confirmed) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: reproduction succeeded (status: ${status}) but no hypothesis is ` +
        'marked `result: confirmed` — a reproduced bug must name the confirmed root-cause hypothesis (ADR 0006 §7).',
      );
    }
  }

  // 2. Referenced run summaries must be THIS change's real run artifacts (§7):
  //    repo-root-relative, under this change's test-runs/, and a JSON summary
  //    whose change_id matches AND whose recorded status/command match what the
  //    block declares — mirroring the test-evidence summaryMismatch check, so a
  //    bare existing path (e.g. CHANGELOG.md), a summary copied from another
  //    change, or a failed/unrelated run cannot stand in as reproduction/
  //    regression proof.
  const regression = block.regression as { status?: unknown; command?: unknown; summary?: unknown } | undefined;
  const testRunsDir = resolve(changeDir, 'test-runs');
  const reproAutomated = reproduction?.failing_before_fix === true || reproduction?.status === 'test-reproduced';
  const refs: ReadonlyArray<{ field: string; value: unknown; status?: unknown; allowedStatuses?: readonly string[]; command?: unknown }> = [
    {
      field: 'reproduction.summary',
      value: reproduction?.summary,
      // A test-reproduced / failing-before-fix reproduction (ADR 0006 §6) must
      // reference a run that FAILED or TIMED OUT (the runner records `timeout`
      // for a performance bug, src/commands/test-run.ts) — never a passing run,
      // nor an `error`/`no-command` setup failure that never actually reproduced.
      allowedStatuses: reproAutomated ? ['failed', 'timeout'] : undefined,
      command: reproduction?.command,
    },
    { field: 'regression.summary', value: regression?.summary, status: regression?.status, command: regression?.command },
  ];
  for (const { field, value, status: wantStatus, allowedStatuses, command: wantCommand } of refs) {
    if (typeof value !== 'string' || value === '') continue;
    if (isAbsolute(value)) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} path \`${value}\` is absolute — ` +
        'record a repo-root-relative path so the evidence stays portable.',
      );
      continue;
    }
    const abs = resolve(cwd, value);
    if (!isWithinDir(testRunsDir, abs)) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} path \`${value}\` is not under this change's ` +
        'test-runs/ directory — reference a `cdd-kit test run` summary for this change (ADR 0006 §7).',
      );
      continue;
    }
    if (!existsSync(abs)) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} artifact \`${value}\` does not exist — ` +
        'reference a real run summary produced by `cdd-kit test run` (ADR 0006 §7).',
      );
      continue;
    }
    let summary: { change_id?: unknown; phase?: unknown; status?: unknown; command?: unknown };
    try {
      summary = JSON.parse(readFileSync(abs, 'utf8')) as { change_id?: unknown; phase?: unknown; status?: unknown; command?: unknown };
    } catch {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` is not a readable JSON run summary ` +
        'produced by `cdd-kit test run` (ADR 0006 §7).',
      );
      continue;
    }
    if (summary.change_id !== changeId) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` records change ` +
        `\`${String(summary.change_id)}\`, not \`${changeId}\` — reference this change's own run summary (ADR 0006 §7).`,
      );
      continue;
    }
    if (summary.phase === 'collect') {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` is a collect-only run (phase: collect) — ` +
        'a collect run does not execute tests, so it cannot prove a reproduction or regression (ADR 0006 §6).',
      );
      continue;
    }
    if (wantStatus !== undefined && summary.status !== wantStatus) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` records status \`${String(summary.status)}\`, ` +
        `but the referenced run must record \`${String(wantStatus)}\` to prove the claimed result (ADR 0006 §7).`,
      );
      continue;
    }
    if (allowedStatuses !== undefined && !allowedStatuses.includes(String(summary.status))) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` records status \`${String(summary.status)}\`, ` +
        'but a test-reproduced / failing-before-fix reproduction must reference a failed or timed-out pre-fix run ' +
        'that proves the symptom — a passing or errored run does not (ADR 0006 §6).',
      );
      continue;
    }
    // `cdd-kit test run` rewrites a simple pytest command before recording it
    // (augmentPytestCommand appends --junitxml/-q/--maxfail/… so the declared
    // command is a prefix of the recorded one). Accept an exact match or that
    // prefix; reject an unrelated command.
    if (typeof wantCommand === 'string') {
      const recorded = typeof summary.command === 'string' ? summary.command : '';
      if (recorded !== wantCommand && !recorded.startsWith(`${wantCommand} `)) {
        errors.push(
          `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` records command \`${String(summary.command)}\`, ` +
          `which is neither the declared \`${wantCommand}\` nor a \`cdd-kit test run\` augmentation of it (ADR 0006 §7).`,
        );
      }
    }
  }

  // 3. Diagnostic-only consistency and the diagnostic vs behavior-fix boundary
  //    (ADR 0006 §10).
  const classifierDiag = readClassifierDiagnosticOnly(changeDir);
  const blockDiag = block.diagnostic_only === true;
  if (blockDiag) {
    // The exemption from root-cause/regression proof needs EXPLICIT classifier
    // approval — classifier silence is not approval, or a behavior bug could
    // self-exempt by setting a flag the classifier never granted.
    if (classifierDiag !== true) {
      errors.push(
        'agent-log/bug-fix-engineer.yml: bug-fix.diagnostic_only is true but change-classification.md does ' +
        'not explicitly set `## Diagnostic Only` to `yes` — the diagnostic-only exemption from ' +
        'root-cause/regression proof requires explicit classifier approval (ADR 0006 §10).',
      );
    }
    // A diagnostic-only record must not ALSO claim a fix — it does not fix the
    // symptom yet; the fix and its root-cause/regression proof belong to a
    // follow-up change, not this record (§10).
    const claimed = (['root_cause', 'fix', 'regression'] as const).filter((k) => block[k] !== undefined);
    if (claimed.length > 0) {
      errors.push(
        'agent-log/bug-fix-engineer.yml: a diagnostic-only record must not claim a fix, but it carries ' +
        `\`${claimed.join('`, `')}\` — diagnostic-only does not fix the symptom yet; record the fix and its ` +
        'proof in a follow-up change (ADR 0006 §10).',
      );
    }
    // Nor may it claim a SUCCESSFUL reproduction — a reproduced symptom is the
    // behavior-fix path, not diagnostic-only (which is for intermittent /
    // environment-blocked / not-reproduced) (ADR 0006 §10).
    if (typeof reproduction?.status === 'string' &&
        (BEHAVIOR_FIX_REPRODUCTION_STATUSES as readonly string[]).includes(reproduction.status)) {
      errors.push(
        'agent-log/bug-fix-engineer.yml: a diagnostic-only record must not use a successful reproduction status ' +
        `(\`${reproduction.status}\`) — a reproduced symptom needs a behavior fix with root-cause/regression ` +
        'proof; diagnostic-only is for intermittent / environment-blocked / not-reproduced (ADR 0006 §10).',
      );
    }
  } else {
    if (classifierDiag === true) {
      errors.push(
        'agent-log/bug-fix-engineer.yml: change-classification.md marks the change diagnostic-only ' +
        '(`## Diagnostic Only` `- yes`) but bug-fix.diagnostic_only is not set — reconcile the two (ADR 0006 §10).',
      );
    }
    // A behavior-changing fix must prove itself with durable, command-tied test
    // evidence (ADR 0006 §6/§7): a regression run summary AND the command it ran
    // (so the summary above is tied to the test that passed, not any same-change
    // collect-only run), plus a present test-evidence.yml. `regression.status:
    // passed` alone, or a summary with no declared command, is not proof.
    const reg = block.regression as { summary?: unknown; command?: unknown } | undefined;
    if (typeof reg?.summary !== 'string' || reg.summary === '') {
      errors.push(
        'agent-log/bug-fix-engineer.yml: a behavior-changing fix must reference a durable regression run ' +
        'summary in bug-fix.regression.summary (a `cdd-kit test run` summary.json) — `regression.status: ' +
        'passed` alone is not proof (ADR 0006 §6, §7).',
      );
    }
    if (typeof reg?.command !== 'string' || reg.command === '') {
      errors.push(
        'agent-log/bug-fix-engineer.yml: a behavior-changing fix must declare bug-fix.regression.command — ' +
        'without it the referenced summary cannot be tied to the test that proves the fix, so any same-change ' +
        'passing run (e.g. collect-only) would satisfy it (ADR 0006 §7).',
      );
    }
    // A test-reproduced / failing-before-fix reproduction must itself reference a
    // durable failing pre-fix run with its command (ADR 0006 §6): the summary loop
    // above only checks the run when summary AND command are present, so omitting
    // either would skip that proof and let a regression summary alone (or any
    // failed same-change run) stand in for the reproduction.
    if (reproAutomated && (typeof reproduction?.summary !== 'string' || reproduction.summary === '')) {
      errors.push(
        'agent-log/bug-fix-engineer.yml: a test-reproduced (failing-before-fix) reproduction must reference a ' +
        'durable failed pre-fix run summary in bug-fix.reproduction.summary (a `cdd-kit test run` summary.json) — ' +
        'a regression summary alone does not prove the symptom was reproduced (ADR 0006 §6).',
      );
    }
    if (reproAutomated && (typeof reproduction?.command !== 'string' || reproduction.command === '')) {
      errors.push(
        'agent-log/bug-fix-engineer.yml: a test-reproduced (failing-before-fix) reproduction must declare ' +
        'bug-fix.reproduction.command — without it the failed pre-fix summary cannot be tied to the command ' +
        'that reproduced the symptom (ADR 0006 §6).',
      );
    }
    // The bug-fix lane uses the ADR 0005 test-evidence layer (ADR 0006 §6): a
    // behavior fix must record test-evidence.yml (enforceTestEvidence then
    // validates its required phases). The `test-evidence-not-applicable` opt-out
    // and the legacy missing-evidence warning do not apply to a bug-fix behavior
    // fix — only diagnostic-only records may skip it.
    if (!existsSync(join(changeDir, 'test-evidence.yml'))) {
      const optOutRaw = tasksData?.['test-evidence-not-applicable'];
      const optOut = typeof optOutRaw === 'string' && optOutRaw.trim() !== '';
      errors.push(
        'agent-log/bug-fix-engineer.yml: a behavior-changing bug-fix must record passing test-evidence.yml ' +
        '(the ADR 0005 bounded ladder) — ' +
        (optOut ? 'the `test-evidence-not-applicable` opt-out does not apply to a bug-fix lane behavior fix' : 'none was found') +
        ' (ADR 0006 §6, §7).',
      );
    }
  }
}

export async function gate(changeId: string, opts: GateOptions = {}): Promise<void> {
  const strict = opts.strict ?? false;
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);

  if (!existsSync(changeDir)) {
    log.error(`change not found: ${changeId} (looked in ${changeDir})`);
    process.exit(1);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const isNewChange = isContextGovernedChange(changeDir);
  const manifestPath = join(changeDir, 'context-manifest.md');
  const hasManifest = existsSync(manifestPath);

  errors.push(...validateDependencies(cwd, changeId, changeDir));

  if (hasManifest) {
    const pending = countPendingContextRequests(readFileSync(manifestPath, 'utf8'));
    if (pending > 0) {
      warnings.push(`context-manifest.md: has ${pending} pending context expansion request(s)`);
    }
  }

  for (const f of REQUIRED_FILES) {
    if (f === 'context-manifest.md') {
      if (!hasManifest) {
        if (isNewChange || strict) {
          errors.push('missing required artifact: context-manifest.md');
        } else {
          warnings.push('missing context-manifest.md (legacy change; run cdd-kit migrate after upgrading)');
        }
      }
      continue;
    }
    if (!existsSync(join(changeDir, f))) {
      errors.push(`missing required artifact: ${f}`);
    }
  }

  if (errors.length === 0) {
    for (const f of REQUIRED_FILES) {
      if (f === 'context-manifest.md' && !hasManifest) continue;
      if (f === 'tasks.yml') continue;
      const content = readFileSync(join(changeDir, f), 'utf8');
      const minChars = MIN_CHARS[f] ?? 100;
      if (meaningfulChars(content) < minChars) {
        errors.push(`${f}: appears to be a stub (< ${minChars} meaningful chars)`);
        continue;
      }
      // context-manifest.md is exempt: its template ships illustrative agent
      // sub-sections (`### <implementation-agent>`, `<change-id>` path stubs)
      // that are explicitly "documentation only — gate enforces Allowed Paths,
      // not individual packets". Its real enforcement lives elsewhere, so a
      // placeholder there is not an unfilled-substance signal.
      if (f !== 'context-manifest.md') {
        const placeholders = findPlaceholders(content);
        if (placeholders.length > 0) {
          errors.push(
            `${f}: still contains unfilled template placeholder(s) ${placeholders.join(', ')} — replace them with the change's real values before the gate can pass`,
          );
        }
      }
    }

    const classifPath = join(changeDir, 'change-classification.md');
    const tierResolution = resolveTier(changeDir);
    if (tierResolution.tier === null && existsSync(classifPath) && !tierResolution.classificationHasLooseMarker) {
      errors.push('change-classification.md: missing tier/risk marker (set tier in tasks.yml frontmatter, or include Tier 0-5 / low|medium|high|critical in change-classification.md)');
    }
  }

  const tasksPath = join(changeDir, 'tasks.yml');
  let tasksData: TasksFile | null = null;
  if (existsSync(tasksPath)) {
    tasksData = lintTasksFile(tasksPath, errors, warnings);
  }
  if (tasksData) {
    const archiveIds = new Set(getArchiveTaskIds(tasksData));
    const nonArchivePending = (tasksData.tasks ?? [])
      .filter(t => t.status === 'pending')
      .filter(t => !archiveIds.has(t.id))
      .length;
    if (nonArchivePending > 0) {
      if (strict) {
        errors.push(`${nonArchivePending} task(s) still pending (mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped). Run gate without --strict during development.`);
      } else {
        warnings.push(`${nonArchivePending} task(s) still pending (warning only in non-strict mode)`);
      }
    }
  }

  enforceTierConsistency(changeDir, errors, warnings);
  enforceTierFloor(changeDir, errors, warnings);
  enforceContractSubstance(cwd, errors, warnings, strict);
  enforceTestEvidence(cwd, changeDir, changeId, tasksData, isNewChange, strict, errors, warnings);
  enforceBugFixEvidence(changeDir, changeId, cwd, tasksData, errors, warnings);

  for (const w of warnings) {
    log.warn(`  ${w}`);
  }

  if (errors.length > 0) {
    log.error(`gate failed for change: ${changeId}`);
    for (const e of errors) {
      log.error(`  ${e}`);
    }
    process.exit(1);
  }

  log.info(`gate: running contract validators for ${changeId}`);
  try {
    await validate({ contracts: true, env: true, ci: true, spec: false, versions: true });
  } catch (err) {
    log.error(`gate failed for change: ${changeId} (validators threw): ${(err as Error).message}`);
    process.exit(1);
  }

  for (const w of warnings) {
    log.warn(`  ${w}`);
  }

  log.ok(`gate passed for change: ${changeId}`);
}
