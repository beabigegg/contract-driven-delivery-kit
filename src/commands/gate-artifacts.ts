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

export const REQUIRED_FILES = [
  'change-request.md',
  'change-classification.md',
  'implementation-plan.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.yml',
  'context-manifest.md',
];

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
  return data?.['context-governance'] === 'v1';
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
