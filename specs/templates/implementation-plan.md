---
change-id: <id>
schema-version: 0.1.0
last-changed: <date>
---

# Implementation Plan: <change-id>

## Objective

(Concrete outcome the implementation agents must deliver.)

## Execution Scope

### In Scope
- 

### Out of Scope
- 

## Required Changes

| id | area | required action | owner agent |
|---|---|---|---|
| IP-1 |  |  |  |

## Source Artifact Pointers

| source | relevant pointer | used for |
|---|---|---|
| test-plan.md | AC-1 | tests to run/write |
| ci-gates.md | required gates table | verification commands |
| design.md | Decision:  | implementation constraint |

## File-Level Plan

| path or glob | action | notes |
|---|---|---|
|  |  |  |

## Contract Updates

- API:
- CSS/UI:
- Env:
- Data shape:
- Business logic:
- CI/CD:

## Test Execution Plan

| acceptance criterion | test file / command | expected signal |
|---|---|---|
| AC-1 |  |  |

## Handoff Constraints

- Implementation agents must not infer missing requirements from chat history.
- Do not re-copy full design, test strategy, CI policy, or contract prose into this plan; follow the source pointers above.
- If this plan omits a required file, behavior, contract, or test, stop and report `blocked`.
- Keep implementation within the file-level plan unless a Context Expansion Request is approved.

## Known Risks

- 

## Test Plan

<!-- v2 folds test-plan.md in here. The gate requires this section to be
     non-empty; the requirement moved, it did not soften. -->

Test families required (mark all that apply): unit / contract / integration /
e2e / data-boundary / resilience / monkey / stress / soak

| criterion id | test family | test file path | tier |
|---|---|---|---|
|  |  |  |  |

**Test update contract** — which existing tests may change, and why a change to
an existing test is a spec change rather than a convenience:

- 

**Stop rules** — what makes this change stop and report `blocked` rather than
push on:

- 

**Out of scope** — test families deliberately not run, with the reason:

- 

## CI Gates

<!-- v2 folds ci-gates.md in here. Same rule as above: this section is required
     and must say something real. -->

| gate | trigger | required? | new or existing |
|---|---|---|---|
|  |  |  |  |

**Merge eligibility** — what must be green before this merges:

- 

**Rollback** — how this is undone if it is wrong in production:

- 
