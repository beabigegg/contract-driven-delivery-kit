# QA Report: acceptance-oracle

Decision: **approved-with-risk** (qa-reviewer, 2026-07-08)

## Verdict
The acceptance-oracle change (ADR 0010) is release-ready on its own merits. Every
acceptance criterion AC-1..AC-8 is implemented across blocks 1-9 and independently
verified; the new `enforceAcceptanceOracle` check passes on this change; the
change's own `acceptance.yml` (3 cases + 1 invariant) is baseline-locked
(`.cdd/acceptance-lock.json`) and backed by a recorded, passed `acceptance`-phase
run; contracts and CI sign-off are complete; the full suite is green.

## Gate results (independently reproduced)
| gate | result |
|---|---|
| `enforceAcceptanceOracle` (this change's new check) | pass |
| acceptance-phase evidence (test-evidence.yml) | pass (`final-status: passed`) |
| this change's acceptance driver (`test/acceptance/acceptance-oracle.driver.test.ts`) | pass 4/4 |
| oracle CLI suite (`test/cli/acceptance-oracle.test.ts`) | pass |
| full suite `npm test` | 88 files / 1125 tests passed, 57 skipped (win32 POSIX-only) |
| contracts (ci 0.2.0, env 0.2.0) + CI sign-off | pass |
| repo-level `cdd-kit gate` | FAIL — pre-existing, unrelated (see Risks) |

## Risks accepted (owned, dated)
1. **Pre-existing empty-template gate red.** The repo-level `cdd-kit gate` is red
   because the kit's own `contracts/{api,css,business}` are unfilled templates for
   surfaces a CLI does not have (no HTTP API/CSS/business-domain). Byte-identical
   to HEAD; not introduced by this change; cannot be cleared without inventing
   fake contracts. → separate follow-up, owner contract-reviewer + ci-cd-gatekeeper.
   Product insight surfaced: the kit's gate cannot distinguish an
   *empty-because-unfilled* contract from an *empty-because-the-surface-does-not-exist*
   one for CLI repos — worth a `validate` enhancement (mark absent surfaces
   `not-applicable`).
2. **Mock-of-SUT precision.** Code-map name-based resolution is a known weak spot;
   over-strict scanning could false-positive. Conservative rule set shipped; a
   future false positive is a P0 rule-tighten, not a gate demotion (ci-cd-gatekeeper).
   Owner test-strategist.
3. **Irreducible lazy-oracle residual (ADR 0010).** No mechanism detects a
   lazy-but-well-formed oracle; the author's oracle role is undelegatable. Accepted
   by design.
4. **Tier-floor override.** `migrate/migration` keyword matched the critical-surface
   floor; substantively justified as a false positive (CLI-command scaffolding, not
   DB/data migration) and recorded in `agent-log/audit.yml`.

## Pre-merge follow-ups
- Author `regression-report.md` (done alongside this report) — classifier-required.
- spec-architect co-sign recommended for this high-risk, system-wide Tier 1 change
  to the gate contract (two-reviewer threshold).
- File the empty-template follow-up change with owner + date before relying on a
  fully-green repo-level `cdd-kit gate`.
