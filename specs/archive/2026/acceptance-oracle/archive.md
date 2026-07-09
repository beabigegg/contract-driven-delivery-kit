# Archive: acceptance-oracle (ADR 0010)

## Change Summary
Added the Acceptance Oracle: a human-owned `acceptance.yml` per change pairing
business-language `input → expect` cases (plus invariant `rules`) with the
behavior, enforced by a required `enforceAcceptanceOracle` gate check that makes
the implementation prove itself against the real system. Closes the intent gap
the oracle problem leaves open — the one point only the non-coding author can
close. Released 3.8.0 (commit e55dc40), built via a dogfooded `/cdd-new`.

## Final Behavior
- `cdd-kit gate` fails a change whose `acceptance.yml` is missing/placeholder, whose
  oracle hash diverges from its `.cdd/acceptance-lock.json` baseline, whose driver
  mocks the code-map-resolved SUT or hardcodes an `expect` value, or whose case pass
  is not a recorded `acceptance`-phase evidence run.
- `cdd-kit new` scaffolds `acceptance.yml`; `migrate` backfills existing changes
  (fail-until-filled). `cdd-kit accept relock <id>` is the only sanctioned way to
  re-baseline. `cdd-kit test run <id> --phase acceptance` runs the drivers.
- `install-agent-hooks --acceptance-write` arms the write-block hook;
  `.cdd/acceptance-lock.json` is an agent-forbidden path.
- `refresh`/`upgrade`/`install-agent-hooks` stamp `.cdd/asset-manifest.json`; `doctor`
  reports asset drift.

## Final Contracts Updated
- `contracts/ci/ci-gate-contract.md` → 0.2.0 (enforceAcceptanceOracle required check).
- `contracts/env/env-contract.md` → 0.2.0 (`CDD_ACCEPTANCE_WRITE_STRICT`); `.env.example.template`, `env.schema.json` synced.

## Final Tests Added / Updated
- New: acceptance schema/hash/mock-scan/asset-manifest unit tests; acceptance-write-hook,
  accept-relock, acceptance-oracle CLI tests; the change's own `test/acceptance/` driver.
- Extended: gate/doctor/migrate/refresh/upgrade/install-agent-hooks + test-evidence schema.
- Full suite green at close (1163 tests via the follow-up state).

## Final CI/CD Gates
- `enforceAcceptanceOracle` — required (blocking), Tier 1, PR + local; ci-cd-gatekeeper
  approved required-from-day-one (see ci-gates.md).

## Production Reality Findings
- qa-reviewer verdict: **approved-with-risk**. The original repo-level gate red was a
  PRE-EXISTING empty-api/css/business-contract issue, unrelated to this change — later
  RESOLVED by the follow-up `not-applicable-contracts` (ADR 0011), so acceptance-oracle's
  gate is now fully green (exit 0) at close.
- Dogfooding surfaced two later-fixed scanner bugs (cross-change contamination + generic-word
  substring FP) in this change's own `mock-of-sut-scan.ts` — fixed under `not-applicable-contracts`.

## Lessons Promoted to Standards
Durable rules were promoted to hot data DURING the change, not deferred:
- The enforceAcceptanceOracle pass/fail semantics live in `contracts/ci/ci-gate-contract.md`
  (§ Required Check Policy) — hot contract.
- The design decisions + portable-enforcement-vs-harness-automation boundary live in
  `docs/adr/0010-acceptance-oracle.md` — durable design record.
No additional promotion required (see Step 3 rationale in tasks.yml 7.2).

## Follow-up Work
- AC-7 drift heuristic counts HTML-comment content (api-contract.md advisory drift warning) — non-blocking, deferred.
- JS/TS + Python driver loaders shipped; deferred ADRs: Z3/SMT contract consistency, mutation testing, property-based generation, Workflow-script lifecycle.
- npm publish of 3.8.0 pending; global cdd-kit still 2.2.1 (pre-commit hook staleness).

## Cold Data Warning
This archive is historical evidence. Current requirements live in `contracts/` and active project guidance.
