// `cdd-kit report` -- let an agent (or a human) file a problem about the CDD
// kit ITSELF as a GitHub issue on the kit's upstream repository.
//
// Design constraint (maintainer requirement): "manual call, but needs your
// confirmation". So this command DRAFTS by default and only POSTS with an
// explicit `--confirm`. The intended protocol is: the agent runs it without
// `--confirm` to show the maintainer the drafted issue, and only re-runs with
// `--confirm` after the maintainer approves. Posting is an outward-facing action
// (it publishes to GitHub), so it is never the default.
//
// Reuses the token-then-`gh` GitHub call shape from acceptance-confirmation.ts.
// Only a safe, fixed set of environment facts is captured -- never a dump of
// process env, secrets, or file contents.

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PACKAGE_ROOT, readKitVersion } from '../utils/paths.js';

const DEFAULT_REPORT_REPO = 'beabigegg/contract-driven-delivery-kit';
const REPORT_CATEGORIES = ['bug', 'gate-false-positive', 'crash', 'docs', 'other'] as const;
const MAX_BODY = 60_000; // GitHub caps issue bodies at 65536 chars; stay under it.

export interface ReportOptions {
  title?: string;
  body?: string;
  category?: string;
  repo?: string;
  label?: string[];
  changeId?: string;
  runId?: string;
  confirm?: boolean;
  json?: boolean;
}

interface ReportDraft {
  repo: string;
  title: string;
  body: string;
  labels: string[];
  category: string;
}

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^<[^<>]*>$/.test(trimmed);
}

function parseRepoSlug(value: string): string | null {
  const cleaned = value.trim().replace(/\.git$/, '');
  // GitHub URL/SSH form: take owner/repo immediately after the host, ignoring
  // trailing path segments like `/issues` on a bugs URL.
  const url = cleaned.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:$|[/#?])/);
  if (url) return `${url[1]}/${url[2]}`;
  // Bare `owner/repo` slug (e.g. from --repo).
  const bare = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return bare ? `${bare[1]}/${bare[2]}` : null;
}

function packageRepoUrls(): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      bugs?: { url?: string } | string;
      repository?: { url?: string } | string;
    };
    const bugs = typeof pkg.bugs === 'object' ? pkg.bugs?.url : typeof pkg.bugs === 'string' ? pkg.bugs : undefined;
    const repo = typeof pkg.repository === 'object' ? pkg.repository?.url : typeof pkg.repository === 'string' ? pkg.repository : undefined;
    return [bugs, repo].filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

function resolveRepo(explicit?: string): string {
  for (const candidate of [explicit, process.env.CDD_REPORT_REPO, ...packageRepoUrls()]) {
    if (candidate) {
      const slug = parseRepoSlug(candidate);
      if (slug) return slug;
    }
  }
  return DEFAULT_REPORT_REPO;
}

function gitFact(args: string[]): string {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

function composeBody(userBody: string, category: string, opts: ReportOptions): string {
  const commit = gitFact(['rev-parse', '--short', 'HEAD']);
  const branch = gitFact(['rev-parse', '--abbrev-ref', 'HEAD']);
  const lines = [
    userBody.trim(),
    '',
    '---',
    '### Environment (captured by `cdd-kit report`)',
    `- cdd-kit: ${readKitVersion()}`,
    `- node: ${process.version}`,
    `- platform: ${process.platform} ${process.arch}`,
    `- category: ${category}`,
  ];
  if (commit) lines.push(`- repo commit: ${commit}${branch ? ` (${branch})` : ''}`);
  if (opts.changeId) lines.push(`- change-id: ${opts.changeId}`);
  if (opts.runId) lines.push(`- run-id: ${opts.runId}`);
  lines.push('', '_Filed via `cdd-kit report` after maintainer confirmation._');
  const body = lines.join('\n');
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n\n_[truncated by cdd-kit report]_` : body;
}

interface PostResult { ok: boolean; url?: string; number?: number; error?: string; via?: string }

function postIssue(draft: ReportDraft): PostResult {
  const payload = JSON.stringify({ title: draft.title, body: draft.body, ...(draft.labels.length ? { labels: draft.labels } : {}) });
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const url = `https://api.github.com/repos/${draft.repo}/issues`;
  if (token) {
    const curl = spawnSync('curl', [
      '--fail', '--silent', '--show-error', '-X', 'POST',
      '-H', 'Accept: application/vnd.github+json',
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'X-GitHub-Api-Version: 2022-11-28',
      '-H', 'Content-Type: application/json',
      '--data', '@-', url,
    ], { input: payload, encoding: 'utf8' });
    if (curl.status === 0) {
      try {
        const issue = JSON.parse(curl.stdout) as { html_url?: string; number?: number };
        return { ok: true, url: issue.html_url, number: issue.number, via: 'curl' };
      } catch { return { ok: false, error: 'GitHub response was not valid JSON', via: 'curl' }; }
    }
  }
  const gh = spawnSync('gh', ['api', '-X', 'POST', `/repos/${draft.repo}/issues`, '--input', '-'], { input: payload, encoding: 'utf8' });
  if (gh.status === 0) {
    try {
      const issue = JSON.parse(gh.stdout) as { html_url?: string; number?: number };
      return { ok: true, url: issue.html_url, number: issue.number, via: 'gh' };
    } catch { return { ok: false, error: 'gh response was not valid JSON', via: 'gh' }; }
  }
  const detail = (gh.stderr || '').trim();
  return {
    ok: false,
    error: detail || 'no GITHUB_TOKEN/GH_TOKEN in the environment and the `gh` CLI is unavailable or failed',
  };
}

export async function report(opts: ReportOptions): Promise<number> {
  const emit = (payload: Record<string, unknown>, human: () => void): void => {
    if (opts.json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    else human();
  };

  const title = (opts.title ?? '').trim();
  const rawBody = opts.body ?? '';
  if (isPlaceholder(title) || title.length < 8) {
    emit({ ok: false, error: 'a real --title (at least 8 characters) is required' },
      () => process.stderr.write('cdd-kit report: a real --title (at least 8 characters) is required\n'));
    return 2;
  }
  if (isPlaceholder(rawBody) || rawBody.trim().length < 15) {
    emit({ ok: false, error: 'a real --body (at least 15 characters) describing the problem is required' },
      () => process.stderr.write('cdd-kit report: a real --body (at least 15 characters) describing the problem is required\n'));
    return 2;
  }

  const category = REPORT_CATEGORIES.includes((opts.category ?? '') as typeof REPORT_CATEGORIES[number])
    ? (opts.category as string)
    : 'bug';
  const draft: ReportDraft = {
    repo: resolveRepo(opts.repo),
    title,
    body: composeBody(rawBody, category, opts),
    labels: (opts.label ?? []).map(label => label.trim()).filter(Boolean),
    category,
  };

  if (!opts.confirm) {
    emit({ posted: false, draft }, () => {
      process.stdout.write(`Draft issue for ${draft.repo} (not filed):\n\n`);
      process.stdout.write(`Title: ${draft.title}\n`);
      if (draft.labels.length) process.stdout.write(`Labels: ${draft.labels.join(', ')}\n`);
      process.stdout.write(`\n${draft.body}\n\n`);
      process.stdout.write('This is a DRAFT only. After the maintainer approves it, re-run with --confirm to file it.\n');
    });
    return 0;
  }

  const result = postIssue(draft);
  if (result.ok) {
    emit({ posted: true, repo: draft.repo, url: result.url, number: result.number },
      () => process.stdout.write(`Filed: ${result.url ?? `#${result.number ?? '?'} on ${draft.repo}`}\n`));
    return 0;
  }
  emit({ posted: false, error: result.error, draft }, () => {
    process.stderr.write(`cdd-kit report: could not file the issue: ${result.error}\n`);
    process.stderr.write('The drafted issue is preserved below so nothing is lost:\n\n');
    process.stderr.write(`Title: ${draft.title}\n\n${draft.body}\n`);
  });
  return 1;
}

export { REPORT_CATEGORIES };
