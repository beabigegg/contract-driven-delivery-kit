/**
 * CLI tests for `cdd-kit manifest <id>` (P2-6).
 *
 * For a low-risk tier 4-5 micro-change the kit auto-generates a minimal
 * context-manifest.md (Allowed Paths = the change directory + the files the
 * change touches) so the author does not have to hand-write a full manifest for
 * a trivial edit. Stricter tiers are refused (the full ceremony is intentional
 * there) and an existing manifest is never clobbered without --force.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

function git(...args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: tmpRepo,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`test setup: \`git ${args.join(' ')}\` failed: ${r.stderr}`);
}

/** Scaffold a change at the given tier, with two touched source files staged. */
function scaffoldMicroChange(changeId: string, tier: number): string {
  const changeDir = join(tmpRepo, 'specs', 'changes', changeId);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'tasks.yml'), [
    `change-id: ${changeId}`,
    'status: in-progress',
    `tier: ${tier}`,
    'tasks:',
    '  - id: "1"',
    '    title: do the thing',
    '    status: pending',
    '',
  ].join('\n'), 'utf8');
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(join(tmpRepo, 'src', 'widget.ts'), 'export const x = 1;\n', 'utf8');
  writeFileSync(join(tmpRepo, 'src', 'helper.ts'), 'export const y = 2;\n', 'utf8');
  git('add', '-A');
  return changeDir;
}

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-manifest-repo-');
  tmpHome = makeTempDir('cdd-manifest-home-');
  git('init');
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit manifest', () => {
  it('generates a minimal manifest for a tier 4 change: defaults + touched files (--json)', () => {
    scaffoldMicroChange('micro', 4);
    const r = runCli(['manifest', 'micro', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      'change-id': string; tier: number; path: string;
      allowed_paths: string[]; touched: string[]; written: boolean;
    };
    expect(payload.tier).toBe(4);
    expect(payload.written).toBe(true);
    expect(payload.touched.sort()).toEqual(['src/helper.ts', 'src/widget.ts']);
    // Allowed Paths = the three defaults + the touched files.
    expect(payload.allowed_paths).toEqual([
      'specs/changes/micro/',
      'specs/context/project-map.md',
      'specs/context/contracts-index.md',
      'src/helper.ts',
      'src/widget.ts',
    ]);

    const body = readFileSync(join(tmpRepo, 'specs', 'changes', 'micro', 'context-manifest.md'), 'utf8');
    expect(body).toMatch(/## Allowed Paths/);
    expect(body).toMatch(/- src\/widget\.ts/);
    // The change's own directory is a default; it must not be double-listed as a touched file.
    expect(body).not.toMatch(/specs\/changes\/micro\/tasks\.yml/);
  });

  it('refuses a tier stricter than 4 (full manifest is intentional there)', () => {
    scaffoldMicroChange('risky', 1);
    const r = runCli(['manifest', 'risky', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect((JSON.parse(r.stdout) as { error: string }).error).toMatch(/only for low-risk tier 4-5/i);
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'risky', 'context-manifest.md'))).toBe(false);
  });

  it('errors when no tier is set yet', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'untiered');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'tasks.yml'), 'change-id: untiered\nstatus: in-progress\ntasks: []\n', 'utf8');
    const r = runCli(['manifest', 'untiered', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect((JSON.parse(r.stdout) as { error: string }).error).toMatch(/no tier is set/i);
  });

  it('refuses to overwrite an existing manifest without --force, then overwrites with it', () => {
    scaffoldMicroChange('keep', 5);
    const manifestPath = join(tmpRepo, 'specs', 'changes', 'keep', 'context-manifest.md');
    writeFileSync(manifestPath, '# Hand-authored\n\n## Allowed Paths\n- src/\n', 'utf8');

    const blocked = runCli(['manifest', 'keep'], { cwd: tmpRepo, home: tmpHome });
    expect(blocked.status).toBe(1);
    expect(blocked.stderr + blocked.stdout).toMatch(/already exists/i);
    expect(readFileSync(manifestPath, 'utf8')).toMatch(/Hand-authored/);

    const forced = runCli(['manifest', 'keep', '--force'], { cwd: tmpRepo, home: tmpHome });
    expect(forced.status).toBe(0);
    expect(readFileSync(manifestPath, 'utf8')).not.toMatch(/Hand-authored/);
    expect(readFileSync(manifestPath, 'utf8')).toMatch(/Auto-generated by `cdd-kit manifest keep`/);
  });

  it('errors for a missing change', () => {
    const r = runCli(['manifest', 'nope', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(1);
    expect((JSON.parse(r.stdout) as { error: string }).error).toMatch(/change not found/i);
  });
});
