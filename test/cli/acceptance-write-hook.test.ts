/**
 * Behavioral tests for hooks/pre-tool-use-acceptance-write.sh (ADR 0010 SS3.2).
 *
 * `install-agent-hooks --acceptance-write` only wires this script into
 * settings.json; the script itself is the chokepoint, so its routing decision
 * and advisory/strict exit codes are exercised here by executing it directly
 * with a tool-call payload on stdin. POSIX-sh only -- skipped on Windows.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The SOURCE script (single source of truth; build.js copies it into assets/).
const HOOK = resolve(__dirname, '..', '..', 'hooks', 'pre-tool-use-acceptance-write.sh');
const ORACLE_REL = 'specs/changes/my-change/acceptance.yml';
const LOCK_REL = '.cdd/acceptance-lock.json';

let repo: string;

function writeOracle(relPath: string): void {
  mkdirSync(join(repo, dirname(relPath)), { recursive: true });
  writeFileSync(join(repo, relPath), 'oracle-version: 0.1.0\n', 'utf8');
}

/** Run the hook with an Edit payload for `filePath`; returns exit status + stderr. */
function runHook(
  filePath: string,
  opts: { strict?: boolean } = {},
): { status: number | null; stderr: string } {
  const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
  const env = { ...process.env };
  if (opts.strict) env.CDD_ACCEPTANCE_WRITE_STRICT = '1';
  else delete env.CDD_ACCEPTANCE_WRITE_STRICT;
  const r = spawnSync('/bin/sh', [HOOK], { cwd: repo, input: payload, env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
}

beforeEach(() => { repo = makeTempDir('cdd-awhook-'); });
afterEach(() => { cleanupDir(repo); });

describe.skipIf(process.platform === 'win32')('pre-tool-use-acceptance-write.sh', () => {
  it('advisory: nudges toward human authorship and ALLOWS the edit (exit 0)', () => {
    writeOracle(ORACLE_REL);
    const r = runHook(ORACLE_REL);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/human-owned/i);
  });

  it('strict: BLOCKS the edit (exit 2) and feeds the reason back', () => {
    writeOracle(ORACLE_REL);
    const r = runHook(ORACLE_REL, { strict: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/human-owned/i);
    expect(r.stderr).toMatch(/CDD_ACCEPTANCE_WRITE_STRICT=0/);
  });

  it('matches an absolute path to the acceptance oracle', () => {
    writeOracle(ORACLE_REL);
    const r = runHook(join(repo, ORACLE_REL), { strict: true });
    expect(r.status).toBe(2);
  });

  it('also blocks the .cdd/acceptance-lock.json baseline sidecar', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, LOCK_REL), '{}', 'utf8');
    const r = runHook(LOCK_REL, { strict: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/human-owned/i);
  });

  it('matches an acceptance.yml under any change id', () => {
    writeOracle('specs/changes/some-other-change/acceptance.yml');
    const r = runHook('specs/changes/some-other-change/acceptance.yml', { strict: true });
    expect(r.status).toBe(2);
  });

  it('blocks even a first-time write when the oracle does not exist yet (no scaffold exemption)', () => {
    // Unlike the contract-write hook, there is no agent-facing "set" command to
    // route to, so this hook blocks/advises regardless of prior existence.
    const r = runHook(ORACLE_REL, { strict: true });
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
    const r = runHook('other-specs/changes/my-change/acceptance.yml', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows when the payload carries no file_path', () => {
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
    const r = spawnSync('/bin/sh', [HOOK], {
      cwd: repo,
      input: payload,
      env: { ...process.env, CDD_ACCEPTANCE_WRITE_STRICT: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
