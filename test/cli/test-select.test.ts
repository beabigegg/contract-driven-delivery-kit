import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import {
  isBareTargetShape,
  formatTarget,
  isPytestTestFile,
  isJsTestFile,
  parseMarkdownTable,
  extractQualityGates,
  detectContractAffected,
} from '../../src/commands/test-select.js';

const PLAN_HEADING = '## Acceptance Criteria → Test Mapping';

function planWithTarget(target: string): string {
  return [
    '---',
    'change-id: demo',
    'schema-version: 0.1.0',
    '---',
    '',
    '# Test Plan: demo',
    '',
    PLAN_HEADING,
    '',
    '| criterion id | test family | test file path | tier |',
    '|---|---|---|---|',
    `| AC-1 | unit | ${target} | 0 |`,
    '',
  ].join('\n');
}

describe('cdd-kit test select (integration)', () => {
  let repo: string;
  let home: string;

  beforeEach(() => {
    repo = makeTempDir('cdd-testselect-repo-');
    home = makeTempDir('cdd-testselect-home-');
    mkdirSync(join(repo, 'specs', 'changes', 'demo'), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(repo);
    cleanupDir(home);
  });

  const changeDir = (): string => join(repo, 'specs', 'changes', 'demo');
  const writePlan = (content: string): void => writeFileSync(join(changeDir(), 'test-plan.md'), content, 'utf8');
  const write = (name: string, content: string): void => writeFileSync(join(changeDir(), name), content, 'utf8');
  // Create a file/dir under the repo so on-disk existence checks pass.
  const touch = (rel: string, content = ''): void => {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  };
  const mkdir = (rel: string): void => mkdirSync(join(repo, rel), { recursive: true });

  it('selects ADR-shaped commands from an explicit, on-disk test-plan mapping', () => {
    touch('tests/orders/test_filter.py');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_status_filter_options'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    const sel = JSON.parse(r.stdout);
    expect(sel.status).toBe('selected');
    expect(sel.phases.collect[0].command).toBe(
      'python -m pytest --collect-only -q tests/orders/test_filter.py::test_status_filter_options',
    );
    expect(sel.phases.targeted[0].command).toBe(
      'python -m pytest tests/orders/test_filter.py::test_status_filter_options -q --maxfail=1 --tb=short -ra',
    );
    expect(sel.phases.full[0].command).toBe('python -m pytest -q --maxfail=1 --tb=short -ra');
  });

  it('selects Vitest commands for JS/TS targets in a detected npm project', () => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      name: 'demo',
      scripts: { test: 'vitest' },
      devDependencies: { vitest: '^2.0.0' },
    }, null, 2));
    touch('src/orders/filter.test.ts');
    writePlan(planWithTarget('src/orders/filter.test.ts'));

    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.collect).toBeUndefined();
    expect(sel.phases.targeted[0].command).toBe('npm test -- --run src/orders/filter.test.ts');
    expect(sel.phases.full[0].command).toBe('npm test -- --run');
  });

  it('asks for explicit commands when a JS target exists but no bounded JS runner is detected', () => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node test.js' } }, null, 2));
    touch('src/orders/filter.test.ts');
    writePlan(planWithTarget('src/orders/filter.test.ts'));

    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    const sel = JSON.parse(r.stdout);
    expect(sel.status).toBe('needs-test-plan-update');
    expect(sel.reason).toMatch(/cannot infer a bounded runner/);
  });

  it('accepts an existing directory target (no trailing slash needed)', () => {
    mkdir('tests/orders');
    writePlan(planWithTarget('tests/orders'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(0);
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.targeted[0].command).toBe('python -m pytest tests/orders -q --maxfail=1 --tb=short -ra');
  });

  it('accepts a real path under an example/ directory (existence, not word-matching)', () => {
    touch('tests/example/test_api.py');
    writePlan(planWithTarget('tests/example/test_api.py'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(0);
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.targeted[0].command).toContain('tests/example/test_api.py');
  });

  it('trusts and emits a full pytest command cell verbatim', () => {
    writePlan(planWithTarget('tests/unit/test_xxx.py')); // not on disk -> placeholder, ignored
    write('implementation-plan.md', [
      '# Implementation Plan',
      '',
      '## Test Execution Plan',
      '',
      '| acceptance criterion | test file / command | expected signal |',
      '|---|---|---|',
      '| AC-2 | python -m pytest tests/api/test_orders.py::test_create --cov src/pkg | 201 |',
      '',
    ].join('\n'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(0);
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.targeted[0]).toMatchObject({
      command: 'python -m pytest tests/api/test_orders.py::test_create --cov src/pkg',
      reason: 'AC-2 mapped in implementation-plan.md',
    });
    expect(sel.phases.targeted[0].target).toBeUndefined(); // verbatim command, not a parsed target
  });

  it('returns needs-test-plan-update for an unfilled mapping (target not on disk)', () => {
    writePlan(planWithTarget('tests/unit/test_xxx.py'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).status).toBe('needs-test-plan-update');
  });

  it('returns needs-test-plan-update (exit 1) when test-plan.md is missing', () => {
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).reason).toContain('test-plan.md not found');
  });

  it('rejects a change id that escapes specs/changes (exit 2)', () => {
    const r = runCli(['test', 'select', '..', '--json'], { cwd: repo, home });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).reason).toBe('invalid change id');
  });

  it('exits 2 when the change directory does not exist', () => {
    const r = runCli(['test', 'select', 'ghost', '--json'], { cwd: repo, home });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).status).toBe('error');
  });

  it('adds the contract phase when implementation-plan.md declares contract updates', () => {
    touch('tests/orders/test_filter.py');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    write('implementation-plan.md', '# Implementation Plan\n\n## Contract Updates\n\n- API: add status filter query param\n');
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.contract[0].command).toBe('cdd-kit validate --contracts');
  });

  it('emits the env validator for an env contract update', () => {
    touch('tests/orders/test_filter.py');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    write('implementation-plan.md', '# Implementation Plan\n\n## Contract Updates\n\n- Env: add FEATURE_FLAG\n');
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(JSON.parse(r.stdout).phases.contract[0].command).toBe('cdd-kit validate --contracts --env');
  });

  it('emits the quality phase from configured ci-gates.md commands', () => {
    touch('tests/orders/test_filter.py');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    write('ci-gates.md', [
      '# CI/CD Gate Plan',
      '',
      '## Required Gates',
      '| gate | tier | required | trigger | command/workflow | expected artifact |',
      '|---|---:|---:|---|---|---|',
      '| lint | 1 | yes | pull_request | ruff check . | lint.log |',
      '| build | 1 | yes | pull_request |  |  |',
      '',
    ].join('\n'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.quality).toEqual([{ reason: 'lint gate configured in ci-gates.md', command: 'ruff check .' }]);
  });

  it('adds the acceptance phase when a pytest acceptance driver exists under tests/acceptance/', () => {
    touch('tests/orders/test_filter.py');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    touch('tests/acceptance/test_over_limit.py', 'def test_over_limit():\n    assert True\n');
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.acceptance).toBeDefined();
    expect(sel.phases.acceptance[0].command).toMatch(/pytest tests\/acceptance/);
  });

  it('does not add the acceptance phase when no acceptance driver files exist', () => {
    touch('tests/orders/test_filter.py');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.acceptance).toBeUndefined();
  });

  it('runs the directory of a changed conftest.py (changed-area)', () => {
    if (spawnSync('git', ['init'], { cwd: repo }).status !== 0) return; // git unavailable -> skip
    touch('tests/orders/test_filter.py');
    touch('tests/pkg/conftest.py', 'import pytest\n');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const changed = JSON.parse(r.stdout).phases['changed-area'] as Array<{ target: string; reason: string }>;
    const hit = changed.find((e) => e.target === 'tests/pkg/');
    expect(hit, JSON.stringify(changed)).toBeTruthy();
    expect(hit!.reason).toBe('changed conftest');
  });

  it('runs a changed test file directly (changed-area)', () => {
    if (spawnSync('git', ['init'], { cwd: repo }).status !== 0) return; // git unavailable -> skip
    touch('tests/orders/test_filter.py');
    touch('tests/extra/test_touch.py', 'def test_touch():\n    assert True\n');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const changed = JSON.parse(r.stdout).phases['changed-area'] as Array<{ target: string; reason: string }>;
    const hit = changed.find((e) => e.target === 'tests/extra/test_touch.py');
    expect(hit, JSON.stringify(changed)).toBeTruthy();
    expect(hit!.reason).toBe('changed test file');
  });

  it('prints a human-readable plan without --json', () => {
    touch('tests/orders/test_filter.py');
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    const r = runCli(['test', 'select', 'demo'], { cwd: repo, home });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('python -m pytest');
    expect(r.stdout).toContain('targeted:');
  });
});

describe('test-select helpers (unit)', () => {
  it('isBareTargetShape accepts file/node/dir shapes and rejects unsafe ones', () => {
    expect(isBareTargetShape('tests/orders/test_filter.py')).toBe(true);
    expect(isBareTargetShape('tests/orders/test_filter.py::test_x')).toBe(true);
    expect(isBareTargetShape('tests/orders/test_filter.py::test_x[1-2]')).toBe(true);
    expect(isBareTargetShape('src/orders/filter.test.ts')).toBe(true);
    expect(isBareTargetShape('tests/orders')).toBe(true);
    expect(isBareTargetShape('tests/orders/')).toBe(true);
    expect(isBareTargetShape('npm test')).toBe(false); // space
    expect(isBareTargetShape('pytest && rm -rf /')).toBe(false);
    expect(isBareTargetShape('tests/../../external')).toBe(false); // traversal
    expect(isBareTargetShape('')).toBe(false);
  });

  it('formatTarget quotes parametrized node ids and leaves simple ones bare', () => {
    expect(formatTarget('tests/x.py::test_y')).toBe('tests/x.py::test_y');
    const expected = process.platform === 'win32'
      ? '"tests/x.py::test_y[1-2]"'
      : "'tests/x.py::test_y[1-2]'";
    expect(formatTarget('tests/x.py::test_y[1-2]')).toBe(expected);
  });

  it('isPytestTestFile recognizes pytest filename conventions', () => {
    expect(isPytestTestFile('tests/test_x.py')).toBe(true);
    expect(isPytestTestFile('pkg/x_test.py')).toBe(true);
    expect(isPytestTestFile('src/x.py')).toBe(false);
    expect(isPytestTestFile('tests/x.test.ts')).toBe(false);
  });

  it('isJsTestFile recognizes common JS/TS test filename conventions', () => {
    expect(isJsTestFile('src/orders/filter.test.ts')).toBe(true);
    expect(isJsTestFile('src/orders/filter.spec.tsx')).toBe(true);
    expect(isJsTestFile('src/orders/filter.ts')).toBe(false);
  });

  it('parseMarkdownTable reads the first table under a heading, else null', () => {
    const table = parseMarkdownTable(planWithTarget('tests/orders/test_filter.py::test_x'), /acceptance criteria.*test mapping/i);
    expect(table?.headers).toEqual(['criterion id', 'test family', 'test file path', 'tier']);
    expect(table?.rows[0][2]).toBe('tests/orders/test_filter.py::test_x');
    expect(parseMarkdownTable('# No tables here\n\nprose', /acceptance criteria/i)).toBeNull();
  });

  it('detectContractAffected maps each contract family to the right validate command', () => {
    expect(detectContractAffected(['contracts/api/api-contract.md'], '')).toMatchObject({
      command: 'cdd-kit validate --contracts',
      reason: 'contract files changed',
    });
    expect(detectContractAffected(['contracts/env/env-contract.md'], '')?.command).toBe('cdd-kit validate --contracts --env');
    expect(detectContractAffected(['contracts/ci/ci-gate-contract.md'], '')?.command).toBe('cdd-kit validate --contracts --ci');
    expect(detectContractAffected([], '## Contract Updates\n- API: add field\n')?.command).toBe('cdd-kit validate --contracts');
    expect(detectContractAffected([], '## Contract Updates\n- Env: rotate key\n')?.command).toBe('cdd-kit validate --contracts --env');
    expect(detectContractAffected([], '## Contract Updates\n- CI/CD: add nightly job\n')?.command).toBe('cdd-kit validate --contracts --ci');
    expect(detectContractAffected([], '## Contract Updates\n- Add status to the API contract\n')?.command).toBe('cdd-kit validate --contracts');
    expect(detectContractAffected([], '## Contract Updates\n- API:\n- Env:\n')).toBeNull();
    expect(detectContractAffected([], 'no contract section')).toBeNull();
  });

  it('extractQualityGates selects runnable lint/build/typecheck commands only', () => {
    const text = [
      '## Required Gates',
      '| gate | required | command/workflow |',
      '|---|---|---|',
      '| lint | yes | ruff check . |',
      '| build | yes |  |',           // empty command -> skipped
      '| unit | yes | pytest tests |', // not a quality gate -> skipped
      '| typecheck | no | mypy src |', // required: no -> skipped
    ].join('\n');
    expect(extractQualityGates(text)).toEqual([{ reason: 'lint gate configured in ci-gates.md', command: 'ruff check .' }]);
    expect(extractQualityGates('no table here')).toEqual([]);

    // a workflow-only column whose value is a .yml ref is not a runnable command
    const workflowOnly = ['## Required Gates', '| gate | required | workflow |', '|---|---|---|', '| lint | yes | ci.yml |'].join('\n');
    expect(extractQualityGates(workflowOnly)).toEqual([]);

    // a markdown inline-code command has its backticks stripped before emitting
    const inlineCode = ['## Required Gates', '| gate | required | command |', '|---|---|---|', '| typecheck | yes | `npm run typecheck` |'].join('\n');
    expect(extractQualityGates(inlineCode)).toEqual([{ reason: 'typecheck gate configured in ci-gates.md', command: 'npm run typecheck' }]);
  });
});
