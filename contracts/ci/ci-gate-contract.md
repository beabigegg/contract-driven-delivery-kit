---
contract: ci
summary: CI gate inventory, artifact retention, and rollback requirements.
owner: platform-team
surface: delivery-pipeline
schema-version: 0.3.0
last-changed: 2026-07-09
breaking-change-policy: deprecate-2-minors
---

# CI/CD Gate Contract

## Gate Inventory
| gate | tier | trigger | required | command/workflow | owner | artifact |
|---|---:|---|---:|---|---|---|
| enforceAcceptanceOracle | 1 | pull_request; local (`cdd-kit gate`) | yes | `cdd-kit gate` | platform-team | `specs/changes/<id>/acceptance.yml`, `.cdd/acceptance-lock.json`, `test-evidence.yml` (`acceptance` phase) |

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
   modified after authoring — human must re-confirm."
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
   bound test (ADR 0010 §4).

Non-behavioral (pure refactor) opt-out is permitted only via reference-parity
evidence or an agent-forbidden, review-countersigned `acceptance-not-applicable`
reason — deliberately stricter than the ADR 0005 test-evidence opt-out.

## Informational Gate Promotion Policy

`enforceAcceptanceOracle` ships required (see Required Check Policy) and has no
promotion-policy entry — it does not go through an informational period. This
is a deliberate exception to `ci/required-check-policy.md`'s general "new gates
begin as informational" guidance; the exception rationale is recorded above and
requires `ci-cd-gatekeeper` sign-off, not silent adoption.

## Artifact Retention Policy

- `specs/changes/<id>/acceptance.yml` is a first-class spec artifact: retained
  indefinitely as part of repo/change history (never pruned), same class as
  other required change artifacts.
- `.cdd/acceptance-lock.json` (per-change hash baseline) and
  `.cdd/asset-manifest.json` (install/refresh digest stamps) are regenerable
  sidecars, not source of record — safe to delete/regenerate, no retention
  requirement beyond current state (design.md Migration/Rollback).

## Rollback Policy

`enforceAcceptanceOracle` is additive: reverting the change removes the gate
check, the `acceptance.yml` template, `pre-tool-use-acceptance-write.sh`, and
digest stamping, with no data migration required. The `.cdd/acceptance-lock.json`
and `.cdd/asset-manifest.json` sidecars are regenerable and safe to delete on
rollback (design.md Migration/Rollback).

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
