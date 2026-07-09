/**
 * Behavioral tests for hooks/pre-tool-use-design-write.sh (ADR 0012 §5).
 *
 * `install-agent-hooks --design-write` only wires this script into
 * settings.json; the script itself is the chokepoint, so its routing decision
 * and advisory/strict exit codes are exercised here by executing it directly
 * with a tool-call payload on stdin. POSIX-sh only -- skipped on Windows.
 * Mirrors test/cli/acceptance-write-hook.test.ts exactly.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', '..', 'hooks', 'pre-tool-use-design-write.sh');
const DESIGN_REL = 'specs/changes/my-change/interaction-design.md';
const LOCK_REL = '.cdd/design-lock.json';

let repo: string;

function writeDesign(relPath: string): void {
  mkdirSync(join(repo, dirname(relPath)), { recursive: true });
  writeFileSync(join(repo, relPath), '# Interaction Design\n', 'utf8');
}

function runHook(
  filePath: string,
  opts: { strict?: boolean } = {},
): { status: number | null; stderr: string } {
  const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
  const env = { ...process.env };
  if (opts.strict) env.CDD_DESIGN_WRITE_STRICT = '1';
  else delete env.CDD_DESIGN_WRITE_STRICT;
  const r = spawnSync('/bin/sh', [HOOK], { cwd: repo, input: payload, env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
}

beforeEach(() => { repo = makeTempDir('cdd-dwhook-'); });
afterEach(() => { cleanupDir(repo); });

describe.skipIf(process.platform === 'win32')('pre-tool-use-design-write.sh', () => {
  it('advisory: nudges toward human confirmation and ALLOWS the edit (exit 0)', () => {
    writeDesign(DESIGN_REL);
    const r = runHook(DESIGN_REL);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/human/i);
  });

  it('strict: BLOCKS the edit (exit 2) and feeds the reason back', () => {
    writeDesign(DESIGN_REL);
    const r = runHook(DESIGN_REL, { strict: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/human/i);
    expect(r.stderr).toMatch(/CDD_DESIGN_WRITE_STRICT=0/);
  });

  it('matches an absolute path to interaction-design.md', () => {
    writeDesign(DESIGN_REL);
    const r = runHook(join(repo, DESIGN_REL), { strict: true });
    expect(r.status).toBe(2);
  });

  it('also blocks the .cdd/design-lock.json baseline sidecar', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, LOCK_REL), '{}', 'utf8');
    const r = runHook(LOCK_REL, { strict: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/human/i);
  });

  it('matches interaction-design.md under any change id', () => {
    writeDesign('specs/changes/some-other-change/interaction-design.md');
    const r = runHook('specs/changes/some-other-change/interaction-design.md', { strict: true });
    expect(r.status).toBe(2);
  });

  it('blocks even a first-time write when the file does not exist yet (no scaffold exemption)', () => {
    const r = runHook(DESIGN_REL, { strict: true });
    expect(r.status).toBe(2);
  });

  it('ignores source files even in strict mode', () => {
    const r = runHook('src/server/orders.ts', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('ignores other change artifacts (e.g. tasks.yml) in strict mode', () => {
    const r = runHook('specs/changes/my-change/tasks.yml', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('does not match a lookalike path outside the change tree', () => {
    const r = runHook('other-specs/changes/my-change/interaction-design.md', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows when the payload carries no file_path', () => {
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
    const r = spawnSync('/bin/sh', [HOOK], {
      cwd: repo,
      input: payload,
      env: { ...process.env, CDD_DESIGN_WRITE_STRICT: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
