import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

export interface ChatAcceptanceReceipt {
  schema_version: '1.0.0';
  provider: 'github-pr-comment';
  repository: string;
  pr_number: number;
  comment_id: number;
}

interface GitHubComment {
  id?: number;
  body?: string;
  issue_url?: string;
  user?: { login?: string };
  author_association?: string;
}

export interface ChatAcceptanceVerification {
  ok: boolean;
  error?: string;
  actor?: string;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

function readReceipt(path: string): ChatAcceptanceReceipt | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as ChatAcceptanceReceipt;
    if (value.schema_version !== '1.0.0' || value.provider !== 'github-pr-comment') return null;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) return null;
    if (!Number.isInteger(value.pr_number) || value.pr_number <= 0) return null;
    if (!Number.isInteger(value.comment_id) || value.comment_id <= 0) return null;
    return value;
  } catch {
    return null;
  }
}

function fetchComment(cwd: string, receipt: ChatAcceptanceReceipt): GitHubComment | null {
  const path = `/repos/${receipt.repository}/issues/comments/${receipt.comment_id}`;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    const result = spawnSync('curl', [
      '--fail', '--silent', '--show-error',
      '-H', 'Accept: application/vnd.github+json',
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'X-GitHub-Api-Version: 2022-11-28',
      `https://api.github.com${path}`,
    ], { cwd, encoding: 'utf8' });
    if (result.status === 0) {
      try { return JSON.parse(result.stdout) as GitHubComment; } catch { return null; }
    }
  }
  const gh = spawnSync('gh', ['api', path], { cwd, encoding: 'utf8' });
  if (gh.status !== 0) return null;
  try { return JSON.parse(gh.stdout) as GitHubComment; } catch { return null; }
}

export function verifyChatAcceptance(
  cwd: string,
  changeDir: string,
  changeId: string,
  acceptanceHash: string,
): ChatAcceptanceVerification {
  const receiptPath = join(changeDir, 'acceptance-confirmation.json');
  const receipt = readReceipt(receiptPath);
  if (!receipt) return { ok: false, error: 'missing or invalid acceptance-confirmation.json for chat-confirmed acceptance' };

  const configuredRepo = process.env.GITHUB_REPOSITORY;
  if (configuredRepo && configuredRepo !== receipt.repository) {
    return { ok: false, error: `acceptance confirmation repository mismatch: expected ${configuredRepo}` };
  }

  const comment = fetchComment(cwd, receipt);
  if (!comment || comment.id !== receipt.comment_id) {
    return { ok: false, error: 'unable to retrieve the referenced GitHub acceptance confirmation comment' };
  }
  if (!comment.issue_url?.endsWith(`/repos/${receipt.repository}/issues/${receipt.pr_number}`)) {
    return { ok: false, error: 'acceptance confirmation comment is not attached to the declared pull request' };
  }
  if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association ?? '')) {
    return { ok: false, error: 'acceptance confirmation must be authored by a repository owner, member, or collaborator' };
  }

  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!head) return { ok: false, error: 'unable to resolve current HEAD for acceptance confirmation' };
  const expectedLines = [
    'CDD-ACCEPTANCE-CONFIRMATION v1',
    `change-id: ${changeId}`,
    `acceptance-hash: ${acceptanceHash}`,
    `head-commit: ${head}`,
    'decision: approved',
  ];
  const bodyLines = new Set((comment.body ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  const missing = expectedLines.filter(line => !bodyLines.has(line));
  if (missing.length > 0) {
    return { ok: false, error: `GitHub acceptance confirmation is stale or incomplete: missing ${missing.join(', ')}` };
  }

  return { ok: true, actor: comment.user?.login };
}
