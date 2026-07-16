import { existsSync } from 'fs';
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
  'context-manifest.md',
];

/** Sections `implementation-plan.md` must carry under v2, absorbing the two
 *  files v1 kept separate. Checked with the same `sectionBody` machinery the
 *  gate already uses elsewhere -- the requirement moved, it did not soften. */
export const V2_PLAN_SECTIONS = ['Test Plan', 'CI Gates'];

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
