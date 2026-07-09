---
change-id: not-applicable-contracts
schema-version: 0.1.0
last-changed: 2026-07-09
---

# Implementation Plan: not-applicable-contracts

## Objective
Ship the `applicability: not-applicable` (+ required `applicability-reason`)
frontmatter marker (ADR 0011). A contract family a project genuinely lacks is
SKIPPED by the Python semantic validators (with an info note); an UNMARKED empty
stub still hard-fails unchanged; a marker without a reason or with an unknown
value is a HARD ERROR. A single shared Python reader (`applicability.py`) is the
sole pass/fail authority; TS reads the same marker only to DISPLAY it in
`doctor`. Mark the kit's own four empty-stub contracts so `cdd-kit gate` on the
kit goes green on those surfaces.

## Execution Scope

### In Scope
- New shared Python reader `applicability.py` under
  `.claude/skills/contract-driven-delivery/scripts/` — single classify authority.
- Wire `validate_contracts.py` per-family loop and `validate_api_semantic.py`
  (defensive: `validate_api_conformance.py`, `validate_response_shape.py`,
  `validate_env_semantic.py`) to consult the reader and self-skip / hard-error
  per fail-closed semantics.
- Read-only TS frontmatter projection in `src/contracts/parser.ts`; `doctor.ts`
  listing of not-applicable surfaces (AC-4) and drift WARNING (AC-7).
- Data edit: add the marker to `contracts/{api,css,business,data}` primary files
  with honest reasons.
- `node build.js` to regenerate `assets/` from the edited `.claude/` scripts.
- Tests per `test-plan.md` (TDD red-first).

### Out of Scope (non-goals — do not implement)
- Per-endpoint / per-row applicability (per contract FAMILY/file only).
- A `.cdd/` config source of truth (frontmatter is the single source — design.md
  decision 1); no `.cdd/contract-applicability.json`.
- Drift as a hard error (advisory WARNING only this change — AC-7).
- `contract set` / version-bump interaction changes for a not-applicable file.
- Any frontmatter JSON-schema machinery / new `src/schemas/` entry (design.md
  decision: validate the two fields INLINE in `applicability.py`).
- Any pass/fail branch on the marker inside TS (that is itself an AC-6
  regression — TS is display-only).
- Touching filled `contracts/{ci,env}` or the non-REQUIRED companion files
  (`api-inventory.md`, `error-format.md`, `design-tokens.md`).

## Required Changes
| id | area | required action | owner agent |
|---|---|---|---|
| IP-1 | Python reader | New `applicability.py`: parse a contract's frontmatter, classify `applicable` / `not-applicable(reason)` / `invalid(no-reason\|unknown-value)`; enforce allowed values + required non-empty reason inline; strip surrounding quotes from the reason. Sole pass/fail authority. | backend-engineer |
| IP-2 | Python presence/stub validator | `validate_contracts.py`: in the per-file loop over `REQUIRED`, consult `applicability.py`; `invalid`→hard-fail (AC-3); `not-applicable`→skip the stub check + print an info note naming surface+reason (AC-1); else stub check unchanged (AC-2). Drift: a `not-applicable` file whose `meaningful_chars` >= `PLACEHOLDER_THRESHOLD` prints a WARNING, never fails (AC-7). | backend-engineer |
| IP-3 | Python API semantic validator | `validate_api_semantic.py`: consult `applicability.py` on `contracts/api/api-contract.md`; when `not-applicable`, print info note + `sys.exit(0)` before the no-endpoint-table check; `invalid`→hard-fail; else unchanged (AC-1). | backend-engineer |
| IP-4 | Python defensive self-skip | Same reader call at the head of `validate_api_conformance.py`, `validate_response_shape.py`, `validate_env_semantic.py` (already opt-in-skip; low risk) so no validator enforces a not-applicable family. | backend-engineer |
| IP-5 | TS parser projection | `src/contracts/parser.ts`: add a read-only helper projecting `applicability` + `applicability-reason` off the existing `stripFrontmatter().frontmatter`. Display only — no classification/skip logic, no pass/fail. | backend-engineer |
| IP-6 | Doctor display + drift | `src/commands/doctor.ts`: add a `checkContractApplicability(cwd)` Finding producer (registered alongside the existing `findings.push(...)` block ~L560-569) that lists each not-applicable surface + reason as `ok`/informational (AC-4), and emits a `warning` when a marked surface's body now looks filled (AC-7). Advisory only. | backend-engineer |
| IP-7 | Kit contract data edits | Add `applicability: not-applicable` + honest `applicability-reason` to `contracts/api/api-contract.md`, `contracts/css/css-contract.md`, `contracts/business/business-rules.md`, `contracts/data/data-shape-contract.md`. Keep all other frontmatter fields (`contract`, `schema-version`, `last-changed`). Leave `contracts/{ci,env}` unmarked. | backend-engineer |
| IP-8 | Asset regeneration | Run `node build.js` to regenerate `assets/` from the edited `.claude/` scripts. Do not hand-edit `assets/`. Register no new CLI command/flag (doctor needs none). | backend-engineer |
| IP-9 | Tests (red-first) | Author/extend the test files in `test-plan.md` §AC→Test Mapping, RED before IP-1..IP-6 exist. | backend-engineer (test-strategist maps) |

## Source Artifact Pointers
| source | relevant pointer | used for |
|---|---|---|
| design.md | Key Decisions 1-5 (frontmatter single source; Python single authority self-skip; fail-closed rules; drift reuses `meaningful_chars`; no schema — inline validation) | implementation constraints |
| docs/adr/0011-...md | Decision items 1-5 | non-reversible design intent |
| contracts/ci/ci-gate-contract.md | §"Contract Applicability Marker (ADR 0011)" semantics 1-5 + Fail-closed invariant (schema-version 0.3.0, already applied) | exact marker grammar + pass/fail semantics IP-1..IP-3 must match |
| test-plan.md | §Acceptance Criteria → Test Mapping; §Test Update Contract; §Notes (red-first, AC-2 regression guard) | tests to write/run |
| ci-gates.md | §Required Gates table; §Fail-Closed Invariant — Confirmed (`enforceContractSubstance` no-ops on empty tables — AC-6 safe, no second TS authority) | verification commands + confirms no gate-contracts.ts change needed |
| change-classification.md | Inferred Acceptance Criteria AC-1..AC-7; Tasks Not Applicable | scope + owner map |

## File-Level Plan
| path or glob | action | notes |
|---|---|---|
| `.claude/skills/contract-driven-delivery/scripts/applicability.py` | create | IP-1. Frontmatter key parser (mirror parser.ts regex `^([A-Za-z0-9_-]+):\s*(.*)$` / Python `strip_frontmatter` convention); classify + inline validate. Sibling-importable (`sys.path[0]` = run-script dir). |
| `.claude/skills/contract-driven-delivery/scripts/validate_contracts.py` | edit | IP-2. Per-file loop consults reader; keep `REQUIRED` list + `meaningful_chars` + `PLACEHOLDER_THRESHOLD` (470) as-is. |
| `.claude/skills/contract-driven-delivery/scripts/validate_api_semantic.py` | edit | IP-3. Reuse existing `strip_frontmatter`; self-skip on `CONTRACT_PATH`. |
| `.claude/skills/contract-driven-delivery/scripts/validate_api_conformance.py` | edit | IP-4 defensive self-skip. |
| `.claude/skills/contract-driven-delivery/scripts/validate_response_shape.py` | edit | IP-4 defensive self-skip. |
| `.claude/skills/contract-driven-delivery/scripts/validate_env_semantic.py` | edit | IP-4 defensive self-skip (env is unmarked → no behavior change, kept consistent). |
| `src/contracts/parser.ts` | edit | IP-5. Add exported read-only projection helper on `stripFrontmatter` result. No pass/fail. |
| `src/commands/doctor.ts` | edit | IP-6. New `checkContractApplicability`; register in the aggregation block (~L560-569). |
| `contracts/api/api-contract.md` | edit | IP-7 marker (reason: CLI has no HTTP API surface). |
| `contracts/css/css-contract.md` | edit | IP-7 marker (reason: CLI has no CSS/UI surface). |
| `contracts/business/business-rules.md` | edit | IP-7 marker (reason: CLI has no business-domain surface). |
| `contracts/data/data-shape-contract.md` | edit | IP-7 marker (reason: CLI has no data-shape surface). VERIFIED empty stub — 4 surfaces total. |
| `assets/**` | regenerate | IP-8 via `node build.js` only; never hand-edit. |
| `test/contracts/applicability-reader.test.ts` | create | AC-1/AC-2/AC-3 unit (spawn Python directly, existing convention). |
| `test/cli/validate-applicability.test.ts` | create | AC-1/AC-2/AC-3/AC-7 contract. |
| `test/contracts/applicability-agreement.test.ts` | create | AC-6 TS↔Python agreement. |
| `test/cli/gate.test.ts` | edit | AC-2 regression guard + AC-5 kit-green (test-plan Test Update Contract). |
| `test/cli/doctor.test.ts` | edit | AC-4 listing + AC-7 drift warning. |
| `test/contracts/parser.test.ts` | edit | AC-6 projection helper unit. |

## Contract Updates
- API: none as schema change; `contracts/api/api-contract.md` gets the marker (IP-7 data edit).
- CSS/UI: none as schema change; `contracts/css/css-contract.md` gets the marker (IP-7 data edit).
- Env: none — `contracts/env/env-contract.md` untouched.
- Data shape: none as schema change; `contracts/data/data-shape-contract.md` gets the marker (IP-7 data edit).
- Business logic: none as schema change; `contracts/business/business-rules.md` gets the marker (IP-7 data edit).
- CI/CD: already applied — `contracts/ci/ci-gate-contract.md` §"Contract Applicability Marker" at schema-version 0.3.0 documents semantics 1-5. No further contract change; `contract-reviewer` confirms marker edits are data-only.

## Test Execution Plan
| acceptance criterion | test file / command | expected signal |
|---|---|---|
| AC-1 | test/contracts/applicability-reader.test.ts | reader returns skip+reason for `not-applicable`+non-empty reason |
| AC-1 | test/cli/validate-applicability.test.ts | validate skips a not-applicable api contract, prints info note (surface+reason); api-semantic chain self-skips |
| AC-2 | test/contracts/applicability-reader.test.ts | reader returns `applicable` for unmarked + `applicability: applicable` |
| AC-2 | test/cli/validate-applicability.test.ts | unmarked empty stub still hard-fails (regression guard, must not weaken) |
| AC-2 | test/cli/gate.test.ts | fresh-templates gate still fails on stub content (re-asserted unchanged) |
| AC-3 | test/contracts/applicability-reader.test.ts | reader flags no-reason + unknown value as invalid |
| AC-3 | test/cli/validate-applicability.test.ts | validate hard-fails no-reason marker + unknown value (never passes silently) |
| AC-4 | test/cli/doctor.test.ts | doctor lists not-applicable surfaces + reasons (no failure) |
| AC-5 | test/cli/gate.test.ts | kit gate passes after marking `contracts/{api,css,business,data}`; filled `{env,ci}` unchanged |
| AC-6 | test/contracts/parser.test.ts | projection reads marker for display only (no TS pass/fail branch) |
| AC-6 | test/contracts/applicability-agreement.test.ts | TS projection and `applicability.py` agree on every fixture case |
| AC-7 | test/cli/validate-applicability.test.ts | not-applicable body over the placeholder threshold → WARNING, not failure |
| AC-7 | test/cli/doctor.test.ts | doctor surfaces same drift as warning, never failure |

Required phase floor: `collect`, `targeted`, `changed-area`; plus `contract`
(`contracts/ci` touched) and `full` (final/CI) per test-plan.md §Test Execution
Ladder. Implementation agents generate evidence with `cdd-kit test run`; the gate
validates `test-evidence.yml`. Python unit tests are spawned from TS
(`spawnSync`) — the repo has no pytest harness; mirror the existing
Python-validator test convention. AC-1/AC-2/AC-3 tests are RED-first before
`applicability.py` exists. Full strategy lives in test-plan.md; do not restate.

## Handoff Constraints
- Implementation agents must not infer missing requirements from chat history.
- Do not re-copy full design, test strategy, CI policy, or contract prose into this plan; follow the source pointers above.
- `.claude/` scripts are the editable source; `assets/` is regenerated by
  `node build.js` — never hand-edit `assets/`.
- Cross-platform: PowerShell + POSIX. Do not add bespoke shell detection —
  cross-platform agreement (AC-6) is covered by the existing CI matrix.
- Reuse existing primitives: `stripFrontmatter` / `strip_frontmatter`, the
  `meaningful_chars` + `PLACEHOLDER_THRESHOLD` stub metric, and mirror
  `tier-floor`'s required-reason discipline for the `applicability-reason` rule.
- TS never makes a pass/fail decision on the marker (an AC-6 regression); the
  Python `applicability.py` reader is the sole authority.
- If this plan omits a required file, behavior, contract, or test, stop and report `blocked`.
- Keep implementation within the file-level plan unless a Context Expansion Request is approved.

## Known Risks
- `.cdd/code-map.yml` header reads `cdd-kit 2.2.1` (stale vs current release) and
  does not index `.claude/` (excluded); source ranges for the `.claude/` Python
  scripts were read directly under the approved CER-001 path. A `cdd-kit code-map`
  refresh is advisable but does not block this plan.
- No standalone `validate_css*.py` or business-rules validator exists — the
  css/business/data families are enforced ONLY by `validate_contracts.py`'s stub
  check, so IP-2 is the single wiring point for those three families; the api
  family additionally needs IP-3. Do not invent new per-family validator scripts.
- Second TS authority already CLEARED: ci-gates.md confirms
  `enforceContractSubstance` (gate-contracts.ts) returns on `rows.length === 0`
  and `gate.ts` delegates all other contract pass/fail to `validate()` → the
  Python reader is the sole authority (AC-6 safe). No gate-contracts.ts edit.
- Sibling import of `applicability.py` relies on the run-script dir being on
  `sys.path[0]`; validators are invoked by path via `spawnSync` in validate.ts.
  Confirm the import resolves under both `python3`/`python` and both platforms
  in the integration test.
- Reason strings in frontmatter may be quoted (`applicability-reason: "..."`);
  `applicability.py` must treat a quoted-empty (`""`) as missing (AC-3).
