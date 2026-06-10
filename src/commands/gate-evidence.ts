import { existsSync, readFileSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';
import { PHASES, isPytestCommand, hasShellControl } from './test-run.js';
import { testEvidenceSchema, PROHIBITED_WAIVER_FIELDS, DEFAULT_REQUIRED_PHASES } from '../schemas/test-evidence.schema.js';
import { agentLogSchema } from '../schemas/agent-log.schema.js';
import { BEHAVIOR_FIX_REPRODUCTION_STATUSES } from '../schemas/bug-fix-evidence.schema.js';
import { ajv, ajvErrorsToMessages, loadYamlFile, type TasksFile } from './gate-shared.js';

const validateTestEvidence = ajv.compile(testEvidenceSchema);
const validateAgentLog = ajv.compile(agentLogSchema);

// `cdd-kit test run` augments a simple pytest command by APPENDING only this
// fixed flag vocabulary (augmentPytestCommand, src/commands/test-run.ts), plus a
// leading `--junitxml=<path>` token. A bug-fix reproduction/regression summary may
// record the declared command followed ONLY by these tokens; any other suffix
// token (e.g. a user-selected `-k`) means a different command actually ran.
const RUNNER_ADDED_PYTEST_FLAGS = new Set(['-q', '--maxfail=1', '--tb=short', '-ra']);

// Proving a reproduction or regression needs an EXECUTED run; the collect-only
// phase never executes tests. The valid executed phases are every `cdd-kit test
// run` phase except `collect` (PHASES, src/commands/test-run.ts).
const EXECUTED_PHASES: readonly string[] = PHASES.filter((p) => p !== 'collect');

/**
 * Shared guidance for a blocked required-test failure (ADR 0005 §7). A required
 * failure cannot be waived; the operator's only valid moves are spelled out once
 * here so every evidence error gives the same advice.
 */
const BLOCKED_FAILURE_GUIDANCE =
  "fix it, expand this change's scope to cover the fix, or open a separate tracked change";

/**
 * Split a command suffix into tokens on whitespace, keeping single/double-quoted
 * spans intact. `cdd-kit test run` shell-quotes the appended `--junitxml=<path>`
 * (shellQuote, src/commands/test-run.ts), so a repo path containing spaces yields
 * a `--junitxml='/a b/junit.xml'` token that a naive whitespace split would tear
 * into bogus extra tokens and wrongly reject as a non-runner flag.
 */
function splitPreservingQuotes(s: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let inToken = false;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) { tokens.push(cur); cur = ''; inToken = false; }
    } else {
      cur += ch;
      inToken = true;
    }
  }
  if (inToken) tokens.push(cur);
  return tokens;
}

/**
 * Validate a typed bug-fix evidence pointer (visual / data / performance, ADR 0006
 * §6 PR 5). When present it must be a portable, existing repo-relative artifact —
 * the durable proof committed with the change. Absent is allowed here; required-ness
 * is decided by the caller (e.g. visual_evidence.before for a visual reproduction).
 */
function checkEvidencePointer(field: string, value: unknown, cwd: string, errors: string[]): void {
  if (typeof value !== 'string' || value === '') return;
  if (isAbsolute(value)) {
    errors.push(
      `agent-log/bug-fix-engineer.yml: bug-fix.${field} path \`${value}\` is absolute — ` +
      'record a repo-root-relative path so the evidence stays portable.',
    );
    return;
  }
  if (!existsSync(resolve(cwd, value))) {
    errors.push(
      `agent-log/bug-fix-engineer.yml: bug-fix.${field} artifact \`${value}\` does not exist — ` +
      'reference a durable evidence file committed with the change (ADR 0006 §6).',
    );
  }
}

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
export function enforceTestEvidence(
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
  // Anchor the value to end-of-line (like readLane): a yes-like-but-invalid value
  // (the `- yes | no` stub, `- yes-ish`) must NOT count as an explicit `yes` and
  // grant the diagnostic-only exemption — treat it as no recorded decision (null).
  const m = readFileSync(classifPath, 'utf8').match(/^##\s+Diagnostic Only\s*\n\s*-\s*(yes|no)\s*$/im);
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
export function enforceBugFixEvidence(
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(abs, 'utf8'));
    } catch {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` is not a readable JSON run summary ` +
        'produced by `cdd-kit test run` (ADR 0006 §7).',
      );
      continue;
    }
    // A well-formed JSON file can still parse to null or a non-object (e.g. the
    // literal `null`), which would crash the field reads below — reject it as an
    // invalid summary, mirroring the test-evidence summary guard.
    if (parsed === null || typeof parsed !== 'object') {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` is not a valid run summary object ` +
        'produced by `cdd-kit test run` (ADR 0006 §7).',
      );
      continue;
    }
    const summary = parsed as { change_id?: unknown; phase?: unknown; status?: unknown; command?: unknown };
    if (summary.change_id !== changeId) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` records change ` +
        `\`${String(summary.change_id)}\`, not \`${changeId}\` — reference this change's own run summary (ADR 0006 §7).`,
      );
      continue;
    }
    if (typeof summary.phase !== 'string' || !EXECUTED_PHASES.includes(summary.phase)) {
      errors.push(
        `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` records phase \`${String(summary.phase)}\`, ` +
        'but a reproduction or regression proof must reference an executed run — one of ' +
        `${EXECUTED_PHASES.join(', ')} (a collect-only run never executes tests) (ADR 0006 §6).`,
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
    // `cdd-kit test run` only APPENDS the runner-added flag vocabulary to a SIMPLE
    // PYTEST command (augmentPytestCommand); every other command runs verbatim
    // (src/commands/test-run.ts). So accept an exact match always, and — only for a
    // pytest declared command with no shell control, mirroring the runner's own
    // augmentation predicate — also accept the declared command followed ONLY by
    // runner-added flags. Every suffix token must be a `--junitxml=<path>` token or
    // one of RUNNER_ADDED_PYTEST_FLAGS; a user-selected flag (e.g. `-k other`), an
    // extra target, or a flag suffix on a non-pytest command (e.g. `npm test`)
    // means a different command actually ran.
    if (typeof wantCommand === 'string') {
      const recorded = typeof summary.command === 'string' ? summary.command : '';
      let commandOk = recorded === wantCommand;
      if (!commandOk && isPytestCommand(wantCommand) && !hasShellControl(wantCommand) &&
          recorded.startsWith(`${wantCommand} `)) {
        const suffix = recorded.slice(wantCommand.length + 1);
        commandOk = splitPreservingQuotes(suffix).every(
          (tok) => tok.startsWith('--junitxml=') || RUNNER_ADDED_PYTEST_FLAGS.has(tok),
        );
      }
      if (!commandOk) {
        errors.push(
          `agent-log/bug-fix-engineer.yml: bug-fix.${field} \`${value}\` records command \`${String(summary.command)}\`, ` +
          `which is neither the declared \`${wantCommand}\` nor that command with only runner-added flags (ADR 0006 §7).`,
        );
      }
    }
  }

  // 2b. Typed evidence pointers for visual / data / performance bugs (ADR 0006 §6,
  //     PR 5). A `visual-reproduced` reproduction must carry a durable pre-fix
  //     visual artifact; any present pointer is validated as a portable, existing
  //     repo-relative file.
  const visual = block.visual_evidence as { before?: unknown; after?: unknown; diff?: unknown } | undefined;
  if (reproduction?.status === 'visual-reproduced' &&
      (typeof visual?.before !== 'string' || visual.before === '')) {
    errors.push(
      'agent-log/bug-fix-engineer.yml: reproduction.status is `visual-reproduced` but no ' +
      'bug-fix.visual_evidence.before pointer is recorded — a visual reproduction needs a durable pre-fix ' +
      'screenshot/browser artifact (ADR 0006 §6).',
    );
  }
  checkEvidencePointer('visual_evidence.before', visual?.before, cwd, errors);
  checkEvidencePointer('visual_evidence.after', visual?.after, cwd, errors);
  checkEvidencePointer('visual_evidence.diff', visual?.diff, cwd, errors);
  checkEvidencePointer('data_evidence.pointer', (block.data_evidence as { pointer?: unknown } | undefined)?.pointer, cwd, errors);
  checkEvidencePointer('performance_evidence.pointer', (block.performance_evidence as { pointer?: unknown } | undefined)?.pointer, cwd, errors);

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
    // ADR 0006 §10 — a diagnostic-only change still needs test-evidence for its
    // diagnostic code "where feasible" and cannot pass with required test
    // failures. Require a present test-evidence.yml (enforceTestEvidence then
    // validates its required phases) UNLESS tasks.yml carries an auditable
    // `test-evidence-not-applicable` opt-out — the "no code / not feasible"
    // declaration. So a diagnostic-only record cannot silently pass with neither
    // evidence nor an opt-out. (A behavior fix, below, may not opt out at all.)
    if (!existsSync(join(changeDir, 'test-evidence.yml'))) {
      const optOutRaw = tasksData?.['test-evidence-not-applicable'];
      const optOut = typeof optOutRaw === 'string' && optOutRaw.trim() !== '';
      if (!optOut) {
        errors.push(
          'agent-log/bug-fix-engineer.yml: a diagnostic-only bug-fix change must record passing test-evidence.yml ' +
          'for its diagnostic code, or set an auditable `test-evidence-not-applicable` opt-out in tasks.yml when no ' +
          'code changed — it cannot pass with neither (ADR 0006 §10).',
        );
      }
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
