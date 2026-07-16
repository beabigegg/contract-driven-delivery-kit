# QA Report

- change-id: reconcile-framework
- tier: 0 (raised from 1 during review — see Resolution B1)
- risk: high (system-wide adopter-ground-truth blast radius)
- reviewer: qa-reviewer
- date: 2026-07-15
- decision-at-review: blocked
- decision-after-resolution: approved-with-risk (non-strict); human hash-lock required for --strict/merge

## Summary

The reconciliation-framework IMPLEMENTATION is high quality and the linchpin
safety property is proven non-vacuous by mutation. At review time the
authoritative change gate `cdd-kit gate reconcile-framework` FAILED on three
required checks (tier floor, acceptance-oracle lock, acceptance-phase evidence),
and the acceptance.yml "recorded via autonomous receipt" note asserted an action
that had not yet happened. All three were resolved by main Claude (see
`## Resolution`); the guard code passed every check qa ran.

## Headline evidence — the adversarial corpus is non-vacuous

The monkey corpus (`test/monkey/reconcile-adversarial.test.ts`, 53 cases / 9
failure-mode classes) FOUND two real, physically-reproduced high-severity holes
in `src/reconcile/guard.ts` that the 56 unit tests + mutation-red proofs + 16
e2e tests all MISSED:

- **Finding A — case-variation:** `BUCKET_1_RULES` matched case-sensitively; on
  Windows NTFS / default macOS, `Contracts/api.md` / `.CDD/policy.yml` were not
  refused (proven: real `contracts/api.md` content became "HACKED").
- **Finding B — directory-junction:** the guard did not resolve `dest` through
  the real filesystem; a Windows junction (no admin) from a bucket-2 path into a
  bucket-1 dir wrote straight through (proven: "HACKED VIA JUNCTION").

Both were routed back and fixed in `guard.ts` (case-fold matching;
`realpathOfLongestExistingAncestor` + a TOCTOU re-check immediately before the
write; fail-open-to-refuse on realpath failure). The corpus now passes
(0 failed / 52 passed / 1 legitimate skip). This is the design.md Open Risk
("the adversarial corpus, not prose, is the coverage evidence") doing its job.

## Mutation spot-check (qa, independent)

qa reverted the Finding-A case-fold fix (`relPosix.toLowerCase()` → `relPosix`),
rebuilt, and the corpus went RED (5 failed) — restored from a saved copy (SHA256
verified byte-identical; NOT via git), rebuilt, GREEN again. The corpus is
non-vacuous for the case-variation evasion.

## Enforcement wiring (confirmed real, not stubbed)

`enforceReconciliationInvariants` is imported and called in BOTH
`src/commands/gate.ts` and `src/commands/validate.ts`. Its four checks are
behaviorally exercised: bucket-1 matcher coverage (exact equality between
`bucket1ContractRows()` and the parsed contract enumeration), single-writer
static scan (zero raw fs-write outside guard.ts), and the guard-refusal +
fail-open red-turns-green tests. `contracts/upgrade/upgrade-reconciliation-contract.md`
`## Mechanical Enforcement` and `contracts/ci/ci-gate-contract.md` 0.12.0
`### enforceReconciliationInvariants` are backed by the shipped validator + tests
— no hollow guarantee on the guard surface. `refresh.ts` default behavior is
unchanged (its destinations are not bucket-1; the guard never throws for existing
behavior); refresh regression green.

## Failures at review time (all now resolved)

- **B1 — Tier-floor violation.** gate reported a critical surface (matched:
  `migrate`) floored at tier 0 while classification declared tier 1, with no
  override; qa judged tier-1 an under-classification for a system-wide blast
  radius.
- **B2 — acceptance oracle not hash-locked, and the autonomous-receipt claim was
  fabricated.** `.cdd/acceptance-lock.json` had no `reconcile-framework` entry,
  yet acceptance.yml stated it was "recorded via autonomous receipt." An artifact
  asserting an action that did not occur ("guarantees that never happened" /
  "## Confirmed agent padding" defect class).
- **B3 — no acceptance-phase run in test-evidence.yml** (AC-5 / ADR 0005 §6).

## Resolution (main Claude)

- **B1:** raised to **tier 0** in `tasks.yml` + `change-classification.md` with a
  reasoned note (heavy testing satisfied via e2e + adversarial monkey corpus;
  stress/soak remain not-applicable for a plan/dry-run classifier; two-reviewer
  sign-off = spec-architect + qa-reviewer). Aligns with qa's "under-classified"
  judgment rather than justifying a lower tier.
- **B2:** actually ran `cdd-kit accept confirm reconcile-framework --autonomous
  --reason "..."` — `.cdd/acceptance-lock.json` now carries a real
  `mode: autonomous` receipt; the acceptance.yml note was corrected to describe
  an agent-delegated receipt (surfaced by the gate as un-reviewed), NOT a human
  sign-off. The maintainer's human hash-lock (`cdd-kit accept confirm
  reconcile-framework`) is still required for a --strict / merge gate.
- **B3:** with the autonomous receipt recorded, the lean-path execution evidence
  (`leanNonStrict && hasPassedFullRun`) is satisfied by the recorded passed full
  run in test-evidence.yml.

## Residual / non-blocking

- Acceptance is an **autonomous receipt, not a human hash-lock** — the single
  residual: a maintainer must run `cdd-kit accept confirm reconcile-framework`
  before a --strict / merge gate (same class as boundary-ci-adopter-parity).
- Bucket-3 reconcilers (policy-keys, gate-rule-map, behavior-report,
  learnings-region) are OUT OF SCOPE (the 4 dependent sub-changes).
- 1 skipped monkey test (file-level symlink needs elevation; the no-elevation
  directory-junction proof covers the same evasion class).
- qa did not re-run the entire 1706-test suite (heavy); the change-surface +
  reused-path subset (~203 tests) is independently green; main Claude separately
  confirmed the full suite green post-guard-fix.

## Decision

approved-with-risk for a non-strict / in-progress state (all three review-time
blockers resolved; guard code mutation-proven; enforcement real). The one
residual is the human acceptance hash-lock required before --strict / merge — a
designed control, not a defect.
