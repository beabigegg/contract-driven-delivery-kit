import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';

interface ContextRequest {
  requestId: string;
  paths: string[];
  reason?: string;
  status: string;
}

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
  const match = content.match(new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[1] ?? '';
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

  const content = readManifest(changeId);
  const requests = parseRequests(content);
  if (requests.some(request => request.requestId === requestId)) {
    log.error(`context expansion request already exists: ${requestId}`);
    process.exit(1);
  }

  const next = replaceSection(content, 'Context Expansion Requests', renderRequests([
    ...requests,
    { requestId, paths: normalizedPaths, reason, status: 'pending' },
  ]));
  writeManifest(changeId, next);

  log.ok(`recorded context expansion request ${requestId} for ${changeId}`);
  for (const path of normalizedPaths) log.info(`  ${path}`);
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
  for (const path of request.paths) {
    const validationError = validateRepoRelativePath(path);
    if (validationError) {
      log.error(validationError);
      process.exit(1);
    }
  }

  const approved = approvedExpansionSet(content);
  for (const path of request.paths) approved.add(path);

  let next = replaceSection(content, 'Approved Expansions', [...[...approved].sort().map(path => `- ${path}`)]);
  next = setRequestStatus(next, requestId, 'approved');
  writeManifest(changeId, next);

  log.ok(`approved context expansion ${requestId} for ${changeId}`);
  for (const path of request.paths) log.info(`  ${path}`);
}

export async function rejectContextExpansion(changeId: string, requestId: string): Promise<void> {
  const next = setRequestStatus(readManifest(changeId), requestId, 'rejected');
  writeManifest(changeId, next);
  log.ok(`rejected context expansion ${requestId} for ${changeId}`);
}
