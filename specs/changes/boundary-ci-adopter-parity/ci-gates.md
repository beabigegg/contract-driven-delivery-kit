# CI/CD Gate Review

## Change ID
boundary-ci-adopter-parity

## Required Gates for This Change
| gate | tier | required | trigger | command/workflow | artifact |
|---|---:|---:|---|---|---|
| vitest suite (unit+integration+contract) | 0/1 | yes | local; pull_request; push | `npm test` (`node node_modules/vitest/vitest.mjs`, not `npx` — see MEMORY test-run-timeout lesson) | test-plan.md AC-1..AC-7 rows; test-evidence.yml |
| re-armed archive-only regression (AC-6) | 1 | yes | pull_request; push | `test/contracts/ci-workflow.test.ts` — `bash -c 'set -eo pipefail; ...'`, all-archived fixture (no live id), structured-`if`-form regex | test-evidence.yml |
| boundary base-wiring + shadow parity (AC-1..AC-5) | 1 | yes | pull_request; push | `test/cli/boundary.test.ts` | test-evidence.yml |
| typecheck | 1 | yes | pull_request; push | `npm run typecheck` | — |
| mojibake / lockfile guards | 1 | yes | pull_request; push | `npm run check:mojibake`, `npm run check:lockfile` | — |
| asset no-drift (AC-7) | 1 | yes | pull_request; push | `test/contracts/ci-workflow.test.ts` byte-compare `github-workflows/` vs `assets/github-workflows/` | `.cdd/asset-manifest.json` |
| enforceAcceptanceOracle | 1 | yes | pull_request; local `cdd-kit gate` | `cdd-kit gate boundary-ci-adopter-parity` | acceptance.yml, `.cdd/acceptance-lock.json` (ci-gate-contract.md § Required Check Policy) |
| enforceInteractionDesign | 1 | yes | pull_request; push `--strict`; local | `cdd-kit gate boundary-ci-adopter-parity` | interaction-design.md, `.cdd/design-lock.json` |
| enforceConfirmationHookInstallation | 1 | ci-or-strict | pull_request (via validate); push `--strict` | `cdd-kit gate` AND `cdd-kit validate` | `.claude/settings.json` |
| Boundary Guard standalone (dogfood, shadow) | 1 | advisory (shadow_mode: true) | pull_request; push (this repo's own workflow) | `.github/workflows/contract-driven-gates.yml` "Boundary Guard (PR diff)" step | exit 0 per `.cdd/policy.yml` |

No informational, nightly, weekly, or manual-dispatch gates are added by this change; the fix is entirely inside existing Tier 0/1 gates.

## Workflow Changes Required (implementation stage — not yet applied)
1. `github-workflows/contract-driven-gates.yml` "Determine changed spec directories" step: replace the chained `[ -n "$id" ] && [ -d "specs/changes/$id" ] && printf` list with the structured `if [ -n "$id" ] && [ -d "specs/changes/$id" ]; then printf '%s\n' "$id"; fi` form already shipped in `.github/workflows/contract-driven-gates.yml` (AC-6, contract § Archive-only push robustness).
2. `github-workflows/contract-driven-gates.yml` "Boundary Guard (PR diff)" step: append `--base "$CDD_BASE_SHA"` to the `cdd-kit boundary check` invocation (AC-5).
3. `.github/workflows/contract-driven-gates.yml` "Boundary Guard (PR diff)" step: same `--base "$CDD_BASE_SHA"` append — this repo's own workflow currently sets the env var only, so it does not exercise AC-4's effective-base resolution either.
4. `build.js` regenerate `assets/github-workflows/contract-driven-gates.yml` from the edited source; no hand-edit of `assets/` (AC-7).
5. `test/contracts/ci-workflow.test.ts` lines 142-166 re-armed: this test is currently VACUOUS — it runs the `IDS=` line under plain `sh -c` (no `set -eo pipefail`) with a live id placed last, so a trailing successful iteration masks the earlier archived-id failure; and its only structural assertion (line 139) matches the bare `[ -d "specs/changes/$id" ]` substring, which BOTH the buggy chained form and the fixed structured-`if` form contain. Replace with: (a) `spawnSync('bash', ['-c', "set -eo pipefail; " + idsLine + ...])`; (b) an all-archived fixture (zero live ids) asserting exit 0 and empty `ids` output; (c) a regex asserting the structured-`if` form specifically (e.g. `/if \[ -n "\$id" \] && \[ -d "specs\/changes\/\$id" \]; then/`), not the bare substring.
6. `test/contracts/ci-workflow.test.ts`: add a `--base "\$CDD_BASE_SHA"` regex assertion on the Boundary Guard `run:` line for both labels (AC-5).

## Promotion Policy
Boundary Guard remains in shadow mode (advisory, exit 0 on `error`-level findings) per `.cdd/policy.yml` `shadow_mode: true` (shipped default). This change does not promote Boundary Guard to blocking in either the integrated gate or the standalone command — it only makes the standalone `cdd-kit boundary check` path honor the same shadow default `cdd-kit gate` already applies, closing the divergence. See `contracts/ci/ci-gate-contract.md` `## Boundary Guard Enforcement Semantics` AC-1/AC-3. `--enforce` (AC-2) is an explicit per-invocation opt-in only, not a policy-wide promotion. No other gate row changes tier or required-status in this change.

## Rollback Policy
Additive/corrective: reverting restores the pre-fix chained-`if` form and env-only base resolution — no data migration, no schema change. `.cdd/asset-manifest.json` is a regenerable sidecar (contract § Artifact Retention Policy), safe to regenerate on rollback via `build.js`.

## Merge Eligibility
blocked — pending the workflow-template edits and the re-armed `ci-workflow.test.ts` regression tests (items 1-6 above) landing with each AC's mutation-red proof recorded per test-plan.md, then contract-reviewer sign-off (AC-8).
