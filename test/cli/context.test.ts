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
});
