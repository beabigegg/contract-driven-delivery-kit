# Change Classification

## Change Types
- primary: bug-fix, ci-cd-change
- secondary: feature-enhancement (adds `--enforce` override flag), business-logic-change (Boundary Guard enforcement-semantics parity, documented in the CI contract)

## Lane
- bug-fix

<!-- Symptom-driven repair of shipped v3.12-3.13.1 behavior; three production
     issues (#61, #62, #63/#65) with known reproductions and required regression
     tests. Promoted to ci-cd-change/business-logic-change because it touches
     contracts/ci/ci-gate-contract.md — the contract path is forced. -->

## Bug Symptom Type
- ci-failure

<!-- Primary observable symptom of all three defects is the adopter CI path
     mis-enforcing Boundary Guard: #61 the workflow exits 1 on archive-only
     pushes, #62 the guard selects every operation (202 vs 8), #63/#65 the
     standalone step blocks a fresh adopter's first API-affecting PR despite
     shadow mode. Sub-symptoms #62/#63 are TypeScript command-behavior bugs
     surfaced through the CI path; ci-cd-gatekeeper owns the workflow/contract
     side, bug-fix-engineer owns the src/ logic. -->

## Diagnostic Only
- no

## Bug Evidence Required
(One evidence set per defect #61 / #62 / #63-#65; recorded by bug-fix-engineer
as schema-valid typed `artifacts:` / `bug-fix:` per ADR 0006. Root causes were
pre-identified by the maintainer and independently re-verified against source,
and must be re-confirmed with a failing test before the fix.)
- symptom
- expected behavior
- actual behavior
- reproduction status
- hypotheses
- root cause pointer
- regression evidence

## Risk Level
- medium

## Impact Radius
- cross-module

## Tier
- 2

## Architecture Review Required
- no
- reason: (n/a) Root causes and fixes are fully prescribed in the change
  request (honor `shadow_mode` by default with `--enforce` override; resolve
  the effective base once and reuse for both `changedFiles` and
  `contractAtRevision`; port the structured-`if` workflow form). No open
  module-boundary, migration/rollback, or compatibility decision remains — the
  `--enforce` flag is additive/backward-compatible and the default change is the
  intended parity with `cdd-kit gate`. If planning finds the shared
  enforcement-semantics extraction requires a non-obvious new module boundary,
  promote to a design review and add `spec-architect`.

## Required Artifacts
Always required: change-request.md, change-classification.md, implementation-plan.md, test-plan.md, ci-gates.md, tasks.yml, context-manifest.md

## Optional Artifacts (default: no — set yes only with explicit reason)
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | current-vs-expected behavior captured in bug-fix-engineer.yml evidence (ADR 0006), not duplicated in prose |
| proposal.md | no | no product/behavior decision to investigate; fixes are prescribed |
| spec.md | no | no user-facing behavior decision beyond the prescribed parity |
| design.md | no | Architecture Review Required = no |
| qa-report.md | no | mutation-red / defect-escape evidence lives mechanically in test-evidence.yml + bug-fix-engineer.yml (each of the 3 regression tests must fail on pre-fix code). Promote to yes ONLY if qa-reviewer records a blocking finding, approved-with-risk, or a mutation gap |
| regression-report.md | no | regression scope captured in test-plan.md + test-evidence.yml |
| visual-review-report.md | no | no UI surface |
| monkey-test-report.md | no | not applicable |
| stress-soak-report.md | no | no high-load / long-running behavior changed |

## Required Contracts
- API: none (contracts/api/* is applicability: not-applicable — cdd-kit has no HTTP API surface)
- CSS/UI: none (not-applicable — no UI surface)
- Env: review-only — confirm `CDD_BASE_SHA` / `GITHUB_BASE_SHA` are documented in `contracts/env/env-contract.md`; no new variable or secret is added, they are CI-runtime inputs consumed by the guard
- Data shape: none (not-applicable)
- Business logic: none as a standalone contract (business-rules.md is not-applicable); the enforcement-semantics rule is captured in the CI contract
- CI/CD: `contracts/ci/ci-gate-contract.md` — MUST document the Boundary Guard enforcement semantics: (a) `boundary check` honors `.cdd/policy.yml` `shadow_mode` by default in BOTH the integrated gate and the standalone path, findings printed as advisory `[shadow]` → exit 0; (b) `--enforce` override → exit 1 on failed status; (c) the shipped workflow template passes `--base "$CDD_BASE_SHA"`; (d) archive-only pushes are not red-lined. contract-reviewer confirms code matches contract.

## Required Tests
- unit: yes — (a) effective-base resolution in `src/boundary/guard.ts` resolved once and reused by `changedFiles()` and `contractAtRevision()`; (b) shared shadow/enforce decision (shadow_mode true → advisory/exit 0; `--enforce` → blocking/exit 1)
- contract: yes — `test/contracts/ci-workflow.test.ts`: shipped `github-workflows/contract-driven-gates.yml` uses the structured-`if` form and passes `--base "$CDD_BASE_SHA"`; boundary-check enforcement matches the `ci-gate-contract.md` shadow-mode claim
- integration: yes — end-to-end `cdd-kit boundary check` against a repo with `shadow_mode: true` (fresh-adopter first API-PR passes); guard selects the correct operation count (8, not 202) when only `CDD_BASE_SHA` is set and the API contract changed; workflow "Determine changed spec directories" step exits 0 on an archive-only push under `bash -eo pipefail`
- E2E: (blank) — no product E2E surface; the tool's own CLI integration tests cover the CI path
- visual: (blank)
- data-boundary: (blank)
- resilience: (blank)
- fuzz/monkey: (blank)
- stress: (blank)
- soak: (blank)

## Required Agents
- implementation-planner — sequences the three fixes + contract update into an execution packet before any implementation
- bug-fix-engineer — diagnostic evidence + the `src/` fixes (boundary.ts, guard.ts) with failing-test-first proof for each defect
- ci-cd-gatekeeper — owns the workflow-template fix (#61), the `--base "$CDD_BASE_SHA"` template wiring (#62), and the `ci-gate-contract.md` gate semantics
- contract-reviewer — reviews the `contracts/ci/ci-gate-contract.md` change (and confirms Env doc accuracy for `CDD_BASE_SHA`); ensures code matches contract
- test-strategist — designs the three regression tests + the parity assertions; maps ACs → tests
- qa-reviewer — release readiness for an npm-shipped enforcement change; verifies each regression test is non-vacuous (fails on pre-fix code) per the CLAUDE.md gate-test lesson

(No `spec-architect` — Architecture Review = no. No frontend/ui-ux/visual agents — no UI surface. No separate `backend-engineer` — bug-fix-engineer is the src/ implementation owner for this lane; add backend-engineer only if the shared-semantics extraction grows beyond the prescribed targeted fixes.)

## Inferred Acceptance Criteria
- AC-1: With `.cdd/policy.yml` `shadow_mode: true` (the shipped default), `cdd-kit boundary check` prints error findings as advisory `[shadow]` and exits 0 — identical to `cdd-kit gate`. A regression test proves a fresh adopter's first API-affecting PR passes the standalone Boundary Guard step in shadow mode (#63/#65).
- AC-2: `cdd-kit boundary check --enforce` overrides `shadow_mode` and exits 1 on any `failed` status; a regression test proves `--enforce` makes shadow findings blocking (#63/#65).
- AC-3: `boundary check` and `gate` derive the shadow/enforce decision from ONE shared enforcement-semantics source (no divergent duplicate logic); a test asserts both paths produce identical decisions for the same policy + findings.
- AC-4: `src/boundary/guard.ts` resolves the effective base (`CDD_BASE_SHA` / `GITHUB_BASE_SHA` / `options.base`) once and uses it for BOTH `changedFiles()` and `contractAtRevision()`. When the API contract changes and only `CDD_BASE_SHA` is set, the guard selects only the actually-changed operations (8, not all 202). A regression test asserts the correct operation count (#62).
- AC-5: The shipped adopter workflow template `github-workflows/contract-driven-gates.yml` passes `--base "$CDD_BASE_SHA"` to the boundary step; a contract/workflow test asserts the template contains it (#62).
- AC-6: The "Determine changed spec directories" step in `github-workflows/contract-driven-gates.yml` uses the structured-`if` form (matching `.github/workflows/contract-driven-gates.yml`) and exits 0 on an archive-only push under `bash -eo pipefail`; a regression test asserts the archive-only case does not exit 1 (#61).
- AC-7: `build.js` regenerates `assets/` from the edited `github-workflows/` source so the shipped asset matches source with no drift (`.cdd/asset-manifest.json` reflects the change); `assets/` is not hand-edited.
- AC-8: `contracts/ci/ci-gate-contract.md` documents the Boundary Guard enforcement semantics (shadow-mode advisory-by-default in both gate and standalone paths, `--enforce` override, workflow `--base` wiring, archive-only pushes not red-lined) and contract-reviewer confirms the code matches the contract.

## Tasks Not Applicable
- not-applicable: 1.3, 2.1, 2.2, 2.4, 2.5, 3.3, 3.4, 3.5, 4.2, 4.3, 5.1, 5.2, 6.4

## Clarifications or Assumptions
- Assumption: `contracts/ci/ci-gate-contract.md` may not fully specify that the standalone `boundary check` honors `shadow_mode` (or specifies it inconsistently with `gate`). If the contract already states the intended parity, this becomes a pure bug-fix (code fixed to match contract) and the CI-contract EDIT reduces to a confirmation; contract-reviewer still runs. Either way the contract path is forced because enforcement semantics are behavior-changing for adopters.
- Assumption: `shadow_mode: true` is the shipped default in `.cdd/policy.yml`; the fix must preserve that default so existing adopters are not newly blocked, while `--enforce` gives an explicit opt-in to blocking.
- Assumption: the default change (standalone `boundary check` now exits 0 in shadow mode where it previously exited 1) is an intended, backward-compatible-for-adopters correction, not a regression — it aligns the standalone path to the already-shipped `gate` behavior. If any adopter relied on the old always-block behavior, `--enforce` restores it.
- Per CLAUDE.md standing lessons ("guarantees that never happened", "vacuous tests"): each regression test MUST be shown to fail on pre-fix code (mutation-red) before the fix, recorded in `test-evidence.yml`.

## Resolved Context Expansion Requests
- CER-001 (RESOLVED, no expansion needed): the gate-side shadow-mode `[shadow]`
  downgrade lives in `src/commands/gate.ts` (lines ~243-258), already inside
  Allowed Paths. The shared enforcement-semantics source will be extracted from
  there so `boundary check` and `gate` cannot diverge again.

## Context Manifest Draft

### Affected Surfaces
- Boundary Guard standalone command — `src/commands/boundary.ts` (`boundaryCheck`)
- Boundary Guard core — `src/boundary/guard.ts` (base resolution + operation selection)
- Gate enforcement semantics (parity target / shared source) — `src/commands/gate.ts` shadow-mode `[shadow]` downgrade
- Adopter CI workflow template (edit source) — `github-workflows/contract-driven-gates.yml`
- Repo's own CI workflow (reference form to port) — `.github/workflows/contract-driven-gates.yml`
- Asset regeneration — `build.js` (regenerates `assets/` from `github-workflows/`; do NOT hand-edit `assets/`)
- CI gate contract — `contracts/ci/ci-gate-contract.md`
- Tests — `test/cli/boundary.test.ts`, `test/contracts/ci-workflow.test.ts`, `test/cli/gate.test.ts`, plus new regression tests

### Allowed Paths
- specs/changes/boundary-ci-adopter-parity/
- specs/context/project-map.md
- specs/context/contracts-index.md
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md
- src/commands/boundary.ts
- src/boundary/guard.ts
- src/boundary/adapters.ts
- src/commands/gate.ts
- src/commands/gate-shared.ts
- src/commands/gate-dependencies.ts
- src/policy/profile.ts
- src/utils/git-paths.ts
- src/schemas/cdd-policy.schema.ts
- src/cli/index.ts
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- docs/boundary-guard.md
- test/cli/boundary.test.ts
- test/cli/gate.test.ts
- test/contracts/ci-workflow.test.ts
- test/helpers.ts
- test/setup-git-env.ts

### Agent Work Packets

#### change-classifier
- specs/changes/boundary-ci-adopter-parity/
- specs/context/project-map.md
- specs/context/contracts-index.md

#### implementation-planner
- specs/changes/boundary-ci-adopter-parity/
- specs/context/project-map.md
- specs/context/contracts-index.md
- contracts/ci/ci-gate-contract.md
- src/commands/boundary.ts
- src/boundary/guard.ts
- src/commands/gate.ts
- src/commands/gate-shared.ts
- src/commands/gate-dependencies.ts
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- docs/boundary-guard.md

#### bug-fix-engineer
- specs/changes/boundary-ci-adopter-parity/
- src/commands/boundary.ts
- src/boundary/guard.ts
- src/boundary/adapters.ts
- src/commands/gate.ts
- src/commands/gate-shared.ts
- src/commands/gate-dependencies.ts
- src/policy/profile.ts
- src/utils/git-paths.ts
- src/schemas/cdd-policy.schema.ts
- src/cli/index.ts
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- test/cli/boundary.test.ts
- test/contracts/ci-workflow.test.ts
- test/helpers.ts
- test/setup-git-env.ts
- docs/boundary-guard.md

#### ci-cd-gatekeeper
- specs/changes/boundary-ci-adopter-parity/
- contracts/ci/ci-gate-contract.md
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- test/contracts/ci-workflow.test.ts

#### contract-reviewer
- specs/changes/boundary-ci-adopter-parity/
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md
- src/commands/boundary.ts
- src/boundary/guard.ts
- github-workflows/contract-driven-gates.yml

#### test-strategist
- specs/changes/boundary-ci-adopter-parity/
- test/cli/boundary.test.ts
- test/cli/gate.test.ts
- test/contracts/ci-workflow.test.ts
- test/helpers.ts
- test/setup-git-env.ts
- src/commands/boundary.ts
- src/boundary/guard.ts

#### qa-reviewer
- specs/changes/boundary-ci-adopter-parity/
- contracts/ci/ci-gate-contract.md
- test/cli/boundary.test.ts
- test/contracts/ci-workflow.test.ts
