import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { testEvidenceSchema } from '../../src/schemas/test-evidence.schema.js';
import {
  isPytestCommand,
  hasShellControl,
  augmentPytestCommand,
  parseJunitFirstFailure,
  classifyFailure,
} from '../../src/commands/test-run.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateEvidence = ajv.compile(testEvidenceSchema);

// Cross-platform command shapes (the runner executes them with shell:true). Inner
// double quotes survive runCli (no shell) and are parsed by the runner's shell.
// String.fromCharCode avoids inner single quotes entirely.
const NODE_PASS = 'node -e "process.exit(0)"';
const NODE_FAIL = 'node -e "process.stderr.write(String.fromCharCode(98,111,111,109)); process.exit(1)"';
// Use process.exitCode (not process.exit) so the large async pipe write fully
// drains before the child exits -- process.exit() would truncate its own output.
// 300k exceeds the runner's in-memory tail (256k), so the on-disk log proves the
// full output is streamed, not capped to the tail.
const NODE_BIG_FAIL = 'node -e "process.stdout.write(Array(300001).join(String.fromCharCode(120))); process.exitCode = 1;"';
const NODE_HANG = 'node -e "setTimeout(function(){}, 60000)"';

describe('cdd-kit test run (integration)', () => {
  let repo: string;
  let home: string;

  beforeEach(() => {
    repo = makeTempDir('cdd-testrun-repo-');
    home = makeTempDir('cdd-testrun-home-');
    mkdirSync(join(repo, 'specs', 'changes', 'demo'), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(repo);
    cleanupDir(home);
  });

  const changeDir = (): string => join(repo, 'specs', 'changes', 'demo');
  const evidence = (): Record<string, any> =>
    yaml.load(readFileSync(join(changeDir(), 'test-evidence.yml'), 'utf8')) as Record<string, any>;

  it('records a passing run and writes schema-valid evidence', () => {
    const r = runCli(
      ['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_PASS, '--required-phases', 'targeted', '--run-id', 'r1', '--json'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);

    const summary = JSON.parse(r.stdout);
    expect(summary.status).toBe('passed');
    expect(summary.exit_code).toBe(0);
    expect(summary.first_failure).toBeNull();

    const runDir = join(changeDir(), 'test-runs', 'r1');
    for (const f of ['command.txt', 'stdout.log', 'stderr.log', 'summary.json']) {
      expect(existsSync(join(runDir, f)), `${f} missing`).toBe(true);
    }

    const ev = evidence();
    expect(validateEvidence(ev), JSON.stringify(validateEvidence.errors)).toBe(true);
    expect(ev['final-status']).toBe('passed');
    expect(ev.runs).toHaveLength(1);
    expect(ev.runs[0]).toMatchObject({ phase: 'targeted', status: 'passed' });
  });

  it('records a failing run and blocks (exit 1, status failed)', () => {
    const r = runCli(
      ['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_FAIL, '--run-id', 'rf', '--json'],
      { cwd: repo, home },
    );
    expect(r.status).toBe(1);

    const summary = JSON.parse(r.stdout);
    expect(summary.status).toBe('failed');
    expect(summary.exit_code).toBe(1);
    expect(summary.first_failure.kind).toBe('unknown');

    const ev = evidence();
    expect(validateEvidence(ev), JSON.stringify(validateEvidence.errors)).toBe(true);
    expect(ev.runs[0].status).toBe('failed');
    expect(ev['final-status']).toBe('failed');
  });

  it('reports a timeout when the command exceeds --timeout', () => {
    const r = runCli(
      ['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_HANG, '--timeout', '1000', '--run-id', 'rt', '--json'],
      { cwd: repo, home },
    );
    expect(r.status).toBe(1);
    const summary = JSON.parse(r.stdout);
    expect(summary.status).toBe('timeout');
    expect(summary.first_failure.kind).toBe('timeout');
  }, 20000);

  it('caps assistant-visible output but keeps the full stdout log', () => {
    const r = runCli(
      ['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_BIG_FAIL, '--run-id', 'rc'],
      { cwd: repo, home },
    );
    expect(r.status).toBe(1);
    // The command produced 200k chars; assistant-visible stdout stays bounded.
    expect(r.stdout.length).toBeLessThan(8000);
    const full = readFileSync(join(changeDir(), 'test-runs', 'rc', 'stdout.log'), 'utf8');
    expect(full.length).toBeGreaterThanOrEqual(300000);
  });

  it('exits 2 with no artifacts when --command is missing', () => {
    const r = runCli(['test', 'run', 'demo', '--phase', 'targeted', '--json'], { cwd: repo, home });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).status).toBe('no-command');
    expect(existsSync(join(changeDir(), 'test-runs'))).toBe(false);
    expect(existsSync(join(changeDir(), 'test-evidence.yml'))).toBe(false);
  });

  it('exits 2 on an invalid phase', () => {
    const r = runCli(['test', 'run', 'demo', '--phase', 'smoke', '--command', NODE_PASS], { cwd: repo, home });
    expect(r.status).toBe(2);
  });

  it('exits 2 when the change directory does not exist', () => {
    const r = runCli(['test', 'run', 'ghost', '--phase', 'targeted', '--command', NODE_PASS], { cwd: repo, home });
    expect(r.status).toBe(2);
  });

  it('upserts a re-run of the same phase instead of duplicating it', () => {
    runCli(['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_FAIL, '--run-id', 'a1', '--required-phases', 'targeted'], { cwd: repo, home });
    runCli(['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_PASS, '--run-id', 'a2', '--required-phases', 'targeted'], { cwd: repo, home });

    const ev = evidence();
    const targeted = ev.runs.filter((x: Record<string, unknown>) => x.phase === 'targeted');
    expect(targeted).toHaveLength(1);
    expect(targeted[0].status).toBe('passed');
    expect(targeted[0].summary).toContain('a2');
    expect(ev['final-status']).toBe('passed');
  });

  it('rejects a change id that escapes specs/changes (path traversal)', () => {
    const r = runCli(['test', 'run', '..', '--phase', 'targeted', '--command', NODE_PASS, '--json'], { cwd: repo, home });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).reason).toBe('invalid change id');
  });

  it('rejects reuse of an explicit --run-id across phases', () => {
    const first = runCli(['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_PASS, '--run-id', 'dup'], { cwd: repo, home });
    expect(first.status).toBe(0);
    const second = runCli(['test', 'run', 'demo', '--phase', 'changed-area', '--command', NODE_PASS, '--run-id', 'dup'], { cwd: repo, home });
    expect(second.status).toBe(2);
  });

  it('kills the whole process tree on timeout (no orphaned writes)', async () => {
    const sentinel = join(repo, 'orphan-sentinel.txt');
    // The shell launches a node child that writes the sentinel after 2.5s. With a
    // 0.8s timeout, a tree-kill must take the child down before it ever writes.
    const cmd = `node -e "setTimeout(function(){require('fs').writeFileSync('${sentinel}', 'x')}, 2500)"`;
    const r = runCli(['test', 'run', 'demo', '--phase', 'targeted', '--command', cmd, '--timeout', '800', '--run-id', 'tk', '--json'], { cwd: repo, home });
    expect(JSON.parse(r.stdout).status).toBe('timeout');
    await new Promise((res) => setTimeout(res, 3000));
    expect(existsSync(sentinel)).toBe(false);
  }, 20000);

  it('runs a shell-composed command verbatim (no pytest flags appended)', () => {
    const cmd = 'pytest tests && echo done';
    runCli(['test', 'run', 'demo', '--phase', 'targeted', '--command', cmd, '--run-id', 'cmp'], { cwd: repo, home });
    const written = readFileSync(join(changeDir(), 'test-runs', 'cmp', 'command.txt'), 'utf8').trim();
    expect(written).toBe(cmd);
  });

  it('reserves distinct run dirs for back-to-back auto runs', () => {
    runCli(['test', 'run', 'demo', '--phase', 'targeted', '--command', NODE_PASS], { cwd: repo, home });
    runCli(['test', 'run', 'demo', '--phase', 'changed-area', '--command', NODE_PASS], { cwd: repo, home });
    const dirs = readdirSync(join(changeDir(), 'test-runs'));
    expect(dirs.length).toBe(2);
    for (const d of dirs) {
      expect(existsSync(join(changeDir(), 'test-runs', d, 'summary.json'))).toBe(true);
    }
  });
});

describe('test-run helpers (unit)', () => {
  it('isPytestCommand detects pytest invocations, not pytest-as-argument', () => {
    expect(isPytestCommand('python -m pytest tests/x.py')).toBe(true);
    expect(isPytestCommand('python3 -m pytest')).toBe(true);
    expect(isPytestCommand('pytest -q')).toBe(true);
    expect(isPytestCommand('py.test')).toBe(true);
    expect(isPytestCommand('.venv/bin/pytest tests/')).toBe(true);
    expect(isPytestCommand('PYTHONPATH=. pytest')).toBe(true);
    expect(isPytestCommand('npm run pytest')).toBe(false);
    expect(isPytestCommand('npm test')).toBe(false);
    expect(isPytestCommand('tox -e py -- python -m pytest tests')).toBe(false);
    expect(isPytestCommand('echo python -m pytest')).toBe(false);
    expect(isPytestCommand('node -e "x"')).toBe(false);
  });

  it('hasShellControl detects shell composition', () => {
    expect(hasShellControl('pytest tests/x.py::test_y')).toBe(false);
    expect(hasShellControl('pytest tests && coverage report')).toBe(true);
    expect(hasShellControl('pytest tests | tee log')).toBe(true);
    expect(hasShellControl('pytest tests > out.log')).toBe(true);
    expect(hasShellControl('pytest tests; echo done')).toBe(true);
    expect(hasShellControl('pytest $(ls)')).toBe(true);
  });

  it('augmentPytestCommand adds the bounded defaults and JUnit output', () => {
    const out = augmentPytestCommand('python -m pytest tests/x.py::test_y', '/run/junit.xml');
    expect(out).toContain('--junitxml=');
    expect(out).toContain('/run/junit.xml');
    expect(out).toContain('-q');
    expect(out).toContain('--maxfail=1');
    expect(out).toContain('--tb=short');
    expect(out).toContain('-ra');
  });

  it('augmentPytestCommand enforces stricter bounds over looser flags', () => {
    const out = augmentPytestCommand('pytest x --maxfail=0 --tb=long -v', '/run/junit.xml');
    expect(out).toContain('--maxfail=1'); // --maxfail=0 (unlimited) is looser, not stricter
    expect(out).toContain('--tb=short');  // --tb=long is looser
    expect(out).toContain('-q');          // -v must not suppress the quiet bound
    expect(out).toContain('/run/junit.xml');
  });

  it('augmentPytestCommand reads the last occurrence of a repeated bound', () => {
    // pytest applies the last --maxfail; --maxfail=1 then =0 is effectively unlimited.
    const out = augmentPytestCommand('pytest x --maxfail=1 --maxfail=0', '/run/junit.xml');
    expect(out.match(/--maxfail=\d+/g)!.pop()).toBe('--maxfail=1'); // our bound is appended last and wins
  });

  it('augmentPytestCommand respects already-strict flags but always forces the run-dir JUnit', () => {
    const original = 'pytest x -x --tb=line -q -rn --junitxml=keep.xml';
    const out = augmentPytestCommand(original, '/run/junit.xml');
    expect(out.startsWith(`${original} --junitxml=`)).toBe(true);
    expect(out).toContain('/run/junit.xml');  // run-dir JUnit forced (last wins)
    expect(out).not.toContain('--maxfail=1'); // -x already fail-fast
    expect(out).not.toContain('--tb=short');  // --tb=line already tighter
    // Only the forced JUnit flag is appended; no extra -q/-ra/maxfail/tb.
    expect(out.slice(original.length).trim().split(/\s+/).length).toBe(1);
  });

  it('parseJunitFirstFailure extracts an assertion failure', () => {
    const xml =
      '<testsuite><testcase classname="tests.t" name="test_a" file="tests/t.py" line="41">' +
      '<failure message="assert 1 == 2">E assert 1 == 2</failure></testcase></testsuite>';
    const ff = parseJunitFirstFailure(xml);
    expect(ff?.kind).toBe('assertion-failure');
    expect(ff?.nodeid).toBe('tests/t.py::test_a');
    expect(ff?.line).toBe(41);
    expect(ff?.message).toContain('assert');
  });

  it('parseJunitFirstFailure skips a self-closing passing testcase before a failure', () => {
    const xml =
      '<testsuite>' +
      '<testcase classname="t" name="test_pass" file="t.py"/>' +
      '<testcase classname="t" name="test_fail" file="t.py" line="9"><failure message="boom">E boom</failure></testcase>' +
      '</testsuite>';
    const ff = parseJunitFirstFailure(xml);
    expect(ff?.nodeid).toBe('t.py::test_fail');
    expect(ff?.line).toBe(9);
  });

  it('parseJunitFirstFailure classifies an import error from <error>', () => {
    const xml =
      '<testsuite><testcase classname="tests.t" name="test_a" file="tests/t.py">' +
      '<error message="ModuleNotFoundError: No module named foo">trace</error></testcase></testsuite>';
    expect(parseJunitFirstFailure(xml)?.kind).toBe('import-error');
  });

  it('parseJunitFirstFailure returns null on malformed XML', () => {
    expect(parseJunitFirstFailure('<testsuite><testcase oops')).toBeNull();
    expect(parseJunitFirstFailure('not xml at all')).toBeNull();
  });

  it('parseJunitFirstFailure returns null when all tests passed', () => {
    expect(parseJunitFirstFailure('<testsuite><testcase name="ok"/></testsuite>')).toBeNull();
  });

  it('classifyFailure maps text patterns and pytest exit codes', () => {
    expect(classifyFailure({ exitCode: 1, stdout: 'ModuleNotFoundError: No module named foo', stderr: '', junitXml: null, command: 'pytest x' }).kind).toBe('import-error');
    expect(classifyFailure({ exitCode: 1, stdout: 'E AssertionError: nope', stderr: '', junitXml: null, command: 'pytest x' }).kind).toBe('assertion-failure');
    expect(classifyFailure({ exitCode: 1, stdout: 'ERROR collecting tests/x.py', stderr: '', junitXml: null, command: 'pytest x' }).kind).toBe('collection-error');
    expect(classifyFailure({ exitCode: 1, stdout: 'drift', stderr: '', junitXml: null, command: 'cdd-kit validate --contracts' }).kind).toBe('contract-drift');
    expect(classifyFailure({ exitCode: 5, stdout: '', stderr: '', junitXml: null, command: 'python -m pytest x' }).kind).toBe('collection-error');
    expect(classifyFailure({ exitCode: 7, stdout: 'weird', stderr: '', junitXml: null, command: 'node x' }).kind).toBe('unknown');
  });

  it('classifyFailure prefers JUnit over text', () => {
    const xml = '<testsuite><testcase name="t" file="t.py"><failure message="boom"/></testcase></testsuite>';
    expect(classifyFailure({ exitCode: 1, stdout: 'ModuleNotFoundError', stderr: '', junitXml: xml, command: 'pytest x' }).kind).toBe('assertion-failure');
  });
});
