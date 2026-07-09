---
change-id: interaction-design-loop
schema-version: 0.1.0
last-changed: 2026-07-09
risk: high
tier: 1
---

# Test Plan: interaction-design-loop

Precedents mirrored: `test/utils/acceptance-hash.test.ts`, `test/schemas/acceptance.schema.test.ts`,
`test/cli/acceptance-oracle.test.ts`, `test/cli/accept-relock.test.ts`,
`test/cli/acceptance-write-hook.test.ts`, `test/cli/install-agent-hooks.test.ts`. No harness is
re-invented; this ADR's tamper-evidence/skip/migration-window mechanics are structural copies of
ADR 0010/0011, so the design-side test files copy those files' fixture and assertion conventions.

## Acceptance Criteria → Test Mapping
| criterion id | test family | test file path | test name |
|---|---|---|---|
| AC-1 | contract | test/contracts/skill-workflow-order.test.ts | interaction-designer sits between contract-reviewer and implementation-planner in the Tier 0-1 block |
| AC-1 | contract | test/contracts/skill-workflow-order.test.ts | same ordering holds in the Tier 2-3 block |
| AC-1 | contract | test/contracts/skill-workflow-order.test.ts | the back-edge to contract-reviewer is documented in the node's entry |
| AC-1 | contract | test/contracts/skill-workflow-order.test.ts | cdd-resume/SKILL.md reflects the same insertion and ordering |
| AC-2 | contract | test/contracts/interaction-design-template.test.ts | template carries all seven derivation-chain sections (info+rationale, intents+path, control-intent mapping incl. deleted+reason, reversibility, meaning-form consistency, Open Decisions, Confirmed) |
| AC-2 | integration | test/cli/new.test.ts (extend) | new <id> scaffolds specs/changes/<id>/interaction-design.md from the template |
| AC-3 | unit | test/utils/design-hash.test.ts | computeDesignHash is a sha256 over the parsed ## Confirmed projection |
| AC-3 | integration | test/cli/design-confirm.test.ts | design confirm <id> writes .cdd/design-lock.json with the current hash |
| AC-3 | integration | test/cli/design-confirm.test.ts | design confirm fails clearly when interaction-design.md or ## Confirmed is missing |
| AC-3 | integration | test/cli/design-write-hook.test.ts | pre-tool-use-design-write.sh strict blocks an agent Edit/Write to .cdd/design-lock.json (exit 2) |
| AC-3 | integration | test/cli/design-write-hook.test.ts | advisory mode nudges and allows (exit 0) |
| AC-3 | integration | test/cli/install-agent-hooks.test.ts (extend) | --design-write advisory/strict installs/wires the hook idempotently, independent of other hooks |
| AC-3 | integration | test/cli/gate-design.test.ts | no code path other than design confirm produces a lock hash the gate accepts |
| AC-4 | integration | test/cli/gate-design.test.ts | fails when interaction-design.md is missing (isNewChange) |
| AC-4 | integration | test/cli/gate-design.test.ts | fails when ## Open Decisions has an unresolved item |
| AC-4 | integration | test/cli/gate-design.test.ts | fails when there is no human ## Confirmed |
| AC-4 | integration | test/cli/gate-design.test.ts | referential integrity: a control citing zero intent ids fails |
| AC-4 | integration | test/cli/gate-design.test.ts | referential integrity: a control citing two intent ids fails |
| AC-4 | integration | test/cli/gate-design.test.ts | referential integrity: a control citing exactly one intent id passes that check |
| AC-4 | integration | test/cli/gate-design.test.ts | referential integrity: an intent with no path fails |
| AC-4 | integration | test/cli/gate-design.test.ts | referential integrity: a deleted control with no recorded reason fails |
| AC-4 | integration | test/cli/gate.test.ts (extend) | enforceInteractionDesign is composed into cdd-kit gate's check list |
| AC-5 | unit | test/utils/design-provenance.test.ts | resolves endpoint+field via a Tier A field table |
| AC-5 | unit | test/utils/design-provenance.test.ts | resolves endpoint+field via a Tier B json-schema block |
| AC-5 | unit | test/utils/design-provenance.test.ts | resolves a nested $ref dotted path |
| AC-5 | unit | test/utils/design-provenance.test.ts | descends items transparently to resolve an array-element field |
| AC-5 | unit | test/utils/design-provenance.test.ts | enum discriminator pin resolves a member present in the field's enum(...) list |
| AC-5 | unit | test/utils/design-provenance.test.ts | enum discriminator pin rejects a member absent from the enum(...) list |
| AC-5 | unit | test/utils/design-provenance.test.ts | errors-column status resolves against that row's bare comma-separated HTTP integers |
| AC-5 | unit | test/utils/design-provenance.test.ts | implicit HTTP status resolves 201 for POST and 200 otherwise |
| AC-5 | unit | test/utils/design-provenance.test.ts | data-shape: <condition> matches the condition column verbatim |
| AC-5 | unit | test/utils/design-provenance.test.ts | HARD failure with actionable message when openapi.json is missing or stale |
| AC-5 | unit | test/utils/design-provenance.test.ts | HARD failure with actionable message when the endpoint's response schema cell is unresolved prose |
| AC-5 | unit | test/utils/design-provenance.test.ts | HARD, marker-aware failure (names marker+reason) when the cited contract family is applicability: not-applicable |
| AC-5 | unit | test/utils/design-provenance.test.ts | a bare HTTP status or errors-column citation still resolves when ## Schemas is empty (no projection needed) |
| AC-5 | unit | test/utils/design-provenance.test.ts | two meaning-distinct states citing the same discriminator is a HARD failure |
| AC-5 | unit | test/utils/design-provenance.test.ts | two states each citing a distinct discriminator passes |
| AC-5 | integration | test/cli/gate-design.test.ts | any provenance HARD failure blocks cdd-kit gate with the resolver's actionable message |
| AC-5 | integration | test/cli/doctor.test.ts (extend) | corpus-wide over-fetch report scans and aggregates multiple specs/changes/*/interaction-design.md |
| AC-5 | integration | test/cli/doctor.test.ts (extend) | the over-fetch report never fails cdd-kit doctor (advisory only) |
| AC-5 | integration | test/cli/gate-design.test.ts | cdd-kit gate itself emits zero over-fetch findings (per-change artifact cannot see sibling screens) |
| AC-6 | unit | test/utils/design-hash.test.ts | hash is unchanged when ## Confirmed is reformatted/reindented (whitespace-insensitive) |
| AC-6 | unit | test/utils/design-hash.test.ts | hash diverges when a ## Confirmed answer is semantically edited |
| AC-6 | integration | test/cli/gate-design.test.ts | gate fails with exactly "interaction design modified after confirmation — human must re-confirm." |
| AC-7 | integration | test/cli/gate-design.test.ts | a pre-existing (legacy) change dir with no interaction-design.md passes non-strict gate |
| AC-7 | integration | test/cli/gate-design.test.ts | the same legacy change dir fails gate --strict |
| AC-7 | integration | test/cli/gate-design.test.ts | a NEW change dir with no interaction-design.md fails even non-strict |
| AC-7 | integration | test/cli/gate-design.test.ts | a cdd-kit migrate placeholder interaction-design.md fails until replaced by a real confirmed design |
| AC-8 | integration | test/cli/gate-design.test.ts | applicability: not-applicable with a non-empty applicability-reason skips conditions 1-6 |
| AC-8 | integration | test/cli/gate-design.test.ts | applicability: not-applicable with an empty/missing reason is a HARD error |
| AC-8 | integration | test/cli/gate-design.test.ts | an unknown applicability value is a HARD error |
| AC-8 | contract | test/contracts/applicability-agreement.test.ts (extend) | applicability.py remains the sole pass/fail authority; no second TS authority decides this node |
| AC-9 | contract | test/contracts/agent-prompt-content.test.ts | frontend-engineer.md reports blocked when the design is unconfirmed and no longer carries the states "when applicable" escape hatch |
| AC-9 | contract | test/contracts/agent-prompt-content.test.ts | implementation-planner.md references the confirmed design by path/section |
| AC-9 | contract | test/contracts/agent-prompt-content.test.ts | ui-ux-reviewer.md points to contracts/css/ and no longer references contracts/ui/ |
| AC-10 | contract | test/contracts/ci-gate-contract.test.ts | Gate Inventory registers enforceInteractionDesign at tier 1, required: yes, with the correct artifact list |
| AC-10 | contract | test/contracts/ci-gate-contract.test.ts | schema-version is bumped to 0.4.0 |
| AC-10 | contract | test/contracts/agent-prompt-content.test.ts | interaction-designer.md and the three edited prompts pass the shared agent-prompt shape lint |

## Test Families Required
| family | tier | notes |
|---|---|---|
| unit | Tier 0 (collect/targeted, <30s) | design-hash canonical projection, provenance resolver pure logic, schema validation — no CLI process spawn |
| contract | Tier 1 (contract phase) | ci-gate-contract.md registration, agent/SKILL prompt content and shape lint, template section presence |
| integration | Tier 1 (targeted/changed-area, <10min) | CLI end-to-end: design confirm, hook block, gate composition, migration window, skip path, doctor corpus scan |

e2e / data-boundary / resilience / monkey / stress / soak: not applicable — see Out of Scope.

## New Test Files
| file | covers |
|---|---|
| test/utils/design-hash.test.ts | AC-3, AC-6 — canonical-projection sha256, tamper divergence, lock round-trip |
| test/utils/design-provenance.test.ts | AC-5 — all join/citation/degrade/state-discriminator resolver cases |
| test/schemas/design-lock.schema.test.ts | AC-3 — design-lock schema shape, mirrors acceptance.schema.test.ts |
| test/cli/design-confirm.test.ts | AC-3 — `design confirm <id>` sole-writer CLI, mirrors accept-relock.test.ts |
| test/cli/design-write-hook.test.ts | AC-3 — hook block/advisory behavior, mirrors acceptance-write-hook.test.ts |
| test/cli/gate-design.test.ts | AC-4, AC-5, AC-6, AC-7, AC-8 — enforceInteractionDesign end-to-end, mirrors acceptance-oracle.test.ts |
| test/contracts/ci-gate-contract.test.ts | AC-10 — gate-inventory consistency |
| test/contracts/agent-prompt-content.test.ts | AC-9, AC-10 — new/edited prompt content + shape lint |
| test/contracts/skill-workflow-order.test.ts | AC-1 — SKILL.md node ordering + back-edge in both tier blocks |
| test/contracts/interaction-design-template.test.ts | AC-2 — derivation-chain section presence |

Extended (not new): `test/cli/gate.test.ts` (gate composition, AC-4), `test/cli/new.test.ts`
(scaffold, AC-2), `test/cli/install-agent-hooks.test.ts` (`--design-write` wiring, AC-3),
`test/cli/doctor.test.ts` (over-fetch advisory report, AC-5), `test/contracts/applicability-agreement.test.ts`
(single-authority claim, AC-8).

## Test Execution Ladder
| phase | required | command source | max failures | result artifact |
|---|---:|---|---:|---|
| collect | yes | cdd-kit test select | 1 | test-runs/<run-id>/summary.json |
| targeted | yes | cdd-kit test select | 1 | test-evidence.yml |
| changed-area | yes | cdd-kit test select | 1 | test-evidence.yml |
| contract | yes (contracts affected) | cdd-kit validate | 1 | test-evidence.yml |
| quality | if configured | ci-gates.md | 1 | test-evidence.yml |
| full | final/CI | cdd-kit test run --phase full | 1 | test-evidence.yml |

`changed-area` bounds to: `test/utils/`, `test/schemas/`, `test/contracts/`,
`test/cli/gate-design.test.ts`, `test/cli/design-confirm.test.ts`, `test/cli/design-write-hook.test.ts`.
`contract` phase bounds to the five `test/contracts/*.test.ts` files listed above.
`acceptance` phase: n/a — this change adds no `acceptance.yml` cases of its own; the existing kit
acceptance-oracle machinery (ADR 0010) is unmodified.

## Test Update Contract
| existing test | action | reason |
|---|---|---|
| test/cli/gate.test.ts | update | add enforceInteractionDesign to the composed check list assertions (AC-4) |
| test/cli/new.test.ts | update | assert interaction-design.md scaffold alongside existing acceptance.yml scaffold assertion (AC-2) |
| test/cli/install-agent-hooks.test.ts | update | add `--design-write` describe block mirroring `--acceptance-write` (AC-3) |
| test/cli/doctor.test.ts | update | add corpus-wide over-fetch advisory describe block (AC-5) |
| test/contracts/applicability-agreement.test.ts | update | extend single-authority assertion to the interaction-design node (AC-8) |

## Stop Rules
- Do not run broad `vitest run` before `targeted` and `changed-area` phases pass.
- Do not investigate more than the first failure per phase.
- Do not classify any failure as known, pre-existing, waived, or allowed.
- If the full suite fails, record the first failure and block the gate.

## Out of Scope
- E2E, visual, monkey, stress, soak — this repo ships no UI; `tasks.yml` already marks 3.3/3.4/3.5
  not-applicable.
- Any test asserting visual aesthetics, motion, layout taste, type/color, or latency/N+1 — ADR 0012
  "Never Gated" forbids gating them; such a test would contradict the ADR.
- Semantic error-code joins (`contracts/api/error-format.md` as a join target) — deferred per ADR
  0012 Out of scope.
- Request-body provenance — deferred, symmetric to the ADR 0007 scope limit.
- `contracts/css/` durable "layout language" contract — deferred to a future ADR.

## Notes
This change reuses ADR 0010/0011 tamper-evidence/skip/migration-window mechanics verbatim in
spirit; test files copy those precedents' fixtures rather than invent new ones. The provenance
resolver (`test/utils/design-provenance.test.ts`) is the highest-risk new unit surface — its
degrade-path messages are the actionable-error contract ADR 0012 §2 requires, not just pass/fail.
The reverse/over-fetch advisory is deliberately tested twice: once proving `doctor` reports it,
once proving `gate` never does — that asymmetry is the load-bearing design decision (ADR 0012 §2/§6).
