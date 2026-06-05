# ADR 0005: Bounded test execution and structured evidence

- Status: Accepted (design); implementation to follow in separate PRs
- Date: 2026-06-05
- Deciders: maintainer + AI delivery agent
- Relates to: `cdd-kit gate`, `cdd-kit validate`, `cdd-kit test` (new), `test-plan.md`, `test-evidence.yml` (new), `ci-gates.md`, `qa-reviewer`, `test-strategist`
- Touches: `src/cli/index.ts`, `src/commands/test-select.ts` (new), `src/commands/test-run.ts` (new), `src/commands/test-summary.ts` (new), `src/schemas/test-evidence.schema.ts` (new), `src/commands/gate.ts`, `specs/templates/test-plan.md`, `specs/templates/test-evidence.yml` (new), `.claude/agents/test-strategist.md`, `.claude/agents/backend-engineer.md`, `.claude/agents/frontend-engineer.md`, `.claude/agents/qa-reviewer.md`, `.claude/skills/cdd-new/SKILL.md`, `ci/gate-policy.md`, `github-workflows/contract-driven-gates.yml`

## Context

CDD requires test evidence before a tracked implementation change can be considered complete. The existing policy direction is correct: Tier 0 is the local fast gate (`lint`, `typecheck`, targeted unit tests, contract validation, changed-area tests), and Tier 1 is the PR-required gate (`build`, unit tests, critical integration/E2E, contract checks, data-boundary/fuzz coverage).

However, the kit currently lacks a bounded, machine-readable test execution layer. The result is that agents often translate "run tests" into an ad hoc broad test command, commonly `pytest`, and then lose time in long output, multiple unrelated failures, terminal scrollback, and repeated attempts to infer which failure matters.

This is not a bug-fix-only issue. It appears during normal feature development, refactoring, contract updates, UI changes, API changes, and bug fixes. The underlying problems are:

1. **Test selection is underspecified.** `test-plan.md` maps acceptance criteria to test families and paths, but it does not require exact commands, runner node IDs, stop rules, or result artifact paths.
2. **Test execution is unbounded.** Agents can run broad `pytest` or equivalent commands too early, creating noisy multi-failure output and expanding the investigation scope.
3. **Test results are hard to find.** Evidence often exists only in chat or terminal output, not in a durable artifact under the change directory.
4. **Failure routing is implicit.** Agents must infer whether a failure is a collection error, fixture/setup error, assertion failure, contract drift, timeout, or unrelated full-suite failure.
5. **Known-failure language weakens the gate.** The workflow should not support passing a gate by excluding known or pre-existing failures. Tests and code should evolve together. A required failing test blocks the gate.

The kit needs a general test execution layer that converts "run tests" into bounded selection, controlled execution, structured summaries, durable artifacts, and gate-checkable evidence.

This ADR does not define the bug-fix workflow itself. ADR 0006 builds on this ADR for symptom-driven repair.

## Decision

### 1. Add a first-class `cdd-kit test` namespace

Add these commands:

```bash
cdd-kit test select <change-id> [--json]
cdd-kit test run <change-id> --phase <phase> [--json]
cdd-kit test summary <change-id> [--json]
```

The namespace is responsible for:

- selecting bounded test commands for the change;
- executing those commands with safe defaults;
- truncating assistant-visible output while preserving full logs;
- writing durable test run artifacts;
- updating `test-evidence.yml`;
- returning machine-readable summaries.

Agents should prefer these commands over direct broad runner calls during tracked CDD changes.

### 2. Define a test execution ladder

Every implementation change has a bounded execution ladder. The default phases are:

| Phase | Purpose | Typical Python command shape | Blocking role |
|---|---|---|---|
| `collect` | Confirm selected tests are discoverable before execution | `python -m pytest --collect-only -q <target>` | Blocks if selected tests cannot be collected |
| `targeted` | Prove acceptance criteria with the narrowest mapped tests | `python -m pytest <nodeid> -q --maxfail=1 --tb=short -ra` | Blocks if failed |
| `changed-area` | Exercise tests near changed source paths | `python -m pytest <test-file-or-dir> -q --maxfail=1 --tb=short -ra` | Blocks if failed |
| `contract` | Run contract validators when contracts/API/data/env/CI are affected | `cdd-kit validate --contracts` or `cdd-kit validate` | Blocks if failed |
| `quality` | Run stack-specific lint/typecheck/build when configured | `ruff check .`, `mypy src/`, `npm run typecheck`, etc. | Blocks if required by `ci-gates.md` |
| `full` | Final local or CI smoke, bounded to first failure | `python -m pytest -q --maxfail=1 --tb=short -ra` | Blocks if failed |

The default discipline is:

1. Do not run broad full-suite commands before targeted and changed-area phases.
2. Investigate only the first failure per phase.
3. If a phase fails, fix that phase before broadening.
4. If the full phase fails, record the first failure and block the gate.
5. Do not mark failures as known, pre-existing, waived, allowed, or ignored.

### 3. Make test selection deterministic

`cdd-kit test select <change-id>` reads, in order:

1. `specs/changes/<change-id>/test-plan.md`
2. `specs/changes/<change-id>/implementation-plan.md`
3. `specs/changes/<change-id>/context-manifest.md`
4. changed/staged files
5. `.cdd/code-map.yml` and `.cdd/code-graph.index.json`
6. runner-specific collection output, when available

The selector first trusts explicit commands and node IDs in `test-plan.md`. If they are missing, it may infer changed-area candidates from source/test path conventions and graph impact. If it still cannot select a bounded target, it returns `needs-test-plan-update` instead of searching the repository indefinitely.

Example JSON output:

```json
{
  "change_id": "add-order-filter",
  "status": "selected",
  "phases": {
    "collect": [
      {
        "reason": "AC-1 mapped in test-plan.md",
        "target": "tests/orders/test_filter.py::test_status_filter_options",
        "command": "python -m pytest --collect-only -q tests/orders/test_filter.py::test_status_filter_options"
      }
    ],
    "targeted": [
      {
        "reason": "AC-1 mapped in test-plan.md",
        "target": "tests/orders/test_filter.py::test_status_filter_options",
        "command": "python -m pytest tests/orders/test_filter.py::test_status_filter_options -q --maxfail=1 --tb=short -ra"
      }
    ],
    "changed-area": [
      {
        "reason": "changed source path maps to tests/orders/",
        "target": "tests/orders/",
        "command": "python -m pytest tests/orders/ -q --maxfail=1 --tb=short -ra"
      }
    ],
    "contract": [
      {
        "reason": "API/data contract affected",
        "command": "cdd-kit validate --contracts"
      }
    ],
    "full": [
      {
        "reason": "final bounded full-suite smoke",
        "command": "python -m pytest -q --maxfail=1 --tb=short -ra"
      }
    ]
  }
}
```

If no bounded tests can be selected:

```json
{
  "change_id": "add-order-filter",
  "status": "needs-test-plan-update",
  "reason": "test-plan.md does not provide target commands or node IDs, and no changed-area tests could be inferred safely"
}
```

### 4. Execute tests through a bounded runner

`cdd-kit test run <change-id> --phase <phase>` executes selected commands with bounded defaults.

For pytest, the command wrapper applies these defaults unless the selected command is stricter:

```bash
-q --maxfail=1 --tb=short -ra
```

When possible, it also writes JUnit XML:

```bash
--junitxml specs/changes/<change-id>/test-runs/<run-id>/junit.xml
```

Every run writes:

```text
specs/changes/<change-id>/test-runs/<run-id>/
  command.txt
  summary.json
  stdout.log
  stderr.log
  junit.xml        # when supported
```

Assistant-visible output is capped. Full output remains available in `stdout.log` and `stderr.log`.

Example summary:

```json
{
  "change_id": "add-order-filter",
  "phase": "targeted",
  "status": "failed",
  "exit_code": 1,
  "command": "python -m pytest tests/orders/test_filter.py::test_status_filter_options -q --maxfail=1 --tb=short -ra",
  "duration_ms": 2418,
  "first_failure": {
    "kind": "assertion-failure",
    "nodeid": "tests/orders/test_filter.py::test_status_filter_options",
    "file": "tests/orders/test_filter.py",
    "line": 42,
    "message": "AssertionError: expected 3 options, got 0"
  },
  "artifacts": {
    "summary": "specs/changes/add-order-filter/test-runs/20260605-101522/summary.json",
    "stdout": "specs/changes/add-order-filter/test-runs/20260605-101522/stdout.log",
    "stderr": "specs/changes/add-order-filter/test-runs/20260605-101522/stderr.log",
    "junit": "specs/changes/add-order-filter/test-runs/20260605-101522/junit.xml"
  },
  "next_action": "fix first failure before running broader phases"
}
```

### 5. Classify first failures

`summary.json` should classify the first failure when possible:

| Failure kind | Examples | Default route |
|---|---|---|
| `collection-error` | pytest cannot collect target | test-strategist / test infra |
| `import-error` | `ModuleNotFoundError`, `ImportError` | backend/frontend engineer or env owner |
| `fixture-error` | setup failure in `conftest.py` or fixtures | test-strategist / test infra |
| `assertion-failure` | expected vs actual mismatch | implementation agent |
| `contract-drift` | `cdd-kit validate --contracts` failure | contract-reviewer + implementation agent |
| `timeout` | command exceeds timeout | e2e/resilience/performance owner |
| `runner-error` | test runner misconfigured | CI/CD gatekeeper or test-strategist |
| `unknown` | unclassified failure | qa-reviewer routes manually |

The classifier does not decide whether to pass. It only helps the agent stop reading long logs and route the first useful failure.

### 6. Add `test-evidence.yml`

For implementation changes, add a machine-readable evidence file:

```text
specs/changes/<change-id>/test-evidence.yml
```

Example:

```yaml
change-id: add-order-filter
schema-version: 0.1.0
generated-by: cdd-kit test run

required-phases:
  - collect
  - targeted
  - changed-area
  - contract

runs:
  - phase: collect
    status: passed
    command: python -m pytest --collect-only -q tests/orders/test_filter.py::test_status_filter_options
    summary: specs/changes/add-order-filter/test-runs/20260605-101301/summary.json

  - phase: targeted
    status: passed
    command: python -m pytest tests/orders/test_filter.py::test_status_filter_options -q --maxfail=1 --tb=short -ra
    summary: specs/changes/add-order-filter/test-runs/20260605-101522/summary.json
    junit: specs/changes/add-order-filter/test-runs/20260605-101522/junit.xml

  - phase: changed-area
    status: passed
    command: python -m pytest tests/orders/ -q --maxfail=1 --tb=short -ra
    summary: specs/changes/add-order-filter/test-runs/20260605-101731/summary.json

  - phase: contract
    status: passed
    command: cdd-kit validate --contracts
    summary: specs/changes/add-order-filter/test-runs/20260605-101802/summary.json

final-status: passed
```

The gate validates evidence, not assistant claims.

### 7. Prohibit known-failure waivers

The evidence schema must reject these fields:

```yaml
known-failures:
pre-existing-failures:
allowed-failures:
waived-failures:
ignored-failures:
```

CDD does not support passing a required gate by excluding known or pre-existing failures.

Rules:

- Any required test failure blocks the gate.
- No required failing test can be waived inside `test-evidence.yml`.
- If a full-suite failure appears outside the current surface, record the first failure and block.
- The maintainer may expand the current change scope or start a separate tracked change.
- The current gate does not pass until required evidence is green.

This preserves test integrity while preventing the agent from chasing unrelated failures indefinitely.

### 8. Upgrade `test-plan.md`

Add these sections to `specs/templates/test-plan.md`:

```md
## Test Execution Ladder

| phase | required | command source | max failures | result artifact |
|---|---:|---|---:|---|
| collect | yes | cdd-kit test select | 1 | test-runs/<run-id>/summary.json |
| targeted | yes | cdd-kit test select | 1 | test-evidence.yml |
| changed-area | yes | cdd-kit test select | 1 | test-evidence.yml |
| contract | if affected | cdd-kit validate | 1 | test-evidence.yml |
| quality | if configured | ci-gates.md | 1 | test-evidence.yml |
| full | final/CI | cdd-kit test run --phase full | 1 | test-evidence.yml |

## Test Update Contract

| existing test | action | reason |
|---|---|---|
| tests/example/test_old_behavior.py::test_legacy_case | update | expected behavior changed by AC-2 |
| tests/example/test_removed_behavior.py::test_removed_case | delete | behavior removed by accepted contract/spec change |

## Stop Rules

- Do not run broad pytest before targeted and changed-area phases pass.
- Do not investigate more than the first failure per phase.
- Do not classify any failure as known, pre-existing, waived, or allowed.
- If full suite fails, record the first failure and block the gate.
```

The `Test Update Contract` is not a waiver. It is the approved place to state that a test's expected behavior must change because the accepted specification or contract changed.

### 9. Update agents and skills

Update implementation-related agents:

- `test-strategist` must write bounded test commands and runner targets.
- `implementation-planner` must reference required test phases, not duplicate full test strategy.
- `backend-engineer` and `frontend-engineer` must run `cdd-kit test run` for targeted and changed-area phases before broad commands.
- `qa-reviewer` must approve based on `test-evidence.yml`, run artifacts, CI, and logs, not claims.
- `/cdd-new` must include test evidence in the flow before final gate.

Add shared prompt rule:

```md
Do not start with a broad test command such as `pytest`, `npm test`, or a full suite.

Use:
1. `cdd-kit test select <change-id> --json`
2. `cdd-kit test run <change-id> --phase collect --json`
3. `cdd-kit test run <change-id> --phase targeted --json`
4. `cdd-kit test run <change-id> --phase changed-area --json`
5. required contract/quality gates
6. full suite only as final bounded smoke or CI gate

If any phase fails, inspect only the first failure, fix it if it belongs to this change, otherwise block the gate. Do not waive it.
```

### 10. Add an optional test-runner agent hook

Extend `cdd-kit install-agent-hooks` with:

```bash
cdd-kit install-agent-hooks --test-runner advisory
cdd-kit install-agent-hooks --test-runner strict
```

Advisory mode warns when a tracked change runs a broad test command directly.

Strict mode blocks broad commands unless one of these is true:

- command is `cdd-kit test run ...`;
- command is an explicit bounded test node/file command;
- command is a configured contract/lint/typecheck/build gate.

Strict mode should not be the first rollout default. Ship advisory first.

## Consequences

### Positive

- Agents stop wasting time in broad test output.
- Test result location is deterministic.
- QA can review structured test evidence instead of chat claims.
- Gate behavior becomes mechanical.
- Required test failures remain blocking.
- The same test layer supports features, refactors, contract changes, UI changes, API changes, and bug fixes.

### Negative / accepted

- More artifacts are written under `specs/changes/<id>/test-runs/`.
- Initial implementation will be strongest for pytest.
- Other runners require adapters.
- Some repos may need to update `test-plan.md` before the selector can infer useful targets.
- Strict hooks may feel disruptive until teams adapt; advisory mode reduces rollout risk.

## Scope of initial implementation

### PR 1 — Policy cleanup

- Remove known/pre-existing failure exclusion language from `qa-reviewer.md`.
- Remove the `Pre-existing Failures Excluded From This Gate` QA report section.
- Add "any required test failure blocks" language.
- Add "stop after first unrelated full-suite failure" language.

### PR 2 — Templates and schema

- Update `specs/templates/test-plan.md`.
- Add `specs/templates/test-evidence.yml`.
- Add `src/schemas/test-evidence.schema.ts`.
- Update `/cdd-new` artifact expectations for implementation changes.

### PR 3 — `cdd-kit test run`

- Add `src/commands/test-run.ts`.
- Add CLI namespace in `src/cli/index.ts`.
- Support pytest first.
- Write `test-runs/<run-id>/`.
- Write/update `test-evidence.yml`.
- Add tests for pass, fail, timeout, output cap, missing command, and malformed JUnit XML.

### PR 4 — `cdd-kit test select`

- Add `src/commands/test-select.ts`.
- Read `test-plan.md` first.
- Return `needs-test-plan-update` when selection is unsafe.
- Add pytest `--collect-only` validation.
- Add changed-file and graph-impact heuristics only after explicit mapping works.

### PR 5 — Gate enforcement

- Extend `cdd-kit gate` to validate `test-evidence.yml`.
- Required phases must pass.
- Waiver fields fail schema validation.
- Missing evidence blocks implementation changes after migration window.

### PR 6 — Agent and skill updates

- Update `test-strategist`, `implementation-planner`, implementation agents, and `qa-reviewer`.
- Update `/cdd-new` and `/cdd-resume`.
- Document the test ladder in README.

### PR 7 — Optional test-runner hook

- Add advisory mode first.
- Add strict mode after field validation.

## Revisit when

- JS/TS, Go, Rust, and other adapters are implemented.
- Remote CI artifacts can be imported into `test-evidence.yml`.
- The kit gains a machine-readable `change.yml` / `trace.yml`.
- Runner output classification needs stack-specific plugins.
