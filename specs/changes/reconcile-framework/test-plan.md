---
change-id: reconcile-framework
schema-version: 0.1.0
last-changed: 2026-07-15
risk: high
tier: 1
---

# Test Plan: reconcile-framework

Source: `contracts/upgrade/upgrade-reconciliation-contract.md` (INV-1/INV-2, `## Mechanical Enforcement`), `design.md` (`src/reconcile/{registry,classifier,guard}.ts`, single `GuardedWrite` chokepoint), `change-classification.md` AC-1..AC-7. `test/cli/reconcile-plan.test.ts` is the one new file the context manifest currently grants for this module — unit-level guard/classifier/registry coverage lives inside it as distinct `describe()` blocks (direct imports of `src/reconcile/*.ts`), not through the CLI, so the pyramid still holds despite one file.

## Acceptance Criteria → Test Mapping

| criterion | family | test file path | test name | tier |
|---|---|---|---|---|
| AC-1 | unit | test/cli/reconcile-plan.test.ts | classifier: every kit-shipped surface maps to exactly one bucket (no gap, no dupe) | 0 |
| AC-1 | integration | test/cli/reconcile-plan.test.ts | `reconcile --plan` prints one disposition line per surface | 1 |
| AC-1 | integration | test/cli/reconcile-plan.test.ts | `reconcile --plan` mutates nothing (mtime+content unchanged over fixture repo) | 1 |
| AC-2 | unit | test/cli/reconcile-plan.test.ts | `guard.assertWritable` throws for every enumerated bucket-1 path | 0 |
| AC-2 | integration | test/cli/reconcile-plan.test.ts | `reconcile --yes`: tampered bucket-1 fixtures byte-identical after apply | 1 |
| AC-3 | unit | test/cli/reconcile-plan.test.ts | `registry.register()`+`list()` round-trips a typed reconciler | 0 |
| AC-3 | unit | test/cli/reconcile-plan.test.ts | plan pass calls `registry.list()` exactly once, not four ad-hoc paths | 0 |
| AC-4 | integration | test/cli/refresh.test.ts | bucket-2 apply: backup written before overwrite, byte-matches pre-overwrite content | 1 |
| AC-4 | integration | test/cli/reconcile-plan.test.ts | bucket-2 refresh preserves "Repository-specific fast gate" workflow step text | 1 |
| AC-5 | contract | test/contracts/ci-workflow.test.ts | `enforceReconciliationInvariants` gate row + subsection exist in ci-gate-contract.md | 1 |
| AC-5 | contract | test/contracts/ci-workflow.test.ts | workflow actually invokes `enforceReconciliationInvariants` in its trigger contexts | 1 |
| AC-5 | unit | test/cli/reconcile-plan.test.ts | `enforceReconciliationInvariants`: bucket-1-matcher coverage gap is a HARD failure | 0 |
| AC-2/AC-3 | unit | test/cli/reconcile-plan.test.ts | static scan: no `fs.write*`/`copyFile*`/`rm*` in `src/reconcile/**` or refresh.ts bucket-2 apply path outside the guarded writer | 0 |
| AC-6 | unit | test/cli/reconcile-plan.test.ts | classifier fails open to keep for malformed/unreadable/unknown input | 0 |
| AC-6 | unit | test/cli/reconcile-plan.test.ts | classifier fails open to keep for a newly-added `.cdd/policy.yml` key | 0 |
| AC-2/AC-6 | unit | test/cli/reconcile-plan.test.ts | `.cdd/policy.yml` per-key: adopter-set key stays keep even if shipped default changed; genuinely-new key reconciles with safe default | 0 |
| AC-6 | monkey | test/monkey/reconcile-adversarial.test.ts (new, monkey-test-engineer owns) | adversarial/malformed corpus never overwrites bucket-1, never crashes plan pass | 3 |
| AC-7 | unit | test/cli/reconcile-plan.test.ts | classifier delegates to `isOwnedAndUnmodified`/`readAssetManifest`/`sha256OfFileNormalized`; no reinvented hashing in `src/reconcile/**` | 0 |
| AC-1/AC-2 | e2e/resilience | test/e2e/reconcile-plan.e2e.test.ts (new, e2e-resilience-engineer owns) | full `reconcile --plan` over a fixture adopter repo + failure injection (unreadable/partial-state/permission-denied/missing files) fails open to keep | 3 |

## Red-Turns-Green Proof

Non-negotiable per contract `## Mechanical Enforcement`; a green suite without these proves nothing (CLAUDE.md vacuous-tests lesson).

| test | mutation | expected red signal |
|---|---|---|
| guard-refusal (AC-2 row) | delete/weaken the bucket-1 check inside `guard.assertWritable()` | guard no longer throws for a bucket-1 path (e.g. `contracts/foo.md`) — `toThrow()` assertion fails |
| fail-open (AC-6 rows) | flip the classifier's unknown/new-surface/new-key default from `keep` to `replace` | `classify()` returns bucket `replace` for malformed input / a new policy key instead of `keep` |
| bucket-1 coverage (AC-5 unit row) | remove one enumerated bucket-1 pattern from the guard's matcher (e.g. drop the `acceptance.yml` rule) | coverage assertion fails, naming the uncovered surface |
| single-writer static scan (AC-2/AC-3 row) | add a second `fs.writeFileSync`/`copyFileSync`/`rmSync` call site inside `src/reconcile/**` outside `guard.ts`'s writer | scan finds >1 filesystem-write call site and fails |
| ci-workflow-pattern (AC-5 contract rows) | remove the `enforceReconciliationInvariants` row/subsection from `ci-gate-contract.md`, or remove its invocation from the workflow YAML | row/subsection lookup or workflow-invocation match fails |

## Test Families Required

| family | tier | notes |
|---|---|---|
| unit | 0 | guard/classifier/registry logic + static scans, all in test/cli/reconcile-plan.test.ts |
| integration | 1 | plan/apply over a fixture repo; bucket-2 backup-before-overwrite ordering |
| contract | 1 | ci-gate-contract.md row/subsection + workflow invocation, test/contracts/ci-workflow.test.ts |
| e2e | 3 | full `--plan` run over a fixture adopter repo — e2e-resilience-engineer's own spec |
| resilience | 3 | failure injection (unreadable/partial/permission-denied/missing) fails open — e2e-resilience-engineer |
| monkey | 3 | adversarial/malformed-input corpus targeting never-overwrite — monkey-test-engineer's own spec |
| data-boundary / stress / soak | n/a | not applicable — CLI/filesystem plan classifier, no tabular data or load/soak shape |

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

No existing test's expected behavior changes. `test/cli/refresh.test.ts` gains one new backup-ordering assertion (AC-4) that extends, not replaces, its existing "3: overwrites tampered template and backs up the prior content" coverage. `test/contracts/ci-workflow.test.ts` gains new rows only; no existing row is altered.

## Stop Rules

- Do not run broad pytest/vitest before targeted and changed-area phases pass.
- Do not investigate more than the first failure per phase.
- Do not classify any failure as known, pre-existing, waived, or allowed.
- If full suite fails, record the first failure and block the gate.

## Out of Scope

- The four bucket-3 reconcilers (`policy-keys`, `gate-rule-map`, `behavior-report`, `learnings-region`) — separate sub-changes, no test coverage here beyond the registry contract they plug into (AC-3).
- API / CSS / env / data-shape / business-logic test families — not-applicable (no such surface).
- Stress / soak — plan classifier is not load/soak-shaped (change-classification.md).

## Notes

`test/monkey/...` and `test/e2e/...` paths above are placeholders those two agents' own specs will resolve against a context-manifest addition (not yet in `## Allowed Paths`); this plan names them per the selector's "name the file that must exist" fallback, not as a claim they exist today. Every AC already has a concrete, existing-directory-rooted bounded target (`test/cli/reconcile-plan.test.ts`, `test/cli/refresh.test.ts`, `test/contracts/ci-workflow.test.ts`) independent of those two placeholders. The five red-turns-green rows are the contract's binding minimum, not the full unit surface — see the AC mapping table for the rest.
