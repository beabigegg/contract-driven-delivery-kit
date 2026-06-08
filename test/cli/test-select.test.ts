import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import {
  isPlaceholderTarget,
  isUsablePytestTarget,
  cellToTarget,
  formatTarget,
  isPytestTestFile,
  parseMarkdownTable,
  extractMappedTargets,
  extractQualityGates,
  detectContractAffected,
  findTestDependents,
} from '../../src/commands/test-select.js';
import type { FileEntry } from '../../src/code-map/types.js';

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

  it('selects ADR-shaped commands from an explicit test-plan mapping', () => {
    writePlan(planWithTarget('tests/orders/test_filter.py::test_status_filter_options'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    const sel = JSON.parse(r.stdout);
    expect(sel.status).toBe('selected');
    expect(sel.change_id).toBe('demo');

    expect(sel.phases.collect[0]).toMatchObject({
      target: 'tests/orders/test_filter.py::test_status_filter_options',
      command: 'python -m pytest --collect-only -q tests/orders/test_filter.py::test_status_filter_options',
      reason: 'AC-1 mapped in test-plan.md',
    });
    expect(sel.phases.targeted[0].command).toBe(
      'python -m pytest tests/orders/test_filter.py::test_status_filter_options -q --maxfail=1 --tb=short -ra',
    );
    expect(sel.phases.full[0].command).toBe('python -m pytest -q --maxfail=1 --tb=short -ra');
  });

  it('accepts a directory target without a trailing slash', () => {
    writePlan(planWithTarget('tests/orders'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(0);
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.targeted[0].command).toBe('python -m pytest tests/orders -q --maxfail=1 --tb=short -ra');
  });

  it('falls back to the directory of mapped targets for changed-area (no git signal)', () => {
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    expect(sel.phases['changed-area']).toHaveLength(1);
    expect(sel.phases['changed-area'][0]).toMatchObject({
      target: 'tests/orders/',
      reason: 'directory of test-plan targets',
      command: 'python -m pytest tests/orders/ -q --maxfail=1 --tb=short -ra',
    });
  });

  it('returns needs-test-plan-update for an unfilled (placeholder) test-plan', () => {
    writePlan(planWithTarget('tests/unit/test_xxx.py'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).status).toBe('needs-test-plan-update');
  });

  it('returns needs-test-plan-update (exit 1) when test-plan.md is missing', () => {
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(1);
    const sel = JSON.parse(r.stdout);
    expect(sel.status).toBe('needs-test-plan-update');
    expect(sel.reason).toContain('test-plan.md not found');
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
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    write('implementation-plan.md', '# Implementation Plan\n\n## Contract Updates\n\n- API: add status filter query param\n');
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.contract).toHaveLength(1);
    expect(sel.phases.contract[0].command).toBe('cdd-kit validate --contracts');
    expect(sel.phases.contract[0].reason).toContain('implementation-plan.md');
  });

  it('emits the env validator for an env contract update', () => {
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    write('implementation-plan.md', '# Implementation Plan\n\n## Contract Updates\n\n- Env: add FEATURE_FLAG\n');
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.contract[0].command).toBe('cdd-kit validate --contracts --env');
  });

  it('emits the quality phase from configured ci-gates.md commands', () => {
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
    expect(sel.phases.quality).toHaveLength(1);
    expect(sel.phases.quality[0]).toMatchObject({ command: 'ruff check .', reason: 'lint gate configured in ci-gates.md' });
  });

  it('selects a full pytest command cell as a bounded target (implementation-plan fallback)', () => {
    writePlan(planWithTarget('tests/unit/test_xxx.py')); // placeholder only
    write('implementation-plan.md', [
      '# Implementation Plan',
      '',
      '## Test Execution Plan',
      '',
      '| acceptance criterion | test file / command | expected signal |',
      '|---|---|---|',
      '| AC-2 | python -m pytest tests/api/test_orders.py::test_create -q | 201 returned |',
      '',
    ].join('\n'));
    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    expect(r.status).toBe(0);
    const sel = JSON.parse(r.stdout);
    expect(sel.phases.targeted[0]).toMatchObject({
      target: 'tests/api/test_orders.py::test_create',
      command: 'python -m pytest tests/api/test_orders.py::test_create -q --maxfail=1 --tb=short -ra',
      reason: 'AC-2 mapped in implementation-plan.md',
    });
  });

  it('uses changed test files for changed-area when git reports them', () => {
    if (spawnSync('git', ['init'], { cwd: repo }).status !== 0) return; // git unavailable -> skip
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    mkdirSync(join(repo, 'tests', 'extra'), { recursive: true });
    writeFileSync(join(repo, 'tests', 'extra', 'test_touch.py'), 'def test_touch():\n    assert True\n', 'utf8');

    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home });
    const sel = JSON.parse(r.stdout);
    const changed = sel.phases['changed-area'] as Array<{ target: string; reason: string }>;
    const hit = changed.find((e) => e.target === 'tests/extra/test_touch.py');
    expect(hit, JSON.stringify(changed)).toBeTruthy();
    expect(hit!.reason).toBe('changed test file');
    expect(changed.some((e) => e.reason === 'directory of test-plan targets')).toBe(false);
  });

  it('refreshes the code-map before deriving changed-area without crashing', () => {
    if (spawnSync('git', ['init'], { cwd: repo }).status !== 0) return; // git unavailable -> skip
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'service.py'), 'def f():\n    return 1\n', 'utf8'); // touched source -> refresh path

    const r = runCli(['test', 'select', 'demo', '--json'], { cwd: repo, home }); // no --no-refresh
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).status).toBe('selected');
  }, 20000);

  it('prints a human-readable plan without --json', () => {
    writePlan(planWithTarget('tests/orders/test_filter.py::test_x'));
    const r = runCli(['test', 'select', 'demo', '--no-refresh'], { cwd: repo, home });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('python -m pytest');
    expect(r.stdout).toContain('targeted:');
  });
});

describe('test-select helpers (unit)', () => {
  it('isPlaceholderTarget flags scaffold tokens, not real targets', () => {
    expect(isPlaceholderTarget('tests/unit/test_xxx.py')).toBe(true);
    expect(isPlaceholderTarget('tests/example/test_old.py')).toBe(true);
    expect(isPlaceholderTarget('<id>')).toBe(true);
    expect(isPlaceholderTarget('')).toBe(true);
    expect(isPlaceholderTarget('-')).toBe(true);
    expect(isPlaceholderTarget('n/a')).toBe(true);
    expect(isPlaceholderTarget('TODO')).toBe(true); // whole-value marker
    expect(isPlaceholderTarget('tests/orders/test_filter.py::test_x')).toBe(false);
    expect(isPlaceholderTarget('tests/todo/test_api.py')).toBe(false); // real `todo` package
  });

  it('isUsablePytestTarget accepts files, node ids, and dirs (slash or not) only', () => {
    expect(isUsablePytestTarget('tests/orders/test_filter.py')).toBe(true);
    expect(isUsablePytestTarget('tests/orders/test_filter.py::test_x')).toBe(true);
    expect(isUsablePytestTarget('tests/orders/test_filter.py::test_x[1-2]')).toBe(true);
    expect(isUsablePytestTarget('tests/orders/')).toBe(true);
    expect(isUsablePytestTarget('tests/orders')).toBe(true); // directory, no trailing slash
    expect(isUsablePytestTarget('tests/todo/test_api.py')).toBe(true); // real `todo` package, not a placeholder
    expect(isUsablePytestTarget('tests/unit/test_xxx.py')).toBe(false); // placeholder
    expect(isUsablePytestTarget('npm test')).toBe(false);
    expect(isUsablePytestTarget('pytest && rm -rf /')).toBe(false);
    expect(isUsablePytestTarget('unit')).toBe(false); // bare word, no separator
    expect(isUsablePytestTarget('tests/../../external_suite')).toBe(false); // path traversal
    expect(isUsablePytestTarget('tests/../other.py')).toBe(false); // path traversal
  });

  it('cellToTarget extracts a bounded target from a bare cell or a pytest command', () => {
    expect(cellToTarget('tests/x.py::test_y')).toBe('tests/x.py::test_y');
    expect(cellToTarget('python -m pytest tests/x.py::test_y -q')).toBe('tests/x.py::test_y');
    expect(cellToTarget('pytest -k expr tests/orders')).toBe('tests/orders');
    expect(cellToTarget("python -m pytest 'tests/x.py::test_y[case]' -q")).toBe('tests/x.py::test_y[case]');
    expect(cellToTarget('python -m pytest --ignore tests/slow tests/api')).toBe('tests/api');
    expect(cellToTarget('`python -m pytest tests/x.py::test_y -q`')).toBe('tests/x.py::test_y'); // markdown inline code
    expect(cellToTarget('npm run build')).toBeNull();
    expect(cellToTarget('python -m pytest -q')).toBeNull(); // command, but no target token
  });

  it('formatTarget quotes parametrized node ids and leaves simple ones bare', () => {
    expect(formatTarget('tests/x.py::test_y')).toBe('tests/x.py::test_y');
    expect(formatTarget('tests/x.py::test_y[1-2]')).toBe("'tests/x.py::test_y[1-2]'");
  });

  it('isPytestTestFile recognizes pytest filename conventions', () => {
    expect(isPytestTestFile('tests/test_x.py')).toBe(true);
    expect(isPytestTestFile('pkg/x_test.py')).toBe(true);
    expect(isPytestTestFile('src/x.py')).toBe(false);
    expect(isPytestTestFile('tests/x.test.ts')).toBe(false);
  });

  it('parseMarkdownTable reads the first table under a heading, else null', () => {
    const table = parseMarkdownTable(planWithTarget('tests/orders/test_filter.py::test_x'), /acceptance criteria.*test mapping/i);
    expect(table?.headers).toEqual(['criterion id', 'test family', 'test file path', 'tier']);
    expect(table?.rows[0][2]).toBe('tests/orders/test_filter.py::test_x');
    expect(parseMarkdownTable('# No tables here\n\nprose', /acceptance criteria/i)).toBeNull();
  });

  it('extractMappedTargets pairs targets with criteria and skips placeholders', () => {
    const table = parseMarkdownTable(planWithTarget('tests/orders/test_filter.py::test_x'), /acceptance criteria.*test mapping/i);
    expect(extractMappedTargets(table, 'test-plan.md')).toEqual([
      { target: 'tests/orders/test_filter.py::test_x', reason: 'AC-1 mapped in test-plan.md' },
    ]);
    const placeholder = parseMarkdownTable(planWithTarget('tests/unit/test_xxx.py'), /acceptance criteria.*test mapping/i);
    expect(extractMappedTargets(placeholder, 'test-plan.md')).toEqual([]);
  });

  it('extractQualityGates selects configured lint/build/typecheck commands only', () => {
    const text = [
      '## Required Gates',
      '| gate | required | command/workflow |',
      '|---|---|---|',
      '| lint | yes | ruff check . |',
      '| build | yes |  |',           // empty command -> skipped
      '| unit | yes | pytest tests |', // not a quality gate -> skipped
      '| typecheck | no | mypy src |', // required: no -> skipped
    ].join('\n');
    expect(extractQualityGates(text)).toEqual([
      { reason: 'lint gate configured in ci-gates.md', command: 'ruff check .' },
    ]);
    expect(extractQualityGates('no table here')).toEqual([]);

    // a workflow-only column whose value is a .yml ref is not a runnable command
    const workflowOnly = [
      '## Required Gates',
      '| gate | required | workflow |',
      '|---|---|---|',
      '| lint | yes | ci.yml |',
    ].join('\n');
    expect(extractQualityGates(workflowOnly)).toEqual([]);

    // a markdown inline-code command has its backticks stripped before emitting
    const inlineCode = [
      '## Required Gates',
      '| gate | required | command |',
      '|---|---|---|',
      '| typecheck | yes | `npm run typecheck` |',
    ].join('\n');
    expect(extractQualityGates(inlineCode)).toEqual([
      { reason: 'typecheck gate configured in ci-gates.md', command: 'npm run typecheck' },
    ]);
  });

  it('detectContractAffected maps each contract family to the right validate command', () => {
    expect(detectContractAffected(['contracts/api/api-contract.md'], '')).toMatchObject({
      command: 'cdd-kit validate --contracts',
      reason: 'contract files changed',
    });
    expect(detectContractAffected(['contracts/env/env-contract.md'], '')?.command).toBe('cdd-kit validate --contracts --env');
    expect(detectContractAffected(['contracts/ci/ci-gate-contract.md'], '')?.command).toBe('cdd-kit validate --contracts --ci');
    expect(detectContractAffected([], '## Contract Updates\n- API: add field\n')).toMatchObject({
      command: 'cdd-kit validate --contracts',
      reason: 'implementation-plan.md declares contract updates',
    });
    expect(detectContractAffected([], '## Contract Updates\n- Env: rotate key\n')?.command).toBe('cdd-kit validate --contracts --env');
    expect(detectContractAffected([], '## Contract Updates\n- CI/CD: add nightly job\n')?.command).toBe('cdd-kit validate --contracts --ci');
    expect(detectContractAffected([], '## Contract Updates\n- Add status to the API contract\n')?.command).toBe('cdd-kit validate --contracts');
    expect(detectContractAffected([], '## Contract Updates\n- API:\n- Env:\n')).toBeNull();
    expect(detectContractAffected([], 'no contract section')).toBeNull();
  });

  it('findTestDependents matches test files whose module or item imports resolve to the source', () => {
    const mk = (path: string, imports: Array<[string, string[]]>): FileEntry => ({
      path,
      total_lines: 0,
      imports: imports.map(([module, items], i) => ({ module, items, line: i + 1 })),
      constants: [],
      classes: [],
      functions: [],
      interfaces: [],
      types: [],
      enums: [],
    });
    const entries: FileEntry[] = [
      mk('tests/orders/test_service.py', [['./service', []]]),     // module-relative import
      mk('tests/orders/test_dotimport.py', [['.', ['service']]]),  // `from . import service`
      mk('tests/orders/test_abs.py', [['tests.orders.service', []]]), // absolute package import
      mk('tests/orders/service.py', []),
      mk('tests/orders/helper.py', [['./service', []]]),           // not a test file
      mk('tests/orders/test_other.py', [['./nope', []]]),          // resolves elsewhere
    ];
    const pathSet = new Set(entries.map((e) => e.path));
    expect(findTestDependents(entries, 'tests/orders/service.py', pathSet).sort()).toEqual([
      'tests/orders/test_abs.py',
      'tests/orders/test_dotimport.py',
      'tests/orders/test_service.py',
    ]);

    // src/ layout: tests live outside the package and use an absolute import
    const srcLayout: FileEntry[] = [
      mk('tests/test_orders.py', [['orders.service', []]]),
      mk('src/orders/service.py', []),
    ];
    expect(
      findTestDependents(srcLayout, 'src/orders/service.py', new Set(srcLayout.map((e) => e.path))),
    ).toEqual(['tests/test_orders.py']);

    // top-level module in a src/ layout (`import orders` -> src/orders.py)
    const topLevel: FileEntry[] = [
      mk('tests/test_top.py', [['orders', []]]),
      mk('src/orders.py', []),
    ];
    expect(
      findTestDependents(topLevel, 'src/orders.py', new Set(topLevel.map((e) => e.path))),
    ).toEqual(['tests/test_top.py']);
  });
});
