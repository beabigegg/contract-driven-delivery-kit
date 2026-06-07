# ADR 0006: Bug-fix lane for symptom-driven repair

- Status: Accepted (design); implementation to follow in separate PRs
- Date: 2026-06-05
- Deciders: maintainer + AI delivery agent
- Relates to: ADR 0003 (Code-intelligence indexing strategy), ADR 0005 (Bounded test execution and structured evidence), `bug-fix-engineer`, `change-classifier`, `cdd-kit graph`, `cdd-kit index`, `cdd-kit gate`
- Touches: `.claude/agents/bug-fix-engineer.md`, `.claude/agents/change-classifier.md`, `.claude/agents/test-strategist.md`, `.claude/agents/qa-reviewer.md`, `.claude/skills/cdd-new/SKILL.md`, `src/cli/index.ts`, `src/commands/bug-suspects.ts` (new), `src/commands/gate.ts`, `src/schemas/bug-fix-evidence.schema.ts` (new), `specs/templates/context-manifest.md`, `specs/templates/test-plan.md`

## Context

Bug fixing is a different workflow from feature implementation.

Feature work starts from a desired behavior and acceptance criteria. Bug fixing starts from a symptom: "the filter is empty", "a panel is covered", "the button does nothing", "the report timed out", "pytest fails", or "the API returns the wrong shape." The implementation location and root cause are unknown at the start.

The kit already has a `bug-fix-engineer` agent. It tells the agent to:

- treat the symptom as a clue, not the root cause;
- query the graph/code-map layer before reading source;
- derive 2-5 hypotheses with candidate files/symbols;
- reproduce or create a failing check before editing when feasible;
- inspect target files plus graph-reported imports, dependents, callers, or callees;
- fix the smallest root cause;
- add regression coverage;
- run narrow tests before broader tests.

That is the correct agent-level discipline, but it is not yet a kit-level lane. The current workflow does not mechanically enforce diagnosis, reproduction, root-cause evidence, or regression proof for bug fixes.

ADR 0005 defines the general test execution and evidence layer. This ADR defines the bug-specific lane that uses that layer.

## Decision

### 1. Introduce a `bug-fix` lane

A tracked change enters the bug-fix lane when the classifier detects a symptom-driven request.

Examples:

- "fix empty filter options"
- "the report times out"
- "button does nothing"
- "layout overlaps"
- "pytest fails on test_x"
- "API returns wrong status"
- "data disappears after refresh"
- "the export works locally but fails in CI"

The classifier records:

```md
## Lane
- bug-fix

## Bug Symptom Type
- ui | visual | api | data | performance | crash | test-failure | ci-failure | unknown

## Required Agents
- bug-fix-engineer
- test-strategist
- qa-reviewer
- plus backend/frontend/visual/e2e/stress agents as classified

## Bug Evidence Required
- symptom
- expected behavior
- actual behavior
- reproduction status
- hypotheses
- root cause pointer
- regression evidence
```

The lane does not replace risk tiers. A bug fix can still be Tier 0-5 based on affected surface. Auth, payments, migrations, concurrency, large reports, exports, queues, caches, DB pools, and long-running production behavior still trigger the high-risk gates required elsewhere in the kit.

### 2. Require a bug-fix evidence contract

For `lane: bug-fix`, require structured evidence in:

```text
specs/changes/<change-id>/agent-log/bug-fix-engineer.yml
```

Required shape:

```yaml
schema-version: 0.1.0
agent: bug-fix-engineer

bug-fix:
  symptom: "Orders page filter options are empty"
  expected_behavior: "Status filter shows available statuses"
  actual_behavior: "Filter dropdown renders no options"
  observed_surface: "Orders page filter panel"

  reproduction:
    status: reproduced
    command: "cdd-kit test run add-order-filter --phase targeted --json"
    failing_before_fix: true
    summary: "specs/changes/add-order-filter/test-runs/20260605-101522/summary.json"

  hypotheses:
    - id: H1
      candidate: "src/pages/Orders.tsx::buildFilterOptions"
      reason: "Graph query matched Orders page and filter symbol"
      result: confirmed
    - id: H2
      candidate: "src/api/orders.ts::fetchOrders"
      reason: "API client may omit status field"
      result: rejected

  root_cause:
    pointer: "src/pages/Orders.tsx:42-68"
    summary: "UI mapped status_label instead of canonical status when building filter options"

  fix:
    files_changed:
      - "src/pages/Orders.tsx"
      - "tests/orders/test_filter.py"
    summary: "Use canonical status field and add regression test"

  regression:
    status: passed
    command: "cdd-kit test run add-order-filter --phase targeted --json"
    summary: "specs/changes/add-order-filter/test-runs/20260605-102034/summary.json"

  residual_risk: "none"
```

This file is not a narrative report. It is a concise machine-readable repair record.

### 3. Define reproduction statuses

Allowed reproduction statuses:

| Status | Meaning | Gate implication |
|---|---|---|
| `reproduced` | Symptom reproduced by a command, local step, or controlled input | Can proceed to fix |
| `test-reproduced` | Failing automated test reproduces the symptom | Preferred for code behavior bugs |
| `visual-reproduced` | Screenshot/browser evidence reproduces the visual symptom | Valid for visual/layout bugs |
| `intermittent` | Symptom reproduced inconsistently | Can proceed only with diagnostic note and bounded evidence |
| `environment-blocked` | Required external environment is unavailable | Blocks behavior-changing fix unless classified diagnostic-only |
| `not-reproduced` | Agent could not reproduce the symptom | Blocks behavior-changing fix unless classified diagnostic-only |

A code change that claims to fix a bug should normally have `reproduced`, `test-reproduced`, or `visual-reproduced`.

`not-reproduced` and `environment-blocked` are not passing states for behavior-changing bug fixes. They can support a diagnostic-only change, such as adding safe logging or a targeted test scaffold, when the classifier and QA agree.

### 4. Enforce no-edit-before-diagnosis

For bug-fix lane changes, the implementation agent must not edit source until one of these is true:

1. a failing automated test reproduces the symptom;
2. a visual/manual reproduction is captured;
3. reproduction is explicitly blocked and a diagnostic-only path is recorded.

The agent must first produce:

- observable symptom;
- expected behavior;
- actual behavior;
- reproduction attempt;
- 2-5 hypotheses;
- candidate files/symbols from graph/index;
- narrow read ranges.

This rule prevents speculative edits based only on intuition or broad search.

### 5. Add `cdd-kit bug suspects`

Add a bug-facing wrapper over the existing graph/index layer:

```bash
cdd-kit bug suspects <change-id> --symptom "<text>" [--json]
cdd-kit bug suspects --text "<symptom>" [--json]
```

It combines:

- `cdd-kit graph context`
- `cdd-kit graph query`
- `cdd-kit graph impact`
- `cdd-kit index query` fallback
- `cdd-kit index impact` fallback
- `context-manifest.md` allowed paths
- `test-plan.md` mapped tests
- changed files, when present

Output example:

```json
{
  "change_id": "add-order-filter",
  "symptom": "Orders page filter options are empty",
  "candidates": [
    {
      "path": "src/pages/Orders.tsx",
      "symbols": ["OrdersPage", "buildFilterOptions"],
      "reason": "screen and filter terms matched graph index",
      "read_ranges": ["42-88", "120-164"],
      "impact": {
        "callers": [],
        "dependents": ["tests/orders/test_filter.py"]
      }
    },
    {
      "path": "src/api/orders.ts",
      "symbols": ["fetchOrders"],
      "reason": "data source for Orders page",
      "read_ranges": ["10-76"]
    }
  ],
  "next_commands": [
    "cdd-kit graph query buildFilterOptions --with-source",
    "cdd-kit test select add-order-filter --json"
  ]
}
```

This command does not replace ADR 0003's graph/index design. It packages that design into a symptom-driven repair workflow.

### 6. Use ADR 0005 for test execution and regression proof

Bug-fix lane uses the general test execution layer:

```bash
cdd-kit test select <change-id> --json
cdd-kit test run <change-id> --phase collect --json
cdd-kit test run <change-id> --phase targeted --json
cdd-kit test run <change-id> --phase changed-area --json
```

Additional bug-fix requirements:

- when feasible, at least one reproduction command/evidence item must fail before the fix;
- after the fix, the same or equivalent command/evidence must pass;
- changed code requires updated or added regression coverage;
- visual bugs may use screenshot/browser evidence for reproduction, but code behavior changes still require automated test evidence where feasible;
- data/API bugs should record request/response or contract evidence;
- performance bugs should record bounded timing/timeout evidence, not unbounded soak runs unless classified as high-risk.

Bug-fix evidence references `test-evidence.yml` summaries rather than duplicating full test output.

### 7. Gate bug-fix evidence

For `lane: bug-fix`, `cdd-kit gate` validates:

- `agent-log/bug-fix-engineer.yml` exists;
- `bug-fix.symptom` exists;
- `bug-fix.expected_behavior` exists;
- `bug-fix.actual_behavior` exists;
- `bug-fix.reproduction.status` is one of the allowed statuses;
- `bug-fix.hypotheses` contains at least one candidate;
- confirmed hypothesis exists when reproduction succeeded;
- `bug-fix.root_cause.pointer` exists when code changed;
- `bug-fix.regression.status: passed` exists when code changed;
- referenced summaries/artifacts exist;
- `test-evidence.yml` required phases passed;
- no known/pre-existing/waived failure fields exist.

If reproduction is `not-reproduced` or `environment-blocked` and the change modifies behavior, gate fails unless the classifier explicitly marks the change as diagnostic-only.

### 8. Keep bug-fix lane separate from general test governance

ADR 0005 solves:

- which tests to run;
- how to run them;
- where results are stored;
- how gate validates evidence.

This ADR solves:

- how to turn a symptom into hypotheses;
- how to reproduce;
- how to identify root cause;
- how to prove regression coverage;
- how to prevent speculative edits.

The two layers are connected but not merged. General feature work does not need bug reproduction evidence. Bug-fix work must use the general test evidence layer plus bug-specific diagnosis.

### 9. Route bug types to specialized agents

The classifier should add agents based on symptom type:

| Symptom type | Additional agents |
|---|---|
| `ui` | `frontend-engineer`, `ui-ux-reviewer` when interaction/copy/accessibility is affected |
| `visual` | `frontend-engineer`, `visual-reviewer` |
| `api` | `backend-engineer`, `contract-reviewer` |
| `data` | `backend-engineer`, `test-strategist`, possibly `contract-reviewer` |
| `performance` | `e2e-resilience-engineer`, `stress-soak-engineer` when production-like risk is present |
| `crash` | implementation owner + `qa-reviewer`; add resilience tests when crash affects user-visible flow |
| `test-failure` | owner of failing area + `test-strategist`; do not treat failing tests as known failures |
| `ci-failure` | `ci-cd-gatekeeper`, relevant implementation owner |

### 10. Define diagnostic-only bug changes

Sometimes the correct first bug-fix lane change is not a behavior fix. It may be diagnostic-only:

- add safe logging around an intermittent failure;
- add a reproduction test marked expected-to-fail only during development, not passing gate;
- add instrumentation to capture environment state;
- add a minimal health check.

Diagnostic-only changes must be classified explicitly:

```md
## Diagnostic Only
- yes
```

Rules:

- diagnostic-only changes must not claim to fix the symptom;
- they still need tests for the diagnostic code itself where feasible;
- they still cannot pass with required test failures;
- they should create a follow-up tracked change for the actual fix.

## Consequences

### Positive

- Bug fixing becomes evidence-driven rather than guess-driven.
- Agents use graph/index tools before source reads.
- Reproduction and regression proof become gate-checkable.
- Maintainers can inspect a concise root-cause record.
- The lane reduces time spent on broad grep and speculative edits.
- General test execution remains shared through ADR 0005.

### Negative / accepted

- Some bugs cannot be reproduced locally.
- Visual bugs need screenshot/browser evidence, which may be stack-specific.
- Initial suspect ranking depends on current graph/index quality.
- The lane adds one more structured evidence requirement for bug fixes.
- Diagnostic-only changes may add a second tracked change when the actual fix follows.

## Scope of initial implementation

### PR 1 — Classification and prompt changes

- Update `change-classifier` to emit `lane: bug-fix`.
- Add symptom type classification.
- Update `/cdd-new` routing for bug-fix lane.
- Update `bug-fix-engineer.md` with:
  - no-edit-before-diagnosis;
  - reproduction statuses;
  - hypothesis table;
  - root-cause pointer;
  - regression proof;
  - use of ADR 0005 test commands.

### PR 2 — Bug evidence schema

- Add `src/schemas/bug-fix-evidence.schema.ts`.
- Define allowed reproduction statuses.
- Validate `agent-log/bug-fix-engineer.yml`.
- Add tests for missing symptom, missing root cause, missing regression, and diagnostic-only exceptions.

### PR 3 — Gate integration

- Extend `cdd-kit gate` to detect `lane: bug-fix`.
- Require bug-fix evidence when lane is active.
- Require passing `test-evidence.yml` when code changed.
- Reject known/pre-existing/waived failure fields.

### PR 4 — `cdd-kit bug suspects`

- Add `src/commands/bug-suspects.ts`.
- Add CLI namespace:
  - `cdd-kit bug suspects <change-id> --symptom "<text>"`
  - `cdd-kit bug suspects --text "<text>"`
- Reuse graph/index query functions.
- Respect `context-manifest.md`.
- Return candidate paths, symbols, line ranges, reasons, and related tests.

### PR 5 — Visual/data/performance extensions

- Add visual evidence pointers for screenshot/browser artifacts.
- Add request/response evidence pointers for API/data bugs.
- Add bounded timing evidence for performance bugs.
- Escalate high-risk production symptoms to resilience/stress/soak agents.

### PR 6 — Documentation and examples

- Add README examples:
  - UI bug fix;
  - pytest failure repair;
  - API response-shape bug;
  - intermittent diagnostic-only change.
- Add sample `agent-log/bug-fix-engineer.yml`.
- Add sample gate failure output for incomplete bug evidence.

## Revisit when

- `cdd-kit bug suspects` produces too many false candidates.
- A richer graph or tree-sitter backend changes suspect ranking.
- Remote CI artifacts can be imported into bug evidence.
- Visual evidence becomes standardized across Playwright/Cypress/browserless setups.
- Diagnostic-only flows need stronger lifecycle enforcement.
