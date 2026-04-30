import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

describe('cdd-kit migrate', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-migrate-repo-');
    tmpHome = makeTempDir('cdd-migrate-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) throw new Error(`Setup init failed: ${r.stderr}`);
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function makeOldChange(id: string, tierLine = '**Tier:** Tier 2'): string {
    const changeDir = join(tmpRepo, 'specs', 'changes', id);
    mkdirSync(changeDir, { recursive: true });

    // Old-format tasks.md — markdown checklist
    writeFileSync(join(changeDir, 'tasks.md'), [
      `# Tasks: ${id}`,
      '',
      '## 1. Preparation',
      '- [x] 1.1 Confirm classification',
      '- [ ] 1.2 Confirm contracts',
      '',
      '## 4. Implementation',
      '- [x] 4.1 Backend',
    ].join('\n'), 'utf8');

    // Old-format classification — uses **Tier:** N, not ## Tier\n- N
    writeFileSync(join(changeDir, 'change-classification.md'), [
      '# Change Classification',
      '',
      `${tierLine}`,
      '**Risk Level:** medium',
      '',
      'This change modifies the API layer.',
    ].join('\n'), 'utf8');

    return changeDir;
  }

  function loadTasksYaml(changeDir: string): Record<string, unknown> {
    const raw = readFileSync(join(changeDir, 'tasks.yml'), 'utf8');
    return yaml.load(raw) as Record<string, unknown>;
  }

  // ── tests ──────────────────────────────────────────────────────────────────

  it('1: migrate on nonexistent change exits 1 and reports change not found', () => {
    const r = runCli(['migrate', 'no-such-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/not found/i);
  });

  it('2: migrate converts tasks.md to tasks.yml with structured fields', () => {
    makeOldChange('old-001');
    const r = runCli(['migrate', 'old-001'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);

    const changeDir = join(tmpRepo, 'specs', 'changes', 'old-001');
    expect(existsSync(join(changeDir, 'tasks.yml'))).toBe(true);
    expect(existsSync(join(changeDir, 'tasks.md'))).toBe(false);

    const data = loadTasksYaml(changeDir);
    expect(data['change-id']).toBe('old-001');
    expect(data['status']).toBe('in-progress');
    expect(data['context-governance']).toBeUndefined();
    expect(existsSync(join(changeDir, 'context-manifest.md'))).toBe(true);
  });

  it('3: migrate populates archive-tasks default in tasks.yml', () => {
    makeOldChange('old-002');
    runCli(['migrate', 'old-002'], { cwd: tmpRepo, home: tmpHome });

    const data = loadTasksYaml(join(tmpRepo, 'specs', 'changes', 'old-002'));
    expect(data['archive-tasks']).toEqual(['7.1', '7.2']);
  });

  it('4: migrate preserves task IDs, titles, and statuses from markdown checklist', () => {
    makeOldChange('old-003');
    runCli(['migrate', 'old-003'], { cwd: tmpRepo, home: tmpHome });

    const data = loadTasksYaml(join(tmpRepo, 'specs', 'changes', 'old-003'));
    const tasks = data['tasks'] as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(tasks.map(t => [t['id'], t]));
    expect(byId['1.1']['title']).toBe('Confirm classification');
    expect(byId['1.1']['status']).toBe('done');
    expect(byId['1.2']['status']).toBe('pending');
    expect(byId['4.1']['title']).toBe('Backend');
    expect(byId['4.1']['status']).toBe('done');
  });

  it('5: migrate converts old **Tier:** format to ## Tier\\n- N in classification', () => {
    makeOldChange('old-004', '**Tier:** Tier 2');
    runCli(['migrate', 'old-004'], { cwd: tmpRepo, home: tmpHome });

    const classif = readFileSync(join(tmpRepo, 'specs', 'changes', 'old-004', 'change-classification.md'), 'utf8');
    expect(classif).toMatch(/^## Tier\s*\n\s*-\s*2/m);
  });

  it('6: migrate on already-migrated change reports "already up to date" and does not modify files', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'new-001');
    mkdirSync(changeDir, { recursive: true });

    const originalTasks = yaml.dump({
      'change-id': 'new-001',
      status: 'in-progress',
      tier: 2,
      'archive-tasks': ['7.1', '7.2'],
      'depends-on': [],
      tasks: [{ id: '1.1', title: 'Done', status: 'done' }],
    }, { lineWidth: -1 });

    const originalClassif = [
      '# Change Classification',
      '',
      '**Risk Level:** medium',
      '',
      '## Tier',
      '- 2',
    ].join('\n');

    writeFileSync(join(changeDir, 'tasks.yml'), originalTasks, 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'), originalClassif, 'utf8');
    writeFileSync(join(changeDir, 'context-manifest.md'), '# Context Manifest\n\n## Allowed Paths\n- specs/changes/new-001/\n', 'utf8');

    const r = runCli(['migrate', 'new-001'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/already up to date/i);

    expect(readFileSync(join(changeDir, 'tasks.yml'), 'utf8')).toBe(originalTasks);
    expect(readFileSync(join(changeDir, 'change-classification.md'), 'utf8')).toBe(originalClassif);
  });

  it('7: migrate --dry-run reports changes but does NOT write files', () => {
    makeOldChange('old-005');
    const originalTasks = readFileSync(
      join(tmpRepo, 'specs', 'changes', 'old-005', 'tasks.md'), 'utf8'
    );

    const r = runCli(['migrate', 'old-005', '--dry-run'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/dry run/i);

    // Original markdown file must still be there with same content
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'old-005', 'tasks.md'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'old-005', 'tasks.yml'))).toBe(false);
    const afterTasks = readFileSync(
      join(tmpRepo, 'specs', 'changes', 'old-005', 'tasks.md'), 'utf8'
    );
    expect(afterTasks).toBe(originalTasks);
  });

  it('10: list shows "abandoned" status after cdd-kit abandon', () => {
    makeOldChange('old-009');
    runCli(['migrate', 'old-009'], { cwd: tmpRepo, home: tmpHome });
    runCli(['abandon', 'old-009', '--reason', 'no longer needed'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['list'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/old-009.*abandoned|abandoned.*old-009/i);
  });

  it('8: migrate --all migrates every change in specs/changes/', () => {
    makeOldChange('old-006');
    makeOldChange('old-007');

    const r = runCli(['migrate', '--all'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);

    for (const id of ['old-006', 'old-007']) {
      const data = loadTasksYaml(join(tmpRepo, 'specs', 'changes', id));
      expect(data['change-id']).toBe(id);
      expect(data['status']).toBe('in-progress');
    }
  });

  it('B4.1: migrate creates a backup at .cdd/migrate-backup/<stamp>/<change-id>/', () => {
    makeOldChange('old-backup');
    runCli(['migrate', 'old-backup'], { cwd: tmpRepo, home: tmpHome });

    const backupRoot = join(tmpRepo, '.cdd', 'migrate-backup');
    expect(existsSync(backupRoot)).toBe(true);
    const stamps = readdirSync(backupRoot);
    expect(stamps.length).toBeGreaterThan(0);
    const backupChangeDir = join(backupRoot, stamps[0], 'old-backup');
    expect(existsSync(backupChangeDir)).toBe(true);
    expect(existsSync(join(backupChangeDir, 'tasks.md'))).toBe(true);
  });

  it('B4.2: migrate --no-backup skips backup directory creation', () => {
    makeOldChange('old-no-backup');
    runCli(['migrate', 'old-no-backup', '--no-backup'], { cwd: tmpRepo, home: tmpHome });

    const backupRoot = join(tmpRepo, '.cdd', 'migrate-backup');
    expect(existsSync(backupRoot)).toBe(false);
  });

  it('B1.5: migrate backfills tier into tasks.yml when classification has structured Tier', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'old-backfill-tier');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Pending\n', 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'),
      '# Change Classification\n\n## Tier\n- 1\n', 'utf8');

    runCli(['migrate', 'old-backfill-tier'], { cwd: tmpRepo, home: tmpHome });
    const data = loadTasksYaml(changeDir);
    expect(data['tier']).toBe(1);
    expect(data['archive-tasks']).toEqual(['7.1', '7.2']);
  });

  it('B1.6: migrate backfills tier from legacy bold **Tier:** Tier N format', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'old-bold-tier');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Pending\n', 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'),
      '# Change Classification\n\n**Tier:** Tier 3\n', 'utf8');

    runCli(['migrate', 'old-bold-tier'], { cwd: tmpRepo, home: tmpHome });
    const data = loadTasksYaml(changeDir);
    expect(data['tier']).toBe(3);
  });

  it('11: migrate --enable-context-governance opts a legacy change into context-governance v1', () => {
    makeOldChange('old-010');

    const r = runCli(['migrate', 'old-010', '--enable-context-governance'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const changeDir = join(tmpRepo, 'specs', 'changes', 'old-010');
    const data = loadTasksYaml(changeDir);
    const manifest = readFileSync(join(changeDir, 'context-manifest.md'), 'utf8');

    expect(data['context-governance']).toBe('v1');
    expect(manifest).toMatch(/Generated by `cdd-kit migrate --enable-context-governance`/);
    expect(manifest).toMatch(/specs\/context\/project-map\.md/);
    expect(manifest).toMatch(/specs\/context\/contracts-index\.md/);
  });

  it('12: migrate converts agent-log/*.md to agent-log/*.yml', () => {
    const changeDir = makeOldChange('old-agentlog');
    const agentLogDir = join(changeDir, 'agent-log');
    mkdirSync(agentLogDir, { recursive: true });
    writeFileSync(join(agentLogDir, 'backend-engineer.md'), [
      '# Backend Engineer Log',
      '- change-id: old-agentlog',
      '- agent: backend-engineer',
      '- timestamp: 2026-04-27T14:30:00Z',
      '- status: complete',
      '- files-read:',
      '  - src/api/users.ts',
      '- artifacts:',
      '  - files-changed: src/api/users.ts:10-45',
      '  - tests-added: test/users.test.ts::should create user',
      '- next-action: none',
    ].join('\n'), 'utf8');

    runCli(['migrate', 'old-agentlog'], { cwd: tmpRepo, home: tmpHome });

    expect(existsSync(join(agentLogDir, 'backend-engineer.yml'))).toBe(true);
    expect(existsSync(join(agentLogDir, 'backend-engineer.md'))).toBe(false);

    const yamlRaw = readFileSync(join(agentLogDir, 'backend-engineer.yml'), 'utf8');
    const data = yaml.load(yamlRaw) as Record<string, unknown>;
    expect(data['change-id']).toBe('old-agentlog');
    expect(data['status']).toBe('complete');
    expect(data['files-read']).toEqual(['src/api/users.ts']);
    const artifacts = data['artifacts'] as Array<Record<string, unknown>>;
    expect(artifacts.find(a => a['type'] === 'files-changed')?.['pointer']).toBe('src/api/users.ts:10-45');
  });
});
