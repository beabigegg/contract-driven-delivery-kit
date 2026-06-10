/**
 * Tests for P1-3 Context Expansion Request de-blocking:
 *   (a) auto-approval of paths inside the policy's auto-safe zones — both at
 *       request time and for already-pending CERs (`context auto-approve`);
 *   (b) `context approve-interactive`, the plain-language y/n walkthrough.
 *
 * The auto-safe behavior is opt-in: it only fires when `.cdd/context-policy.json`
 * sets `contextExpansion.mode: "auto-safe"`. A repo without the policy file (or
 * in manual mode) keeps the old pending-CER behavior, so existing flows are
 * unaffected.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

let tmpRepo: string;
let tmpHome: string;

const CHANGE = 'feat-context';

function manifestPath(): string {
  return join(tmpRepo, 'specs', 'changes', CHANGE, 'context-manifest.md');
}

function writeManifest(lines: string[]): void {
  writeFileSync(manifestPath(), lines.join('\n'), 'utf8');
}

function writePolicy(mode: string): void {
  mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
  writeFileSync(join(tmpRepo, '.cdd', 'context-policy.json'), JSON.stringify({
    contextExpansion: {
      mode,
      autoApprovePatterns: ['src/**', 'tests/**', 'contracts/**', 'specs/changes/<current-change-id>/**'],
    },
  }), 'utf8');
}

function emptyManifest(): string[] {
  return [
    '# Context Manifest',
    '',
    '## Allowed Paths',
    `- specs/changes/${CHANGE}/`,
    '',
    '## Context Expansion Requests',
    '-',
    '',
    '## Approved Expansions',
    '-',
    '',
  ];
}

/** Run the CLI feeding `input` to stdin (runCli does not support stdin). */
function runCliStdin(args: string[], input: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: tmpRepo,
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
    input,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-ctx-auto-repo-');
  tmpHome = makeTempDir('cdd-ctx-auto-home-');
  mkdirSync(join(tmpRepo, 'specs', 'changes', CHANGE), { recursive: true });
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('context auto-approval at request time (P1-3a)', () => {
  it('auto-approves a fully-safe request without creating a pending CER', () => {
    writePolicy('auto-safe');
    writeManifest(emptyManifest());

    const r = runCli([
      'context', 'request', CHANGE, 'CER-1',
      '--path', 'src/a.ts', 'tests/a.test.ts',
      '--reason', 'paired source and tests',
    ], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/auto-approved 2 path\(s\)/i);
    expect(r.stdout).toMatch(/no pending request needed/i);

    const m = readFileSync(manifestPath(), 'utf8');
    expect(m).toContain('- src/a.ts');
    expect(m).toContain('- tests/a.test.ts');
    // No pending CER should exist.
    const list = runCli(['context', 'list', CHANGE, '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(JSON.parse(list.stdout).requests).toHaveLength(0);
  });

  it('splits a partly-safe request: safe paths approved, the rest left pending', () => {
    writePolicy('auto-safe');
    writeManifest(emptyManifest());

    const r = runCli([
      'context', 'request', CHANGE, 'CER-2',
      '--path', 'src/a.ts', 'lib/vendor/x.ts',
      '--reason', 'needs a vendored helper too',
    ], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const m = readFileSync(manifestPath(), 'utf8');
    expect(m).toContain('- src/a.ts');             // auto-approved
    const list = JSON.parse(runCli(['context', 'list', CHANGE, '--json'], { cwd: tmpRepo, home: tmpHome }).stdout);
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0].requestId).toBe('CER-2');
    expect(list.requests[0].status).toBe('pending');
    expect(list.requests[0].paths).toEqual(['lib/vendor/x.ts']);  // only the unsafe path remains
  });

  it('keeps the pending CER (no auto-approval) when there is no policy file', () => {
    writeManifest(emptyManifest());  // no .cdd/context-policy.json

    const r = runCli([
      'context', 'request', CHANGE, 'CER-3',
      '--path', 'src/a.ts',
      '--reason', 'manual mode',
    ], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const list = JSON.parse(runCli(['context', 'list', CHANGE, '--json'], { cwd: tmpRepo, home: tmpHome }).stdout);
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0].status).toBe('pending');
  });
});

describe('context auto-approve command on existing pending CERs (P1-3a)', () => {
  it('fully approves a CER whose every path is in a safe zone', () => {
    writePolicy('auto-safe');
    writeManifest([
      '# Context Manifest', '',
      '## Context Expansion Requests',
      '- request-id: CER-10',
      '  requested_paths:',
      '    - src/a.ts',
      '    - tests/a.test.ts',
      '  status: pending',
      '',
      '## Approved Expansions', '-', '',
    ]);

    const r = runCli(['context', 'auto-approve', CHANGE], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/auto-approved 1 request\(s\) fully/i);

    const m = readFileSync(manifestPath(), 'utf8');
    expect(m).toMatch(/status:\s*approved/i);
    expect(m).toContain('- src/a.ts');
    expect(m).toContain('- tests/a.test.ts');
  });

  it('partially resolves a mixed CER and leaves the unsafe paths pending', () => {
    writePolicy('auto-safe');
    writeManifest([
      '# Context Manifest', '',
      '## Context Expansion Requests',
      '- request-id: CER-11',
      '  requested_paths:',
      '    - src/a.ts',
      '    - specs/changes/other-change/notes.md',
      '  status: pending',
      '',
      '## Approved Expansions', '-', '',
    ]);

    const r = runCli(['context', 'auto-approve', CHANGE], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/1 partially/i);

    const list = JSON.parse(runCli(['context', 'list', CHANGE, '--json'], { cwd: tmpRepo, home: tmpHome }).stdout);
    expect(list.requests[0].status).toBe('pending');
    expect(list.requests[0].paths).toEqual(['specs/changes/other-change/notes.md']);  // sibling change is forbidden → not auto-approved
    expect(readFileSync(manifestPath(), 'utf8')).toContain('- src/a.ts');
  });

  it('does nothing when the policy mode is not auto-safe', () => {
    writePolicy('manual');
    writeManifest([
      '# Context Manifest', '',
      '## Context Expansion Requests',
      '- request-id: CER-12',
      '  requested_paths:',
      '    - src/a.ts',
      '  status: pending',
      '',
    ]);

    const r = runCli(['context', 'auto-approve', CHANGE], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/not "auto-safe"/i);

    const list = JSON.parse(runCli(['context', 'list', CHANGE, '--json'], { cwd: tmpRepo, home: tmpHome }).stdout);
    expect(list.requests[0].status).toBe('pending');
  });
});

describe('context approve-interactive (P1-3b)', () => {
  function pendingManifest(): void {
    writeManifest([
      '# Context Manifest', '',
      '## Context Expansion Requests',
      '- request-id: CER-20',
      '  requested_paths:',
      '    - lib/vendor/x.ts',
      '  reason: needs a vendored helper',
      '  status: pending',
      '',
      '## Approved Expansions', '-', '',
    ]);
  }

  it('approves a request when the user answers yes', () => {
    pendingManifest();
    const r = runCliStdin(['context', 'approve-interactive', CHANGE], 'y\n');
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(manifestPath(), 'utf8')).toMatch(/status:\s*approved/i);
    expect(readFileSync(manifestPath(), 'utf8')).toContain('- lib/vendor/x.ts');
  });

  it('leaves a request pending when the user answers no', () => {
    pendingManifest();
    const r = runCliStdin(['context', 'approve-interactive', CHANGE], 'n\n');
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(manifestPath(), 'utf8')).toMatch(/status:\s*pending/i);
  });

  it('stops cleanly on EOF (no input) instead of hanging', () => {
    pendingManifest();
    const r = runCliStdin(['context', 'approve-interactive', CHANGE], '');
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(manifestPath(), 'utf8')).toMatch(/status:\s*pending/i);
  });

  it('reports when there are no pending requests', () => {
    writeManifest(emptyManifest());
    const r = runCliStdin(['context', 'approve-interactive', CHANGE], '');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no pending context expansion requests/i);
  });
});
