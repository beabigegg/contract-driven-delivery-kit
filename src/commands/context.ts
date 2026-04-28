import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';

interface PendingRequest {
  requestId: string;
  paths: string[];
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

function parsePendingRequests(content: string): PendingRequest[] {
  const section = content.match(/## Context Expansion Requests\s*\n([\s\S]*?)(?:\n## |$)/);
  if (!section) return [];

  const requests: PendingRequest[] = [];
  const blocks = section[1].split(/(?=^\s*-\s*request-id:\s*)/m);
  for (const block of blocks) {
    const idMatch = block.match(/^\s*-\s*request-id:\s*(\S+)/m);
    const statusMatch = block.match(/^\s*status:\s*pending\b/im);
    if (!idMatch || !statusMatch) continue;

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

    requests.push({ requestId: idMatch[1], paths });
  }
  return requests;
}

function approvedExpansionSet(content: string): Set<string> {
  const section = content.match(/## Approved Expansions\s*\n([\s\S]*?)(?:\n## |$)/);
  if (!section) return new Set();
  const approved = new Set<string>();
  for (const line of section[1].split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!item) continue;
    const value = normalizePath(item[1]);
    if (value && value !== '-') approved.add(value);
  }
  return approved;
}

function replaceApprovedExpansions(content: string, paths: string[]): string {
  const section = [
    '## Approved Expansions',
    ...paths.map(path => `- ${path}`),
    '',
  ].join('\n');

  if (/## Approved Expansions\s*\n[\s\S]*?(?:\n## |$)/.test(content)) {
    return content.replace(/## Approved Expansions\s*\n[\s\S]*?(?=\n## |$)/, section.trimEnd());
  }

  return `${content.trimEnd()}\n\n${section}`;
}

function markRequestApproved(content: string, requestId: string): string {
  const lines = content.split(/\r?\n/);
  let insideTarget = false;

  return lines.map(line => {
    if (/^##\s+/.test(line) || /^\s*-\s*request-id:\s*/.test(line)) {
      const idMatch = line.match(/^\s*-\s*request-id:\s*(\S+)/);
      insideTarget = idMatch?.[1] === requestId;
    }

    if (insideTarget && /^\s*status:\s*pending\b/i.test(line)) {
      return line.replace(/pending\b/i, 'approved');
    }

    return line;
  }).join('\n');
}

export async function approveContextExpansion(changeId: string, requestId: string): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = join(cwd, 'specs', 'changes', changeId, 'context-manifest.md');
  if (!existsSync(manifestPath)) {
    log.error(`context manifest not found: specs/changes/${changeId}/context-manifest.md`);
    process.exit(1);
  }

  const content = readFileSync(manifestPath, 'utf8');
  const request = parsePendingRequests(content).find(item => item.requestId === requestId);
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

  let next = replaceApprovedExpansions(content, [...approved].sort());
  next = markRequestApproved(next, requestId);
  writeFileSync(manifestPath, next.endsWith('\n') ? next : `${next}\n`, 'utf8');

  log.ok(`approved context expansion ${requestId} for ${changeId}`);
  for (const path of request.paths) log.info(`  ${path}`);
}
