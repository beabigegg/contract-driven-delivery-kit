import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

describe('cdd-kit context-scan', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-context-scan-repo-');
    tmpHome = makeTempDir('cdd-context-scan-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error(`Setup init failed: ${r.stderr}`);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('writes project-map.md with schema metadata and excludes forbidden directories', () => {
    mkdirSync(join(tmpRepo, '.git', 'objects'), { recursive: true });
    mkdirSync(join(tmpRepo, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(tmpRepo, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(tmpRepo, 'src', 'server'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src', 'server', 'users.ts'), 'export const users = [];\n', 'utf8');

    const r = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const projectMapPath = join(tmpRepo, 'specs', 'context', 'project-map.md');
    expect(existsSync(projectMapPath)).toBe(true);
    const projectMap = readFileSync(projectMapPath, 'utf8');

    expect(projectMap).toMatch(/^artifact: project-map$/m);
    expect(projectMap).toMatch(/^schema-version: 1$/m);
    expect(projectMap).toMatch(/## Excluded Paths/);
    expect(projectMap).toContain('- .git');
    expect(projectMap).toContain('- .claude');
    expect(projectMap).toContain('|-- src/');
    expect(projectMap).toContain('users.ts');
    expect(projectMap).not.toContain('node_modules/');
    expect(projectMap).not.toContain('├');
    expect(projectMap).not.toContain('└');
  });

  it('writes contracts-index.md with inventory rows and summary warnings', () => {
    mkdirSync(join(tmpRepo, 'contracts', 'payments'), { recursive: true });
    writeFileSync(join(tmpRepo, 'contracts', 'payments', 'payments-contract.md'), [
      '---',
      'contract: payments',
      'summary: Payment authorization and capture rules.',
      'owner: platform-team',
      'surface: billing',
      '---',
      '',
      '# Payments Contract',
      '',
      'Rules for payment workflows.',
    ].join('\n'), 'utf8');

    mkdirSync(join(tmpRepo, 'contracts', 'legacy'), { recursive: true });
    writeFileSync(join(tmpRepo, 'contracts', 'legacy', 'legacy-contract.md'), [
      '# Legacy Contract',
      '',
      'This intentionally has no deterministic summary metadata.',
    ].join('\n'), 'utf8');

    const r = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing summary warning/i);

    const indexPath = join(tmpRepo, 'specs', 'context', 'contracts-index.md');
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, 'utf8');

    expect(index).toMatch(/^artifact: contracts-index$/m);
    expect(index).toMatch(/^schema-version: 1$/m);
    expect(index).toMatch(/^missing-summary-count: [1-9]/m);
    expect(index).toContain('| contracts/payments/payments-contract.md | payments | billing | platform-team | yes |');
    expect(index).toContain('- title: Payments Contract');
    expect(index).toContain('- summary: Payment authorization and capture rules.');
    expect(index).toContain('contracts/legacy/legacy-contract.md');
    expect(index).toContain('summary: MISSING');
  });

  it('excludes .cdd/.refresh-backup, .cdd/migrate-backup, .cdd/runtime from project-map', () => {
    // Plant local kit-generated backup dirs that must NOT pollute the project map.
    // (This is the 2.0.9 bug fix: previously these paths were not in DEFAULT_FORBIDDEN
    // so user's local backups landed in specs/context/project-map.md and broke the
    // inputs-digest match for any fresh clone.)
    const refreshBackup = join(tmpRepo, '.cdd', '.refresh-backup', '2026-05-04T00-00-00-000Z', 'specs');
    const migrateBackup = join(tmpRepo, '.cdd', 'migrate-backup', '2026-05-04T00-00-00-000Z', 'feat-x');
    const runtime = join(tmpRepo, '.cdd', 'runtime');
    mkdirSync(refreshBackup, { recursive: true });
    mkdirSync(migrateBackup, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(refreshBackup, 'change-classification.md'), '# old\n', 'utf8');
    writeFileSync(join(migrateBackup, 'tasks.md'), '# old tasks\n', 'utf8');
    writeFileSync(join(runtime, 'feat-x-files-read.jsonl'), '{}\n', 'utf8');

    const r = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const map = readFileSync(join(tmpRepo, 'specs', 'context', 'project-map.md'), 'utf8');
    // The `## Excluded Paths` documentation section legitimately mentions these
    // names. We only care that they don't appear in the actual file tree.
    const treeMatch = map.match(/## Tree\s*\n+```\n([\s\S]*?)\n```/);
    expect(treeMatch, 'tree section must exist').toBeTruthy();
    const tree = treeMatch![1];
    expect(tree).not.toMatch(/refresh-backup/);
    expect(tree).not.toMatch(/migrate-backup/);
    expect(tree).not.toMatch(/\.cdd\/runtime/);
  });
});
