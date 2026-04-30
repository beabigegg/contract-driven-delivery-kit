import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { tmpdir } from 'os';

describe('cdd-kit update', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-update-repo-');
    tmpHome = makeTempDir('cdd-update-home-');
    // Full init so ~/.claude/agents is populated (needed for update to have something to compare)
    const r = runCli(['init'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('update (no --yes) prints "Run with --yes" or "Already up to date" without writing files', () => {
    const agentsDir = join(tmpHome, '.claude', 'agents');
    const agentFiles = readdirSync(agentsDir);
    // Pick the first agent file to check mtime
    const watchFile = join(agentsDir, agentFiles[0]);
    const mtimeBefore = statSync(watchFile).mtimeMs;

    const r = runCli(['update'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const combined = r.stdout + r.stderr;
    const hasExpectedMessage =
      /run with --yes/i.test(combined) || /already up to date/i.test(combined);
    expect(hasExpectedMessage, `output was: ${combined}`).toBe(true);

    // File mtime must be unchanged (no actual write happened)
    const mtimeAfter = statSync(watchFile).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('update --yes on a just-init environment reports "Already up to date"', () => {
    const r = runCli(['update', '--yes'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/already up to date/i);
  });

  it('update --yes restores a manually-modified agent file to kit version', () => {
    const agentsDir = join(tmpHome, '.claude', 'agents');
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    expect(agentFiles.length).toBeGreaterThan(0);

    const targetFile = join(agentsDir, agentFiles[0]);
    const originalContent = readFileSync(targetFile, 'utf8');

    // Modify the file
    writeFileSync(targetFile, 'MODIFIED');

    // Run update --yes
    const r = runCli(['update', '--yes'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    // File should be restored to kit version
    const restoredContent = readFileSync(targetFile, 'utf8');
    expect(restoredContent).toBe(originalContent);
    expect(restoredContent).not.toBe('MODIFIED');
  });

  it('update --yes creates a backup with the modified content before overwriting', () => {
    const agentsDir = join(tmpHome, '.claude', 'agents');
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    const targetFile = join(agentsDir, agentFiles[0]);

    // Modify the agent file
    writeFileSync(targetFile, 'MODIFIED');

    // Run update --yes
    const r = runCli(['update', '--yes'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    // Backup directory should exist under ~/.claude/.cdd-kit-backup/<timestamp>/
    const backupRoot = join(tmpHome, '.claude', '.cdd-kit-backup');
    expect(existsSync(backupRoot), '.cdd-kit-backup dir missing').toBe(true);

    // Should have exactly one timestamp subdirectory
    const timestampDirs = readdirSync(backupRoot);
    expect(timestampDirs.length).toBeGreaterThanOrEqual(1);

    // Inside the timestamp dir there should be an agents/ subdir
    const timestampDir = join(backupRoot, timestampDirs[0]);
    const backupAgentsDir = join(timestampDir, 'agents');
    expect(existsSync(backupAgentsDir), 'backup agents/ dir missing').toBe(true);

    // The backed-up file should contain the modified content
    const backedUpFile = join(backupAgentsDir, agentFiles[0]);
    expect(existsSync(backedUpFile), `backup file ${agentFiles[0]} missing`).toBe(true);
    const backedUpContent = readFileSync(backedUpFile, 'utf8');
    expect(backedUpContent).toBe('MODIFIED');
  });

  it('update auto-detects codex provider and does not create ~/.claude assets', () => {
    rmSync(join(tmpHome, '.claude'), { recursive: true, force: true });
    writeFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), JSON.stringify({
      provider: 'codex',
      generated_at: '2026-04-28T00:00:00.000Z',
      roles: {},
    }, null, 2) + '\n', 'utf8');

    const r = runCli(['update', '--yes'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Provider: codex/i);
    expect(r.stdout + r.stderr).toMatch(/no global cdd-kit assets/i);
    expect(existsSync(join(tmpHome, '.claude'))).toBe(false);
  });

  it('update rejects invalid provider values', () => {
    const r = runCli(['update', '--provider', 'bad-provider'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Invalid provider: bad-provider/i);
  });

  it('update --postinstall is a no-op when cdd has not been init-ed in this home', () => {
    const freshHome = makeTempDir('cdd-update-fresh-home-');
    try {
      const r = runCli(['update', '--postinstall'], { cwd: tmpRepo, home: freshHome });
      expect(r.status, `stderr: ${r.stderr}`).toBe(0);
      expect((r.stdout + r.stderr).trim()).toBe('');
      expect(existsSync(join(freshHome, '.claude', 'skills', 'contract-driven-delivery'))).toBe(false);
    } finally {
      cleanupDir(freshHome);
    }
  });

  it('update --postinstall exits cleanly with no output when already up to date', () => {
    const r = runCli(['update', '--postinstall'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect((r.stdout + r.stderr).trim()).toBe('');
  });

  it('update --postinstall auto-applies changes without explicit --yes', () => {
    const agentsDir = join(tmpHome, '.claude', 'agents');
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    expect(agentFiles.length).toBeGreaterThan(0);
    const targetFile = join(agentsDir, agentFiles[0]);
    const originalContent = readFileSync(targetFile, 'utf8');
    writeFileSync(targetFile, 'MODIFIED');

    const r = runCli(['update', '--postinstall'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const restoredContent = readFileSync(targetFile, 'utf8');
    expect(restoredContent).toBe(originalContent);
    expect(restoredContent).not.toBe('MODIFIED');
  });

  it('update --postinstall syncs correctly even from a non-project cwd', () => {
    const nonProjectDir = makeTempDir('cdd-update-noncwd-');
    try {
      const agentsDir = join(tmpHome, '.claude', 'agents');
      const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
      const targetFile = join(agentsDir, agentFiles[0]);
      writeFileSync(targetFile, 'MODIFIED');

      const r = runCli(['update', '--postinstall'], { cwd: nonProjectDir, home: tmpHome });
      expect(r.status, `stderr: ${r.stderr}`).toBe(0);

      const restoredContent = readFileSync(targetFile, 'utf8');
      expect(restoredContent).not.toBe('MODIFIED');
    } finally {
      cleanupDir(nonProjectDir);
    }
  });
});
