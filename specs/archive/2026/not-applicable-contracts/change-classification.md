# Change Classification

## Change Types
- primary: `feature-enhancement`, `ci-cd-change`
- secondary: `contract-data-change` (apply the new marker to the kit's own `contracts/{api,css,business}`)

## Lane
- feature

## Risk Level
- medium

## Impact Radius
- module-level (the validate/gate orchestration + per-contract validators; a governance chokepoint, but a single mechanism)

## Tier
- 2

Justification: Changes `cdd-kit validate`/`gate` pass/fail behavior (a governance chokepoint), so not Tier 3+. Kept out of Tier 0-1 because: (1) it moves strictly in the SAFE direction — it can only make a previously-failing EMPTY contract pass, and only when explicitly marked with a required reason; it must never let an UNMARKED unfilled contract pass; (2) strong existing patterns to mirror (tier-floor-override required-reason discipline, acceptance-oracle frontmatter conventions, existing validate.ts <-> Python-validator orchestration); (3) impact is module-level, not system-wide. The one non-obvious decision (source-of-truth: frontmatter vs `.cdd/` config) is handled by design review.

## Architecture Review Required
- yes
- reason: One genuine cross-cutting design decision must be settled before implementation: the source of truth for applicability (contract frontmatter `applicability:` + `applicability-reason:` vs a `.cdd/contract-applicability.json` config vs both), and how the TS orchestrator (`validate.ts`) and the Python semantic validators AGREE on reading it cross-platform. This affects the durability of the "not-applicable must never be a silent bypass" invariant.

## Required Artifacts

The 7 always-required artifacts apply.

## Optional Artifacts

| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | Captured in change-request Known Context + referenced acceptance-oracle qa/regression reports. |
| proposal.md | no | Goal is unambiguous. |
| spec.md | no | Behavior specified adequately by acceptance criteria + design.md. |
| design.md | yes | Frontmatter-vs-`.cdd`-config source-of-truth + TS<->Python read contract is a real design decision. spec-architect writes it before implementation-planner. |
| qa-report.md | no | Routine pass/fail fits `agent-log/qa-reviewer.yml`; escalate only on blocking/approved-with-risk. |
| regression-report.md | no | Regression scope covered by required tests + agent-log; no durable prose bundle unless a regression is found. |
| visual-review-report.md | no | No UI surface. |
| monkey-test-report.md | no | No interactive UI. |
| stress-soak-report.md | no | No high-load surface. |

## Required Contracts
- API: none as a schema change. `contracts/api/*` receive the `applicability: not-applicable` frontmatter marker (data edit).
- CSS/UI: none as a schema change. `contracts/css/*` receive the marker (data edit).
- Env: none.
- Data shape: none.
- Business logic: none as a schema change. `contracts/business/business-rules.md` receives the marker (data edit).
- CI/CD: yes. `contracts/ci/ci-gate-contract.md` — record the gate-semantics change (skip a marked-not-applicable surface while still hard-failing unmarked stubs; not-applicable requires a reason and is never a silent bypass).

## Required Tests
- unit: yes — applicability frontmatter parsing; required-reason enforcement; skip-decision logic per family; cross-reader agreement helper.
- contract: yes — CI/CD gate contract behavior: marked+reason => skipped-with-info; unmarked empty stub => hard-fail unchanged; filled contract => unchanged.
- integration: yes — `validate.ts` orchestrating the Python `validate_*.py` end-to-end (TS/Python agree, PowerShell + POSIX); `cdd-kit gate`/`validate` on the kit itself goes green after marking `contracts/{api,css,business}`.
- E2E/visual/data-boundary/resilience/fuzz/stress/soak: none.

## Required Agents
- `spec-architect` — resolve source-of-truth decision + TS<->Python read contract; author `design.md`.
- `implementation-planner` — execution packet from design + CI/CD contract + tests.
- `backend-engineer` — TS (`validate.ts`/`doctor.ts`/contract parser/gate) AND Python `validate_*.py`; apply the marker to the kit's own `contracts/{api,css,business}`.
- `test-strategist` — map ACs to unit/contract/integration tests, especially the negative cases.
- `contract-reviewer` — review the CI/CD gate-contract change; confirm marker edits are data-only.
- `ci-cd-gatekeeper` — confirm the gate-semantics change preserves the fail-closed invariant.
- `qa-reviewer` — release-readiness + invariant confirmation ("not-applicable is never a silent bypass").

## Inferred Acceptance Criteria
- AC-1: A contract marked `applicability: not-applicable` with a non-empty reason is SKIPPED by `cdd-kit validate` and the relevant Python semantic validator, and validate emits an informational note naming the surface + reason (not a failure, not silent).
- AC-2: A contract that is an empty/placeholder template stub and is NOT marked not-applicable still HARD-FAILS `cdd-kit validate`/`gate` exactly as today (unfilled-stub detection not weakened).
- AC-3: A contract marked `applicability: not-applicable` WITHOUT a non-empty reason is REJECTED (hard error), mirroring the tier-floor-override required-reason discipline.
- AC-4: `cdd-kit doctor` lists which contract surfaces are marked not-applicable (with reasons) as informational output.
- AC-5: After marking the kit's own `contracts/{api,css,business}` not-applicable with reasons, `cdd-kit gate`/`validate` on the kit no longer fails on those three surfaces, while all filled contracts continue to validate unchanged.
- AC-6: The TS orchestrator and the Python validators agree on how applicability is read, verified cross-platform (PowerShell + POSIX) by an integration test — no divergence where one skips and the other fails.
- AC-7 (drift, advisory/WARNING only): a not-applicable contract that later gains real (non-stub) content is surfaced by `doctor`/`validate` as a drift WARNING (the mark may be stale), without hard-failing. Escalation to hard error deferred (record as follow-up in design.md / CI contract).

## Tasks Not Applicable
- `2.3` (Env contract) — none
- `2.4` (Data shape contract) — none
- `3.3` (E2E/resilience) — none
- `3.4` (Data-boundary/monkey) — none
- `3.5` (Stress/soak) — none
- `4.2` (Frontend) — no UI surface
- `4.3` (Env/deploy) — no env change
- `5.1` (UI/UX review) — no UI surface
- `5.2` (Visual review) — no UI surface

Design task `1.3` IS applicable (design.md = yes). Tasks 2.1/2.2/2.5 (api/css/business contract) are applicable as data edits (apply the marker); 2.6 (CI/CD) is the real contract update.

## Atomic-split evaluation
NOT split. Single focused concern (one applicability marker mechanism) + a bounded secondary data edit (mark the kit's own three empty contracts). No cross-feature / cross-surface(3+) / contract-heavy(>=5) trigger; ~8 tasks.

## Clarifications or Assumptions
- Applicability is per contract FAMILY/file (per Non-goals), not per endpoint/row.
- Frontmatter is the LIKELY source of truth (co-located, versioned), but deferred to spec-architect's design.md; `.cdd/` config or hybrid remains open.
- Drift detection (AC-7) delivered as advisory WARNING, not a hard gate, in this change.
- `contract set` / version-bump interaction for a not-applicable file documented in design.md but not a required behavior change unless design finds a conflict.
