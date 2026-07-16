# CI/CD Gate Plan

## Change ID
reconcile-framework

## Required Gates
| gate | tier | required | trigger | command/workflow | expected artifact |
|---|---:|---:|---|---|---|
| full vitest suite | 0/1 | yes | pull_request; push; local | `npm test` — incl. `test/cli/reconcile-plan.test.ts`, `test/reconcile/**`, `test/e2e/reconcile-plan.e2e.test.ts`, `test/monkey/reconcile-adversarial.test.ts`, `test/contracts/reconciliation-invariants.test.ts` | `test-evidence.yml` |
| enforceReconciliationInvariants (NEW) | 1 | ci-or-strict | pull_request; push (`--strict`); local (`cdd-kit validate`/`gate`) | `node dist/cli/index.js validate` / `gate` | see `## Required Check Policy` below; lands WITH the guard code — see Notes |
| cdd-kit gate reconcile-framework (isNewChange bundle) | 1 | yes | pull_request; push (`--strict`); local | `node dist/cli/index.js gate reconcile-framework` | `acceptance.yml`, `interaction-design.md`, `.cdd/{acceptance,design}-lock.json` |
| typecheck | 0 | yes | pull_request | `npm run typecheck` | tsc exit code |
| mojibake / lockfile guards | 0 | yes | pull_request | `npm run check:mojibake`; `npm run check:lockfile` | stdout |
| asset no-drift | 0 | yes | pull_request (part of `npm run build`) | `node build.js` regen `assets/` from `.claude/` — no post-build working-tree diff | build step output |

## New Workflow Changes
None this turn. `.github/workflows/contract-driven-gates.yml` and `contracts/ci/ci-gate-contract.md` are NOT edited by this artifact — landing them ahead of the validator would be a guarantee-that-never-happened (see `## Required Check Policy`).

## Required Check Policy

### enforceReconciliationInvariants (drafted by contract-reviewer as a NEW `ci-gate-contract.md` 0.12.0 Gate Inventory row, `ci-or-strict`)
Enforces, per `contracts/upgrade/upgrade-reconciliation-contract.md` `## Mechanical Enforcement`:
1. the guard's bucket-1 matcher COVERS every surface in the contract's `## Bucket 1 — Never-Overwrite Ground Truth` enumeration — an uncovered surface is a HARD failure, not a warning;
2. no reconciler / bucket-2 apply path writes to the filesystem through any capability other than the single guarded writer (static scan over `src/reconcile/**` and `refresh.ts`'s bucket-2 apply path);
3. a recorded, PASSED test proves a bucket-1 write attempt is physically REFUSED by the guard — test-plan.md `## Red-Turns-Green Proof` row "guard-refusal", mutation: delete/weaken the bucket-1 check inside `guard.assertWritable()`;
4. a recorded, PASSED test proves fail-open-to-keep for malformed/unknown/unreadable input and for a newly-added surface or `.cdd/policy.yml` key — test-plan.md `## Red-Turns-Green Proof` row "fail-open", mutation: flip the classifier's unknown/new default from `keep` to `replace`.

**Landing discipline (guarantees-that-never-happened, CLAUDE.md Promoted Learnings).** backend-engineer wires this check into `cdd-kit validate`/`gate` AND applies the `ci-gate-contract.md` 0.12.0 row + `### enforceReconciliationInvariants` subsection + `[upgrade 0.1.0]`/`[ci 0.12.0]` CHANGELOG entries in the SAME implementation pass as the guard code, atomically. The ci-gate-contract.md row/subsection MUST NOT be committed before the validator exists and both its linchpin tests (guard-refusal, fail-open) are red-turns-green proven — a row describing a check that doesn't yet exist is exactly this repo's recurring defect class.

## Informational Gate Promotion Policy
`enforceReconciliationInvariants` is a project-level structural-code check, same class as `ci-gate-contract.md` `### enforceConfirmationHookInstallation`: `ci-or-strict`, NOT gated on `isNewChange` — the invariant is a property of the codebase's write path, not one change directory's vintage, so a legacy change and a brand-new one see the identical shape. It ships required from day one with no informational phase, for the same reason `enforceAcceptanceOracle`/`enforceInteractionDesign` did not phase in (a silently-passable write-safety check defeats the mechanism it exists to enforce). It carries NO shadow-mode knob and no `.cdd/policy.yml` toggle: unlike Boundary Guard's `shadow_mode` rollout stage, INV-2 (never-overwrite) is contract-binding and non-negotiable — this is a deliberate, permanent divergence from the Boundary Guard precedent, not an oversight.

## Rollback Policy
Additive, per `contracts/upgrade/upgrade-reconciliation-contract.md` `## Rollback`: reverting `reconcile-framework` removes the `reconcile` command, `src/reconcile/`, the contract, and the `enforceReconciliationInvariants` gate check, with no data migration; `refresh`/`upgrade`/`update` continue enforcing their existing (narrower) keep/replace boundaries exactly as before.

## Artifact Retention
No new retained artifact class beyond what `ci-gate-contract.md` `## Artifact Retention Policy` already covers: `test-evidence.yml` phases per test-plan.md `## Test Execution Ladder`; `.cdd/asset-manifest.json` remains a regenerable sidecar, unaffected by this change.

## Merge Eligibility Decision
mergeable — conditional: the implementation PR must land `enforceReconciliationInvariants` (validator + both linchpin red-turns-green tests, mutation-proven per test-plan.md `## Red-Turns-Green Proof`) together with the guard code and the `ci-gate-contract.md` 0.12.0 row/subsection/CHANGELOG entries in ONE pass. A PR landing the contract row without the validator, or the validator without a PASSED guard-refusal/fail-open test pair, is NOT mergeable under this policy.

## Notes
This file states gate policy only. See test-plan.md `## Acceptance Criteria → Test Mapping` and `## Red-Turns-Green Proof`, and `contracts/upgrade/upgrade-reconciliation-contract.md` `## Mechanical Enforcement`, for the full test strategy — not duplicated here.
