import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ensureCodeMapFresh, loadCodeMapEntries } from '../code-map/index-reader.js';
import { graphPathFor, loadCodeGraph } from '../code-graph/reader.js';
import { searchGraph, graphImpact as nativeGraphImpact } from '../code-graph/queries.js';
import { queryEntries } from './index-query.js';
import { getStagedPaths } from '../utils/git-paths.js';
import { sectionBody } from '../utils/markdown-section.js';
import { log } from '../utils/logger.js';
import { readPlanSourceText } from './gate-artifacts.js';

export interface BugSuspectsOptions {
  symptom?: string;
  text?: string;
  json: boolean;
  limit: number;
  map?: string;
  refresh?: boolean;
}

export interface SuspectCandidate {
  path: string;
  symbols: string[];
  reason: string;
  read_ranges: string[];
  impact?: {
    callers: string[];
    dependents: string[];
  };
}

export interface BugSuspectsPayload {
  change_id: string | null;
  symptom: string;
  candidates: SuspectCandidate[];
  next_commands: string[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function emitError(json: boolean, payload: Record<string, unknown>, humanMessage: string): void {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else log.error(humanMessage);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function parseListSection(content: string, heading: string): string[] {
  return sectionBody(content, heading)
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*-\s*/, '').trim())
    .filter(item => item && item !== '-' && item.toLowerCase() !== 'none')
    .map(normalizePath);
}

function readChangeDir(changeId: string): string {
  return join(process.cwd(), 'specs', 'changes', changeId);
}

function parseAllowedPaths(changeId: string): string[] {
  const manifestPath = join(readChangeDir(changeId), 'context-manifest.md');
  if (!existsSync(manifestPath)) return [];
  const content = readFileSync(manifestPath, 'utf8');
  return [
    ...parseListSection(content, 'Allowed Paths'),
    ...parseListSection(content, 'Approved Expansions'),
  ];
}

function parseTestPlanFiles(changeId: string): string[] {
  // v1's test-plan.md or v2's folded `## Test Plan` section (readPlanSourceText).
  const content = readPlanSourceText(readChangeDir(changeId), 'Test Plan');
  if (!content) return [];
  // Extract file paths mentioned in the test-plan (lines with paths like test/..., tests/..., spec/...)
  const pathRe = /(?:^|\s)((?:test|tests|spec|specs)\/[\w/.:-]+\.(?:py|ts|tsx|js|jsx|rb|java|go|rs))/gm;
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(content)) !== null) {
    const p = normalizePath(m[1]);
    if (p && !paths.includes(p)) paths.push(p);
  }
  return paths;
}

function rangeFromLines(lines: [number, number] | string | undefined): string | undefined {
  if (!lines) return undefined;
  if (typeof lines === 'string') return lines;
  return `${lines[0]}-${lines[1]}`;
}

// ── main entry ────────────────────────────────────────────────────────────────

export async function bugSuspects(changeId: string | undefined, opts: BugSuspectsOptions): Promise<number> {
  const symptom = (opts.symptom ?? opts.text ?? '').trim();
  if (!symptom) {
    emitError(opts.json, { error: 'symptom text is required; use --symptom "<text>" or --text "<text>"' },
      'symptom text is required; use --symptom "<text>" or --text "<text>"');
    return 2;
  }

  // Validate change-id when provided
  if (changeId !== undefined) {
    const changeDir = readChangeDir(changeId);
    if (!existsSync(changeDir)) {
      emitError(opts.json,
        { error: `change not found: specs/changes/${changeId}/ does not exist; run "cdd-kit new ${changeId}" first` },
        `change not found: specs/changes/${changeId}/ does not exist; run "cdd-kit new ${changeId}" first`);
      return 2;
    }
  }

  const mapPath = opts.map ?? '.cdd/code-map.yml';
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : 20;

  // Use the existing committed index by default; only (re)generate it when the
  // caller passes --refresh. A read-only suspects query must not mutate the
  // tracked code-map on every run (mirrors `cdd-kit index query`).
  const freshness = await ensureCodeMapFresh(mapPath, opts.refresh === true);
  if (freshness.error && !existsSync(mapPath)) {
    const msg = `${mapPath} is missing; run \`cdd-kit code-map\` first to build the code index`;
    emitError(opts.json, { error: msg }, msg);
    return 2;
  }

  // Check if we have ANY code intel
  const graphPath = graphPathFor(mapPath);
  const hasGraph = existsSync(graphPath);
  const hasMap = existsSync(mapPath);

  if (!hasGraph && !hasMap) {
    const msg = `no code-intel found (${graphPath} and ${mapPath} are both missing); run \`cdd-kit code-map\` first`;
    emitError(opts.json, { error: msg }, msg);
    return 2;
  }

  // Gather change-scoped context when change-id is provided
  const allowedPaths: string[] = changeId ? parseAllowedPaths(changeId) : [];
  const testPlanFiles: string[] = changeId ? parseTestPlanFiles(changeId) : [];
  const stagedFiles: string[] = changeId ? getStagedPaths(process.cwd()) : [];

  // Split symptom into query terms (use full phrase + individual words for broader coverage)
  const queryTerms = buildQueryTerms(symptom);

  let candidates: SuspectCandidate[] = [];

  if (hasGraph) {
    candidates = await buildFromGraph(graphPath, queryTerms, limit);
  } else {
    candidates = buildFromCodeMap(mapPath, queryTerms, limit);
  }

  // Incorporate test-plan files as additional context (append, don't duplicate)
  const candidatePaths = new Set(candidates.map(c => c.path));
  for (const testFile of testPlanFiles) {
    if (!candidatePaths.has(testFile) && existsSync(join(process.cwd(), testFile))) {
      candidates.push({
        path: testFile,
        symbols: [],
        reason: 'listed in test-plan.md',
        read_ranges: [],
      });
      candidatePaths.add(testFile);
    }
  }

  // Note staged files if they overlap with candidates or are nearby
  const stagedSet = new Set(stagedFiles.map(normalizePath));
  for (const candidate of candidates) {
    if (stagedSet.has(normalizePath(candidate.path))) {
      candidate.reason += '; currently staged';
    }
  }

  // Sort: prefer candidates within allowed paths (change-scoped mode)
  if (allowedPaths.length > 0) {
    candidates.sort((a, b) => {
      const aAllowed = isWithinAllowedPaths(a.path, allowedPaths) ? 0 : 1;
      const bAllowed = isWithinAllowedPaths(b.path, allowedPaths) ? 0 : 1;
      return aAllowed - bAllowed;
    });
    // Annotate candidates outside allowed paths
    for (const c of candidates) {
      if (!isWithinAllowedPaths(c.path, normalizePaths(allowedPaths))) {
        c.reason += ' (outside context-manifest allowed paths)';
      }
    }
  }

  candidates = candidates.slice(0, limit);

  // Build next_commands suggestions
  const topSymbol = candidates[0]?.symbols[0] ?? candidates[0]?.path;
  const next_commands: string[] = [];
  if (topSymbol) {
    next_commands.push(`cdd-kit graph query ${topSymbol} --with-source`);
  }
  if (changeId) {
    next_commands.push(`cdd-kit test select ${changeId} --json`);
  }

  const payload: BugSuspectsPayload = {
    change_id: changeId ?? null,
    symptom,
    candidates,
    next_commands,
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  // Human-readable output
  printHuman(payload, allowedPaths);
  return 0;
}

// ── query helpers ─────────────────────────────────────────────────────────────

/**
 * Build a deduplicated list of search terms from symptom text.
 * Uses the full phrase first, then individual words of length >= 4.
 */
function buildQueryTerms(symptom: string): string[] {
  const terms: string[] = [];
  const full = symptom.trim();
  if (full) terms.push(full);
  for (const word of full.split(/\s+/)) {
    const clean = word.replace(/[^a-zA-Z0-9_-]/g, '');
    if (clean.length >= 4 && !terms.includes(clean)) {
      terms.push(clean);
    }
  }
  return terms;
}

// ── graph-backed search ───────────────────────────────────────────────────────

async function buildFromGraph(graphPath: string, queryTerms: string[], limit: number): Promise<SuspectCandidate[]> {
  let graph;
  try {
    graph = loadCodeGraph(graphPath);
  } catch {
    return [];
  }

  // Collect scored results across all terms, deduped by node id
  const nodeScores = new Map<string, { score: number; result: ReturnType<typeof searchGraph>[0] }>();
  for (const term of queryTerms) {
    const results = searchGraph(graph, term, limit * 2);
    for (const r of results) {
      const existing = nodeScores.get(r.node.id);
      if (!existing || r.score > existing.score) {
        nodeScores.set(r.node.id, { score: r.score, result: r });
      }
    }
  }

  const sorted = [...nodeScores.values()]
    .sort((a, b) => b.score - a.score || a.result.node.file_path.localeCompare(b.result.node.file_path));

  // Group by file_path, keeping highest-scoring node per file
  const byFile = new Map<string, { score: number; nodes: typeof sorted[0]['result']['node'][] }>();
  for (const { score, result } of sorted) {
    const fp = normalizePath(result.node.file_path);
    const existing = byFile.get(fp);
    if (!existing) {
      byFile.set(fp, { score, nodes: [result.node] });
    } else {
      existing.score = Math.max(existing.score, score);
      if (existing.nodes.length < 5) existing.nodes.push(result.node);
    }
  }

  const candidates: SuspectCandidate[] = [];
  for (const [filePath, { nodes }] of byFile) {
    const topNode = nodes[0];
    // Get impact for top node
    const impact = nativeGraphImpact(graph, topNode.id, 1, 20);
    const callers: string[] = [];
    const dependents: string[] = [];
    if (impact) {
      for (const edge of impact.edges) {
        const other = edge.source === topNode.id ? edge.target : edge.source;
        const otherNode = graph.nodes.find(n => n.id === other);
        if (!otherNode) continue;
        if (edge.kind === 'calls' && edge.target === topNode.id) {
          callers.push(normalizePath(otherNode.file_path));
        } else if (edge.kind === 'imports' && edge.target === topNode.id) {
          dependents.push(normalizePath(otherNode.file_path));
        }
      }
    }

    const symbols = nodes
      .filter(n => n.kind !== 'file')
      .map(n => n.name)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);
    const ranges = nodes
      .filter(n => n.kind !== 'file' && n.start_line)
      .map(n => `${n.start_line}-${n.end_line ?? n.start_line}`)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);

    candidates.push({
      path: filePath,
      symbols,
      reason: buildReason(nodes.map(n => n.name), queryTerms, 'graph index'),
      read_ranges: ranges,
      impact: { callers: [...new Set(callers)], dependents: [...new Set(dependents)] },
    });

    if (candidates.length >= limit) break;
  }

  return candidates;
}

// ── code-map fallback search ──────────────────────────────────────────────────

function buildFromCodeMap(mapPath: string, queryTerms: string[], limit: number): SuspectCandidate[] {
  let entries;
  try {
    entries = loadCodeMapEntries(mapPath);
  } catch {
    return [];
  }

  // Collect scored results across all terms, deduped by path
  const pathScores = new Map<string, { score: number; result: ReturnType<typeof queryEntries>[0] }>();
  for (const term of queryTerms) {
    const results = queryEntries(entries, term);
    for (const r of results) {
      const existing = pathScores.get(r.path);
      if (!existing || r.score > existing.score) {
        pathScores.set(r.path, { score: r.score, result: r });
      }
    }
  }

  const sorted = [...pathScores.values()]
    .sort((a, b) => b.score - a.score || a.result.path.localeCompare(b.result.path));

  const candidates: SuspectCandidate[] = [];
  for (const { result } of sorted) {
    const symbols = result.matches
      .filter(m => m.kind !== 'file' && m.kind !== 'import')
      .map(m => m.name)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);
    const ranges = result.matches
      .filter(m => m.lines)
      .map(m => m.lines!)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);

    candidates.push({
      path: normalizePath(result.path),
      symbols,
      reason: buildReason(symbols, queryTerms, 'code-map index'),
      read_ranges: ranges,
    });

    if (candidates.length >= limit) break;
  }

  return candidates;
}

// ── utilities ─────────────────────────────────────────────────────────────────

function buildReason(matchedNames: string[], queryTerms: string[], engine: string): string {
  const matched = matchedNames.filter(n =>
    queryTerms.some(t => n.toLowerCase().includes(t.toLowerCase()))
  ).slice(0, 3);
  if (matched.length > 0) {
    return `${matched.join(', ')} matched ${engine}`;
  }
  return `symbol and file terms matched ${engine}`;
}

function isWithinAllowedPaths(filePath: string, allowedPaths: string[]): boolean {
  const normalized = normalizePath(filePath);
  return allowedPaths.some(allowed => {
    const a = normalizePath(allowed);
    // Exact match, prefix match, or glob-style prefix
    return normalized === a || normalized.startsWith(`${a}/`) || a.endsWith('/**') && normalized.startsWith(a.slice(0, -3));
  });
}

function normalizePaths(paths: string[]): string[] {
  return paths.map(normalizePath);
}

function printHuman(payload: BugSuspectsPayload, allowedPaths: string[]): void {
  if (payload.change_id) {
    log.info(`bug suspects for change: ${payload.change_id}`);
  }
  log.info(`symptom: ${payload.symptom}`);
  log.blank();

  if (payload.candidates.length === 0) {
    log.warn('no candidates found; try running `cdd-kit code-map` to refresh the code index, or use a more specific symptom term');
    return;
  }

  log.info(`candidates (${payload.candidates.length}):`);
  for (const c of payload.candidates) {
    const inScope = allowedPaths.length === 0 || isWithinAllowedPaths(c.path, allowedPaths);
    const marker = inScope ? '' : ' [outside allowed paths]';
    log.info(`  ${c.path}${marker}`);
    if (c.symbols.length > 0) {
      log.dim(`    symbols: ${c.symbols.join(', ')}`);
    }
    if (c.read_ranges.length > 0) {
      log.dim(`    read ranges: ${c.read_ranges.join(', ')}`);
    }
    log.dim(`    reason: ${c.reason}`);
    if (c.impact?.callers && c.impact.callers.length > 0) {
      log.dim(`    callers: ${c.impact.callers.slice(0, 3).join(', ')}`);
    }
    if (c.impact?.dependents && c.impact.dependents.length > 0) {
      log.dim(`    dependents: ${c.impact.dependents.slice(0, 3).join(', ')}`);
    }
  }

  log.blank();
  if (payload.next_commands.length > 0) {
    log.info('next commands:');
    for (const cmd of payload.next_commands) {
      log.dim(`  ${cmd}`);
    }
  }
}
