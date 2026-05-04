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

  it('excludes nested build outputs (dist/, build/, out/) at any depth', () => {
    // Plant nested build outputs that are gitignored locally but exist on user's
    // filesystem. Without basename matching, only top-level dist/ is excluded.
    mkdirSync(join(tmpRepo, 'frontend', 'dist', 'assets'), { recursive: true });
    writeFileSync(join(tmpRepo, 'frontend', 'dist', 'assets', 'index.js'), '// build output\n', 'utf8');
    mkdirSync(join(tmpRepo, 'apps', 'web', 'build'), { recursive: true });
    writeFileSync(join(tmpRepo, 'apps', 'web', 'build', 'main.js'), '// build\n', 'utf8');
    mkdirSync(join(tmpRepo, 'packages', 'lib', 'out'), { recursive: true });
    writeFileSync(join(tmpRepo, 'packages', 'lib', 'out', 'lib.js'), '// out\n', 'utf8');
    // Real source must survive
    mkdirSync(join(tmpRepo, 'apps', 'web', 'src'), { recursive: true });
    writeFileSync(join(tmpRepo, 'apps', 'web', 'src', 'app.ts'), '// real source\n', 'utf8');

    const r = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const map = readFileSync(join(tmpRepo, 'specs', 'context', 'project-map.md'), 'utf8');
    const treeMatch = map.match(/## Tree\s*\n+```\n([\s\S]*?)\n```/);
    const tree = treeMatch![1];
    expect(tree).not.toMatch(/frontend\/dist/);
    expect(tree).not.toMatch(/apps\/web\/build/);
    expect(tree).not.toMatch(/packages\/lib\/out/);
    expect(tree).toMatch(/app\.ts/);
  });

  it('inputs-digest is portable across clones (depends only on repo-relative path + content)', () => {
    // Two repos with IDENTICAL `.cdd/context-policy.json` content but different
    // absolute cwd should produce the SAME inputs-digest.
    const tmpRepo2 = makeTempDir('cdd-context-scan-portable-');
    try {
      const r2 = runCli(['init', '--local-only'], { cwd: tmpRepo2, home: tmpHome });
      if (r2.status !== 0) throw new Error(`second init failed: ${r2.stderr}`);

      // Force both context-policy.json files to identical content
      const policy = JSON.stringify({
        forbiddenPaths: ['.git/**'],
        contextExpansion: { mode: 'auto-safe', autoApprovePatterns: [] },
        audit: { requireFilesRead: true, unknownFilesRead: 'warn' },
      }, null, 2);
      writeFileSync(join(tmpRepo, '.cdd', 'context-policy.json'), policy, 'utf8');
      writeFileSync(join(tmpRepo2, '.cdd', 'context-policy.json'), policy, 'utf8');

      runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
      runCli(['context-scan'], { cwd: tmpRepo2, home: tmpHome });

      const map1 = readFileSync(join(tmpRepo, 'specs', 'context', 'project-map.md'), 'utf8');
      const map2 = readFileSync(join(tmpRepo2, 'specs', 'context', 'project-map.md'), 'utf8');
      const d1 = map1.match(/^inputs-digest:\s*([a-f0-9]+)/m)![1];
      const d2 = map2.match(/^inputs-digest:\s*([a-f0-9]+)/m)![1];
      expect(d1).toBe(d2);
    } finally {
      cleanupDir(tmpRepo2);
    }
  });

  it('excludes Python/JS transient cache dirs at any depth (__pycache__, .pytest_cache, etc.)', () => {
    // Plant nested kit-irrelevant cache dirs that the user's filesystem
    // produces locally. They are gitignored so they exist on the user's
    // machine but not in any clone — leaving them in project-map breaks
    // inputs-digest determinism.
    mkdirSync(join(tmpRepo, '.pytest_cache', 'v', 'cache'), { recursive: true });
    writeFileSync(join(tmpRepo, '.pytest_cache', 'v', 'cache', 'lastfailed'), '{}\n', 'utf8');
    mkdirSync(join(tmpRepo, 'backend', '__pycache__'), { recursive: true });
    writeFileSync(join(tmpRepo, 'backend', '__pycache__', 'app.cpython-311.pyc'), 'compiled', 'utf8');
    mkdirSync(join(tmpRepo, 'backend', 'core', '__pycache__'), { recursive: true });
    writeFileSync(join(tmpRepo, 'backend', 'core', '__pycache__', 'csrf.cpython-311.pyc'), 'compiled', 'utf8');
    mkdirSync(join(tmpRepo, 'frontend', 'node_modules'), { recursive: true });  // also nested
    mkdirSync(join(tmpRepo, '.venv', 'bin'), { recursive: true });
    mkdirSync(join(tmpRepo, '.idea'), { recursive: true });
    // Plant a real source file too so the tree isn't empty
    mkdirSync(join(tmpRepo, 'backend', 'routes'), { recursive: true });
    writeFileSync(join(tmpRepo, 'backend', 'routes', 'todos.py'), '# todos\n', 'utf8');

    const r = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const map = readFileSync(join(tmpRepo, 'specs', 'context', 'project-map.md'), 'utf8');
    const treeMatch = map.match(/## Tree\s*\n+```\n([\s\S]*?)\n```/);
    expect(treeMatch, 'tree section must exist').toBeTruthy();
    const tree = treeMatch![1];
    expect(tree).not.toMatch(/__pycache__/);
    expect(tree).not.toMatch(/\.pytest_cache/);
    expect(tree).not.toMatch(/\.venv/);
    expect(tree).not.toMatch(/\.idea/);
    expect(tree).not.toMatch(/node_modules/);
    // Real source file should still be present
    expect(tree).toMatch(/todos\.py/);
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
