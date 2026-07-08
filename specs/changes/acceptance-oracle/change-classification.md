# Change Classification

## Change Types
- primary: `feature-add` (new human-owned `acceptance.yml` artifact + `enforceAcceptanceOracle` gate machinery), `ci-cd-change` (modifies the `cdd-kit gate` pass/fail contract and adds a new required gate check)
- secondary: `migration` (migrate/refresh/upgrade backfill + version/content-digest stamping), `tooling/CLI-enhancement` (new PreToolUse hook + installer arming, doctor drift detection)

## Lane
- feature

## Risk Level
- high

## Impact Radius
- system-wide

The gate is the governance chokepoint every kit user depends on; this change alters its pass/fail contract, adds a new required artifact, adds a new PreToolUse hook, and rewrites the migrate/refresh/upgrade path — so it is high-blast-radius for the kit's own installed base, not just this repo.

## Tier
- 1

Rationale: high risk + system-wide maps to Tier 0-1. It is Tier 1 rather than Tier 0 because the ADR 0010 spec is authoritative and complete, and every mechanism has a strong existing pattern to mirror (contract-write hook, ADR 0005 evidence harness, gate placeholder detection, digest util). Classifying upward, this stays a full-ceremony Tier 1.

## Architecture Review Required
- yes
- reason: Non-obvious design decisions remain open in ADR 0010 (stable serialization/key-ordering for the hash-locked human region; per-stack acceptance-driver loader emission; digest-stamp storage location — `.cdd/` manifest vs per-asset frontmatter). It also introduces module-boundary changes (new gate check composed into `gate.ts`, new `acceptance` phase in the ADR 0005 evidence harness, SUT resolution via the code-map for the mock-scan) and a migration/upgrade compatibility decision (migrated changes must fail-until-filled). Per the portable-enforcement boundary (ADR 0010 §5), the correctness/harness split must be reviewed before implementation.

## Required Artifacts

The 7 always-required artifacts are in scope:
`change-request.md`, `change-classification.md`, `implementation-plan.md`, `test-plan.md`, `ci-gates.md`, `tasks.yml`, `context-manifest.md`

## Optional Artifacts

| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | Existing gate/migrate/upgrade behavior is covered by ADRs 0004/0005/0009 and captured in design.md; no separate product investigation needed. |
| proposal.md | no | ADR 0010 is the proposal/decision record. |
| spec.md | no | ADR 0010 is the authoritative spec. |
| design.md | yes | Architecture Review Required = yes; resolves the three open design questions (hash serialization, driver-loader emission, digest storage) and records the portable-vs-harness enforcement boundary (§5). |
| qa-report.md | yes | Tier 1 change to the core gate contract warrants durable QA sign-off prose (release-readiness of a check all users depend on; likely approved-with-risk notes on the irreducible "lazy-but-well-formed oracle" residual). |
| regression-report.md | yes | Changes existing behavior of `gate`, `migrate`, `refresh`, `upgrade`, and `doctor`; existing in-flight changes for real users will start failing the new gate by design — regression scope must be recorded as durable evidence. |
| visual-review-report.md | no | No UI/CSS/frontend surface. |
| monkey-test-report.md | no | Not a high-interaction UI surface. |
| stress-soak-report.md | no | No high-load/auto-refresh/long-running runtime path. |

## Required Contracts
- API: none (no HTTP API surface; this is a CLI/governance change)
- CSS/UI: none
- Env: yes — new `CDD_ACCEPTANCE_WRITE_STRICT` variable for the acceptance-write hook; update `contracts/env/env-contract.md`, `contracts/env/.env.example.template`, and `contracts/env/env.schema.json`
- Data shape: internal artifact schemas only — new `src/schemas/acceptance.schema.ts` and a new `acceptance` block in `test-evidence.yml`/`test-evidence.schema.ts`; these are governed by schema files, not the app-level `contracts/data/data-shape-contract.md` (no change to that contract)
- Business logic: none (`contracts/business/business-rules.md` governs delivered-app domain behavior, not kit governance)
- CI/CD: yes — this adds `enforceAcceptanceOracle` as a new required gate check and changes the gate pass/fail contract; update `contracts/ci/ci-gate-contract.md`

## Required Tests
- unit: yes — `acceptance.schema` validation, hash-lock compute/compare, placeholder/`meaningfulChars` reuse, mock-of-SUT scan, digest-stamp compute
- contract: yes — `enforceAcceptanceOracle` gate behavior conforms to `ci-gate-contract.md`; env-contract conformance for the new variable
- integration: yes — end-to-end `gate` pass/fail wiring, `migrate`/`refresh`/`upgrade` backfill, `install-agent-hooks --acceptance-write` arming, `doctor` drift detection
- E2E: yes — full CLI lifecycle: scaffold → author oracle → implement driver → `gate` green/red, including tamper (hash divergence) and mock-of-SUT rejection
- visual: no
- data-boundary: yes — malformed/placeholder `acceptance.yml`, missing `input`/`expect`, and the new `acceptance` block boundary in `test-evidence.yml`
- resilience: no
- fuzz/monkey: no
- stress: no
- soak: no

## Required Agents
- `spec-architect` — writes `design.md`, resolves open design questions and the portable-vs-harness boundary before planning
- `implementation-planner` — turns ADR 0010 + design + contracts + tests into the execution packet
- `backend-engineer` — TypeScript CLI (gate check, schema, installer, migrate/refresh/upgrade, doctor, digest) and the POSIX `sh` hook
- `test-strategist` — maps the ACs below into the test matrix; owns the new `acceptance` evidence phase test design
- `contract-reviewer` — reviews `ci-gate-contract.md` and `env-contract.md` changes and their conformance
- `ci-cd-gatekeeper` — signs off the gate pass/fail contract change and required-check policy impact
- `qa-reviewer` — release readiness / durable QA sign-off for a Tier 1 governance-chokepoint change

## Inferred Acceptance Criteria
- AC-1: `cdd-kit gate` fails a change whose `acceptance.yml` is missing or placeholder (no case with meaningful `input`/`expect` per the existing `meaningfulChars` detection), and passes only when >=1 non-placeholder case exists with a recorded, passed acceptance-driver run.
- AC-2: When an agent alters any locked human-region value (`cases[].input`, `cases[].expect`, or `rules`) after authoring, the recorded oracle hash diverges and `gate` fails with "acceptance oracle modified after authoring — human must re-confirm."
- AC-3: The `pre-tool-use-acceptance-write.sh` hook blocks an agent Edit/Write/MultiEdit targeting `acceptance.yml` (advisory by default; hard-block under `CDD_ACCEPTANCE_WRITE_STRICT=1`) while leaving human edits and edits to other files unaffected; it is armed via `install-agent-hooks --acceptance-write` and is doctor-detectable.
- AC-4: `gate` fails when an acceptance driver mocks a module resolved from the code-map as the change's SUT ("acceptance test mocks the thing it is supposed to verify"), and passes when only external I/O boundaries (network/clock) are faked.
- AC-5: An acceptance case counts as passing only when the ADR 0005 evidence harness records a bounded, passed `acceptance`-phase run for it in `test-evidence.yml`; a self-reported pass with no recorded run fails the gate.
- AC-6: `src/schemas/acceptance.schema.ts` validates a well-formed `acceptance.yml` (`oracle-version`, `authored-by`, `cases[].{id,given,when,then,input,expect}`, `rules[].{id,statement}`) and rejects malformed or missing-field inputs.
- AC-7: `cdd-kit migrate` scaffolds a placeholder-plus-instructions `acceptance.yml` into existing in-flight change dirs, and `refresh`/`upgrade` add it for new work; a migrated change fails `enforceAcceptanceOracle` until real cases are supplied (never silently skipped).
- AC-8: Installed agents/skills/hooks/templates are stamped with package version + content digest at install/refresh, and `doctor` reports drift when an installed asset's digest differs from the packaged asset (distinguishing a complete re-scaffold from a partial copy and a stale global install from a current one).

## Tasks Not Applicable
- `2.1` (API contract) — API: none
- `2.2` (CSS/UI contract) — none
- `2.4` (Data shape contract) — internal schema files only; no change to `contracts/data/data-shape-contract.md`
- `2.5` (Business logic contract) — none
- `4.2` (Frontend) — no UI surface
- `5.1` (UI/UX review) — no UI surface
- `5.2` (Visual review) — no UI surface
- `3.5` (Stress/soak) — no high-load/long-running runtime path

Design task `1.3` IS applicable (design.md = yes) and remains active. `3.3` E2E is retained but is CLI-lifecycle E2E owned by `test-strategist`/`backend-engineer` (no dedicated `e2e-resilience-engineer` commissioned); `3.4` is retained for the required data-boundary tests (monkey/fuzz not required).

## Atomic-split evaluation
Explicitly considered, NOT split. Only the soft task-heavy heuristic (~12-15 impl tasks) fires; cross-feature, cross-surface (3+), and contract-heavy (>=5) triggers do not. Splitting would fragment a single guarantee whose parts are not independently valuable (a gate check with no schema/hook/evidence is broken; a migration with no template is meaningless) and force two changes to contend for the same files (`upgrade.ts`, `refresh.ts`, `migrate.ts`, `doctor.ts`) — the exact same-file coupling ADR 0009 reserve/integrate avoids. If a split is later desired, the only cleanly separable concern is asset version/content-digest stamping + `doctor` drift (ADR 0010 §6 second bullet), carveable as a Tier 2 follow-up depending on this change.
