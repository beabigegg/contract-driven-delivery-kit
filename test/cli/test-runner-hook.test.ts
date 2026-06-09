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

  // --- Codex review hardening (PR-7): precise broad-vs-bounded edges. ---

  it('flags pytest whose only positional is an option VALUE, not a target', () => {
    // `--maxfail 1` / `--tb short`: the value is not a test target, so these stay
    // whole-suite runs and must be flagged rather than read as bounded.
    expect(runHook('pytest --maxfail 1', { strict: true }).status).toBe(2);
    expect(runHook('pytest --tb short', { strict: true }).status).toBe(2);
    expect(runHook('python -m pytest --maxfail 1', { strict: true }).status).toBe(2);
  });

  it('catches a broad run chained after a ladder command (`cdd-kit test select ... && pytest`)', () => {
    expect(runHook('cdd-kit test select add-order-filter --json && pytest', { strict: true }).status).toBe(2);
    expect(
      runHook('cdd-kit test run x --phase targeted --command "pytest -q"; pytest', { strict: true }).status,
    ).toBe(2);
  });

  it('still allows a ladder command alone, and a ladder command after a setup step', () => {
    expect(runHook('cdd-kit test select add-order-filter --json', { strict: true }).status).toBe(0);
    const r = runHook('cd packages/api && cdd-kit test run x --phase targeted --command "pytest -q"', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('ALLOWS a bounded jest/vitest run even when flags precede the target (strict)', () => {
    expect(runHook('jest --runInBand tests/orders/filter.test.ts', { strict: true }).status).toBe(0);
    expect(runHook('vitest --config vitest.config.ts tests/orders/filter.test.ts', { strict: true }).status).toBe(0);
  });

  it('flags an npm `--` passthrough that carries only flags (no real target)', () => {
    // npm-style is bounded only via `-- <target>`; flags after `--` still run all.
    expect(runHook('npm test -- --runInBand', { strict: true }).status).toBe(2);
    expect(runHook('npm test -- --watch=false', { strict: true }).status).toBe(2);
  });

  it('flags `vitest run` (no target) as broad but allows `vitest run <file>`', () => {
    expect(runHook('vitest run', { strict: true }).status).toBe(2);
    expect(runHook('vitest run --coverage', { strict: true }).status).toBe(2);
    expect(runHook('vitest run tests/orders/filter.test.ts', { strict: true }).status).toBe(0);
  });

  // --- Codex review round 2 (PR-7): command-position + option-value edges. ---

  it('recognizes a wrapped pytest at command position (env prefix / venv path)', () => {
    expect(runHook('PYTHONPATH=. pytest', { strict: true }).status).toBe(2);
    expect(runHook('.venv/bin/pytest', { strict: true }).status).toBe(2);
    expect(runHook('PYTHONPATH=src .venv/bin/pytest', { strict: true }).status).toBe(2);
    // ...but a wrapped pytest WITH a target stays bounded.
    expect(runHook('PYTHONPATH=. .venv/bin/pytest tests/orders/test_filter.py', { strict: true }).status).toBe(0);
  });

  it('does NOT treat a path-valued config/report option as a test target', () => {
    expect(runHook('vitest --config config/vitest.config.ts', { strict: true }).status).toBe(2);
    expect(runHook('jest --config config/jest.config.js', { strict: true }).status).toBe(2);
    expect(runHook('pytest --junitxml reports/junit.xml', { strict: true }).status).toBe(2);
    // a real target alongside the config flag is still bounded.
    expect(runHook('vitest --config config/vitest.config.ts tests/a.test.ts', { strict: true }).status).toBe(0);
  });

  it('flags whole-module `go test ./...` even with flags before the pattern', () => {
    expect(runHook('go test -race ./...', { strict: true }).status).toBe(2);
    expect(runHook('go test -count=1 ./...', { strict: true }).status).toBe(2);
    // a specific package stays allowed.
    expect(runHook('go test ./internal/orders', { strict: true }).status).toBe(0);
  });

  it('does NOT block a non-test command that merely mentions a runner', () => {
    // The runner must be at command position; a mention is left untouched.
    for (const cmd of ['echo python -m pytest', 'echo pytest && echo done', 'cat pytest.ini']) {
      const r = runHook(cmd, { strict: true });
      expect(r.status, cmd).toBe(0);
      expect(r.stderr, cmd).toBe('');
    }
  });

  // --- Codex review round 3 (PR-7): npm config values, quoted --command, slashed env. ---

  it('requires a real npm `-- <target>`, not a config/report option value', () => {
    // npm forwards `-- --config x` to the runner, which still runs the whole suite.
    expect(runHook('npm test -- --config config/jest.config.js', { strict: true }).status).toBe(2);
    expect(runHook('npm test -- --reporters default', { strict: true }).status).toBe(2);
    // a real target after `--` stays bounded.
    expect(runHook('npm test -- tests/orders/filter.test.ts', { strict: true }).status).toBe(0);
  });

  it('does NOT split a ladder command on a `;`/`&&` inside its quoted --command value', () => {
    // `cdd-kit test run` executes the --command value verbatim (test-run.ts), so a
    // shell-composed value must not be mis-split and the inner runner mis-flagged.
    for (const q of ['"setup; pytest -q"', "'setup; pytest -q'", '"a && pytest -q"']) {
      const r = runHook(`cdd-kit test run x --phase targeted --command ${q}`, { strict: true });
      expect(r.status, q).toBe(0);
      expect(r.stderr, q).toBe('');
    }
    // ...but a broad run chained OUTSIDE the quotes is still caught.
    expect(
      runHook('cdd-kit test run x --phase targeted --command "pytest -q"; pytest', { strict: true }).status,
    ).toBe(2);
  });

  it('recognizes a wrapped pytest whose env-assignment value contains a slash', () => {
    // Mirrors isPytestCommand: the assignment KEY must be an identifier; its VALUE
    // may hold slashes, so these are command-position pytest runs (broad).
    expect(runHook('VIRTUAL_ENV=/tmp/venv pytest', { strict: true }).status).toBe(2);
    expect(runHook('PYTHONPATH=src/foo pytest', { strict: true }).status).toBe(2);
    // ...still bounded when a real target follows.
    expect(runHook('PYTHONPATH=src/foo pytest tests/orders/test_filter.py', { strict: true }).status).toBe(0);
  });

  // --- Codex review round 4 (PR-7): structural-target stop-loss + python interpreter opts. ---
  // A bare word is never a target (it is structurally ambiguous: dir? option value?
  // shell operator?), so detection is purely structural — a path, a `::` node id, or a
  // test file. This reverts round 3's bare-directory acceptance; bound such a run with a
  // path (`pytest tests/`). Prefers false negatives over an unbounded CLI option table.

  it('treats a bare directory as broad — only a path/::/test-file is a bounded target', () => {
    expect(runHook('pytest tests', { strict: true }).status).toBe(2);
    expect(runHook('pytest src', { strict: true }).status).toBe(2);
    expect(runHook('pytest -q tests', { strict: true }).status).toBe(2);
    // ...a real path (trailing slash or a file) bounds it.
    expect(runHook('pytest tests/', { strict: true }).status).toBe(0);
    expect(runHook('pytest tests/orders/test_filter.py', { strict: true }).status).toBe(0);
  });

  it('keeps short-option values and shell operators from satisfying a pytest target', () => {
    // `-p name` / `-W ignore` are option values, and `|`/`>`/`||` are shell operators —
    // none is a [file_or_dir], so each leaves the run whole-suite (broad).
    expect(runHook('pytest -p no:warnings', { strict: true }).status).toBe(2);
    expect(runHook('pytest -W ignore', { strict: true }).status).toBe(2);
    expect(runHook('pytest | tee log', { strict: true }).status).toBe(2);
    expect(runHook('pytest > out.txt', { strict: true }).status).toBe(2);
    expect(runHook('pytest || true', { strict: true }).status).toBe(2);
  });

  it('flags `python -m pytest` even behind interpreter options', () => {
    // python --help: `[option] ... [-m mod]`, so -u/-I sit before `-m pytest`.
    expect(runHook('python -u -m pytest', { strict: true }).status).toBe(2);
    expect(runHook('python -I -m pytest', { strict: true }).status).toBe(2);
    expect(runHook('python3 -u -m pytest', { strict: true }).status).toBe(2);
    // ...still bounded with a real target, and a real script run is left untouched.
    expect(runHook('python -u -m pytest tests/orders/test_filter.py', { strict: true }).status).toBe(0);
    expect(runHook('python -u app.py', { strict: true }).status).toBe(0);
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
