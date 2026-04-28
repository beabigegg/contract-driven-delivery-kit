import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
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

    // Old-format tasks.md — no frontmatter, no legend
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

  // ── tests ──────────────────────────────────────────────────────────────────

  it('1: migrate on nonexistent change exits 1 and reports change not found', () => {
    const r = runCli(['migrate', 'no-such-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/not found/i);
  });

  it('2: migrate adds YAML frontmatter to tasks.md when missing', () => {
    makeOldChange('old-001');
    const r = runCli(['migrate', 'old-001'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);

    const tasks = readFileSync(join(tmpRepo, 'specs', 'changes', 'old-001', 'tasks.md'), 'utf8');
    expect(tasks).toMatch(/^---/);
    expect(tasks).toMatch(/change-id: old-001/);
    expect(tasks).toMatch(/status: in-progress/);
    expect(tasks).not.toMatch(/^context-governance:\s*v1\b/m);
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'old-001', 'context-manifest.md'))).toBe(true);
  });

  it('3: migrate adds legend comment to tasks.md when missing', () => {
    makeOldChange('old-002');
    runCli(['migrate', 'old-002'], { cwd: tmpRepo, home: tmpHome });

    const tasks = readFileSync(join(tmpRepo, 'specs', 'changes', 'old-002', 'tasks.md'), 'utf8');
    expect(tasks).toMatch(/\[x\]=done \[-\]=N\/A \[ \]=pending/);
  });

  it('4: migrate preserves existing task content', () => {
    makeOldChange('old-003');
    runCli(['migrate', 'old-003'], { cwd: tmpRepo, home: tmpHome });

    const tasks = readFileSync(join(tmpRepo, 'specs', 'changes', 'old-003', 'tasks.md'), 'utf8');
    expect(tasks).toMatch(/1\.1 Confirm classification/);
    expect(tasks).toMatch(/\[x\] 4\.1 Backend/);
  });

  it('5: migrate converts old **Tier:** format to ## Tier\\n- N in classification', () => {
    makeOldChange('old-004', '**Tier:** Tier 2');
    runCli(['migrate', 'old-004'], { cwd: tmpRepo, home: tmpHome });

    const classif = readFileSync(join(tmpRepo, 'specs', 'changes', 'old-004', 'change-classification.md'), 'utf8');
    expect(classif).toMatch(/^## Tier\s*\n\s*-\s*2/m);
  });

  it('6: migrate on already-migrated change reports "already up to date" and does not modify files', () => {
    // Create a change that already has frontmatter + legend + new tier format
    const changeDir = join(tmpRepo, 'specs', 'changes', 'new-001');
    mkdirSync(changeDir, { recursive: true });

    const originalTasks = [
      '---',
      'change-id: new-001',
      'status: in-progress',
      '---',
      '',
      '<!-- [x]=done [-]=N/A [ ]=pending -->',
      '',
      '# Tasks: new-001',
      '- [x] 1.1 Done',
    ].join('\n');

    const originalClassif = [
      '# Change Classification',
      '',
      '**Risk Level:** medium',
      '',
      '## Tier',
      '- 2',
    ].join('\n');

    writeFileSync(join(changeDir, 'tasks.md'), originalTasks, 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'), originalClassif, 'utf8');
    writeFileSync(join(changeDir, 'context-manifest.md'), '# Context Manifest\n\n## Allowed Paths\n- specs/changes/new-001/\n', 'utf8');

    const r = runCli(['migrate', 'new-001'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/already up to date/i);

    // Files must be unchanged
    expect(readFileSync(join(changeDir, 'tasks.md'), 'utf8')).toBe(originalTasks);
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

    // File must be unchanged
    const afterTasks = readFileSync(
      join(tmpRepo, 'specs', 'changes', 'old-005', 'tasks.md'), 'utf8'
    );
    expect(afterTasks).toBe(originalTasks);
  });

  it('9: migrate preserves gate-blocked status from bare body line and removes the duplicate', () => {
    // Simulate a pre-v1.10 tasks.md with a bare "status: gate-blocked" line (no frontmatter)
    const changeDir = join(tmpRepo, 'specs', 'changes', 'old-008');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.md'), [
      'status: gate-blocked',
      '',
      '# Tasks: old-008',
      '- [x] 1.1 Done',
      '- [ ] 1.2 Pending',
    ].join('\n'), 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'), '# Classification\n**Risk Level:** medium\n', 'utf8');

    runCli(['migrate', 'old-008'], { cwd: tmpRepo, home: tmpHome });

    const tasks = readFileSync(join(changeDir, 'tasks.md'), 'utf8');
    // Frontmatter must have the correct status
    expect(tasks).toMatch(/^---\nchange-id: old-008\nstatus: gate-blocked\n---/);
    // Body must NOT have a duplicate bare status line
    const bodyAfterFrontmatter = tasks.replace(/^---[\s\S]*?---\n/, '');
    expect(bodyAfterFrontmatter).not.toMatch(/^status:/m);
  });

  it('10: list shows "abandoned" status after cdd-kit abandon', () => {
    makeOldChange('old-009');
    // First migrate to new format (needed for abandon to work cleanly)
    runCli(['migrate', 'old-009'], { cwd: tmpRepo, home: tmpHome });
    // Then abandon the change
    runCli(['abandon', 'old-009', '--reason', 'no longer needed'], { cwd: tmpRepo, home: tmpHome });
    // List should show abandoned
    const r = runCli(['list'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/old-009.*abandoned|abandoned.*old-009/i);
  });

  it('8: migrate --all migrates every change in specs/changes/', () => {
    makeOldChange('old-006');
    makeOldChange('old-007');

    const r = runCli(['migrate', '--all'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);

    for (const id of ['old-006', 'old-007']) {
      const tasks = readFileSync(join(tmpRepo, 'specs', 'changes', id, 'tasks.md'), 'utf8');
      expect(tasks).toMatch(/^---/);
      expect(tasks).toMatch(/status: in-progress/);
    }
  });

  it('11: migrate --enable-context-governance opts a legacy change into context-governance v1', () => {
    makeOldChange('old-010');

    const r = runCli(['migrate', 'old-010', '--enable-context-governance'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const changeDir = join(tmpRepo, 'specs', 'changes', 'old-010');
    const tasks = readFileSync(join(changeDir, 'tasks.md'), 'utf8');
    const manifest = readFileSync(join(changeDir, 'context-manifest.md'), 'utf8');

    expect(tasks).toMatch(/^context-governance:\s*v1\b/m);
    expect(manifest).toMatch(/Generated by `cdd-kit migrate --enable-context-governance`/);
    expect(manifest).toMatch(/specs\/context\/project-map\.md/);
    expect(manifest).toMatch(/specs\/context\/contracts-index\.md/);
  });
});
