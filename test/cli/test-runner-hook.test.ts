/**
 * Behavioral tests for hooks/pre-tool-use-test-runner.sh (ADR 0005 §10).
 *
 * `install-agent-hooks --test-runner` only wires this script into settings.json;
 * the script itself is the chokepoint, so its broad-vs-bounded decision and
 * advisory/strict exit codes are exercised here by executing it directly with a
 * Bash tool-call payload on stdin. POSIX-sh only — skipped on Windows.
 *
 * Detection is deliberately conservative (advice, not a security boundary): a
 * bounded target, `cdd-kit test run`, and every non-test command must be allowed
 * untouched; only an unambiguous whole-suite run is flagged.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The SOURCE script (single source of truth; build.js copies it into assets/).
const HOOK = resolve(__dirname, '..', '..', 'hooks', 'pre-tool-use-test-runner.sh');

let repo: string;

/** Run the hook with a Bash payload for `command`; returns exit status + stderr. */
function runHook(
  command: string,
  opts: { strict?: boolean; cddRepo?: boolean } = {},
): { status: number | null; stderr: string } {
  // The hook only fires inside a CDD repo (a `.cdd/` directory exists).
  if (opts.cddRepo !== false) mkdirSync(join(repo, '.cdd'), { recursive: true });
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const env = { ...process.env };
  if (opts.strict) env.CDD_TEST_RUNNER_STRICT = '1';
  else delete env.CDD_TEST_RUNNER_STRICT;
  const r = spawnSync('/bin/sh', [HOOK], { cwd: repo, input: payload, env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
}

beforeEach(() => { repo = makeTempDir('cdd-trhook-'); });
afterEach(() => { cleanupDir(repo); });

describe.skipIf(process.platform === 'win32')('pre-tool-use-test-runner.sh', () => {
  it('advisory: nudges a broad `pytest` toward the ladder and ALLOWS it (exit 0)', () => {
    const r = runHook('pytest');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/cdd-kit test run/);
    expect(r.stderr).toMatch(/bounded/i);
  });

  it('strict: BLOCKS a broad `pytest` (exit 2) and feeds the reason back', () => {
    const r = runHook('pytest', { strict: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/cdd-kit test run/);
    expect(r.stderr).toMatch(/CDD_TEST_RUNNER_STRICT=0/);
  });

  it('flags a flags-only `pytest -q` as broad (no positional target)', () => {
    const r = runHook('pytest -q --maxfail=1', { strict: true });
    expect(r.status).toBe(2);
  });

  it('ALLOWS a bounded pytest node id even in strict mode', () => {
    const r = runHook('pytest tests/orders/test_filter.py::test_status_filter_options', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('ALLOWS a bounded pytest directory even with flags', () => {
    const r = runHook('pytest -q tests/orders/', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('flags `python -m pytest` with no target as broad', () => {
    const r = runHook('python -m pytest', { strict: true });
    expect(r.status).toBe(2);
  });

  it('ALLOWS `python -m pytest <file>` (bounded)', () => {
    const r = runHook('python -m pytest tests/orders/test_filter.py', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('ALWAYS allows the sanctioned `cdd-kit test run` command, even in strict mode', () => {
    const r = runHook('cdd-kit test run add-order-filter --phase targeted --command "pytest -q"', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('flags a broad `npm test` as broad', () => {
    expect(runHook('npm test').status).toBe(0); // advisory allows but warns
    expect(runHook('npm test').stderr).toMatch(/cdd-kit test run/);
    expect(runHook('npm test', { strict: true }).status).toBe(2);
  });

  it('ALLOWS `npm test -- <target>` (bounded via passthrough)', () => {
    const r = runHook('npm test -- tests/orders/filter.test.ts', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('flags bare `jest` and `vitest` and whole-module `go test ./...`', () => {
    expect(runHook('jest', { strict: true }).status).toBe(2);
    expect(runHook('vitest', { strict: true }).status).toBe(2);
    expect(runHook('go test ./...', { strict: true }).status).toBe(2);
  });

  it('sees through a leading `cd <dir> &&` setup prefix', () => {
    const r = runHook('cd packages/api && pytest', { strict: true });
    expect(r.status).toBe(2);
  });

  it('ALLOWS non-test commands (lint/typecheck/validate) untouched in strict mode', () => {
    for (const cmd of ['ruff check .', 'npm run typecheck', 'cdd-kit validate --contracts', 'ls tests/']) {
      const r = runHook(cmd, { strict: true });
      expect(r.status, cmd).toBe(0);
      expect(r.stderr, cmd).toBe('');
    }
  });

  it('is a silent no-op outside a CDD repo (no .cdd/), even for a broad run', () => {
    const r = runHook('pytest', { strict: true, cddRepo: false });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows when the payload carries no command', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: {} });
    const r = spawnSync('/bin/sh', [HOOK], {
      cwd: repo,
      input: payload,
      env: { ...process.env, CDD_TEST_RUNNER_STRICT: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
