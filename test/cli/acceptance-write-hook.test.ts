/**
 * Behavioral tests for hooks/pre-tool-use-acceptance-write.sh (ADR 0010 SS3.2).
 *
 * `install-agent-hooks --acceptance-write` only wires this script into
 * settings.json; the script itself is the chokepoint, so its routing decision
 * is exercised here by executing it directly with a tool-call payload on stdin.
 * POSIX-sh only -- skipped on Windows.
 *
 * The hook keys off the write TARGET PATH (Decision 1, axis (a)): the lock
 * sidecar is blocked unconditionally, the artifact body is always allowed, and
 * the retired `CDD_ACCEPTANCE_WRITE_STRICT` toggle no longer changes anything.
 * For a standalone `.sh` hook the exit code (2 vs 0) + stderr IS the
 * discriminator -- spawnSync runs the script alone (test-plan.md).
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

// The retired toggle: `undefined` = unset, or a literal value that must not
// change the outcome. The path axis, not this variable, decides.
const RETIRED_TOGGLE_STATES = [undefined, '0', '1'] as const;

let repo: string;

function writeOracle(relPath: string): void {
  mkdirSync(join(repo, dirname(relPath)), { recursive: true });
  writeFileSync(join(repo, relPath), 'oracle-version: 0.1.0\n', 'utf8');
}

/** Run the hook with an Edit payload for `filePath`; returns exit status + stderr. */
function runHook(
  filePath: string,
  opts: { legacyToggle?: string } = {},
): { status: number | null; stderr: string } {
  const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
  const env = { ...process.env };
  delete env.CDD_ACCEPTANCE_WRITE_STRICT;
  if (opts.legacyToggle !== undefined) env.CDD_ACCEPTANCE_WRITE_STRICT = opts.legacyToggle;
  const r = spawnSync('sh', [HOOK], { cwd: repo, input: payload, env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
}

beforeEach(() => { repo = makeTempDir('cdd-awhook-'); });
afterEach(() => { cleanupDir(repo); });

describe('pre-tool-use-acceptance-write.sh', () => {
  // T3c — a write to the lock sidecar is BLOCKED unconditionally, whatever the
  // retired toggle says. Mutation: make the lock case fall through to exit 0.
  it('T3c: blocks a write to .cdd/acceptance-lock.json (exit 2 + stderr), toggle set OR unset', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, LOCK_REL), '{}', 'utf8');
    for (const legacyToggle of RETIRED_TOGGLE_STATES) {
      const r = runHook(LOCK_REL, { legacyToggle });
      expect(r.status, `CDD_ACCEPTANCE_WRITE_STRICT=${legacyToggle}`).toBe(2);
      expect(r.stderr).toMatch(/acceptance-lock\.json/);
    }
  });

  it('T3c: blocks an absolute path to the lock sidecar too', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, LOCK_REL), '{}', 'utf8');
    for (const legacyToggle of RETIRED_TOGGLE_STATES) {
      const r = runHook(join(repo, LOCK_REL), { legacyToggle });
      expect(r.status, `CDD_ACCEPTANCE_WRITE_STRICT=${legacyToggle}`).toBe(2);
    }
  });

  // T3d — a write to the artifact BODY is ALLOWED, whatever the retired toggle
  // says (the sanctioned first write + transcription path). Mutation: re-add a
  // toggle branch that blocks the body.
  it('T3d: allows a write to acceptance.yml (exit 0, no stderr), toggle set OR unset', () => {
    writeOracle(ORACLE_REL);
    for (const legacyToggle of RETIRED_TOGGLE_STATES) {
      const r = runHook(ORACLE_REL, { legacyToggle });
      expect(r.status, `CDD_ACCEPTANCE_WRITE_STRICT=${legacyToggle}`).toBe(0);
      expect(r.stderr, `CDD_ACCEPTANCE_WRITE_STRICT=${legacyToggle}`).toBe('');
    }
  });

  it('T3d: allows acceptance.yml under any change id, and via an absolute path', () => {
    writeOracle('specs/changes/some-other-change/acceptance.yml');
    expect(runHook('specs/changes/some-other-change/acceptance.yml', { legacyToggle: '1' }).status).toBe(0);
    writeOracle(ORACLE_REL);
    expect(runHook(join(repo, ORACLE_REL), { legacyToggle: '1' }).status).toBe(0);
  });

  it('allows source files (exit 0, no stderr), toggle set', () => {
    const r = runHook('src/server/orders.ts', { legacyToggle: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows other change artifacts (e.g. tasks.yml), toggle set', () => {
    const r = runHook('specs/changes/my-change/tasks.yml', { legacyToggle: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows when the payload carries no file_path', () => {
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
    const r = spawnSync('sh', [HOOK], {
      cwd: repo,
      input: payload,
      env: { ...process.env, CDD_ACCEPTANCE_WRITE_STRICT: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
