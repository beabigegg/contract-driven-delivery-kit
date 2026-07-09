# Archive: not-applicable-contracts (ADR 0011)

## Change Summary
Added the `applicability: not-applicable` contract-frontmatter marker (with a
required `applicability-reason`) so `cdd-kit validate` can distinguish an
empty-because-unfilled contract from an empty-because-the-surface-does-not-exist
one. A marked family is skipped with an informational note; an UNMARKED empty stub
still hard-fails. Released 3.9.0 (commit 80f0f8f), built via a dogfooded `/cdd-new`.

## Final Behavior
- Fail-closed: no marker / `applicable` → validated as today (stub still hard-fails);
  `not-applicable` + reason → skip + info note; `not-applicable` without a reason, or
  an unrecognized value → hard error; a marked-but-now-filled contract → advisory drift
  WARNING only.
- Python `applicability.py` is the single pass/fail authority; `validate.ts`/`doctor`
  read the marker for display only (no second authority → no TS/Python divergence).
- `build.js` strips the marker from generated `assets/contracts`, so `cdd-kit init`
  still ships neutral, fail-until-filled stubs to adopters.
- The kit's own `contracts/{api,css,business,data}` are marked, so `cdd-kit gate`/
  `validate` on the kit is green on those surfaces (and acceptance-oracle's gate, which
  was previously red on them, is now fully green too).

## Final Contracts Updated
- `contracts/ci/ci-gate-contract.md` → 0.3.0 (§ Contract Applicability Marker).
- Data edits (marker applied): `contracts/{api,css,business,data}`.

## Final Tests Added / Updated
- New: `applicability-reader`, `applicability-agreement`, `validate-applicability` tests;
  the change's own `test/acceptance/` driver.
- Extended: parser/doctor/gate tests; `mock-of-sut-scan` tests (for the scanner bugfix).
- Full suite green at close: 92 files / 1163 tests passed.

## Final CI/CD Gates
- No new gate row (alters existing validate/semantic-validator semantics, safe direction).
  ci-cd-gatekeeper confirmed the fail-closed invariant and no second TS authority.

## Production Reality Findings
- qa-reviewer verdict: **approved-with-risk** (only risk = commit hygiene; resolved by a
  precise, scoped commit).
- Dogfooding surfaced two real bugs in the shipped 3.8.0 acceptance-oracle scanner
  (`mock-of-sut-scan.ts`): cross-change contamination + generic-word substring FP. FIXED
  in this change (change-scoped driver association + word-boundary matching).
- Unplanned-but-necessary `build.js` asset-strip: without it, marking the kit's own
  contracts would have leaked the marker into every `cdd-kit init` project's starter
  contracts, defeating stub detection for adopters.

## Lessons Promoted to Standards
Durable rules were promoted to hot data DURING the change:
- Applicability marker semantics live in `contracts/ci/ci-gate-contract.md` (§ Contract
  Applicability Marker) — hot contract.
- The single-authority design + fail-closed invariant live in
  `docs/adr/0011-not-applicable-contract-marker.md` — durable design record.
No additional promotion required (see tasks.yml 7.2 rationale).

## Follow-up Work
- AC-7 drift heuristic counts HTML-comment content (api-contract.md advisory drift) — non-blocking, deferred to a future change (owner test-strategist + backend-engineer).
- npm publish of 3.9.0 pending; global cdd-kit still 2.2.1 (pre-commit hook staleness — commits touching specs/changes/** need `node dist/cli/index.js gate` verification + `--no-verify`).

## Cold Data Warning
This archive is historical evidence. Current requirements live in `contracts/` and active project guidance.
