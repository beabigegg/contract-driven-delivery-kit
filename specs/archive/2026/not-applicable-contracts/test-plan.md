---
change-id: not-applicable-contracts
schema-version: 0.1.0
last-changed: 2026-07-09
risk: medium
tier: 2
---

# Test Plan: not-applicable-contracts

## Acceptance Criteria → Test Mapping
| criterion id | test family | test file path | tier | test names |
|---|---|---|---|---|
| AC-1 | unit | test/contracts/applicability-reader.test.ts | 0 | reader returns skip+reason for `applicability: not-applicable` with a non-empty `applicability-reason` |
| AC-1 | contract | test/cli/validate-applicability.test.ts | 1 | validate skips a not-applicable api contract and prints an info note naming surface+reason; validate_api_semantic chain self-skips when api contract is not-applicable |
| AC-2 | unit | test/contracts/applicability-reader.test.ts | 0 | reader returns "applicable" (no skip) for an unmarked contract and for `applicability: applicable` |
| AC-2 | contract | test/cli/validate-applicability.test.ts | 1 | unmarked empty-stub api/css/business contract still hard-fails validate (regression guard, must not weaken) |
| AC-2 | integration | test/cli/gate.test.ts | 1 | existing "gate on fresh cdd-kit new (templates only) fails on stub content" re-asserted unchanged |
| AC-3 | unit | test/contracts/applicability-reader.test.ts | 0 | reader flags `not-applicable` with empty/missing reason as invalid; flags an unrecognized `applicability` value as invalid |
| AC-3 | contract | test/cli/validate-applicability.test.ts | 1 | validate hard-fails a contract marked not-applicable with no reason; validate hard-fails an unrecognized applicability value (typo) rather than passing silently |
| AC-4 | integration | test/cli/doctor.test.ts | 1 | doctor lists not-applicable surfaces with their reasons as informational output (no failure) |
| AC-5 | integration | test/cli/gate.test.ts | 1 | gate on the kit's own repo passes once contracts/{api,css,business} are marked not-applicable with reasons |
| AC-5 | integration | test/cli/gate.test.ts | 1 | filled contracts/{env,ci} continue to validate unchanged after the marker is applied elsewhere |
| AC-6 | unit | test/contracts/parser.test.ts | 0 | new applicability projection reads `applicability`/`applicability-reason` off frontmatter for display only (no pass/fail branch in TS) |
| AC-6 | contract | test/contracts/applicability-agreement.test.ts | 1 | TS parser projection and Python applicability.py agree on the same classification for every fixture case (marked+reason, marked+no-reason, applicable, unmarked, garbage value) |
| AC-7 | contract | test/cli/validate-applicability.test.ts | 1 | a not-applicable contract whose body now exceeds the placeholder threshold is a WARNING, not a validate failure |
| AC-7 | integration | test/cli/doctor.test.ts | 1 | doctor surfaces the same drift (marked not-applicable but now looks filled) as a warning, never a failure |

## Test Families Required
| family | tier | notes |
|---|---|---|
| unit | 0 | Narrow-scope invocation of the shared Python `applicability.py` reader (not the full `validate_contracts.py` loop) plus the new read-only TS frontmatter projection in `parser.ts`. Carries the negative-case density (AC-2, AC-3). No new Python test framework — spawns Python directly (spawnSync), matching existing repo convention (there is no pytest/unittest infra here today). |
| contract | 1 | `cdd-kit validate` end-to-end against `validate_contracts.py` + the `validate_api_semantic.py` self-skip chain. Pins the CI/CD gate-contract semantics: skip+reason vs hard-fail vs drift-warning. |
| integration | 1 | Full `cdd-kit gate`/`doctor` runs against real repo trees, including the kit's own `contracts/{api,css,business}`, and the TS↔Python agreement check. |

## Test Execution Ladder
| phase | required | command source | max failures | result artifact |
|---|---:|---|---:|---|
| collect | yes | cdd-kit test select | 1 | test-runs/<run-id>/summary.json |
| targeted | yes | cdd-kit test select | 1 | test-evidence.yml |
| changed-area | yes | cdd-kit test select | 1 | test-evidence.yml |
| contract | yes (contracts/ci touched) | cdd-kit validate --contracts --ci | 1 | test-evidence.yml |
| full | final/CI | cdd-kit test run --phase full | 1 | test-evidence.yml |

## Test Update Contract
| existing test | action | reason |
|---|---|---|
| test/cli/gate.test.ts | update | assert AC-2 regression guard unchanged + AC-5 kit-goes-green after marking |
| test/cli/doctor.test.ts | update | add AC-4 not-applicable listing + AC-7 drift-warning assertions |
| test/contracts/parser.test.ts | update | add unit coverage for the new applicability frontmatter projection helper |

## Stop Rules
- Do not run broad pytest/vitest before targeted and changed-area phases pass.
- Do not investigate more than the first failure per phase.
- Do not classify any failure as known, pre-existing, waived, or allowed.
- AC-2's regression tests must stay green throughout; a failure there blocks the gate immediately, it is never a waivable pre-existing case.

## Out of Scope
- E2E/visual/data-boundary/resilience/monkey/stress/soak: no UI or high-load surface (change-classification Tasks Not Applicable).
- Per-endpoint/per-row applicability: mechanism is per contract family/file only (change-request Non-goals).
- `contract set`/version-bump interaction with a not-applicable file: documented in design.md, not a required test this change.

## Notes
- New: `test/contracts/applicability-reader.test.ts`, `test/cli/validate-applicability.test.ts`, `test/contracts/applicability-agreement.test.ts`.
- Extend (not duplicate): `test/cli/gate.test.ts`, `test/cli/doctor.test.ts`, `test/contracts/parser.test.ts`.
- `applicability.py` is the single pass/fail authority (design.md); `parser.ts`/`doctor.ts` tests assert DISPLAY only — a TS-side pass/fail branch on this marker is itself an AC-6 regression and must not appear.
- AC-2 is the key regression guard: every new skip-path test is paired with an unmarked-stub test proving the hard-fail is unweakened.
- AC-1/AC-2/AC-3 tests must be written and RED against current behavior before `applicability.py` exists (TDD-first).
- Cross-platform (AC-6) is verified by the existing CI matrix (POSIX + Windows runners); no bespoke shell-detection test is required.
