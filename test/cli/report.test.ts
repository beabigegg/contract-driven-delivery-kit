import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

// The report command NEVER hits the network in these tests: only the dry-run
// (default, no --confirm) and input-validation paths are exercised. The
// --confirm POST path is intentionally not tested here since it would attempt a
// real GitHub request.

let repo: string;
let home: string;

beforeEach(() => {
  repo = makeTempDir('cdd-report-');
  home = makeTempDir('cdd-report-home-');
});

afterEach(() => { cleanupDir(repo); cleanupDir(home); });

describe('cdd-kit report', () => {
  it('drafts (does not file) by default and enriches the body with environment context', () => {
    const result = runCli([
      'report', '--title', 'gate crashes on empty manifest', '--body',
      'Running cdd-kit gate with an empty boundary manifest throws instead of a finding.', '--json',
    ], { cwd: repo, home });
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.posted).toBe(false);
    expect(payload.draft.repo).toBe('beabigegg/contract-driven-delivery-kit');
    expect(payload.draft.title).toBe('gate crashes on empty manifest');
    expect(payload.draft.body).toContain('### Environment');
    expect(payload.draft.body).toContain('cdd-kit:');
    expect(payload.draft.category).toBe('bug');
  });

  it('honors an explicit --repo target and --category', () => {
    const result = runCli([
      'report', '--title', 'docs link is broken', '--body', 'The api-conformance doc link 404s.',
      '--repo', 'acme/widgets', '--category', 'docs', '--json',
    ], { cwd: repo, home });
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.draft.repo).toBe('acme/widgets');
    expect(payload.draft.category).toBe('docs');
  });

  it('rejects a missing or placeholder title', () => {
    const missing = runCli(['report', '--body', 'a real body describing the issue', '--json'], { cwd: repo, home });
    expect(missing.status).toBe(2);
    const placeholder = runCli(['report', '--title', '<title>', '--body', 'a real body describing the issue', '--json'], { cwd: repo, home });
    expect(placeholder.status).toBe(2);
  });

  it('rejects a missing body so an empty issue is never filed', () => {
    const result = runCli(['report', '--title', 'a real enough title', '--json'], { cwd: repo, home });
    expect(result.status).toBe(2);
  });
});
