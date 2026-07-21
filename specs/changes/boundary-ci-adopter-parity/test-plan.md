---
change-id: boundary-ci-adopter-parity
schema-version: 0.1.0
last-changed: 2026-07-14
risk: medium
tier: 2
---

# Test Plan: boundary-ci-adopter-parity

## Acceptance Criteria → Test Mapping

| criterion id | test family | test file path | test name | tier |
|---|---|---|---|---|
| AC-1 | integration (CLI) | test/cli/boundary.test.ts | shadow_mode: true (default) — error finding printed `Boundary Guard [shadow]: ...` on stdout, exit 0 | 1 |
| AC-2 | integration (CLI) | test/cli/boundary.test.ts | `boundary check --enforce` — same failed finding, same message, exit 1 | 1 |
| AC-3 | integration (anti-divergence) | test/cli/boundary.test.ts | `boundary check` and `gate <id>` given the identical policy+manifest fixture derive the identical shadow/enforce decision (both advisory-exit-0 under shadow, both blocking under `shadow_mode: false`) | 1 |
| AC-4 | integration (real git fixture) | test/cli/boundary.test.ts | only `CDD_BASE_SHA` set (no `--base`), API contract changed between base and head commits — `changed_operations` is exactly the changed subset, not every contracted operation | 1 |
| AC-5 | contract (workflow YAML) | test/contracts/ci-workflow.test.ts | `${label}`: Boundary Guard step run line matches `--base "$CDD_BASE_SHA"` in addition to the env var, for both adopter template and this repo's own workflow | 1 |
| AC-6 | contract (bash -eo pipefail) | test/contracts/ci-workflow.test.ts | `${label}`: archive-only push (every id in the diff already archived, none live) — the shipped `IDS=` line exits the step 0 with empty `ids` when run via `bash -c 'set -eo pipefail; ...'` | 1 |
| AC-7 | contract (drift) | test/contracts/ci-workflow.test.ts | `assets/github-workflows/contract-driven-gates.yml` is byte-identical to `github-workflows/contract-driven-gates.yml` after build (no hand-edit drift) | 1 |
| AC-8 | process (contract review) | n/a — contract-reviewer sign-off; mechanically backed by AC-1..AC-5 passing + `contracts/ci/ci-gate-contract.md` diff review | — | 1 |
| acceptance | acceptance (oracle driver, ADR 0010) | test/acceptance/boundary-ci-adopter-parity.driver.test.ts | drives the real built `cdd-kit` CLI (shadow exit code, `--enforce` exit code, changed-operation count) for each case in `specs/changes/boundary-ci-adopter-parity/acceptance.yml`, compares to the human-locked `expect` — answer key not reproduced here | 1 |

## Mutation-Red Proof (each row MUST be shown red on pre-fix code, recorded in test-evidence.yml — no waiver)

| criterion id | pre-fix mutation | expected red signal |
|---|---|---|
| AC-1 | `boundaryCheck` keeps unconditional `return result.status === 'failed' ? 1 : 0` | test exits 1 instead of 0 |
| AC-2 | `--enforce` flag parsed but not read before the exit decision | `--enforce` case still exits 0 |
| AC-3 | boundary.ts and gate.ts each read `shadow_mode` via their own inline check instead of one shared source | parity test finds mismatched exit code or message between the two callers |
| AC-4 | `contractAtRevision` gated on `options.base ?` only (ignores the env-resolved effective base) | `previous` stays `null`, `changed_operations` reverts to every contracted operation |
| AC-5 | Boundary Guard step keeps `env: CDD_BASE_SHA: ...` but no `--base` arg on the `run:` line | regex match on `--base "\$CDD_BASE_SHA"` fails |
| AC-6 | changed-spec-directories `IDS=` line keeps the chained `[ -n "$id" ] && [ -d ... ] && printf` list | all-archived fixture exits non-zero under `bash -eo pipefail` |
| AC-7 | `assets/github-workflows/contract-driven-gates.yml` hand-edited without `node build.js` | byte-diff assertion fails |

## Test Families Required

| family | tier | notes |
|---|---|---|
| integration | 1 | real `git` repo + built CLI via `runCli` (test/helpers.ts) — no mocking of git/fs; matches existing boundary.test.ts convention |
| contract | 1 | parses/greps the shipped workflow YAML and byte-compares generated assets; extends test/contracts/ci-workflow.test.ts |
| acceptance | 1 | ADR 0010 driver against human-locked `acceptance.yml`; new file, added once the oracle is confirmed |

## Test Execution Ladder

| phase | required | command source | max failures | result artifact |
|---|---:|---|---:|---|
| collect | yes | cdd-kit test select | 1 | test-runs/<run-id>/summary.json |
| targeted | yes | cdd-kit test select | 1 | test-evidence.yml |
| changed-area | yes | cdd-kit test select | 1 | test-evidence.yml |
| contract | if affected | cdd-kit validate | 1 | test-evidence.yml |
| quality | if configured | ci-gates.md | 1 | test-evidence.yml |
| full | final/CI | cdd-kit test run --phase full | 1 | test-evidence.yml |

## Test Update Contract

None. This is a bug-fix restoring documented behavior — no existing passing test's expected outcome changes; all seven rows above are additive regression tests plus one asset-drift check.

## Stop Rules

- Do not run the broad suite before targeted and changed-area phases pass.
- Do not investigate more than the first failure per phase.
- Do not classify any failure as known, pre-existing, waived, or allowed (CLAUDE.md "vacuous tests").
- Each Mutation-Red Proof row must be independently reproduced red before the corresponding fix lands.

## Out of Scope

- `contracts/env/env-contract.md` documentation accuracy for `CDD_BASE_SHA`/`GITHUB_BASE_SHA` — review-only per change-classification, no new test.
- #66/#67 — separate changes, not covered here.
- `docs/boundary-guard.md` prose update — ci-cd-gatekeeper artifact, no dedicated test (its claims are what AC-1/AC-2 mechanically verify).
- Non-error-level (`warning`/`info`) findings changing shadow/enforce treatment — contract states they are always advisory; no behavior change, no new test.

## Notes

- AC-3's parity test lives in test/cli/boundary.test.ts (not a new file, not gate.test.ts) because bug-fix-engineer's Allowed Paths include test/cli/boundary.test.ts but not test/cli/gate.test.ts; it calls both `boundary check` and `gate <id>` via `runCli`.
- AC-1/AC-2 assert BOTH the exit code AND that the finding text still appears on stdout — a shadow pass that silently drops the finding is a different bug than a wrong exit code.
- AC-6's fixture must contain ONLY archived ids (no live id) — a mixed batch does not reproduce the defect, since a trailing live id's success masks the failing loop iteration under `bash -eo pipefail`.
