# CI/CD Gate Plan

## Change ID
acceptance-oracle (ADR 0010)

## Sign-off Decision — enforceAcceptanceOracle required-from-day-one

**APPROVED.** `ci/required-check-policy.md`'s general rule ("new gates that are
expensive or unstable should begin as informational") does not fit this gate,
because the failure mode it guards against (an unstable/flaky check blocking
unrelated merges) is not the risk here — the risk is the opposite: an
informational-period oracle check that reports "fail" but does not block is
exactly the "silently skipped" oracle the mechanism exists to prevent (AC-7).
An informational period would let every migrated change (placeholder
`acceptance.yml`, AC-7) merge unblocked, which defeats the change's own reason
for existing. The pass/fail conditions (AC-1, AC-2, AC-5, AC-7) are
deterministic, fast (hash compare, schema/placeholder check, evidence-file
read) and reuse already-hardened logic (`meaningfulChars`, `normalizeContentForHash`,
ADR 0005 evidence). **Caveat, not a blocking condition:** the AC-4 mock-of-SUT
scan is the one sub-check with real false-positive exposure — code-map
name-based resolution is an acknowledged weak spot (design.md Open Risks) and
the rule set is intentionally conservative/minimal-then-grow (mirrors ADR
0004 §5). If AC-4 produces a false positive blocking a real PR, treat it as a
P0 gate-defect bug fix (tighten the rule, do not disable the check), not as
grounds to demote the whole gate to informational.

## Required Gates
| gate | tier | required | trigger | command/workflow | expected artifact |
|---|---:|---:|---|---|---|
| lint | 0/1 | yes | local + pull_request | existing lint step | — |
| build/typecheck | 1 | yes | pull_request | existing build step | — |
| unit | 1 | yes | pull_request | `vitest` — schema, hash util, `meaningfulChars` reuse, mock-scan, digest (AC-6) | `test-evidence.yml` |
| contract | 1 | yes | pull_request | `cdd-kit validate --contracts` — `ci-gate-contract.md` + `env-contract.md` conformance | `test-evidence.yml` |
| **enforceAcceptanceOracle** | **1** | **yes** | **pull_request; local (`cdd-kit gate`)** | `cdd-kit gate` — AC-1/AC-2/AC-4/AC-5/AC-7 | `acceptance.yml`, `.cdd/acceptance-lock.json`, `test-evidence.yml` (`acceptance` phase) |
| integration | 1 | yes | pull_request | gate wiring E2E; `migrate`/`refresh`/`upgrade` backfill; `install-agent-hooks --acceptance-write`; `doctor` drift (AC-3, AC-7, AC-8) | `test-evidence.yml` |
| e2e-critical | 1 | yes | pull_request | full CLI lifecycle: scaffold → author oracle → driver → gate green/red, tamper, mock-of-SUT rejection (AC-1..AC-5) | `test-evidence.yml` |
| data-boundary | 1 | yes | pull_request | malformed/placeholder `acceptance.yml`; missing `input`/`expect`; new `acceptance` block in `test-evidence.yml` schema | `test-evidence.yml` |
| visual | 2 | n/a | — | no UI surface | — |
| resilience/fuzz/monkey | 1/3 | n/a | — | not required (change-classification.md) | — |
| stress/soak | 4/5 | n/a | — | no long-running/high-load surface | — |

## New Workflow Changes

No new `.github/workflows/*.yml` file or job is required. `enforceAcceptanceOracle`
composes into `src/commands/gate.ts` as another `enforce*(errors, warnings)` call
(same shape as `enforceContractSubstance`/`enforceTestEvidence` — errors are
blocking, warnings are advisory), so it is exercised automatically wherever
`cdd-kit gate` already runs: the pre-commit hook and `github-workflows/
contract-driven-gates.yml`'s existing `cdd-kit validate`/`cdd-kit gate` steps.
**Known pre-existing gap (not fixed by this change):** source-only edits can
bypass the gate step in CI today; this change does not alter that trigger
condition. Flagging it here is scope-tracking only — fixing the trigger gap is
a separate change if the maintainer wants it addressed.

## Required Check Policy

`enforceAcceptanceOracle` is required (blocking) on every PR and local `gate`
run from initial release — see Sign-off Decision above. All other rows in this
table follow the kit's existing required-check policy unchanged.

## Informational Gate Promotion Policy

None for `enforceAcceptanceOracle` — it does not enter an informational
period (exception, approved above). No other new informational gate is added
by this change.

## Rollback Policy

Additive, no data migration (design.md Migration/Rollback; `ci-gate-contract.md`
Rollback Policy). Reverting removes the `enforceAcceptanceOracle` check, the
`acceptance.yml` template, `pre-tool-use-acceptance-write.sh`, and asset digest
stamping. `.cdd/acceptance-lock.json` and `.cdd/asset-manifest.json` are
regenerable sidecars, safe to delete on rollback.

## Artifact Retention

`specs/changes/<id>/acceptance.yml` — retained indefinitely (first-class spec
artifact, same class as other required change artifacts). `.cdd/acceptance-lock.json`
and `.cdd/asset-manifest.json` — regenerable sidecars, no retention requirement
beyond current state.

## Merge Eligibility Decision

mergeable — required gates and the sign-off above are recorded; no blocking
objection to shipping `enforceAcceptanceOracle` required-from-day-one.

## Notes

Pass/fail conditions, AC mapping, and phase detail live in
`contracts/ci/ci-gate-contract.md` and `change-classification.md`
(`## Inferred Acceptance Criteria`, AC-1..AC-8) — not duplicated here.
