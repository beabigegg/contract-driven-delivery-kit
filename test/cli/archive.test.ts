import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper: create a minimal populated change directory
function scaffoldChange(repo: string, changeId: string, opts: { gateBlocked?: boolean } = {}): void {
  const changeDir = join(repo, 'specs', 'changes', changeId);
  mkdirSync(changeDir, { recursive: true });
  const statusLine = opts.gateBlocked ? '\nstatus: gate-blocked\n' : '';
  writeFileSync(join(changeDir, 'tasks.md'), `# Tasks: ${changeId}\n${statusLine}\n- [x] 1.1 Done task\n`, 'utf8');
  writeFileSync(join(changeDir, 'change-request.md'), '# Change Request\n\nSome request.\n', 'utf8');
}

describe('cdd-kit archive', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-archive-repo-');
    tmpHome = makeTempDir('cdd-archive-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('1: archive on non-existent change exits 1 and reports change not found', () => {
    const r = runCli(['archive', 'nonexistent'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/change not found/i);
  });

  it('2: archive moves change directory to specs/archive/<year>/<change-id>', () => {
    scaffoldChange(tmpRepo, 'my-change');
    const r = runCli(['archive', 'my-change'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);

    // Source should no longer exist
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'my-change'))).toBe(false);

    // Destination should exist
    const year = new Date().getFullYear().toString();
    expect(existsSync(join(tmpRepo, 'specs', 'archive', year, 'my-change'))).toBe(true);
  });

  it('3: archive creates INDEX.md with entry', () => {
    scaffoldChange(tmpRepo, 'my-change-2');
    runCli(['archive', 'my-change-2'], { cwd: tmpRepo, home: tmpHome });

    const indexPath = join(tmpRepo, 'specs', 'archive', 'INDEX.md');
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, 'utf8');
    expect(index).toMatch(/my-change-2/);
  });

  it('4: archive on gate-blocked change warns but does not block', () => {
    scaffoldChange(tmpRepo, 'blocked-change', { gateBlocked: true });
    const r = runCli(['archive', 'blocked-change'], { cwd: tmpRepo, home: tmpHome });
    // Should succeed (with warning)
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/gate-blocked/i);
  });

  it('5: archive on already-archived change exits 1', () => {
    scaffoldChange(tmpRepo, 'double-archive');
    runCli(['archive', 'double-archive'], { cwd: tmpRepo, home: tmpHome });
    // Re-scaffold source and try to archive again
    scaffoldChange(tmpRepo, 'double-archive');
    const r = runCli(['archive', 'double-archive'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/already archived/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static code check for EXDEV cross-volume fallback implementation
// ─────────────────────────────────────────────────────────────────────────────
describe('archive EXDEV cross-volume fallback', () => {
  it('6: archive.ts source contains EXDEV fallback using cpSync and rmSync', () => {
    // Verify the implementation exists in the source without running the CLI
    // (EXDEV cannot easily be triggered without cross-device mounts in CI)
    const archiveSrc = resolve(__dirname, '..', '..', 'src', 'commands', 'archive.ts');
    const content = readFileSync(archiveSrc, 'utf8');

    // Verify the EXDEV handling is present
    expect(content).toMatch(/EXDEV/);
    expect(content).toMatch(/cpSync/);
    expect(content).toMatch(/rmSync/);
    // Verify it's inside a catch block
    expect(content).toMatch(/catch.*err[\s\S]*EXDEV/);
  });
});
