import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { tasksSchema } from '../schemas/tasks.schema.js';
import { ajv, ajvErrorsToMessages, loadYamlFile, type TasksFile } from './gate-shared.js';
import { sectionBody, stripHtmlComments } from '../utils/markdown-section.js';

const validateTasks = ajv.compile(tasksSchema);

const TASKS_STATUS_ENUM = new Set([
  'in-progress', 'completed', 'complete', 'done',
  'gate-blocked', 'abandoned', 'needs-review',
]);

/**
 * `context-governance: v1` (the legacy shape) required seven artifacts. Two of
 * them carried no information the others did not already have:
 *
 * - `change-classification.md` was 99 lines of template around seven scalar
 *   fields, and its `## Tier` DUPLICATED `tasks.yml`'s `tier:` -- so faithfully
 *   that `gate-tier.ts` ships a validator whose only job is to catch the two
 *   copies disagreeing. A fact stored twice needs a referee; a fact stored once
 *   does not. v2 moves the seven fields into `tasks.yml` frontmatter, and the
 *   referee has nothing left to arbitrate.
 * - `test-plan.md` and `ci-gates.md` were sections of the plan that had been
 *   given their own files. v2 requires them as `## Test Plan` / `## CI Gates`
 *   sections of `implementation-plan.md` -- the same content, mechanically
 *   checked the same way, minus two files of template.
 *
 * `context-manifest.md` is OPTIONAL under v2, for a different reason: not that
 * it duplicates something, but that requiring it never bought anything. The
 * only thing the gate ever checked was that the file existed and cleared 50
 * characters -- the `Allowed Paths` it declares are read by `cdd-kit context
 * check`, which no gate, no CI job, and no hook invokes. It is a read boundary
 * that nothing enforces, and its real value is the opposite of a boundary
 * anyway: pointing an agent AT the files it needs, faster. That job now belongs
 * to the code-map/graph layer, which is mechanical and actually runs. A manifest
 * is still honoured wherever one exists; it is simply no longer a file you must
 * produce to pass.
 *
 * v2 is NOT a migration: `v1` change directories keep the old shape and the old
 * checks forever (see `requiredFilesFor`). Nothing an adopter already wrote is
 * touched, rewritten, or asked to move. Only the shape of NEW changes differs.
 */
export const REQUIRED_FILES_V1 = [
  'change-request.md',
  'change-classification.md',
  'implementation-plan.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.yml',
  'context-manifest.md',
];

export const REQUIRED_FILES_V2 = [
  'change-request.md',
  'implementation-plan.md',
  'tasks.yml',
];

/** Sections `implementation-plan.md` must carry under v2, absorbing the two
 *  files v1 kept separate. */
export const V2_PLAN_SECTIONS = ['Test Plan', 'CI Gates'];

/**
 * Whether a v2 plan section carries real content, and the finding if it does not.
 *
 * A bare non-empty check on the section body was VACUOUS: the scaffold ships
 * guidance prose and empty table skeletons, so `## Test Plan` measured 541
 * characters and `## CI Gates` 216 before an author typed anything, and both
 * "passed". The commit that introduced the fold claimed the requirement had
 * moved rather than softened; that was false until this check existed.
 *
 * What counts as content: at least one table row whose cells are not all blank,
 * or at least one filled bullet. Template scaffolding does not qualify -- an
 * all-empty row (`|  |  |  |`), a separator row, a bare `-` bullet, and a
 * heading are all shapes the scaffold ships pre-filled.
 */
export function v2PlanSectionFinding(planContent: string, section: string): string | null {
  const body = sectionBody(planContent, section);
  const source = section === 'Test Plan' ? 'test-plan.md' : 'ci-gates.md';
  if (body.trim() === '') {
    return `implementation-plan.md: missing or empty \`## ${section}\` section — v2 folds ${source} ` +
      'into the plan rather than a separate file, so the section is required here.';
  }
  if (!hasAuthoredContent(body)) {
    return `implementation-plan.md: \`## ${section}\` still holds only the scaffold — every table row is ` +
      `blank and no bullet is filled in. v2 folds ${source} into the plan, so this section carries that ` +
      'content and must actually be authored (a present-but-unfilled section is not a plan).';
  }
  return null;
}

/**
 * The text a consumer should read for a folded plan surface, whichever shape
 * this change uses: v1's standalone file, or v2's section of
 * implementation-plan.md.
 *
 * This exists because folding the two files produced the SAME bug six times over
 * — every consumer had its own hardcoded `join(changeDir, 'test-plan.md')` and
 * each silently degraded to "nothing declared" for a v2 change: spec
 * traceability rejected them, `test select` could not find a test plan, the
 * quality phase lost its gate commands, trace metadata came out empty, and
 * bug-suspect ranking lost a signal. One resolver, so the next consumer cannot
 * repeat it.
 *
 * Returns '' when neither source exists.
 */
export function readPlanSourceText(changeDir: string, section: 'Test Plan' | 'CI Gates'): string {
  const v1File = section === 'Test Plan' ? 'test-plan.md' : 'ci-gates.md';
  const v1Path = join(changeDir, v1File);
  // Governance decides, not mere presence. `cdd-kit new --force` over an old v1
  // directory does NOT delete its files, so a v2 change can still carry a stale
  // test-plan.md; preferring it would plan and record evidence from an obsolete
  // mapping while the gate validated the folded section. Same stale-v1 trap
  // `readLane` already closes.
  const preferFolded = governanceVersion(changeDir) === 'v2';
  if (!preferFolded && existsSync(v1Path)) {
    try { return readFileSync(v1Path, 'utf8'); } catch { return ''; }
  }
  const planPath = join(changeDir, 'implementation-plan.md');
  if (existsSync(planPath)) {
    try {
      const folded = sectionBody(readFileSync(planPath, 'utf8'), section);
      if (folded.trim()) return folded;
    } catch { /* fall through */ }
  }
  // A v2 change whose plan has no such section still falls back to a v1 file if
  // one happens to exist -- better a stale mapping than none, and the gate
  // separately requires the folded section to be authored.
  if (existsSync(v1Path)) {
    try { return readFileSync(v1Path, 'utf8'); } catch { return ''; }
  }
  return '';
}

/** A markdown table row whose cells are all blank, or a separator row. */
function isEmptyTableRow(line: string): boolean {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').every(c => c.trim() === '' || /^:?-{2,}:?$/.test(c.trim()));
}

function hasAuthoredContent(body: string): boolean {
  let sawHeaderRow = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    // A blank line or heading ENDS a table, so header tracking resets with it.
    // Kept global, a section with two tables (the test-strategist output shape has
    // an AC-mapping table then a Test-Families table) let an empty first table set
    // the flag, after which the SECOND table header counted as authored data.
    if (line === '' || line.startsWith('#')) { sawHeaderRow = false; continue; }
    if (line.startsWith('|')) {
      if (isEmptyTableRow(line)) continue;
      // The first non-empty row of a table is its header, which the scaffold
      // ships. Only a row after it counts as authored data.
      if (!sawHeaderRow) { sawHeaderRow = true; continue; }
      return true;
    }
    // A bullet with real text after the marker.
    if (/^[-*]\s+\S/.test(line)) return true;
  }
  return false;
}

/** Back-compat alias: callers that just want "the artifact set" without a change
 *  directory in hand (e.g. `cdd-kit metadata`) get the current default shape. */
export const REQUIRED_FILES = REQUIRED_FILES_V2;

export const MIN_CHARS: Record<string, number> = {
  'change-classification.md': 200,
  'implementation-plan.md': 200,
  'test-plan.md': 200,
  'ci-gates.md': 150,
  'change-request.md': 100,
  'context-manifest.md': 50,
};

const DEFAULT_ARCHIVE_TASKS = ['7.1', '7.2'];

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

export function meaningfulChars(text: string): number {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l)
    .filter(l => !l.startsWith('#'))
    .filter(l => !/^[|\s\-:]+$/.test(l))
    .filter(l => !l.startsWith('<!--'))
    .join('').length;
}

/** Unfilled template placeholder tokens still present in an artifact body. */
export function findPlaceholders(text: string): string[] {
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

/**
 * Tolerant line-scan fallback used only when the section body is not valid YAML
 * (a hand-edited manifest with, say, an unquoted colon in a reason). This is the
 * old hand-rolled parser; it is indentation/blank-line sensitive, so it is the
 * backstop rather than the primary path — but keeping it means a slightly
 * malformed section is still counted rather than silently dropped.
 */
function countPendingByScan(body: string): number {
  let count = 0;
  const blocks = body.split(/(?=^\s*-\s*request-id:\s*)/m);
  for (const block of blocks) {
    if (!/^\s*-\s*request-id:\s*\S/m.test(block)) continue;
    const statusMatch = block.match(/^\s*status:\s*(\S+)/im);
    if (statusMatch && statusMatch[1].trim().toLowerCase() === 'pending') count += 1;
  }
  return count;
}

/**
 * Count pending Context Expansion Requests in a context-manifest.
 *
 * The CER section is authored as a YAML sequence (see `renderRequests` in
 * context.ts), so we extract the `## Context Expansion Requests` body with the
 * shared section helper and `yaml.load` it — robust to the indentation and
 * blank-line variation the previous hand-rolled regex silently miscounted
 * (P1-15). A genuinely malformed (non-YAML) section falls back to the tolerant
 * line scan so we never count fewer than before.
 */
export function countPendingContextRequests(content: string): number {
  const body = sectionBody(content, 'Context Expansion Requests');
  if (!body.trim()) return 0;

  try {
    const parsed = yaml.load(body, { schema: yaml.JSON_SCHEMA });
    if (Array.isArray(parsed)) {
      return parsed.filter(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const rec = item as Record<string, unknown>;
        if (!('request-id' in rec)) return false;
        return String(rec.status ?? '').trim().toLowerCase() === 'pending';
      }).length;
    }
    // Non-sequence YAML (null / scalar / mapping) — fall through to the scan.
  } catch {
    // Invalid YAML — fall through to the tolerant scan.
  }
  return countPendingByScan(body);
}

export function isContextGovernedChange(changeDir: string): boolean {
  const tasksPath = join(changeDir, 'tasks.yml');
  if (!existsSync(tasksPath)) return false;
  const { data } = loadYamlFile<TasksFile>(tasksPath);
  const g = data?.['context-governance'];
  return g === 'v1' || g === 'v2';
}

/** `v2` | `v1` | `null` (ungoverned legacy). Unreadable/absent tasks.yml yields
 *  `null` -- the least-demanding shape, so a broken file never manufactures a
 *  requirement the change was never authored against. */
export function governanceVersion(changeDir: string): 'v1' | 'v2' | null {
  const tasksPath = join(changeDir, 'tasks.yml');
  if (!existsSync(tasksPath)) return null;
  const { data } = loadYamlFile<TasksFile>(tasksPath);
  const g = data?.['context-governance'];
  return g === 'v2' ? 'v2' : g === 'v1' ? 'v1' : null;
}

/** The artifact set this specific change is held to. A v1 directory is
 *  grandfathered on the v1 list for good -- see REQUIRED_FILES_V1's note. */
export function requiredFilesFor(changeDir: string): string[] {
  return governanceVersion(changeDir) === 'v2' ? REQUIRED_FILES_V2 : REQUIRED_FILES_V1;
}

/**
 * v2's replacement for the `change-classification.md` substance check. Dropping
 * the file must not drop the requirement: the same facts are still mandatory,
 * they just live in `tasks.yml` frontmatter now. Without this, v2 would be a
 * loosening wearing a refactor's clothes.
 *
 * `architecture-review: true` with no reason is refused for the same reason ADR
 * 0011 refuses a bare `applicability: not-applicable` -- an unjustified marker
 * is not a decision, it is a box someone ticked.
 */
export function enforceClassificationSubstance(
  changeDir: string,
  tasks: TasksFile | null,
  errors: string[],
): void {
  if (governanceVersion(changeDir) !== 'v2') return;
  const c = tasks?.classification;
  // Only the two things the JSON schema structurally cannot do. The shape of
  // `types`/`risk`/`impact` is already enforced by tasksSchema whenever the
  // block is present -- restating it here would just print every failure twice.
  if (!c) {
    // The schema cannot put `classification` in `required`: a v1 change is valid
    // without it, and the schema has no view of which version it is validating.
    errors.push(
      'tasks.yml: missing required `classification:` block (v2 folds change-classification.md into ' +
      'tasks.yml frontmatter — it needs `types`, `risk`, and `impact`).',
    );
    return;
  }
  // v1 kept the tier in `## Tier` inside change-classification.md, and the
  // missing-tier guard only fires when that file exists. v2 removed the file, so
  // nothing demanded a tier any more: a v2 change with `tier: null` and no
  // tier-floor match would resolve to null and the gate would lose the input it
  // uses to decide strictness. The requirement follows the classification.
  if (typeof tasks?.tier !== 'number') {
    errors.push(
      'tasks.yml: `tier:` is required (0-5) — it is what the gate uses to decide how much process this ' +
      'change earns. v1 carried it in change-classification.md `## Tier`; v2 keeps it as a top-level key.',
    );
  }
  if (c['architecture-review'] === true && !(c['architecture-review-reason'] ?? '').trim()) {
    errors.push(
      'tasks.yml: `classification.architecture-review: true` requires a non-empty ' +
      '`architecture-review-reason` — a bare yes with no reason is not a decision.',
    );
  }
}

export function lintTasksFile(tasksPath: string, errors: string[], warnings: string[]): TasksFile | null {
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

export function getArchiveTaskIds(tasks: TasksFile | null): string[] {
  const fromFile = tasks?.['archive-tasks'];
  return fromFile && fromFile.length > 0 ? fromFile : DEFAULT_ARCHIVE_TASKS;
}
