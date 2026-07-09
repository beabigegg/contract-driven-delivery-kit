---
change-id: acceptance-oracle
schema-version: 0.1.0
last-changed: 2026-07-08
risk: high
tier: 1
---

# Test Plan: acceptance-oracle

## Acceptance Criteria → Test Mapping
| criterion id | test family | test file path | tier |
|---|---|---|---|
| AC-1 | unit | test/schemas/acceptance.schema.test.ts::rejects placeholder-only cases (meaningfulChars) | 0 |
| AC-1 | integration | test/cli/acceptance-oracle.test.ts::gate fails on missing acceptance.yml | 1 |
| AC-1 | integration | test/cli/acceptance-oracle.test.ts::gate fails when all cases are placeholder | 1 |
| AC-1 | integration | test/cli/acceptance-oracle.test.ts::gate passes with >=1 non-placeholder case + passed evidence | 1 |
| AC-2 | unit | test/utils/acceptance-hash.test.ts::hash is stable across key order/whitespace/quoting | 0 |
| AC-2 | unit | test/utils/acceptance-hash.test.ts::hash diverges when cases[].input changes | 0 |
| AC-2 | unit | test/utils/acceptance-hash.test.ts::hash diverges when cases[].expect changes | 0 |
| AC-2 | unit | test/utils/acceptance-hash.test.ts::hash diverges when a rule id changes | 0 |
| AC-2 | unit | test/utils/acceptance-hash.test.ts::hash unchanged when given/when/then reworded | 0 |
| AC-2 | integration | test/cli/acceptance-oracle.test.ts::gate fails with re-confirm message on baseline mismatch | 1 |
| AC-3 | contract | test/cli/acceptance-write-hook.test.ts::advisory nudges and allows edit (exit 0) | 0 |
| AC-3 | contract | test/cli/acceptance-write-hook.test.ts::strict blocks edit (exit 2) under CDD_ACCEPTANCE_WRITE_STRICT=1 | 0 |
| AC-3 | contract | test/cli/acceptance-write-hook.test.ts::ignores non-acceptance.yml files in strict mode | 0 |
| AC-3 | contract | test/cli/acceptance-write-hook.test.ts::does not block first-time human scaffold write | 0 |
| AC-3 | integration | test/cli/install-agent-hooks.test.ts::--acceptance-write arms the hook in settings.json | 1 |
| AC-3 | integration | test/cli/doctor.test.ts::doctor detects acceptance-write hook armed/missing | 1 |
| AC-4 | unit | test/utils/mock-of-sut-scan.test.ts::pytest driver mocking code-map-resolved SUT fails (Python) | 0 |
| AC-4 | unit | test/utils/mock-of-sut-scan.test.ts::vitest driver mocking code-map-resolved SUT fails (JS/TS) | 0 |
| AC-4 | unit | test/utils/mock-of-sut-scan.test.ts::faking network client passes (Python + JS/TS) | 0 |
| AC-4 | unit | test/utils/mock-of-sut-scan.test.ts::faking system clock passes (Python + JS/TS) | 0 |
| AC-4 | data-boundary | test/utils/mock-of-sut-scan.test.ts::unresolved SUT (code-map miss) does not false-fail | 0 |
| AC-4 | unit | test/utils/mock-of-sut-scan.test.ts::driver hardcoding a case's expect literal fails (Python + JS/TS) | 0 |
| AC-5 | contract | test/schemas/test-evidence.schema.test.ts::accepts acceptance phase in required-phases/runs | 0 |
| AC-5 | integration | test/cli/acceptance-oracle.test.ts::gate fails when no recorded acceptance-phase run exists (self-report) | 1 |
| AC-5 | integration | test/cli/acceptance-oracle.test.ts::gate passes when acceptance phase run status=passed and case ids covered | 1 |
| AC-6 | unit | test/schemas/acceptance.schema.test.ts::accepts well-formed oracle-version/authored-by/cases/rules | 0 |
| AC-6 | unit | test/schemas/acceptance.schema.test.ts::rejects missing cases[].id/input/expect | 0 |
| AC-6 | unit | test/schemas/acceptance.schema.test.ts::rejects missing rules[].id/statement | 0 |
| AC-6 | unit | test/schemas/acceptance.schema.test.ts::rejects unknown top-level field (additionalProperties) | 0 |
| AC-6 | unit | test/schemas/acceptance.schema.test.ts::shipped specs/templates/acceptance.yml validates | 0 |
| AC-7 | integration | test/cli/migrate.test.ts::scaffolds placeholder-plus-instructions acceptance.yml into in-flight change | 1 |
| AC-7 | integration | test/cli/refresh.test.ts::adds acceptance.yml template for new work | 1 |
| AC-7 | integration | test/cli/acceptance-oracle.test.ts::migrated change fails enforceAcceptanceOracle until filled | 1 |
| AC-8 | unit | test/utils/digest.test.ts::asset-manifest stamps version+digest per installed asset | 0 |
| AC-8 | integration | test/cli/doctor.test.ts::drift when installed digest != manifest (partial copy) | 1 |
| AC-8 | integration | test/cli/doctor.test.ts::drift when installed digest != packaged asset (stale global install) | 1 |
| AC-8 | integration | test/cli/doctor.test.ts::no drift reported for a complete current re-scaffold | 1 |
| — | e2e | test/cli/acceptance-oracle.test.ts::full lifecycle scaffold→author→driver→gate green, then tamper→gate red | 1 |

## Test Families Required
| family | tier | notes |
|---|---|---|
| unit | 0 | schema validation, hash-lock compute/compare, mock-of-SUT + hardcoded-expect scan (Python+JS/TS), digest stamping — pure/no-process, <30s |
| contract | 0-1 | acceptance-write hook exit codes (mirrors contract-write hook, POSIX sh, `describe.skipIf(win32)`); test-evidence `acceptance` phase vocabulary; ci-gate-contract/env-contract conformance owned by contract-reviewer, referenced not re-specified here |
| integration | 1 | `gate` wiring (AC-1/2/5/7/8), `migrate`/`refresh`/`upgrade` backfill, `install-agent-hooks --acceptance-write`, `doctor` drift — real CLI subprocess via `runCli`/`makeTempDir` per existing gate.test.ts pattern |
| e2e | 1 | one full-lifecycle CLI test per AC set: scaffold → non-placeholder oracle → conforming driver → green gate; then tamper a locked field → red gate with re-confirm message; then swap driver to mock the SUT → red gate |
| data-boundary | 0 | malformed/placeholder acceptance.yml, missing input/expect, unresolved-SUT non-false-fail, malformed acceptance evidence block |

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
| test/cli/gate.test.ts | update | compose new `enforceAcceptanceOracle` check into gate pass/fail assertions |
| test/schemas/test-evidence.schema.test.ts | update | add `acceptance` to phase vocabulary fixtures |
| test/cli/migrate.test.ts, test/cli/refresh.test.ts | update | assert new `acceptance.yml` backfill/scaffold behavior |
| test/cli/doctor.test.ts | update | add asset-manifest digest-drift assertions |

## Stop Rules
- Do not run broad pytest/vitest before targeted and changed-area phases pass.
- Do not investigate more than the first failure per phase.
- Do not classify any failure as known, pre-existing, waived, or allowed (ADR 0005 §7 applies to the new `acceptance` phase too).
- If full suite fails, record the first failure and block the gate.

## Out of Scope
- No UI/visual/monkey/stress/soak (no UI surface; not high-load runtime — matches change-classification.md Required Tests).
- Z3/SMT consistency, mutation testing as an evidence phase, property-based generation from contracts — deferred to follow-up ADRs (change-request.md Non-goals).
- Digest/drift stress or soak (no long-running runtime path).

## Notes
- New: `test/cli/acceptance-oracle.test.ts`, `test/cli/acceptance-write-hook.test.ts` (clone of contract-write-hook.test.ts), `test/schemas/acceptance.schema.test.ts`, `test/utils/acceptance-hash.test.ts`, `test/utils/mock-of-sut-scan.test.ts`.
- Extend (not duplicate): gate.test.ts, migrate.test.ts, refresh.test.ts, install-agent-hooks.test.ts, doctor.test.ts, test-evidence.schema.test.ts, digest.test.ts.
- AC-2/AC-4 mechanisms must be red before their implementation lands (TDD-first); no waiver fields permitted in `acceptance`-phase evidence.
- AC-4/AC-5 mechanical coverage spans BOTH Python(pytest) and JS/TS(vitest) drivers (design.md Maintainer Decision 2026-07-08) — no Python-only carve-out.
