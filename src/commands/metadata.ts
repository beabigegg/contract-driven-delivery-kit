import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, join, relative } from 'path';
import yaml from 'js-yaml';
import { log } from '../utils/logger.js';
import { sha256OfFileNormalized } from '../utils/digest.js';
import { sectionBody } from '../utils/markdown-section.js';
import { parsePipeTable } from '../utils/markdown-table.js';
import { ajv, loadYamlFile, type TasksFile } from './gate-shared.js';
import { REQUIRED_FILES } from './gate-artifacts.js';
import { resolveTier } from './gate-tier.js';
import { readLane } from './gate-evidence.js';
import { changeMetadataSchema } from '../schemas/change-metadata.schema.js';
import { traceMetadataSchema } from '../schemas/trace.schema.js';

// ── Shapes (mirror the two schemas) ──────────────────────────────────────────

export interface ChangeMetadata {
  'change-id': string;
  status: string;
  tier: number | null;
  lane: 'tracked';
  'classification-lane'?: 'feature' | 'bug-fix';
  types: { primary: string | null; secondary: string[] };
  'required-agents': string[];
  artifacts: { required: string[]; optional: string[] };
  context: { manifest: string | null; 'allowed-paths-count': number };
  dependencies: string[];
  'generated-from': Record<string, string>;
}

export interface TraceCriterion {
  id: string;
  text: string;
  tests: { family: string; path: string }[];
  gates: string[];
}

export interface TraceMetadata {
  'change-id': string;
  criteria: TraceCriterion[];
  'required-gates': string[];
  evidence: { agent: string; type: string; pointer: string }[];
  'generated-from': Record<string, string>;
}

export interface BuildResult<T> { data: T; warnings: string[]; }

// Optional artifacts a change MAY carry (change-classification.md "Optional
// Artifacts" table). Used to report which ones are actually present.
const OPTIONAL_ARTIFACTS = [
  'current-behavior.md', 'proposal.md', 'spec.md', 'design.md',
  'qa-report.md', 'regression-report.md', 'visual-review-report.md',
  'monkey-test-report.md', 'stress-soak-report.md',
];

const validateChange = ajv.compile(changeMetadataSchema);
const validateTrace = ajv.compile(traceMetadataSchema);

// ── Small parse helpers (read-only, never throw) ─────────────────────────────

function readIfExists(p: string): string {
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

function digestRef(path: string): string {
  return `sha256:${sha256OfFileNormalized(path)}`;
}

/** Build the `generated-from` map for the source files that exist. */
function generatedFrom(changeDir: string, relFiles: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of relFiles) {
    const p = join(changeDir, rel);
    if (existsSync(p)) out[rel] = digestRef(p);
  }
  return out;
}

/** Value of a `- label: value` list line inside a section body. */
function labeledValue(body: string, label: string): string {
  const m = body.match(new RegExp(String.raw`^\s*-\s*${label}\s*:\s*(.*)$`, 'im'));
  return m ? m[1].trim() : '';
}

function parseChangeTypes(classifText: string): { primary: string | null; secondary: string[] } {
  const body = sectionBody(classifText, 'Change Types');
  const primary = labeledValue(body, 'primary');
  const secRaw = labeledValue(body, 'secondary');
  const secondary = secRaw ? secRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  return { primary: primary || null, secondary };
}

function parseRequiredAgents(classifText: string): string[] {
  const body = sectionBody(classifText, 'Required Agents');
  const agents: string[] = [];
  for (const line of body.split('\n')) {
    // Agent slugs are lowercase-hyphen (e.g. backend-engineer). Capture the
    // leading slug and tolerate trailing prose ("- backend-engineer (impl)").
    const m = line.match(/^\s*-\s*([a-z][a-z0-9-]+)\b/);
    if (m) agents.push(m[1]);
  }
  return agents;
}

function countAllowedPaths(manifestText: string): number {
  const body = sectionBody(manifestText, 'Allowed Paths');
  return body.split('\n').filter(l => /^\s*-\s+\S/.test(l)).length;
}

function parseAcceptanceCriteria(classifText: string): { id: string; text: string }[] {
  const body = sectionBody(classifText, 'Inferred Acceptance Criteria');
  const out: { id: string; text: string }[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*-\s*(AC-\d+)\s*:\s*(.+?)\s*$/i);
    if (m && m[2].trim()) out.push({ id: m[1].toUpperCase(), text: m[2].trim() });
  }
  return out;
}

function parseTestMapping(testPlanText: string): { criterion: string; family: string; path: string }[] {
  const rows = parsePipeTable(sectionBody(testPlanText, 'Acceptance Criteria → Test Mapping'));
  const out: { criterion: string; family: string; path: string }[] = [];
  for (const r of rows) {
    const criterion = (r['criterion id'] ?? '').toUpperCase();
    const family = (r['test family'] ?? '').toLowerCase();
    const path = r['test file path'] ?? '';
    if (!criterion || !path) continue;
    out.push({ criterion, family, path });
  }
  return out;
}

function parseRequiredGates(ciGatesText: string): string[] {
  const rows = parsePipeTable(sectionBody(ciGatesText, 'Required Gates'));
  const gates: string[] = [];
  for (const r of rows) {
    const name = (r['gate'] ?? '').trim();
    const required = (r['required'] ?? '').trim().toLowerCase();
    if (name && required === 'yes') gates.push(name);
  }
  return gates;
}

/**
 * Whether a required gate name corresponds to a criterion's test family. Gate
 * and family vocabularies mostly coincide (unit, contract, integration,
 * visual…) but differ in a few spots (gate `e2e-critical` vs family `e2e`, gate
 * `fuzz/monkey` vs family `monkey`), so the match is a bounded name overlap —
 * never inference.
 */
function gateMatchesFamily(gate: string, family: string): boolean {
  const g = gate.toLowerCase(), f = family.toLowerCase();
  if (!g || !f) return false;
  return g === f || g.includes(f) || f.includes(g);
}

function listAgentLogs(changeDir: string): string[] {
  const dir = join(changeDir, 'agent-log');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.yml')).sort();
}

function collectEvidence(changeDir: string, warnings: string[]): { agent: string; type: string; pointer: string }[] {
  const out: { agent: string; type: string; pointer: string }[] = [];
  for (const f of listAgentLogs(changeDir)) {
    const { data, parseError } = loadYamlFile<Record<string, unknown>>(join(changeDir, 'agent-log', f));
    if (parseError || !data || typeof data !== 'object') {
      warnings.push(`agent-log/${f}: unreadable; skipped in trace evidence`);
      continue;
    }
    const agent = typeof data.agent === 'string' && data.agent ? data.agent : f.replace(/\.yml$/, '');
    const arts = Array.isArray(data.artifacts) ? data.artifacts : [];
    for (const a of arts) {
      if (a && typeof a === 'object' && typeof (a as { type?: unknown }).type === 'string'
        && typeof (a as { pointer?: unknown }).pointer === 'string') {
        out.push({ agent, type: (a as { type: string }).type, pointer: (a as { pointer: string }).pointer });
      }
    }
  }
  return out;
}

// ── Builders (pure: derive a metadata object from a change directory) ─────────

export function buildChangeMetadata(changeDir: string, cwd: string): BuildResult<ChangeMetadata> {
  const warnings: string[] = [];
  const changeId = basename(changeDir);

  const { data: tasks, parseError } = loadYamlFile<TasksFile>(join(changeDir, 'tasks.yml'));
  if (parseError) warnings.push(`tasks.yml: ${parseError}; status/dependencies/tier may be incomplete`);
  const status = (tasks?.status && String(tasks.status)) || 'unknown';
  const dependencies = Array.isArray(tasks?.['depends-on']) ? tasks!['depends-on'] as string[] : [];

  const tier = resolveTier(changeDir).tier;

  const classifText = readIfExists(join(changeDir, 'change-classification.md'));
  const types = parseChangeTypes(classifText);
  const requiredAgents = parseRequiredAgents(classifText);
  const classificationLane = readLane(changeDir);

  const optionalPresent = OPTIONAL_ARTIFACTS.filter(f => existsSync(join(changeDir, f)));

  const manifestPath = join(changeDir, 'context-manifest.md');
  const manifestRel = existsSync(manifestPath)
    ? relative(cwd, manifestPath).replace(/\\/g, '/')
    : null;
  const allowedPathsCount = existsSync(manifestPath) ? countAllowedPaths(readFileSync(manifestPath, 'utf8')) : 0;

  const data: ChangeMetadata = {
    'change-id': changeId,
    status,
    tier: tier ?? null,
    lane: 'tracked',
    ...(classificationLane ? { 'classification-lane': classificationLane } : {}),
    types,
    'required-agents': requiredAgents,
    artifacts: { required: [...REQUIRED_FILES], optional: optionalPresent },
    context: { manifest: manifestRel, 'allowed-paths-count': allowedPathsCount },
    dependencies,
    'generated-from': generatedFrom(changeDir, ['tasks.yml', 'change-classification.md', 'context-manifest.md']),
  };

  if (!validateChange(data)) {
    warnings.push(`change.yml failed self-validation: ${ajv.errorsText(validateChange.errors)}`);
  }
  return { data, warnings };
}

export function buildTraceMetadata(changeDir: string, cwd: string): BuildResult<TraceMetadata> {
  const warnings: string[] = [];
  const changeId = basename(changeDir);

  const classifText = readIfExists(join(changeDir, 'change-classification.md'));
  const testPlanText = readIfExists(join(changeDir, 'test-plan.md'));
  const ciGatesText = readIfExists(join(changeDir, 'ci-gates.md'));

  const acList = parseAcceptanceCriteria(classifText);
  const testRows = parseTestMapping(testPlanText);
  const requiredGates = parseRequiredGates(ciGatesText);

  const criteria: TraceCriterion[] = acList.map(c => {
    const tests = testRows.filter(r => r.criterion === c.id).map(r => ({ family: r.family, path: r.path }));
    const families = new Set(tests.map(t => t.family).filter(Boolean));
    const gates = requiredGates.filter(g => [...families].some(f => gateMatchesFamily(g, f)));
    return { id: c.id, text: c.text, tests, gates };
  });

  const evidence = collectEvidence(changeDir, warnings);
  const agentLogRefs = listAgentLogs(changeDir).map(f => `agent-log/${f}`);

  const data: TraceMetadata = {
    'change-id': changeId,
    criteria,
    'required-gates': requiredGates,
    evidence,
    'generated-from': generatedFrom(changeDir, ['change-classification.md', 'test-plan.md', 'ci-gates.md', ...agentLogRefs]),
  };

  if (!validateTrace(data)) {
    warnings.push(`trace.yml failed self-validation: ${ajv.errorsText(validateTrace.errors)}`);
  }
  return { data, warnings };
}

// ── Serialization ────────────────────────────────────────────────────────────

const GENERATED_NOTICE =
  '# Generated by `cdd-kit metadata` — do not edit by hand.\n' +
  '# This is a DERIVED index of the change\'s source artifacts; regenerate after\n' +
  '# editing them with: cdd-kit metadata <change-id>\n';

function dumpYaml(obj: unknown): string {
  return GENERATED_NOTICE + yaml.dump(obj, { lineWidth: -1, noRefs: true, sortKeys: false });
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export interface MetadataOptions {
  check?: boolean;
  all?: boolean;
  json?: boolean;
}

interface MetadataResult {
  'change-id': string;
  error?: string;
  stale?: string[];
  wrote?: string[];
  warnings?: string[];
}

function activeChangeIds(changesDir: string): string[] {
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => {
      const { data } = loadYamlFile<TasksFile>(join(changesDir, d.name, 'tasks.yml'));
      return data?.status === 'in-progress';
    })
    .map(d => d.name)
    .sort();
}

export async function metadata(changeId: string | undefined, opts: MetadataOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const changesDir = join(cwd, 'specs', 'changes');

  let ids: string[];
  if (opts.all) {
    ids = activeChangeIds(changesDir);
    if (ids.length === 0 && !opts.json) log.info('No active (in-progress) changes in specs/changes/.');
  } else if (changeId) {
    ids = [changeId];
  } else {
    log.error('metadata requires a <change-id> (or pass --all to process every active change).');
    process.exit(1);
  }

  const results: MetadataResult[] = [];
  let anyError = false;
  let anyStale = false;

  for (const id of ids) {
    const changeDir = join(changesDir, id);
    if (!existsSync(changeDir)) {
      anyError = true;
      results.push({ 'change-id': id, error: 'change not found' });
      if (!opts.json) log.error(`change not found: ${id} (looked in ${changeDir})`);
      continue;
    }

    const change = buildChangeMetadata(changeDir, cwd);
    const trace = buildTraceMetadata(changeDir, cwd);
    const changeStr = dumpYaml(change.data);
    const traceStr = dumpYaml(trace.data);
    const warnings = [...change.warnings, ...trace.warnings];

    const changePath = join(changeDir, 'change.yml');
    const tracePath = join(changeDir, 'trace.yml');

    if (opts.check) {
      const stale: string[] = [];
      if (readIfExists(changePath) !== changeStr) stale.push('change.yml');
      if (readIfExists(tracePath) !== traceStr) stale.push('trace.yml');
      if (stale.length) anyStale = true;
      results.push({ 'change-id': id, stale, warnings });
      if (!opts.json) {
        if (stale.length) log.warn(`${id}: stale metadata (${stale.join(', ')}) — run \`cdd-kit metadata ${id}\``);
        else log.info(`${id}: metadata up to date`);
      }
    } else {
      writeFileSync(changePath, changeStr);
      writeFileSync(tracePath, traceStr);
      results.push({ 'change-id': id, wrote: ['change.yml', 'trace.yml'], warnings });
      if (!opts.json) {
        log.info(`${id}: wrote change.yml + trace.yml`);
        for (const w of warnings) log.dim(`  note: ${w}`);
      }
    }
  }

  if (opts.json) console.log(JSON.stringify({ results }, null, 2));
  if (anyError) process.exit(1);
  if (opts.check && anyStale) process.exit(1);
}
