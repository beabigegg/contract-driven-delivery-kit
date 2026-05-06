import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import picomatch from 'picomatch';
import { log } from '../utils/logger.js';
import { validate } from './validate.js';
import { agentLogSchema } from '../schemas/agent-log.schema.js';
import { tasksSchema } from '../schemas/tasks.schema.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateAgentLog = ajv.compile(agentLogSchema);
const validateTasks = ajv.compile(tasksSchema);

const TASKS_STATUS_ENUM = new Set([
  'in-progress', 'completed', 'complete', 'done',
  'gate-blocked', 'abandoned', 'needs-review',
]);

const REQUIRED_FILES = [
  'change-request.md',
  'change-classification.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.yml',
  'context-manifest.md',
];

const TIER_PATTERN = /\b(tier\s*[0-5]|low|medium|high|critical)\b/i;

const MIN_CHARS: Record<string, number> = {
  'change-classification.md': 200,
  'test-plan.md': 200,
  'ci-gates.md': 150,
  'change-request.md': 100,
  'context-manifest.md': 50,
};

const DEFAULT_ARCHIVE_TASKS = ['7.1', '7.2'];

interface AgentLog {
  'change-id': string;
  timestamp: string;
  agent: string;
  status: 'complete' | 'done' | 'approved' | 'needs-review' | 'blocked';
  'files-read'?: string[];
  artifacts: { type: string; pointer: string }[];
  'next-action': string;
  notes?: string;
}

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
  tasks: TaskItem[];
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

export interface GateOptions {
  strict?: boolean;
  lax?: boolean;
}

interface ContextPolicy {
  forbiddenPaths: string[];
  audit: {
    requireFilesRead: boolean;
    unknownFilesRead: string;
  };
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Match a repo-relative path against an array of patterns.
 *
 * Each pattern may be:
 *   - A literal directory or file path (matched as exact OR prefix `<pattern>/`)
 *   - A glob with `*`, `**`, `?`, `[...]`, `{a,b}` (picomatch grammar)
 *   - The special `specs/changes/*` pattern which, when `currentChangeId` is
 *     provided, matches OTHER change directories but excludes the current one
 *     (used for forbidden-path matching)
 *
 * Trailing `/` is normalised away. Backslashes are converted to forward slashes.
 */
function pathMatches(relPath: string, patterns: string[], currentChangeId?: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');

  return patterns.some(rawPattern => {
    const pattern = rawPattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!pattern) return false;

    // Special-case the "other changes" pattern: match any specs/changes/* except current
    if (pattern === 'specs/changes/*' && currentChangeId) {
      const current = `specs/changes/${currentChangeId}`;
      if (normalized === current || normalized.startsWith(`${current}/`)) return false;
      return normalized.startsWith('specs/changes/');
    }

    // Glob pattern — delegate to picomatch (covers **, *, ?, [...], {a,b})
    if (/[*?[{]/.test(pattern)) {
      // basename: false so `**` matches across multiple segments
      if (picomatch.isMatch(normalized, pattern, { dot: true, nocase: false })) return true;
      // Treat `dir/**` as also matching `dir` itself (common manifest expectation)
      if (pattern.endsWith('/**')) {
        const base = pattern.slice(0, -3);
        if (normalized === base) return true;
      }
      return false;
    }

    // Literal path: exact OR prefix-with-slash
    return normalized === pattern || normalized.startsWith(`${pattern}/`);
  });
}

function parseListSection(content: string, heading: string): string[] {
  const clean = stripHtmlComments(content);
  const match = clean.match(new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?:\\n## |$)`));
  if (!match) return [];

  return match[1]
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*-\s*/, '').trim())
    .filter(item => item && item !== '-' && item.toLowerCase() !== 'none');
}

/**
 * Count pending Context Expansion Requests in the manifest.
 *
 * The canonical writer (`cdd-kit context request`, src/commands/context.ts)
 * emits each request as a multi-line block:
 *
 *   - request-id: CER-001
 *     requested_paths:
 *       - some/path
 *     reason: ...
 *     status: pending
 *
 * `status:` is on its OWN indented line, NOT prefixed by `-`. The previous
 * implementation required a leading `-` and missed every real-world request.
 * We mirror context.ts:48-86 — split the section into per-request blocks and
 * inspect each block's status field independently.
 */
function countPendingExpansions(sectionBody: string): number {
  if (!sectionBody.trim()) return 0;
  let count = 0;
  // Same block-split heuristic as context.ts:53
  const blocks = sectionBody.split(/(?=^\s*-\s*request-id:\s*)/m);
  for (const block of blocks) {
    if (!/^\s*-\s*request-id:\s*\S/m.test(block)) continue;
    const statusMatch = block.match(/^\s*status:\s*(\S+)/im);
    if (statusMatch && statusMatch[1].trim().toLowerCase() === 'pending') count += 1;
  }
  return count;
}

function parseContextManifest(content: string): { allowedPaths: string[]; approvedExpansions: string[]; pendingExpansions: number } {
  const clean = stripHtmlComments(content);
  const requestMatch = clean.match(/## Context Expansion Requests\s*\n([\s\S]*?)(?:\n## |$)/);
  const pendingExpansions = requestMatch ? countPendingExpansions(requestMatch[1]) : 0;

  return {
    allowedPaths: parseListSection(content, 'Allowed Paths'),
    approvedExpansions: parseListSection(content, 'Approved Expansions'),
    pendingExpansions,
  };
}

/**
 * Extract the per-agent required artifact types declared in the agent's prompt
 * file (`.claude/agents/<agent>.md`). Reads the section that begins with
 * `Minimum required \`type\` values for this agent` and pulls each bullet line
 * shaped like `- \`type-name\`: description`.
 *
 * Resolution order — first existing file wins:
 *   1. `<cwd>/.claude/agents/<name>.md` (per-repo override)
 *   2. `~/.claude/agents/<name>.md`     (global, where `cdd-kit update` installs)
 *
 * Returns an empty array when neither file exists or the section cannot be
 * found — gate then falls back to the schema's "≥ 1 artifact" rule only,
 * preserving back-compat for repos without the cdd-kit agent prompts shipped.
 */
function extractRequiredArtifactTypes(cwd: string, agentName: string): string[] {
  const candidates = [
    join(cwd, '.claude', 'agents', `${agentName}.md`),
    join(homedir(), '.claude', 'agents', `${agentName}.md`),
  ];
  let content: string | null = null;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      content = readFileSync(candidate, 'utf8');
      break;
    } catch {
      // try next candidate
    }
  }
  if (content === null) return [];

  // The section starts with the distinctive phrase; the preamble is multi-line
  // (typically two lines ending in "...):") then a blank line, then the bullets.
  // Eat everything up to and including the blank line, then capture bullets.
  const sectionMatch = content.match(
    /Minimum required `type` values for this agent[\s\S]*?\r?\n\r?\n+((?:[ \t]*- `[a-z][a-z0-9-]+`[^\n]*\r?\n)+)/,
  );
  if (!sectionMatch) return [];
  const types: string[] = [];
  for (const line of sectionMatch[1].split(/\r?\n/)) {
    const m = line.match(/^[ \t]*- `([a-z][a-z0-9-]+)`/);
    if (m) types.push(m[1]);
  }
  return types;
}

function loadContextPolicy(cwd: string): ContextPolicy {
  const defaults: ContextPolicy = {
    forbiddenPaths: [
      '.claude/worktrees/**',
      '.git/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'assets/**',
      'specs/archive/**',
      'specs/changes/*',
    ],
    audit: {
      requireFilesRead: true,
      unknownFilesRead: 'warn-for-legacy-fail-for-new',
    },
  };

  const policyPath = join(cwd, '.cdd', 'context-policy.json');
  if (!existsSync(policyPath)) return defaults;

  try {
    const custom = JSON.parse(readFileSync(policyPath, 'utf8')) as Partial<ContextPolicy>;
    return {
      ...defaults,
      ...custom,
      forbiddenPaths: Array.from(new Set([...(defaults.forbiddenPaths), ...(custom.forbiddenPaths ?? [])])),
      audit: { ...defaults.audit, ...(custom.audit ?? {}) },
    };
  } catch {
    log.warn('could not parse .cdd/context-policy.json; using default context policy');
    return defaults;
  }
}

function loadYamlFile<T>(path: string): { data: T | null; parseError: string | null } {
  try {
    const raw = readFileSync(path, 'utf8');
    // Keep YAML scalars JSON-compatible for schema validation. js-yaml's
    // default schema turns unquoted ISO timestamps into Date objects, while
    // agent-log.schema.ts requires timestamp to remain a string.
    return { data: yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as T, parseError: null };
  } catch (err) {
    return { data: null, parseError: (err as Error).message };
  }
}

function ajvErrorsToMessages(
  errors: ErrorObject[] | null | undefined,
  prefix: string,
  knownKeys?: string[]
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

function enforceTierRequirements(
  changeDir: string,
  agentLogDir: string | null,
  errors: string[],
  warnings: string[],
): void {
  const resolution = resolveTier(changeDir);

  if (resolution.tier === null) {
    if (resolution.classificationPresent && !resolution.classificationHasLooseMarker) {
      errors.push(
        'change-classification.md: missing tier marker. Set `tier: <0-5>` in tasks.yml frontmatter (preferred) or include `## Tier\\n- N` in change-classification.md.'
      );
    }
    return;
  }

  if (resolution.source === 'classification-bold') {
    warnings.push(
      'tier marker is bold-text only (legacy format); set `tier: <0-5>` in tasks.yml frontmatter so tier-specific agent requirements are enforced.'
    );
    return;
  }

  const tier = resolution.tier;
  const agentLogFiles = agentLogDir && existsSync(agentLogDir)
    ? readdirSync(agentLogDir).map(f => f.replace(/\.ya?ml$/, ''))
    : [];

  if (tier <= 1) {
    for (const required of ['e2e-resilience-engineer', 'monkey-test-engineer', 'stress-soak-engineer']) {
      if (!agentLogFiles.includes(required)) {
        errors.push(`Tier ${tier} change requires agent-log/${required}.yml (high-risk change — E2E/monkey/stress testing mandatory)`);
      }
    }
  }
  if (tier <= 3) {
    for (const required of ['contract-reviewer', 'qa-reviewer']) {
      if (!agentLogFiles.includes(required)) {
        errors.push(`Tier ${tier} change requires agent-log/${required}.yml`);
      }
    }
  }

  if (resolution.source === 'tasks-frontmatter' && resolution.classificationPresent) {
    const text = readFileSync(join(changeDir, 'change-classification.md'), 'utf8');
    const structured = text.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
    const bold = text.match(/\*\*Tier:\*\*\s*Tier\s*(\d)\b/i);
    const classifTier = structured ? parseInt(structured[1], 10) : (bold ? parseInt(bold[1], 10) : NaN);
    if (!Number.isNaN(classifTier) && classifTier !== tier) {
      warnings.push(
        `tier mismatch: tasks.yml frontmatter says ${tier}, change-classification.md says ${classifTier} (frontmatter wins; reconcile classification).`
      );
    }
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
    errors.push(`depends-on cycle detected: ${cycle.join(' → ')}`);
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

export async function gate(changeId: string, opts: GateOptions = {}): Promise<void> {
  const strict = opts.strict ?? false;
  const lax = opts.lax ?? false;
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);

  if (!existsSync(changeDir)) {
    log.error(`change not found: ${changeId} (looked in ${changeDir})`);
    process.exit(1);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Code-map freshness check (runs first — structural issues before manifest checks)
  {
    const { checkCodeMapFreshness } = await import('../code-map/freshness.js');
    const freshness = checkCodeMapFreshness(cwd);
    if (freshness.status === 'config-error') {
      errors.push(
        `.cdd/code-map-config.yml is invalid: ${freshness.configError}. Fix the config before running gate.`
      );
    } else if (freshness.status === 'stale') {
      const more = freshness.staleCount > 5 ? ` (+${freshness.staleCount - 5} more)` : '';
      errors.push(
        `code-map stale: ${freshness.staleFiles.join(', ')}${more} modified after ${freshness.mapPath}; run \`cdd-kit code-map\` to regenerate.`
      );
    } else if (freshness.status === 'missing-with-sources') {
      warnings.push(
        `code-map missing: run \`cdd-kit code-map\` to enable read-scope optimization (agents will fall back to whole-file Reads until generated).`
      );
    }
    // 'missing-greenfield' and 'ok' → no output
  }

  const contextPolicy = loadContextPolicy(cwd);
  const isNewChange = isContextGovernedChange(changeDir);
  const manifestPath = join(changeDir, 'context-manifest.md');
  const hasManifest = existsSync(manifestPath);
  let allowedPaths: string[] = [];
  let approvedExpansions: string[] = [];

  errors.push(...validateDependencies(cwd, changeId, changeDir));

  if (hasManifest) {
    const manifest = parseContextManifest(readFileSync(manifestPath, 'utf8'));
    allowedPaths = manifest.allowedPaths;
    approvedExpansions = manifest.approvedExpansions;
    if (manifest.pendingExpansions > 0) {
      errors.push(`context-manifest.md: has ${manifest.pendingExpansions} pending context expansion request(s)`);
    }
  }

  // Step 2: required files
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
    // Step 3: stub check (skip tasks.yml — its content is validated by schema)
    for (const f of REQUIRED_FILES) {
      if (f === 'context-manifest.md' && !hasManifest) continue;
      if (f === 'tasks.yml') continue;
      const content = readFileSync(join(changeDir, f), 'utf8');
      const minChars = MIN_CHARS[f] ?? 100;
      if (meaningfulChars(content) < minChars) {
        errors.push(`${f}: appears to be a stub (< ${minChars} meaningful chars)`);
      }
    }

    // Step 4: tier marker
    const classifPath = join(changeDir, 'change-classification.md');
    const tierResolution = resolveTier(changeDir);
    if (tierResolution.tier === null && existsSync(classifPath) && !tierResolution.classificationHasLooseMarker) {
      errors.push('change-classification.md: missing tier/risk marker (set tier in tasks.yml frontmatter, or include Tier 0-5 / low|medium|high|critical in change-classification.md)');
    }
  }

  // Step 4b: tasks.yml lint + pending check
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

  // Step 5: agent-log validation
  const agentLogDir = join(changeDir, 'agent-log');
  if (existsSync(agentLogDir)) {
    const logFiles = readdirSync(agentLogDir).filter(f => f.endsWith('.yml'));
    for (const f of logFiles) {
      const fullPath = join(agentLogDir, f);
      const { data, parseError } = loadYamlFile<AgentLog>(fullPath);
      if (parseError) {
        errors.push(`agent-log/${f}: invalid YAML: ${parseError}`);
        continue;
      }
      if (!data) {
        errors.push(`agent-log/${f}: file is empty`);
        continue;
      }

      const ok = validateAgentLog(data);
      let statusReported = false;
      if (!ok) {
        for (const e of validateAgentLog.errors ?? []) {
          if (e.keyword === 'required' && (e.params as { missingProperty: string }).missingProperty === 'status') {
            if (!statusReported) {
              errors.push(`agent-log/${f}: missing required "status:" line (expected complete | needs-review | blocked; aliases accepted: done, approved)`);
              statusReported = true;
            }
            continue;
          }
          if (e.instancePath === '/status' && e.keyword === 'enum') {
            if (!statusReported) {
              const rawStatus = (data as { status?: unknown }).status;
              const shownStatus = typeof rawStatus === 'string' ? rawStatus : JSON.stringify(rawStatus);
              errors.push(`agent-log/${f}: invalid "status:" value ${shownStatus ?? '<missing>'} (expected complete | needs-review | blocked; aliases accepted: done, approved)`);
              statusReported = true;
            }
            continue;
          }
          errors.push(`agent-log/${f}: ${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
        }
        if (statusReported) continue;
      }

      if (data['change-id'] && data['change-id'] !== changeId) {
        errors.push(`agent-log/${f}: change-id mismatch (expected ${changeId}, got ${data['change-id']})`);
      }

      const filesRead = data['files-read'];
      if (filesRead === undefined) {
        if (contextPolicy.audit.requireFilesRead) {
          const msg = `agent-log/${f}: missing "- files-read:" section`;
          if (isNewChange || strict || contextPolicy.audit.unknownFilesRead !== 'warn-for-legacy-fail-for-new') {
            errors.push(msg);
          } else {
            warnings.push(`${msg} (legacy warning only)`);
          }
        }
      } else {
        const normalizedPaths: string[] = [];
        for (const item of filesRead) {
          if (typeof item !== 'string') {
            errors.push(`agent-log/${f}: invalid files-read entry format: ${JSON.stringify(item)}`);
            continue;
          }
          const trimmed = item.trim();
          if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'unknown') continue;
          const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
          if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) {
            errors.push(`agent-log/${f}: files-read path must be repo-relative: ${trimmed}`);
            continue;
          }
          if (normalized.split('/').includes('..')) {
            errors.push(`agent-log/${f}: files-read path must not contain "..": ${trimmed}`);
            continue;
          }
          normalizedPaths.push(normalized);
        }

        for (const p of normalizedPaths) {
          if (pathMatches(p, contextPolicy.forbiddenPaths, changeId)) {
            errors.push(`agent-log/${f}: read forbidden path -> ${p}`);
          }
          if (hasManifest && allowedPaths.length > 0 && !pathMatches(p, allowedPaths) && !pathMatches(p, approvedExpansions)) {
            errors.push(`agent-log/${f}: read unauthorized path -> ${p} (not in context-manifest Allowed Paths or Approved Expansions; if legitimate, add it to the manifest instead of deleting it from files-read)`);
          }
        }

        const runtimeLog = join(cwd, '.cdd', 'runtime', `${changeId}-files-read.jsonl`);
        if (existsSync(runtimeLog)) {
          const runtimePaths = readFileSync(runtimeLog, 'utf8').split('\n').filter(Boolean)
            .map(line => { try { return (JSON.parse(line) as { path?: string }).path; } catch { return undefined; } })
            .filter((p): p is string => Boolean(p))
            .map(p => p.replace(/\\/g, '/').replace(/^\.\//, ''));
          const declared = new Set(normalizedPaths);
          const undeclared = runtimePaths.filter(p => !declared.has(p));
          if (undeclared.length > 0) {
            const sample = undeclared.slice(0, 5).join(', ');
            const more = undeclared.length > 5 ? ` (+${undeclared.length - 5} more)` : '';
            const msg = `agent-log/${f}: runtime log shows ${undeclared.length} read(s) not declared in files-read: ${sample}${more}`;
            if (strict) errors.push(msg); else warnings.push(msg);
          }
        }
      }

      if (data.status === 'blocked') {
        const next = (data['next-action'] ?? '').trim();
        const lower = next.toLowerCase();
        // Match references/agent-log-protocol.md:75-78 — these placeholders are
        // not concrete next-actions. Single source of truth: that doc's list.
        const PLACEHOLDERS = ['none', 'tbd', 'n/a', 'na', 'unknown', 'investigate', 'investigate further', 'todo', 'pending'];
        const isPlaceholder = PLACEHOLDERS.includes(lower) || /^(tbd|todo)\b/.test(lower);
        if (!next || isPlaceholder || next.length < 10) {
          errors.push(`agent-log/${f}: status=blocked requires concrete "next-action:" line (>= 10 chars, not "none/tbd/n/a/investigate/unknown/todo")`);
        }
      }

      if (!lax) {
        for (const a of data.artifacts ?? []) {
          const pointer = a.pointer ?? '';
          // n/a fallback — protocol allows `n/a (<reason>)` for inapplicable types.
          // The reason text often contains '/' (e.g. "n/a (no contracts/ files)"),
          // which would otherwise trigger a spurious existence check.
          if (/^n\/a\b/i.test(pointer.trim())) continue;
          const pathPart = pointer.split(':')[0];
          if (pathPart.includes('/') && !pointer.startsWith('http')) {
            const abs = join(cwd, pathPart);
            if (!existsSync(abs)) {
              errors.push(`agent-log/${f}: artifact pointer not found: ${pathPart}`);
            }
          }
        }

        // Per-agent required artifact types. Each agent prompt declares a
        // "Minimum required `type` values for this agent" list. This is
        // enforced here: every declared type must appear at least once in
        // artifacts. Agents may emit `pointer: "n/a (<reason>)"` for an
        // inapplicable type — that still counts as present (only the type
        // membership is checked, not the pointer's content).
        if (data.agent) {
          const required = extractRequiredArtifactTypes(cwd, data.agent);
          if (required.length > 0) {
            const present = new Set((data.artifacts ?? []).map(a => a.type));
            const missing = required.filter(t => !present.has(t));
            if (missing.length > 0) {
              errors.push(
                `agent-log/${f}: missing required artifact type(s) for agent "${data.agent}": ${missing.join(', ')} ` +
                `(declared in .claude/agents/${data.agent}.md → "Minimum required type values"; ` +
                `emit pointer "n/a (<reason>)" if a type does not apply)`
              );
            }
          }
        }
      }
    }

    enforceTierRequirements(changeDir, agentLogDir, errors, warnings);
  } else {
    enforceTierRequirements(changeDir, null, errors, warnings);
  }

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

  log.info(`gate: running contract validators for ${changeId}…`);
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
