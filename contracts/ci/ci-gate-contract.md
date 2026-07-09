---
contract: ci
summary: CI gate inventory, artifact retention, and rollback requirements.
owner: platform-team
surface: delivery-pipeline
schema-version: 0.5.0
last-changed: 2026-07-09
breaking-change-policy: deprecate-2-minors
---

# CI/CD Gate Contract

## Gate Inventory
| gate | tier | trigger | required | command/workflow | owner | artifact |
|---|---:|---|---:|---|---|---|
| enforceAcceptanceOracle | 1 | pull_request; local (`cdd-kit gate`) | yes | `cdd-kit gate` | platform-team | `specs/changes/<id>/acceptance.yml`, `.cdd/acceptance-lock.json`, `test-evidence.yml` (`acceptance` phase) |
| enforceInteractionDesign | 1 | pull_request; push to default branch (`--strict`); local (`cdd-kit gate`) | yes | `cdd-kit gate` | platform-team | `specs/changes/<id>/interaction-design.md`, `.cdd/design-lock.json` |

### Trigger truthfulness (corrected by interaction-design-loop, ADR 0012)

Before this change, the `pull_request` half of `enforceAcceptanceOracle`'s trigger
cell was **false**: the shipped workflow ran `cdd-kit validate` only and never
invoked `cdd-kit gate <id>`, so every required check above ran solely in the local
`.git/hooks/pre-commit` hook — which `--no-verify` bypasses. This change adds the
change-id derivation + `cdd-kit gate` steps to both
`github-workflows/contract-driven-gates.yml` (adopter template) and this repo's
`.github/workflows/contract-driven-gates.yml`, making the `pull_request` trigger
true for **both** rows above. `enforceAcceptanceOracle` is the only other check
with an inventory row, so no other claim needed correcting.

`--strict` is applied on `push` to the default branch, not on `pull_request`: a PR
is legitimately opened mid-change with tasks still pending, whereas a merged change
with pending tasks is a defect.

## Required Check Policy

### enforceAcceptanceOracle (added by acceptance-oracle, ADR 0010)

`enforceAcceptanceOracle` ships as a REQUIRED (blocking) check from initial
release — it is **not** phased in as informational first, despite the general
new-gate guidance in `ci/required-check-policy.md` — because a silently-passable
oracle check defeats the mechanism it exists to enforce (design.md Migration/
Rollback: "the oracle is never silently skipped"; AC-7). `ci-cd-gatekeeper` must
sign off this required-from-day-one status against the general informational-
first guidance before this row ships (see CI/CD Gate Impact below).

Pass/fail conditions — ALL must hold to pass; any one failing fails the gate:

1. **AC-1** — `specs/changes/<id>/acceptance.yml` exists, is non-placeholder
   (existing `meaningfulChars`/placeholder detection), and has >=1 case.
2. **AC-2** — the recorded oracle hash (locked region: `cases[].{id,input,expect}`,
   `rules[].{id,statement}`) matches the author-time baseline in
   `.cdd/acceptance-lock.json`; a mismatch fails with "acceptance oracle
   modified after authoring — human must re-confirm." A `acceptance.yml` with **no**
   recorded baseline at all also fails (under `isNewChange || strict`; a legacy dir
   is warned). An unlocked oracle is not evidence of human authorship: the
   acceptance-write hook is advisory unless `CDD_ACCEPTANCE_WRITE_STRICT=1`, so any
   Edit-capable agent can author one. Only `cdd-kit accept relock` writes the lock.
3. **AC-4** — no acceptance driver mocks a module resolved as the change's SUT
   from the code-map ("acceptance test mocks the thing it is supposed to
   verify"); external I/O boundary fakes (network, clock) are allowed.
4. **AC-5** — each case's pass is a recorded, bounded, passed `acceptance`-phase
   run in `test-evidence.yml` (ADR 0005 evidence harness); a self-reported pass
   with no recorded run fails.
5. **AC-7** — a change migrated by `cdd-kit migrate` (placeholder-plus-
   instructions `acceptance.yml`) fails this check until the author supplies
   real, non-placeholder cases; never silently skipped.
6. `--strict` mode additionally requires each `rules[]` invariant to have >=1
   bound test (ADR 0010 §4; implemented by `findUnboundRules`,
   `src/utils/mock-of-sut-scan.ts`, added by interaction-design-loop scope
   expansion 2 — this condition previously named a check that did not exist
   in code). **Binding convention:** a rule is bound when a driver file under
   `test(s)/acceptance/` that belongs to THIS change (`driverBelongsToChange`
   — filename `<change-id>.driver.*`, or its source resolves the emitted
   loader to this change id) contains a word-boundary occurrence
   (`isWordBoundaryOccurrence`) of the rule's id — conventionally inside a
   test title, e.g. `it("rule <id>: ...", ...)`, the same test-title-carries-
   the-id convention this codebase already uses for AC ids. An unbound rule
   fails with `acceptance rule "<id>" has no bound test in test/acceptance/
   (--strict; ADR 0010 §4).` naming the rule id. `rules: []` (or no `rules`
   key) passes trivially — there is nothing to bind, so a change dir that has
   never declared `rules[]` is unaffected. This scan reuses the same two
   guards AC-4's mock-of-SUT/hardcoded-expect scan above already enforces, so
   it cannot reproduce the two false-positive bugs that scan's own dogfooding
   exposed: a driver written for a **different** change never counts toward
   this change's binding (change-scoped), and a rule id that is only a
   substring of a longer token never counts as a match (whole-token).

Non-behavioral (pure refactor) opt-out is permitted only via reference-parity
evidence or an agent-forbidden, review-countersigned `acceptance-not-applicable`
reason — deliberately stricter than the ADR 0005 test-evidence opt-out.

### enforceInteractionDesign (added by interaction-design-loop, ADR 0012)

`enforceInteractionDesign` ships as a REQUIRED (blocking) check for every change
created after this gate lands — it is **not** phased in as purely informational,
for the same reason `enforceAcceptanceOracle` was not: a silently-passable design
gate defeats the mechanism it exists to enforce (ADR 0012 §6). Unlike
`enforceAcceptanceOracle`'s registration above, this row states the migration
device explicitly rather than leaving it to code comments: the check gates on
`isNewChange || strict` — a NEW change directory (`tasks.yml` frontmatter
`context-governance: v1`, per `isContextGovernedChange`) or a `--strict` run must
pass all conditions below unconditionally; a PRE-EXISTING change directory is
exempt from the missing-artifact / missing-confirmation branches until migrated,
exactly as `enforceTestEvidence` / `enforceAcceptanceOracle` are exempted, so no
in-flight change directory fails overnight on introduction. `ci-cd-gatekeeper` has
signed off this required-from-day-one-for-new-changes status.

Pass/fail conditions — ALL must hold to pass; any one failing fails the gate:

1. **AC-2** — `specs/changes/<id>/interaction-design.md` exists and is
   non-placeholder (existing `meaningfulChars`/placeholder detection).
2. **AC-4** — zero unresolved `## Open Decisions` entries.
3. **AC-4** — a human `## Confirmed` section is present.
4. **AC-4 / AC-9** — referential integrity holds: every control cites exactly one
   intent id; every intent has exactly one path; every deleted control records its
   reason.
5. **AC-5** — provenance reconciliation (see `## Provenance Reconciliation Policy`
   below) has zero HARD failures. Reverse-direction findings (a contract field or
   row with zero citing information items) are corpus-wide, `doctor`-reported,
   ADVISORY only, and are never evaluated or blocked by this per-change gate.
6. **AC-3 / AC-6** — the confirmed-region canonical-projection sha256 in
   `.cdd/design-lock.json` matches the parsed `## Confirmed` region; a mismatch
   fails with "interaction design modified after confirmation — human must
   re-confirm." A `## Confirmed` section with **no** recorded baseline at all also
   fails (under `isNewChange || strict`; a legacy dir is warned). An unlocked
   `## Confirmed` is not evidence of human confirmation: the design-write hook is
   advisory unless `CDD_DESIGN_WRITE_STRICT=1`, so any Edit-capable agent can
   author that prose. Only `cdd-kit design confirm` writes the lock.
7. **AC-8** — a change whose `interaction-design.md` carries
   `applicability: not-applicable` with a non-empty `applicability-reason` SKIPS
   conditions 1–6 entirely. `applicability.py` remains the sole pass/fail authority
   for this marker, applied here to a per-change spec artifact rather than a
   `contracts/` family file (see the `## Contract Applicability Marker (ADR 0011)`
   addendum below) — no second authority is introduced.
8. **AC-7** — a change migrated by `cdd-kit migrate` (placeholder-plus-instructions
   `interaction-design.md`) fails this check until the author supplies a real,
   human-confirmed design; never silently skipped, mirroring
   `enforceAcceptanceOracle` AC-7.

Non-behavioral (pure copy/color) opt-out is permitted only via condition 7 above —
the same discipline `enforceAcceptanceOracle` applies to non-behavioral refactors,
applied here to design instead of function.

**Never gated (ADR 0012 § Never Gated).** This check must never fail a change on
visual aesthetics, animation or motion, layout taste, typography, colour, or
latency / round-trip count. Only derivation, provenance, referential integrity, and
tamper-evidence may block. A rule over taste has no oracle to consult and would
manufacture the very defect this gate exists to prevent.

## Provenance Reconciliation Policy (ADR 0012 §2)

Every information item and UI state in `interaction-design.md` must cite a supplier
resolvable against `contracts/api/api-contract.md` (endpoint + `## Schemas` field,
its `errors`-column HTTP status, or an implicit HTTP status) or
`contracts/data/data-shape-contract.md` (`## Invalid Data Behavior` row, keyed by
its `condition` column). The `errors` column holds bare comma-separated HTTP-status
integers only, never a semantic error code; `contracts/api/error-format.md` is
deliberately NOT a join target (ADR 0012 § Out of scope).

Field-existence resolution reuses the ADR 0007 `contracts/api/openapi.json`
projection and does not re-derive it. If that projection is missing or stale
(`openapi export --check` would fail), OR the cited endpoint's `response schema`
cell is unresolved prose with no matching `## Schemas` entry, then any
endpoint+field citation is a HARD failure naming the fix — it never silently
passes: a citation asserting a field exists is a positive claim, and an
unverifiable positive claim must not pass a required blocking gate. Citations of a
bare HTTP status or an `errors`-column status do not require the projection and
remain checkable when `## Schemas` is empty.

If `contracts/api/api-contract.md` or `contracts/data/data-shape-contract.md`
itself carries `applicability: not-applicable`, citing that family's supplier kinds
is its own HARD failure category, with a marker-aware message naming the marker and
its reason — distinct from a bare "reference not found". Citing a family the
project has declared it does not have is a different, more actionable error.

Two UI states that differ in meaning MUST cite distinct discriminators. A state
citing a discriminator absent from the contract is a HARD error that drives the
convergence back-edge to `contract-reviewer`: the contract must supply the
discriminator (a field, a distinct HTTP status, an enum-pinned success-envelope
value) before either side freezes.

## Informational Gate Promotion Policy

`enforceAcceptanceOracle` ships required (see Required Check Policy) and has no
promotion-policy entry — it does not go through an informational period. This
is a deliberate exception to `ci/required-check-policy.md`'s general "new gates
begin as informational" guidance; the exception rationale is recorded above and
requires `ci-cd-gatekeeper` sign-off, not silent adoption.

`enforceInteractionDesign` is a second deliberate exception, bounded by
`isNewChange || strict` rather than being an unconditional day-one requirement.

The reverse/over-fetch advisory (a contract field with zero citing information
items) is a corpus-wide `cdd-kit doctor` report, permanently informational. It may
never be promoted to a gate finding: a per-change artifact cannot see sibling
screens, so a per-change computation would emit false advisories — the
context-blind failure ADR 0012 § Never Gated condemns.

## Artifact Retention Policy

- `specs/changes/<id>/acceptance.yml` is a first-class spec artifact: retained
  indefinitely as part of repo/change history (never pruned), same class as
  other required change artifacts.
- `.cdd/acceptance-lock.json` (per-change hash baseline) and
  `.cdd/asset-manifest.json` (install/refresh digest stamps) are regenerable
  sidecars, not source of record — safe to delete/regenerate, no retention
  requirement beyond current state (design.md Migration/Rollback).
- `specs/changes/<id>/interaction-design.md` is a first-class spec artifact:
  retained indefinitely, same class as `acceptance.yml`.
- `.cdd/design-lock.json` is a regenerable sidecar (per-change hash baseline), not
  source of record — safe to delete/regenerate, same class as
  `.cdd/acceptance-lock.json`.

## Rollback Policy

`enforceAcceptanceOracle` is additive: reverting the change removes the gate
check, the `acceptance.yml` template, `pre-tool-use-acceptance-write.sh`, and
digest stamping, with no data migration required. The `.cdd/acceptance-lock.json`
and `.cdd/asset-manifest.json` sidecars are regenerable and safe to delete on
rollback (design.md Migration/Rollback).

`enforceInteractionDesign` is additive: reverting the change removes the gate
check, the `interaction-design.md` template, `pre-tool-use-design-write.sh`, the
`design confirm` CLI, and the CI gate steps, with no data migration required.
`.cdd/design-lock.json` is regenerable and safe to delete on rollback.

## Contract Applicability Marker (ADR 0011)

Contract frontmatter may declare `applicability: not-applicable` with a
required, non-empty `applicability-reason: "<why>"` when a contract family
describes a surface the project genuinely does not have (e.g. a CLI has no
HTTP API / CSS / business-domain layer). The marker is read by a single shared
Python reader (`applicability.py`) imported by every semantic validator — the
Python layer is the SOLE pass/fail authority for this marker. `validate.ts`
reads the same field only to DISPLAY it in `doctor` output; it never makes its
own skip/fail decision from it (design.md decision 2 — no second authority, no
AC-6 divergence).

Marker semantics — fail-closed by default:

1. No `applicability` field, or `applicability: applicable` — validated
   exactly as today; an empty/placeholder stub still HARD-FAILS
   `cdd-kit validate`/`gate` unchanged (AC-2).
2. `applicability: not-applicable` + non-empty `applicability-reason` — the
   contract's presence/stub check and its family-specific semantic validator
   are SKIPPED, and `cdd-kit validate` emits an informational note naming the
   surface and the reason (not a failure, not silent) (AC-1).
3. `applicability: not-applicable` with a missing or empty
   `applicability-reason` — HARD ERROR, mirroring the tier-floor-override
   required-reason discipline: a bare skip with no justification is never
   allowed (AC-3).
4. Any unrecognized `applicability` value (e.g. a typo toward
   "not-applicable") — HARD ERROR; an unrecognized value is never treated as
   applicable-by-default or not-applicable-by-default.
5. A `not-applicable` contract whose body later exceeds the stub/placeholder
   threshold (i.e. now looks filled) is surfaced by `doctor`/`validate` as an
   advisory drift WARNING only — the mark may be stale — never a hard fail in
   this change (AC-7). Escalating drift to a hard error is an open follow-up,
   not yet scheduled.

**Fail-closed invariant:** a marker only suppresses its own family's check; an
unmarked stub still fails; a marker requires a reason.

`cdd-kit doctor` lists every not-applicable surface with its recorded reason as
informational output (AC-4).

First consumers: the kit's own `contracts/{api,css,business,data}` are marked
`applicability: not-applicable` (empty template stubs for surfaces this CLI
does not have) so `cdd-kit gate` on the kit itself goes green on those four
surfaces; `contracts/{ci,env}` are filled and remain unmarked, validated as
today.

Second consumer (ADR 0012): `specs/changes/<id>/interaction-design.md` — a
per-change spec artifact, not a `contracts/` family file — now also carries this
marker. `enforceInteractionDesign` reads it via the same `applicability.py` sole
authority, applied per-change rather than per-contract-family. This does not create
a second authority; it is a second file type read by the one existing reader.
