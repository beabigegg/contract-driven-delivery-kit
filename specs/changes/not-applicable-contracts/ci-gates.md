# CI/CD Gate Review — not-applicable-contracts (ADR 0011)

## Fail-Closed Invariant — Confirmed

Verified against `src/commands/gate-contracts.ts` and `src/commands/gate.ts`:

- `enforceContractSubstance` (gate-contracts.ts:48) `return`s as soon as
  `rows.length === 0` — it asserts only test-coverage cells on a *filled*
  endpoint table and never independently fails an empty/stub contract. It is
  not a second presence/stub authority.
- `gate.ts` calls this function once (line 176) and otherwise delegates all
  contract pass/fail to `validate()` (line 208), which shells out to the
  Python `validate_*.py` layer. Gate itself has no other contract-family
  stub check.
- Net: the Python `applicability.py` reader is the SOLE pass/fail authority
  for the new marker (design.md decision 2). No second TS-side authority
  exists that could diverge — **AC-6 holds, nothing blocking found.**
- AC-2 (unmarked stub still hard-fails) and AC-3 (marker without reason is a
  hard error) are enforced entirely inside the Python layer per
  `contracts/ci/ci-gate-contract.md` §"Contract Applicability Marker"
  semantics 1/3/4; TS reads the field read-only for `doctor` display only.
- Direction check: the change can only turn a previously-*failing* empty
  contract into a *passing* one, and only under an explicit, reasoned marker.
  It can never turn a passing check into a failing one, and never lets an
  unmarked stub pass. This is a strictly-safe semantics change.

## Required Gates for This Change
| gate | tier | required | trigger | command/workflow | artifact |
|---|---:|---:|---|---|---|
| build+typecheck+test | 1 | yes | pull_request/push master | `.github/workflows/test.yml` job `test` (`npm ci` → `node build.js` → `npm run typecheck` → `npx vitest run`) | vitest run results (Node 18/20/22 matrix) |
| mojibake guard | 1 | yes | pull_request/push master | `.github/workflows/test.yml` job `guards` | `tools/check-mojibake.mjs` exit code |
| contract validation (`cdd-kit validate`/`gate`) | 1 | yes (local, dogfooded in the `test` job via vitest) | local `cdd-kit gate`; exercised by `test/cli/gate.test.ts` | `cdd-kit gate <id>` | gate stdout, exit code |

No new gate row is required in `contracts/ci/ci-gate-contract.md`'s Gate
Inventory: this change alters existing validate/semantic-validator
**semantics** (what counts as a passing empty contract), not the CI
mechanism that runs them. The contract's new "Contract Applicability
Marker" section (already at schema-version 0.3.0) documents the semantics
change in place of a new row.

## Workflow Changes Applied

None. `test/cli/gate.test.ts`, `test/contracts/parser.test.ts`, and the new
integration test (marked-not-applicable + unmarked-stub, PowerShell + POSIX)
run under the existing `npx vitest run` step in `.github/workflows/test.yml`
— no new job, step, or trigger is needed. The kit's own dogfooded
`cdd-kit gate` on `contracts/{api,css,business,data}` (now marked
not-applicable) is exercised the same way it always was; AC-5 (green kit
gate) is a consequence of the marker, not a new CI step.

## Promotion Policy

Not applicable — no gate is being introduced or promoted. Unlike ADR 0010's
`enforceAcceptanceOracle` (required-from-day-one exception), this change has
no informational-first phase-in question: it does not add a check, it
relaxes an existing one only in the direction of "an explicitly reasoned
absence is no longer a false-positive failure."

## Rollback Policy

Additive frontmatter marker only, mirroring `contracts/ci/ci-gate-contract.md`
§Rollback: revert deletes `applicability.py`, restores the pre-change
validator branches, and strips the `applicability`/`applicability-reason`
lines from `contracts/{api,css,business,data}`. No data migration, no
sidecar state, no workflow file to revert.

## Merge Eligibility

mergeable — pending green `test` + `guards` workflows and the required
unit/contract/integration tests (test-plan.md rows for this change);
no CI workflow edits were needed and no second pass/fail authority was
found that would diverge from the Python `applicability.py` reader.
