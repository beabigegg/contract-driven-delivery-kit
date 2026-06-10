import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import picomatch from 'picomatch';
import { log } from '../utils/logger.js';

interface ContextRequest {
  requestId: string;
  paths: string[];
  reason?: string;
  status: string;
}

interface ContextPolicy {
  forbiddenPaths: string[];
  /** `contextExpansion.mode`: 'auto-safe' enables auto-approval; anything else is manual-only. */
  mode: string;
  /** `contextExpansion.autoApprovePatterns`: globs whose matches are auto-approved under auto-safe mode. */
  autoApprovePatterns: string[];
}

const DEFAULT_FORBIDDEN_PATHS = [
  '.claude/worktrees/**',
  '.git/**',
  'node_modules/**',
  'dist/**',
  'build/**',
  'assets/**',
  'specs/archive/**',
  'specs/changes/*',
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function validateRepoRelativePath(path: string): string | null {
  if (/^[a-zA-Z]:\//.test(path) || path.startsWith('/')) {
    return `requested path must be repo-relative: ${path}`;
  }
  if (path.split('/').includes('..')) {
    return `requested path must not contain "..": ${path}`;
  }
  return null;
}

function manifestPathFor(changeId: string): string {
  return join(process.cwd(), 'specs', 'changes', changeId, 'context-manifest.md');
}

function readManifest(changeId: string): string {
  const manifestPath = manifestPathFor(changeId);
  if (!existsSync(manifestPath)) {
    log.error(`context manifest not found: specs/changes/${changeId}/context-manifest.md`);
    process.exit(1);
  }
  return readFileSync(manifestPath, 'utf8');
}

function writeManifest(changeId: string, content: string): void {
  writeFileSync(manifestPathFor(changeId), content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function sectionBody(content: string, heading: string): string {
  const match = stripHtmlComments(content).match(new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[1] ?? '';
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function parseListSection(content: string, heading: string): string[] {
  return sectionBody(content, heading)
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*-\s*/, '').trim())
    .filter(item => item && item !== '-' && item.toLowerCase() !== 'none')
    .map(normalizePath);
}

function pathMatches(relPath: string, patterns: string[], currentChangeId?: string): boolean {
  const normalized = normalizePath(relPath);

  return patterns.some(rawPattern => {
    const pattern = normalizePath(rawPattern).replace(/\/+$/, '');
    if (!pattern) return false;

    if (pattern === 'specs/changes/*' && currentChangeId) {
      const current = `specs/changes/${currentChangeId}`;
      if (normalized === current || normalized.startsWith(`${current}/`)) return false;
      return normalized.startsWith('specs/changes/');
    }

    if (/[*?[{]/.test(pattern)) {
      if (picomatch.isMatch(normalized, pattern, { dot: true, nocase: false })) return true;
      if (pattern.endsWith('/**')) {
        const base = pattern.slice(0, -3);
        if (normalized === base) return true;
      }
      return false;
    }

    return normalized === pattern || normalized.startsWith(`${pattern}/`);
  });
}

/**
 * Default policy when no `.cdd/context-policy.json` exists: forbidden baseline
 * only, and auto-approval OFF (mode 'manual'). Auto-approval is opt-in via the
 * scaffolded policy's `contextExpansion.mode: "auto-safe"` so a repo without the
 * file never silently widens an agent's read scope.
 */
function defaultPolicy(): ContextPolicy {
  return { forbiddenPaths: DEFAULT_FORBIDDEN_PATHS, mode: 'manual', autoApprovePatterns: [] };
}

interface RawContextPolicy {
  forbiddenPaths?: string[];
  contextExpansion?: { mode?: string; autoApprovePatterns?: string[] };
}

function loadContextPolicy(): ContextPolicy {
  const policyPath = join(process.cwd(), '.cdd', 'context-policy.json');
  if (!existsSync(policyPath)) return defaultPolicy();

  try {
    const custom = JSON.parse(readFileSync(policyPath, 'utf8')) as RawContextPolicy;
    return {
      forbiddenPaths: Array.from(new Set([
        ...DEFAULT_FORBIDDEN_PATHS,
        ...(custom.forbiddenPaths ?? []),
      ])),
      mode: custom.contextExpansion?.mode ?? 'manual',
      autoApprovePatterns: custom.contextExpansion?.autoApprovePatterns ?? [],
    };
  } catch {
    // Fail safe: a broken policy must never enable auto-approval.
    log.warn('could not parse .cdd/context-policy.json; using default context policy (auto-approval off)');
    return defaultPolicy();
  }
}

/**
 * Paths that may be auto-approved for this change: only under auto-safe mode,
 * only when they match an `autoApprovePatterns` glob (with `<current-change-id>`
 * substituted to the real change id), are repo-relative, and are NOT forbidden.
 * Forbidden always wins, so the auto-safe list can never widen past the baseline.
 */
function autoApprovablePaths(paths: string[], policy: ContextPolicy, changeId: string): string[] {
  if (policy.mode !== 'auto-safe' || policy.autoApprovePatterns.length === 0) return [];
  const patterns = policy.autoApprovePatterns.map(p => normalizePath(p.replace(/<current-change-id>/g, changeId)));
  return paths.filter(path => {
    if (validateRepoRelativePath(path)) return false;
    if (pathMatches(path, policy.forbiddenPaths, changeId)) return false;
    return pathMatches(path, patterns, changeId);
  });
}

function parseRequests(content: string): ContextRequest[] {
  const body = sectionBody(content, 'Context Expansion Requests');
  if (!body.trim()) return [];

  const requests: ContextRequest[] = [];
  const blocks = body.split(/(?=^\s*-\s*request-id:\s*)/m);
  for (const block of blocks) {
    const idMatch = block.match(/^\s*-\s*request-id:\s*(\S+)/m);
    if (!idMatch) continue;

    const statusMatch = block.match(/^\s*status:\s*(\S+)/im);
    const reasonMatch = block.match(/^\s*reason:\s*(.+)$/im);
    const paths: string[] = [];
    let inPaths = false;

    for (const line of block.split(/\r?\n/)) {
      if (/^\s*requested_paths:\s*$/.test(line)) {
        inPaths = true;
        continue;
      }
      if (!inPaths) continue;

      const item = line.match(/^\s*-\s+(.+?)\s*$/);
      if (item) {
        paths.push(normalizePath(item[1]));
        continue;
      }
      if (/^\s*[a-zA-Z_-]+:\s*/.test(line)) break;
    }

    requests.push({
      requestId: idMatch[1],
      paths,
      reason: reasonMatch?.[1]?.trim(),
      status: statusMatch?.[1]?.trim().toLowerCase() ?? 'unknown',
    });
  }
  return requests;
}

function approvedExpansionSet(content: string): Set<string> {
  const body = sectionBody(content, 'Approved Expansions');
  const approved = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!item) continue;
    const value = normalizePath(item[1]);
    if (value && value !== '-') approved.add(value);
  }
  return approved;
}

function replaceSection(content: string, heading: string, lines: string[]): string {
  const nextSection = [`## ${heading}`, ...lines, ''].join('\n');
  const pattern = new RegExp(`## ${heading}\\s*\\n[\\s\\S]*?(?=\\n## |$)`);
  if (pattern.test(content)) return content.replace(pattern, nextSection.trimEnd());
  return `${content.trimEnd()}\n\n${nextSection}`;
}

function renderRequests(requests: ContextRequest[]): string[] {
  if (requests.length === 0) return ['-'];
  const lines: string[] = [];
  for (const request of requests) {
    lines.push(`- request-id: ${request.requestId}`);
    lines.push('  requested_paths:');
    for (const path of request.paths) lines.push(`    - ${path}`);
    if (request.reason) lines.push(`  reason: ${request.reason}`);
    lines.push(`  status: ${request.status}`);
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function setRequestStatus(content: string, requestId: string, status: 'approved' | 'rejected'): string {
  const requests = parseRequests(content);
  const target = requests.find(request => request.requestId === requestId);
  if (!target) {
    log.error(`context expansion request not found: ${requestId}`);
    process.exit(1);
  }
  if (target.status !== 'pending') {
    log.error(`pending context expansion request not found: ${requestId}`);
    process.exit(1);
  }

  const next = requests.map(request => request.requestId === requestId ? { ...request, status } : request);
  return replaceSection(content, 'Context Expansion Requests', renderRequests(next));
}

export async function requestContextExpansion(changeId: string, requestId: string, paths: string[], reason?: string): Promise<void> {
  if (paths.length === 0) {
    log.error('at least one --path value is required');
    process.exit(1);
  }

  const normalizedPaths = [...new Set(paths.map(normalizePath).filter(Boolean))];
  for (const path of normalizedPaths) {
    const validationError = validateRepoRelativePath(path);
    if (validationError) {
      log.error(validationError);
      process.exit(1);
    }
  }

  let content = readManifest(changeId);
  const requests = parseRequests(content);
  if (requests.some(request => request.requestId === requestId)) {
    log.error(`context expansion request already exists: ${requestId}`);
    process.exit(1);
  }

  // P1-3(a): under auto-safe mode, paths inside the configured safe zones are
  // approved immediately so a fully-safe request never stalls the session as a
  // pending CER. Only the remainder is recorded for human adjudication.
  const policy = loadContextPolicy();
  const autoApproved = autoApprovablePaths(normalizedPaths, policy, changeId);
  const stillPending = normalizedPaths.filter(path => !autoApproved.includes(path));

  if (autoApproved.length > 0) {
    const approved = approvedExpansionSet(content);
    for (const path of autoApproved) approved.add(path);
    content = replaceSection(content, 'Approved Expansions', [...approved].sort().map(p => `- ${p}`));
  }
  if (stillPending.length > 0) {
    content = replaceSection(content, 'Context Expansion Requests', renderRequests([
      ...requests,
      { requestId, paths: stillPending, reason, status: 'pending' },
    ]));
  }
  writeManifest(changeId, content);

  if (autoApproved.length > 0) {
    log.ok(`auto-approved ${autoApproved.length} path(s) under .cdd/context-policy.json auto-safe patterns for ${changeId}`);
    for (const path of autoApproved) log.info(`  ${path}`);
  }
  if (stillPending.length > 0) {
    log.ok(`recorded context expansion request ${requestId} for ${changeId}`);
    for (const path of stillPending) log.info(`  ${path}`);
  } else {
    log.ok(`no pending request needed for ${requestId} — all requested paths were auto-approved`);
  }
}

export async function listContextExpansions(changeId: string, json = false): Promise<void> {
  const requests = parseRequests(readManifest(changeId));

  if (json) {
    console.log(JSON.stringify({ changeId, requests }, null, 2));
    return;
  }

  if (requests.length === 0) {
    log.info(`no context expansion requests for ${changeId}`);
    return;
  }

  log.info(`context expansion requests for ${changeId}`);
  for (const request of requests) {
    log.info(`- ${request.requestId} [${request.status}] ${request.reason ?? ''}`.trimEnd());
    for (const path of request.paths) log.dim(`    ${path}`);
  }
}

export async function checkContextPaths(changeId: string, paths: string[], json = false): Promise<void> {
  if (paths.length === 0) {
    log.error('at least one --path value is required');
    process.exit(1);
  }

  const content = readManifest(changeId);
  const allowedPaths = parseListSection(content, 'Allowed Paths');
  const approvedExpansions = parseListSection(content, 'Approved Expansions');
  const policy = loadContextPolicy();
  const normalizedPaths = [...new Set(paths.map(normalizePath).filter(Boolean))];

  const results = normalizedPaths.map(path => {
    const validationError = validateRepoRelativePath(path);
    const forbidden = !validationError && pathMatches(path, policy.forbiddenPaths, changeId);
    const authorized = !validationError && !forbidden && (
      pathMatches(path, allowedPaths) || pathMatches(path, approvedExpansions)
    );
    let reason = 'authorized';
    if (validationError) reason = validationError;
    else if (forbidden) reason = 'forbidden by .cdd/context-policy.json baseline';
    else if (!authorized) reason = 'not in context-manifest Allowed Paths or Approved Expansions';

    return { path, authorized, reason };
  });

  if (json) {
    console.log(JSON.stringify({ changeId, results }, null, 2));
  } else {
    for (const result of results) {
      if (result.authorized) log.ok(`authorized: ${result.path}`);
      else log.error(`unauthorized: ${result.path} (${result.reason})`);
    }
    const unauthorized = results.filter(r => !r.authorized).map(r => r.path);
    if (unauthorized.length > 0) {
      log.info(`If these reads are legitimate, add them to specs/changes/${changeId}/context-manifest.md Allowed Paths or request expansion:`);
      log.info(`  cdd-kit context request ${changeId} CER-<id> --path ${unauthorized.join(' ')} --reason "<why needed>"`);
    }
  }

  if (results.some(result => !result.authorized)) process.exit(1);
}

function applyApproval(content: string, request: ContextRequest): string {
  for (const path of request.paths) {
    const validationError = validateRepoRelativePath(path);
    if (validationError) {
      log.error(validationError);
      process.exit(1);
    }
  }
  const approved = approvedExpansionSet(content);
  for (const path of request.paths) approved.add(path);
  let next = replaceSection(content, 'Approved Expansions', [...approved].sort().map(p => `- ${p}`));
  next = setRequestStatus(next, request.requestId, 'approved');
  return next;
}

export async function approveContextExpansion(changeId: string, requestId: string): Promise<void> {
  const content = readManifest(changeId);
  const request = parseRequests(content).find(item => item.requestId === requestId && item.status === 'pending');
  if (!request) {
    log.error(`pending context expansion request not found: ${requestId}`);
    process.exit(1);
  }
  if (request.paths.length === 0) {
    log.error(`context expansion request has no requested_paths: ${requestId}`);
    process.exit(1);
  }

  const next = applyApproval(content, request);
  writeManifest(changeId, next);

  log.ok(`approved context expansion ${requestId} for ${changeId}`);
  for (const path of request.paths) log.info(`  ${path}`);
}

export async function approveAllPending(changeId: string): Promise<void> {
  let content = readManifest(changeId);
  const pending = parseRequests(content).filter(r => r.status === 'pending');

  if (pending.length === 0) {
    log.info(`no pending context expansion requests for ${changeId}`);
    return;
  }

  const skipped: string[] = [];
  let approvedCount = 0;
  for (const request of pending) {
    if (request.paths.length === 0) {
      skipped.push(`${request.requestId} (no requested_paths)`);
      continue;
    }
    content = applyApproval(content, request);
    approvedCount += 1;
  }
  writeManifest(changeId, content);

  log.ok(`approved ${approvedCount} pending context expansion request(s) for ${changeId}`);
  for (const reason of skipped) {
    log.warn(`  skipped ${reason}`);
  }
}

/**
 * P1-3(a): resolve already-pending CERs against the auto-safe policy. For each
 * pending request, the paths inside the safe zones are moved to Approved
 * Expansions; a request whose every path is safe is marked `approved`, and one
 * with leftover paths stays pending (trimmed to just the paths that still need
 * human judgment). This is the unblock `/cdd-resume` can call before stopping.
 */
export async function autoApproveContextExpansions(changeId: string): Promise<void> {
  let content = readManifest(changeId);
  const policy = loadContextPolicy();

  if (policy.mode !== 'auto-safe') {
    log.info(`context auto-approve: policy mode is "${policy.mode}", not "auto-safe" — nothing auto-approved`);
    return;
  }

  const pending = parseRequests(content).filter(r => r.status === 'pending');
  if (pending.length === 0) {
    log.info(`no pending context expansion requests for ${changeId}`);
    return;
  }

  const approved = approvedExpansionSet(content);
  let fullyApproved = 0;
  let partial = 0;
  let untouched = 0;

  const nextRequests = parseRequests(content).map(request => {
    if (request.status !== 'pending') return request;
    const safe = autoApprovablePaths(request.paths, policy, changeId);
    if (safe.length === 0) {
      untouched += 1;
      return request;
    }
    for (const path of safe) approved.add(path);
    const remaining = request.paths.filter(path => !safe.includes(path));
    if (remaining.length === 0) {
      fullyApproved += 1;
      return { ...request, status: 'approved' };
    }
    partial += 1;
    return { ...request, paths: remaining };
  });

  content = replaceSection(content, 'Approved Expansions', [...approved].sort().map(p => `- ${p}`));
  content = replaceSection(content, 'Context Expansion Requests', renderRequests(nextRequests));
  writeManifest(changeId, content);

  log.ok(`auto-approved ${fullyApproved} request(s) fully and ${partial} partially for ${changeId} (${untouched} still need review)`);
}

/** One-line plain-language tag for a requested path, for the interactive prompt. */
function describePathForHuman(path: string, policy: ContextPolicy, changeId: string): string {
  if (validateRepoRelativePath(path)) return 'invalid path — cannot be approved';
  if (pathMatches(path, policy.forbiddenPaths, changeId)) return 'blocked by policy — approving will not authorize it';
  if (autoApprovablePaths([path], policy, changeId).length > 0) return 'inside an auto-safe zone (normally approved automatically)';
  return 'outside the usual safe zones — review before approving';
}

/**
 * P1-3(b): walk pending CERs one at a time with a plain-language explanation
 * and a y/n/q prompt, so a non-engineer can adjudicate without editing the
 * manifest by hand. Reads answers from stdin; on EOF (no input / non-interactive
 * with nothing piped) it stops cleanly instead of hanging.
 */
export async function approveContextExpansionsInteractive(changeId: string): Promise<void> {
  const policy = loadContextPolicy();
  let content = readManifest(changeId);
  const pending = parseRequests(content).filter(r => r.status === 'pending');

  if (pending.length === 0) {
    log.info(`no pending context expansion requests for ${changeId}`);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> => new Promise(resolve => {
    let done = false;
    const onClose = (): void => { if (!done) { done = true; resolve('q'); } };
    rl.once('close', onClose);
    rl.question(question, answer => {
      if (done) return;
      done = true;
      rl.removeListener('close', onClose);
      resolve(answer.trim().toLowerCase());
    });
  });

  const approvedIds: string[] = [];
  let quit = false;
  for (const request of pending) {
    log.info(`Request ${request.requestId}${request.reason ? ` — ${request.reason}` : ''}`);
    for (const path of request.paths) {
      log.dim(`  ${path}  (${describePathForHuman(path, policy, changeId)})`);
    }
    const answer = await ask('Approve reading these path(s)? [y]es / [n]o-skip / [q]uit: ');
    if (answer === 'q' || answer === 'quit') { quit = true; break; }
    if (answer === 'y' || answer === 'yes') {
      // Re-parse so each approval composes on the latest content.
      const target = parseRequests(content).find(r => r.requestId === request.requestId && r.status === 'pending');
      if (target) {
        content = applyApproval(content, target);
        writeManifest(changeId, content);
        approvedIds.push(request.requestId);
      }
    }
  }
  rl.close();

  if (approvedIds.length > 0) {
    log.ok(`approved ${approvedIds.length} request(s) for ${changeId}: ${approvedIds.join(', ')}`);
  } else {
    log.info(`no requests approved for ${changeId}`);
  }
  if (quit) log.dim('stopped at your request; remaining pending requests were left untouched');
}

export async function rejectContextExpansion(changeId: string, requestId: string): Promise<void> {
  const next = setRequestStatus(readManifest(changeId), requestId, 'rejected');
  writeManifest(changeId, next);
  log.ok(`rejected context expansion ${requestId} for ${changeId}`);
}

export async function rejectAllPending(changeId: string): Promise<void> {
  let content = readManifest(changeId);
  const pending = parseRequests(content).filter(r => r.status === 'pending');
  if (pending.length === 0) {
    log.info(`no pending context expansion requests for ${changeId}`);
    return;
  }
  for (const request of pending) {
    content = setRequestStatus(content, request.requestId, 'rejected');
  }
  writeManifest(changeId, content);
  log.ok(`rejected ${pending.length} pending context expansion request(s) for ${changeId}`);
}
