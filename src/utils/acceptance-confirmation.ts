import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';

interface GitHubComment {
  id?: number;
  body?: string;
  user?: { login?: string };
  author_association?: string;
}

export interface ChatAcceptanceVerification {
  ok: boolean;
  error?: string;
  actor?: string;
  comment_id?: number;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

function githubContext(): { repository: string; prNumber: number } | null {
  const repository = process.env.CDD_ACCEPTANCE_REPOSITORY || process.env.GITHUB_REPOSITORY || '';
  const explicitPr = Number(process.env.CDD_ACCEPTANCE_PR || 0);
  if (repository && Number.isInteger(explicitPr) && explicitPr > 0) {
    return { repository, prNumber: explicitPr };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repository || !eventPath || !existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { pull_request?: { number?: number }; number?: number };
    const prNumber = event.pull_request?.number ?? event.number;
    return Number.isInteger(prNumber) && Number(prNumber) > 0
      ? { repository, prNumber: Number(prNumber) }
      : null;
  } catch {
    return null;
  }
}

function fetchComments(cwd: string, repository: string, prNumber: number): GitHubComment[] | null {
  const path = `/repos/${repository}/issues/${prNumber}/comments?per_page=100`;
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
      try {
        const parsed = JSON.parse(result.stdout);
        return Array.isArray(parsed) ? parsed as GitHubComment[] : null;
      } catch { return null; }
    }
  }

  const gh = spawnSync('gh', ['api', path], { cwd, encoding: 'utf8' });
  if (gh.status !== 0) return null;
  try {
    const parsed = JSON.parse(gh.stdout);
    return Array.isArray(parsed) ? parsed as GitHubComment[] : null;
  } catch { return null; }
}

export function commentConfirmsAcceptance(
  comment: GitHubComment,
  changeId: string,
  acceptanceHash: string,
  head: string,
): boolean {
  if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association ?? '')) return false;
  const expectedLines = [
    'CDD-ACCEPTANCE-CONFIRMATION v1',
    `change-id: ${changeId}`,
    `acceptance-hash: ${acceptanceHash}`,
    `head-commit: ${head}`,
    'decision: approved',
  ];
  const bodyLines = new Set((comment.body ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  return expectedLines.every(line => bodyLines.has(line));
}

export function verifyChatAcceptance(
  cwd: string,
  _changeDir: string,
  changeId: string,
  acceptanceHash: string,
): ChatAcceptanceVerification {
  const context = githubContext();
  if (!context) {
    return {
      ok: false,
      error: 'chat-confirmed acceptance requires a pull-request context (GITHUB_REPOSITORY plus GITHUB_EVENT_PATH, or CDD_ACCEPTANCE_REPOSITORY/CDD_ACCEPTANCE_PR)',
    };
  }

  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!head) return { ok: false, error: 'unable to resolve current HEAD for acceptance confirmation' };

  const comments = fetchComments(cwd, context.repository, context.prNumber);
  if (!comments) return { ok: false, error: 'unable to retrieve pull-request comments for acceptance verification' };

  const match = [...comments].reverse().find(comment => commentConfirmsAcceptance(comment, changeId, acceptanceHash, head));
  if (!match) {
    return {
      ok: false,
      error: 'no authorized PR comment confirms the current acceptance criteria and HEAD',
    };
  }

  return { ok: true, actor: match.user?.login, comment_id: match.id };
}
