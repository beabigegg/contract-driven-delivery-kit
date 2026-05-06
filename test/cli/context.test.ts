import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

describe('cdd-kit context', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-context-repo-');
    tmpHome = makeTempDir('cdd-context-home-');
    mkdirSync(join(tmpRepo, 'specs', 'changes', 'feat-context'), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('approves pending context expansion requests', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Allowed Paths',
      '- specs/changes/feat-context/',
      '',
      '## Context Expansion Requests',
      '- request-id: CER-001',
      '  requested_paths:',
      '    - src/server/users.ts',
      '    - tests/users.test.ts',
      '  reason: implementation requires paired source and tests',
      '  status: pending',
      '',
      '## Approved Expansions',
      '- src/existing.ts',
      '',
    ].join('\n'), 'utf8');

    const r = runCli(['context', 'approve', 'feat-context', 'CER-001'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toMatch(/status:\s*approved/i);
    expect(manifest).toContain('- src/existing.ts');
    expect(manifest).toContain('- src/server/users.ts');
    expect(manifest).toContain('- tests/users.test.ts');
  });

  it('fails when request id is not pending', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '- request-id: CER-002',
      '  requested_paths:',
      '    - src/server/users.ts',
      '  status: approved',
    ].join('\n'), 'utf8');

    const r = runCli(['context', 'approve', 'feat-context', 'CER-002'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/pending context expansion request not found/i);
  });

  it('rejects absolute or parent-traversal requested paths', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '- request-id: CER-003',
      '  requested_paths:',
      '    - ../outside.ts',
      '  status: pending',
    ].join('\n'), 'utf8');

    const r = runCli(['context', 'approve', 'feat-context', 'CER-003'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/must not contain "\.\."/i);
  });

  it('records and lists new pending context expansion requests', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '-',
      '',
      '## Approved Expansions',
      '-',
      '',
    ].join('\n'), 'utf8');

    const request = runCli([
      'context', 'request', 'feat-context', 'CER-010',
      '--path', 'src/server/users.ts', 'tests/users.test.ts',
      '--reason', 'paired implementation and regression coverage',
    ], { cwd: tmpRepo, home: tmpHome });
    expect(request.status, request.stderr).toBe(0);

    const list = runCli(['context', 'list', 'feat-context', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(list.status, list.stderr).toBe(0);
    const payload = JSON.parse(list.stdout);
    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0].requestId).toBe('CER-010');
    expect(payload.requests[0].status).toBe('pending');
  });

  it('B7.1: --all-pending approves every pending request in one command', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '- request-id: CER-A',
      '  requested_paths:',
      '    - src/a.ts',
      '  status: pending',
      '- request-id: CER-B',
      '  requested_paths:',
      '    - src/b.ts',
      '  status: pending',
      '- request-id: CER-C',
      '  requested_paths:',
      '    - src/c.ts',
      '  status: approved',
      '',
      '## Approved Expansions',
      '-',
      '',
    ].join('\n'), 'utf8');

    const r = runCli(['context', 'approve', 'feat-context', '--all-pending'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/approved 2 pending/i);

    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('- src/a.ts');
    expect(manifest).toContain('- src/b.ts');
    // The previously-approved CER-C should NOT be in Approved Expansions (it was already approved with no path movement here)
  });

  it('B7.2: --all-pending rejects every pending request in one command', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '- request-id: CER-X',
      '  requested_paths:',
      '    - src/x.ts',
      '  status: pending',
      '- request-id: CER-Y',
      '  requested_paths:',
      '    - src/y.ts',
      '  status: pending',
      '',
    ].join('\n'), 'utf8');

    const r = runCli(['context', 'reject', 'feat-context', '--all-pending'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/rejected 2 pending/i);

    const list = runCli(['context', 'list', 'feat-context', '--json'], { cwd: tmpRepo, home: tmpHome });
    const payload = JSON.parse(list.stdout);
    expect(payload.requests.every((r: { status: string }) => r.status === 'rejected')).toBe(true);
  });

  it('B7.3: --all-pending with no pending requests reports info, exit 0', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '-',
      '',
    ].join('\n'), 'utf8');

    const r = runCli(['context', 'approve', 'feat-context', '--all-pending'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no pending context expansion requests/i);
  });

  it('B7.4: --all-pending with explicit request-id is rejected', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, '# Context Manifest\n\n## Context Expansion Requests\n-\n', 'utf8');

    const r = runCli(['context', 'approve', 'feat-context', 'CER-Z', '--all-pending'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/cannot be combined with a request-id/i);
  });

  it('can reject pending requests without approving paths', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Context Expansion Requests',
      '- request-id: CER-011',
      '  requested_paths:',
      '    - src/secret.ts',
      '  reason: not actually needed',
      '  status: pending',
      '',
      '## Approved Expansions',
      '-',
      '',
    ].join('\n'), 'utf8');

    const reject = runCli(['context', 'reject', 'feat-context', 'CER-011'], { cwd: tmpRepo, home: tmpHome });
    expect(reject.status, reject.stderr).toBe(0);

    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toMatch(/status:\s*rejected/i);
    const approvedSection = manifest.match(/## Approved Expansions\s*\n([\s\S]*?)$/);
    expect(approvedSection?.[1] ?? '').not.toContain('src/secret.ts');
  });

  it('preflight-checks paths against Allowed Paths and Approved Expansions', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Allowed Paths',
      '- specs/changes/feat-context/',
      '- src/components/**',
      '',
      '## Approved Expansions',
      '- tests/monkey/',
      '',
    ].join('\n'), 'utf8');

    const r = runCli([
      'context', 'check', 'feat-context',
      '--path',
      'src/components/Sidebar.vue',
      'tests/monkey/test_creator_only_fuzz.py',
    ], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/authorized: src\/components\/Sidebar\.vue/i);
    expect(r.stdout + r.stderr).toMatch(/authorized: tests\/monkey\/test_creator_only_fuzz\.py/i);
  });

  it('preflight check fails with manifest expansion guidance for unauthorized paths', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Allowed Paths',
      '- specs/changes/feat-context/',
      '- src/components/Sidebar.vue',
      '',
      '## Approved Expansions',
      '-',
      '',
    ].join('\n'), 'utf8');

    const r = runCli([
      'context', 'check', 'feat-context',
      '--path',
      'src/stores/todos.js',
      'src/views/DashboardView.vue',
    ], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/unauthorized: src\/stores\/todos\.js/i);
    expect(r.stdout + r.stderr).toMatch(/not in context-manifest Allowed Paths or Approved Expansions/i);
    expect(r.stdout + r.stderr).toMatch(/cdd-kit context request feat-context CER-<id> --path src\/stores\/todos\.js src\/views\/DashboardView\.vue/i);
  });

  it('preflight check rejects forbidden and non-repo-relative paths before agent work', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Allowed Paths',
      '- node_modules/pkg/index.js',
      '- src/',
      '',
    ].join('\n'), 'utf8');

    const forbidden = runCli([
      'context', 'check', 'feat-context',
      '--path', 'node_modules/pkg/index.js',
    ], { cwd: tmpRepo, home: tmpHome });
    expect(forbidden.status).not.toBe(0);
    expect(forbidden.stdout + forbidden.stderr).toMatch(/forbidden by .*context-policy/i);

    const absolute = runCli([
      'context', 'check', 'feat-context',
      '--path', 'C:/repo/src/file.ts',
    ], { cwd: tmpRepo, home: tmpHome });
    expect(absolute.status).not.toBe(0);
    expect(absolute.stdout + absolute.stderr).toMatch(/must be repo-relative/i);
  });

  it('preflight check can emit machine-readable json', () => {
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'feat-context', 'context-manifest.md');
    writeFileSync(manifestPath, [
      '# Context Manifest',
      '',
      '## Allowed Paths',
      '- src/**',
      '',
    ].join('\n'), 'utf8');

    const r = runCli([
      'context', 'check', 'feat-context',
      '--path', 'src/index.ts',
      '--json',
    ], { cwd: tmpRepo, home: tmpHome });

    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.changeId).toBe('feat-context');
    expect(payload.results[0]).toEqual({
      path: 'src/index.ts',
      authorized: true,
      reason: 'authorized',
    });
  });
});
