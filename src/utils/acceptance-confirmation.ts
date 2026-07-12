import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

interface GitHubComment {
  id?: number;
  body?: string;
  user?: { login?: string };
  author_association?: string;
}

export interface AcceptanceAuthorization {
  logins: string[];
  associations: string[];
}

// Who may confirm chat-native acceptance. Default: only the repository OWNER.
// `MEMBER`/`COLLABORATOR` are deliberately NOT trusted by default -- both are
// broad (any org member, anyone with write access, including bot accounts). A
// project widens or pins trust explicitly in `.cdd/policy.yml`:
//
//   acceptance:
//     authorized_logins: [maintainer]        # pin to specific GitHub identities
//     authorized_associations: [OWNER, MEMBER] # or re-broaden by role
//
// This does not make the confirmation unforgeable by an agent that holds a
// qualifying credential -- that requires binding the approval to the human's
// own session/channel -- but it removes needless trust surface.
export const DEFAULT_ACCEPTANCE_AUTHORIZATION: AcceptanceAuthorization = { logins: [], associations: ['OWNER'] };

export function acceptanceAuthorization(cwd: string): AcceptanceAuthorization {
  try {
    const path = join(cwd, '.cdd', 'policy.yml');
    if (!existsSync(path)) return DEFAULT_ACCEPTANCE_AUTHORIZATION;
    const policy = yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA }) as {
      acceptance?: { authorized_logins?: unknown; authorized_associations?: unknown };
    } | null;
    const config = policy?.acceptance ?? {};
    const logins = Array.isArray(config.authorized_logins)
      ? config.authorized_logins.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const associations = Array.isArray(config.authorized_associations) && config.authorized_associations.length > 0
      ? config.authorized_associations.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : ['OWNER'];
    return { logins, associations };
  } catch {
    return DEFAULT_ACCEPTANCE_AUTHORIZATION;
  }
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

function githubContext(): { repository: string; prNumber: number; acceptedHead: string } | null {
  const repository = process.env.CDD_ACCEPTANCE_REPOSITORY || process.env.GITHUB_REPOSITORY || '';
  const explicitPr = Number(process.env.CDD_ACCEPTANCE_PR || 0);
  const explicitHead = process.env.CDD_ACCEPTANCE_HEAD || '';
  if (repository && Number.isInteger(explicitPr) && explicitPr > 0 && explicitHead) {
    return { repository, prNumber: explicitPr, acceptedHead: explicitHead };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repository || !eventPath || !existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
      pull_request?: { number?: number; head?: { sha?: string } };
      number?: number;
      after?: string;
    };
    const prNumber = event.pull_request?.number ?? event.number;
    const acceptedHead = event.pull_request?.head?.sha ?? explicitHead ?? event.after ?? '';
    return Number.isInteger(prNumber) && Number(prNumber) > 0 && Boolean(acceptedHead)
      ? { repository, prNumber: Number(prNumber), acceptedHead }
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
  authorization: AcceptanceAuthorization = DEFAULT_ACCEPTANCE_AUTHORIZATION,
): boolean {
  const login = comment.user?.login ?? '';
  const association = comment.author_association ?? '';
  // A named-login allowlist is the strongest binding (GitHub logins are unique,
  // authenticated identities), so when present it fully governs and the coarse
  // association tier is ignored. Otherwise fall back to the association
  // allowlist, which defaults to OWNER-only.
  const authorized = authorization.logins.length > 0
    ? authorization.logins.includes(login)
    : authorization.associations.includes(association);
  if (!authorized) return false;
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
      error: 'chat-confirmed acceptance requires a pull-request context with repository, PR number, and source-branch HEAD',
    };
  }

  const checkedOutHead = git(cwd, ['rev-parse', 'HEAD']);
  if (!checkedOutHead) return { ok: false, error: 'unable to resolve checked-out HEAD for acceptance verification' };

  const comments = fetchComments(cwd, context.repository, context.prNumber);
  if (!comments) return { ok: false, error: 'unable to retrieve pull-request comments for acceptance verification' };

  const authorization = acceptanceAuthorization(cwd);
  const match = [...comments].reverse().find(comment => commentConfirmsAcceptance(
    comment,
    changeId,
    acceptanceHash,
    context.acceptedHead,
    authorization,
  ));
  if (!match) {
    return {
      ok: false,
      error: 'no authorized PR comment confirms the current acceptance criteria and source-branch HEAD',
    };
  }

  return { ok: true, actor: match.user?.login, comment_id: match.id };
}
