# QA Report: not-applicable-contracts

Decision: **approved-with-risk** (qa-reviewer, 2026-07-09)

## Verdict
ADR 0011 (contract applicability marker) is release-ready. The fail-closed
invariant "not-applicable is never a silent bypass" is directly verified: an
UNMARKED empty stub still hard-fails; a marker without a reason is a hard error;
an unrecognized value is a hard error; only a reasoned marker skips. The kit's
own empty `contracts/{api,css,business,data}` are marked and `validate --contracts`
on the kit now exits 0, while `build.js` strips the marker from generated
`assets/contracts` so `cdd-kit init` still ships neutral stubs that hard-fail
until filled (adopter safety preserved).

## Gate results (independently reproduced)
| gate | result |
|---|---|
| `cdd-kit gate not-applicable-contracts` | pass (exit 0; only benign 2-pending-task warning) |
| `cdd-kit validate --contracts` (kit repo) | pass (exit 0; api/css/business/data skipped-with-info; ci/env validated) |
| invariant tests (reader + validate-applicability + agreement) | 20/20 pass |
| acceptance oracle (this change's own) | authored, baseline-locked, passed acceptance-phase run |
| full suite `npm test` | 92 files / 1163 passed, 57 skipped, 0 failed |

## Scanner bugfix to a shipped feature
Dogfooding surfaced and this change FIXED two real bugs in the 3.8.0
acceptance-oracle hardcoded-expect scanner (`src/utils/mock-of-sut-scan.ts`):
cross-change contamination (it scanned sibling changes' drivers) and a
generic-word substring false positive ("reason" matched inside
"applicability-reason"). Fixed with change-scoped driver association +
word-boundary matching + regression tests; the acceptance-oracle change's own 15
gate tests still pass. qa assessment: correct, safe, narrowing (only reduces
false positives; a standalone hardcoded literal is still caught). Worth shipping
as a 3.8.1-class fix.

## Risks accepted (owned, dated)
1. **Commit hygiene (HIGH) — owner maintainer, before merge.** The working tree
   contained files outside this change's scope (stray `package.json`
   `contract:client` scripts added by an agent; never-tracked generated files:
   `AGENTS.md`, `CLAUDE.md`, `.github/workflows/contract-driven-gates.yml`,
   `tests/contract/`, `.claude/hooks/`, `.claude/settings.json`,
   `.cdd/asset-manifest.json`). The stray `package.json`/`model-policy` edits were
   reverted; the never-tracked generated files must NOT be bundled into the
   release commit. Commit ONLY this change's file set.
2. **Version bump — owner maintainer at release.** package.json still 3.8.0; this
   feature + the scanner fix need a bump (recommend 3.9.0 for the new capability)
   + CHANGELOG.
3. **AC-7 drift heuristic counts HTML comments — non-blocking follow-up.** The
   kit's own `contracts/api/api-contract.md` triggers an advisory (never-blocking)
   drift WARNING because a large `## Schemas` HTML-comment example inflates
   `meaningful_chars`. Owner test-strategist + backend-engineer, future change.

## Fail-closed invariant confirmation
Verified directly (not by claim): AC-2 unmarked stub hard-fails; AC-3 reason-less
marker + unknown value hard-error; AC-1 reasoned marker skips with info; AC-5 kit
green on four surfaces, ci/env unaffected; AC-6 TS↔Python agree (no second TS
authority — `enforceContractSubstance` no-ops on empty rows); AC-7 drift advisory.
