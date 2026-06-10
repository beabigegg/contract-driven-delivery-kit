/**
 * P1-14 — machine-readable output for the lifecycle commands that were still
 * text-only: `list`, `abandon`, `archive`. Also the first direct coverage of
 * abandon/archive at all (previously only exercised indirectly).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-lifecycle-json-repo-');
  tmpHome = makeTempDir('cdd-lifecycle-json-home-');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit list --json', () => {
  it('prints an empty changes array when specs/changes/ is empty', () => {
    const r = runCli(['list', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ changes: [] });
  });

  it('lists scaffolded changes with status and pending count', () => {
    runCli(['new', 'feat-a'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['list', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as { changes: Array<{ id: string; status: string; pendingTasks: number }> };
    expect(payload.changes).toHaveLength(1);
    expect(payload.changes[0].id).toBe('feat-a');
    expect(typeof payload.changes[0].status).toBe('string');
    expect(typeof payload.changes[0].pendingTasks).toBe('number');
  });
});

describe('cdd-kit abandon --json', () => {
  it('returns the abandoned payload and updates tasks.yml', () => {
    runCli(['new', 'feat-b'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['abandon', 'feat-b', '--reason', 'superseded', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.changeId).toBe('feat-b');
    expect(payload.status).toBe('abandoned');
    expect(payload.reason).toBe('superseded');
    expect(readFileSync(join(tmpRepo, 'specs', 'changes', 'feat-b', 'tasks.yml'), 'utf8')).toMatch(/status:\s*abandoned/);
  });

  it('returns an error payload with exit 1 for a missing change', () => {
    const r = runCli(['abandon', 'no-such-change', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toMatch(/change not found/i);
  });
});

describe('cdd-kit archive --json', () => {
  it('returns the archived payload (with warnings) and moves the directory', () => {
    runCli(['new', 'feat-c'], { cwd: tmpRepo, home: tmpHome });
    const r = runCli(['archive', 'feat-c', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.changeId).toBe('feat-c');
    expect(payload.archivedTo).toMatch(/^specs\/archive\/\d{4}\/feat-c\/$/);
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'feat-c'))).toBe(false);
    expect(existsSync(join(tmpRepo, 'specs', 'archive', payload.year, 'feat-c'))).toBe(true);
    // JSON mode keeps stdout to the single payload object (warnings live inside it).
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('returns an error payload with exit 1 for a missing change', () => {
    const r = runCli(['archive', 'no-such-change', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toMatch(/change not found/i);
  });
});
