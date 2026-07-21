---
change-id: reconcile-framework
schema-version: 0.1.0
last-changed: 2026-07-15
---

# Implementation Plan: reconcile-framework

## Objective

Ship one typed **reconciliation framework** that unifies the scattered old→new
upgrade paths under a three-bucket surface taxonomy (keep / replace / reconcile)
behind a **single guarded writer**. Deliver: `src/reconcile/{guard,classifier,registry}.ts`,
the `src/schemas/reconciliation.schema.ts` shapes, a thin `cdd-kit reconcile
[--plan|--yes]` command, `refresh.ts` bucket-2 apply routed through the guard, and
the `enforceReconciliationInvariants` validator wired into `validate`/`gate` —
landed **atomically** with the `contracts/ci/ci-gate-contract.md` 0.12.0 row/subsection
and `contracts/CHANGELOG.md` entries and both linchpin red-turns-green tests. The
load-bearing invariant is INV-2: every filesystem write in the reconcile/refresh
apply path passes through one bucket-1 guard that physically refuses a
never-overwrite path and fails open to `keep`. See `design.md` `## Summary`,
`contracts/upgrade/upgrade-reconciliation-contract.md` INV-1/INV-2.

## Execution Scope

### In Scope
- New `src/reconcile/` module: `guard.ts` (single bucket-1 write chokepoint),
  `classifier.ts` (surface→bucket, fail-open to keep, `.cdd/policy.yml` per-key),
  `registry.ts` (typed `Reconciler` register/list; one plan/apply pass).
- New `src/schemas/reconciliation.schema.ts` (`SurfaceDisposition` / `Reconciler`).
- New `src/commands/reconcile.ts` + `reconcile` subcommand registration in `src/cli/index.ts`.
- `src/commands/refresh.ts` bucket-2 apply routed through the guard, reusing existing
  `planForceRefresh`/`applyPlan` + `.cdd/.refresh-backup/` backup — **no default-behavior change**.
- New `enforceReconciliationInvariants` validator wired into `src/commands/validate.ts`
  and `src/commands/gate.ts` (the four checks in `contracts/upgrade/...` `## Mechanical
  Enforcement` + `ci-gates.md` `### enforceReconciliationInvariants`).
- `contracts/ci/ci-gate-contract.md` 0.11.0→0.12.0 Gate Inventory row +
  `### enforceReconciliationInvariants` subsection; `contracts/CHANGELOG.md`
  `[upgrade 0.1.0]` + `[ci 0.12.0]` — applied in the SAME pass as the validator.
- Tests owned by backend-engineer: `test/cli/reconcile-plan.test.ts`,
  `test/reconcile/**`, `test/contracts/reconciliation-invariants.test.ts`, and one new
  backup-ordering assertion extending `test/cli/refresh.test.ts` — with the five
  red-turns-green mutations (`test-plan.md` `## Red-Turns-Green Proof`).

### Out of Scope
- The four bucket-3 reconcilers (`policy-keys`, `gate-rule-map`, `behavior-report`,
  `learnings-region`) — separate sub-changes. This change ships only the registry
  slots they plug into.
- Any change to the default behavior of `refresh` / `upgrade` / `update` — they keep
  working, now sharing the guard (`design.md` `## Migration / Rollback / Fail-open`).
- Reinventing ownership detection — kit-vs-user classification delegates wholesale to
  `isOwnedAndUnmodified` / `readAssetManifest` / `sha256OfFileNormalized` (AC-7).
- Opportunistic refactoring of `refresh.ts` / `upgrade.ts` / `update.ts` beyond the
  guard routing named above.
- The e2e and monkey specs — authored by their own agents AFTER backend-engineer
  (see `## Ownership`); do not pre-write them.

## Required Changes

| id | area | required action | owner agent |
|---|---|---|---|
| IP-1 | reconcile module (guard) | NEW `src/reconcile/guard.ts` — `assertWritable(dest)` throws on any bucket-1 path; matcher covers the contract's `## Bucket 1 — Never-Overwrite Ground Truth` enumeration; this is the sole `fs`-write chokepoint (LINCHPIN, INV-2/AC-2/AC-6) | backend-engineer |
| IP-2 | reconcile module (classifier) | NEW `src/reconcile/classifier.ts` — surface→bucket; fails open to `keep` on malformed/unknown/unreadable input; `.cdd/policy.yml` classified PER-KEY; delegates ownership to digest/asset-manifest utils (AC-1/AC-6/AC-7) | backend-engineer |
| IP-3 | reconcile module (registry) | NEW `src/reconcile/registry.ts` — typed `Reconciler` register/list; one plan/apply pass iterates the single `list()`; reconcilers receive ONLY a `GuardedWrite` capability (AC-3) | backend-engineer |
| IP-4 | schema | NEW `src/schemas/reconciliation.schema.ts` — `SurfaceDisposition` / `Reconciler` shapes (`design.md` `## Registry Interface`) | backend-engineer |
| IP-5 | command | NEW `src/commands/reconcile.ts` — `cdd-kit reconcile [--plan|--yes]`; `--plan` default/read-only (mutates nothing, AC-1); `--yes` applies (backup-before-overwrite for bucket-2, guard on every write) | backend-engineer |
| IP-6 | CLI registration | `src/cli/index.ts` — register the `reconcile` subcommand | backend-engineer |
| IP-7 | force-refresh path | `src/commands/refresh.ts` — route bucket-2 apply through the guard, reusing `planForceRefresh`/`applyPlan` + existing backup; DO NOT change default behavior (AC-4) | backend-engineer |
| IP-8 | mechanical check | NEW `enforceReconciliationInvariants` validator wired into `src/commands/validate.ts` + `src/commands/gate.ts` — the four checks in `ci-gates.md` `### enforceReconciliationInvariants` (AC-5) | backend-engineer |
| IP-9 | CI contract + changelog | `contracts/ci/ci-gate-contract.md` 0.11.0→0.12.0 row + `### enforceReconciliationInvariants` subsection; `contracts/CHANGELOG.md` `[upgrade 0.1.0]` + `[ci 0.12.0]` — applied ATOMICALLY with IP-8 | backend-engineer |
| IP-10 | tests | `test/cli/reconcile-plan.test.ts` + `test/reconcile/**` + `test/contracts/reconciliation-invariants.test.ts` + backup-ordering assertion in `test/cli/refresh.test.ts`, with the five red-turns-green mutations | backend-engineer |
| IP-11 | e2e / resilience | Full `reconcile --plan` over a fixture adopter repo + failure injection (unreadable / partial-state / permission-denied / missing files) fails open to keep — `test/e2e/reconcile-plan.e2e.test.ts` | e2e-resilience-engineer |
| IP-12 | monkey / fuzz | Adversarial/malformed corpus PROVING a bucket-1 write is physically REFUSED (not merely undocumented) and the plan pass never crashes — `test/monkey/reconcile-adversarial.test.ts` | monkey-test-engineer |

## Source Artifact Pointers

| source | relevant pointer | used for |
|---|---|---|
| design.md | `## Affected Components`, `## Surface → Bucket Taxonomy`, `## Registry Interface`, `## Key Decisions` | file boundaries, taxonomy, `GuardedWrite` chokepoint, fail-open-to-keep |
| contracts/upgrade/upgrade-reconciliation-contract.md | `## Bucket 1 — Never-Overwrite Ground Truth`, `## .cdd/policy.yml is classified PER-KEY`, INV-1/INV-2, `## Mechanical Enforcement` | guard matcher coverage set, per-key rule, validator's four checks |
| ci-gates.md | `## Required Check Policy` → `### enforceReconciliationInvariants`, `## Merge Eligibility Decision`, `## Informational Gate Promotion Policy` | validator semantics, `ci-or-strict` shape, atomic landing discipline |
| test-plan.md | `## Acceptance Criteria → Test Mapping`, `## Red-Turns-Green Proof`, `## Test Execution Ladder` | test files per AC, the five mutations, phase floor |
| agent-log/contract-reviewer.yml | drafted (held) ci-gate 0.12.0 row + CHANGELOG entries live in the contract-reviewer transcript | text backend-engineer reproduces for IP-9 |
| src/commands/refresh.ts | lines 8-28 keep/replace boundary comment; `planForceRefresh` 66-98, `applyPlan` 107-125 | reuse anchor for bucket-2 apply + backup |
| src/utils/{asset-manifest,user-asset-manifest,digest}.ts | `readAssetManifest`/`stampAssetManifest`, `isOwnedAndUnmodified`, `sha256OfFileNormalized` | delegated ownership detection (AC-7) — do NOT reinvent |
| src/commands/gate.ts | existing `enforce*` wiring (e.g. `enforceInteractionDesign` line 23; `enforceConfirmationHookInstallation`) | shape/host pattern for IP-8 |

## File-Level Plan

| path or glob | action | notes |
|---|---|---|
| `src/reconcile/guard.ts` | new | LINCHPIN: `assertWritable(dest)` throws on any bucket-1 path; the ONLY `fs`-write site the framework/refresh apply is allowed to route through; `GuardedWrite` wraps it. Matcher must COVER the contract's bucket-1 enumeration. |
| `src/reconcile/classifier.ts` | new | surface→`SurfaceDisposition`; fail-open to `keep` on malformed/unknown/unreadable; `.cdd/policy.yml` per-key (adopter-set key = keep; genuinely-new key = reconcile w/ INV-1 safe default); ownership via delegated utils only. |
| `src/reconcile/registry.ts` | new | `register(r)` / `list()`; one plan/apply pass iterates `list()` exactly once (not four ad-hoc paths, AC-3); reconcilers get only `GuardedWrite`. |
| `src/schemas/reconciliation.schema.ts` | new | `Bucket`, `SurfaceDisposition`, `Reconciler`, `GuardedWrite`, `ReconcileResult` per `design.md` `## Registry Interface`. |
| `src/commands/reconcile.ts` | new | thin wrapper; `--plan` default/read-only (mutates nothing); `--yes` applies (bucket-2 backup-before-overwrite; guard on every write). |
| `src/cli/index.ts` | edit | register `reconcile` subcommand (import from `../commands/reconcile.js`, mirror existing subcommand wiring). |
| `src/commands/refresh.ts` | edit | route the bucket-2 `applyPlan` overwrite through the guard; reuse existing `.cdd/.refresh-backup/` + gitignore stamp; keep default behavior + "Repository-specific fast gate" step preservation (AC-4). |
| `enforceReconciliationInvariants` validator | new + wire | new module (follow the `src/commands/gate-*.ts` `enforce*` convention or place under `src/reconcile/`); imported/invoked in `src/commands/gate.ts` and surfaced by `src/commands/validate.ts`. Four checks per `ci-gates.md` `### enforceReconciliationInvariants`: (1) matcher covers enumeration, (2) static single-writer scan over `src/reconcile/**` + refresh bucket-2 apply, (3) recorded PASSED guard-refusal test, (4) recorded PASSED fail-open test. |
| `contracts/ci/ci-gate-contract.md` | edit | 0.11.0→0.12.0 Gate Inventory row + `### enforceReconciliationInvariants` subsection (`ci-or-strict`, shape it after existing `### enforceInteractionDesign` / `### enforceConfirmationHookInstallation`). Atomic with the validator (IP-8). |
| `contracts/CHANGELOG.md` | edit | `[upgrade 0.1.0]` (new contract) + `[ci 0.12.0]` entries. Atomic with the validator. |
| `test/cli/reconcile-plan.test.ts` | new | unit+integration `describe()` blocks: guard/classifier/registry, static scans, plan-mutates-nothing, per-key policy.yml, fail-open. Direct imports of `src/reconcile/*.ts`. |
| `test/reconcile/**` | new | supporting fixtures/units per `ci-gates.md` full-suite list. |
| `test/contracts/reconciliation-invariants.test.ts` | new | asserts `enforceReconciliationInvariants` behavior (coverage-gap = HARD failure) and the ci-gate row/subsection exist + are invoked. |
| `test/cli/refresh.test.ts` | edit | ADD one backup-ordering assertion (AC-4); extends existing "overwrites tampered template and backs up prior content" — do not alter existing rows (`test-plan.md` `## Test Update Contract`). |
| `test/e2e/reconcile-plan.e2e.test.ts` | new (NOT backend) | e2e-resilience-engineer only. |
| `test/monkey/reconcile-adversarial.test.ts` | new (NOT backend) | monkey-test-engineer only. |

## Contract Updates

Reference only — applied by backend-engineer in the SAME pass as the validator (IP-8/IP-9),
never before it. Exact enforcement semantics are in `ci-gates.md`
`### enforceReconciliationInvariants` and `contracts/upgrade/...` `## Mechanical Enforcement`.

- API: none (no HTTP surface).
- CSS/UI: none (CLI-only, no UI surface — `interaction-design.md` not-applicable per classification).
- Env: none.
- Data shape: none.
- Business logic: none.
- CI/CD: `contracts/ci/ci-gate-contract.md` 0.11.0→0.12.0 — add the
  `enforceReconciliationInvariants` Gate Inventory row (`ci-or-strict`) + subsection;
  `contracts/CHANGELOG.md` `[ci 0.12.0]`. Plus the NEW
  `contracts/upgrade/upgrade-reconciliation-contract.md` (already authored by
  contract-reviewer) referenced by `contracts/CHANGELOG.md` `[upgrade 0.1.0]`.

## Test Execution Plan

Full AC→test mapping and the five mutations live in `test-plan.md` — do not restate.
Required phase floor: **collect, targeted, changed-area** (always); **contract** (affected —
`ci-gate-contract.md` + `upgrade-reconciliation-contract.md`); **quality** if configured;
**full** at final/CI. See `test-plan.md` `## Test Execution Ladder` and
`references/sdd-tdd-policy.md`. Implementation agents generate evidence with
`cdd-kit test run`; the gate validates `test-evidence.yml`.

| acceptance criterion | test file / command | expected signal |
|---|---|---|
| AC-1 | test/cli/reconcile-plan.test.ts | every kit-shipped surface maps to exactly one bucket; `--plan` prints one line/surface and mutates nothing (mtime+content unchanged) |
| AC-2 | test/cli/reconcile-plan.test.ts | `guard.assertWritable` throws for every enumerated bucket-1 path; tampered bucket-1 fixtures byte-identical after `--yes` |
| AC-3 | test/cli/reconcile-plan.test.ts | typed `register()`+`list()` round-trip; plan pass calls `list()` exactly once |
| AC-4 | test/cli/refresh.test.ts | bucket-2 backup written BEFORE overwrite, byte-matches pre-overwrite content; fast-gate step preserved |
| AC-5 | test/contracts/reconciliation-invariants.test.ts | ci-gate row + subsection exist and are invoked; bucket-1-matcher coverage gap is a HARD failure |
| AC-6 | test/cli/reconcile-plan.test.ts | classifier fails open to keep for malformed/unreadable/unknown input and a newly-added `.cdd/policy.yml` key |
| AC-7 | test/cli/reconcile-plan.test.ts | classifier delegates to `isOwnedAndUnmodified`/`readAssetManifest`/`sha256OfFileNormalized`; no reinvented hashing in `src/reconcile/**` |

Red-turns-green minimum (per `test-plan.md` `## Red-Turns-Green Proof`): guard-refusal
(RED when the bucket-1 check is deleted/weakened), fail-open (RED when the classifier
default flips keep→replace), bucket-1 coverage, single-writer static scan, ci-workflow-pattern.
The guard-refusal and fail-open pair MUST be PASSED and mutation-proven before IP-9 lands.

## Ownership

Sequenced, not parallel. Each stage lands before the next starts.

1. **backend-engineer** owns ALL of IP-1..IP-10 in one coherent pass: the `src/reconcile/`
   module, the `reconcile` command + CLI registration, the schema, the `refresh.ts` guard
   routing, the `enforceReconciliationInvariants` validator, the `ci-gate-contract.md`
   row/subsection + `CHANGELOG.md` entries, and the reconcile-plan + reconciliation-invariants
   tests. The validator + contract row + guard-refusal/fail-open tests **MUST land together**
   (no hollow guarantee — `ci-gates.md` `## Merge Eligibility Decision`, CLAUDE.md
   guarantees-that-never-happened lesson).
2. **e2e-resilience-engineer** (IP-11) THEN adds the full `--plan`-over-fixture-repo e2e +
   failure injection, after the module and command exist.
3. **monkey-test-engineer** (IP-12) THEN adds the adversarial corpus proving a bucket-1
   write is physically refused — the corpus, not prose, is the coverage evidence
   (`design.md` `## Open Risks`).

## Discipline / Constraints

- **Reuse-first:** extend `refresh.ts` / asset-manifest / digest; the guard is genuinely
  new but ownership detection is DELEGATED, never reinvented (AC-7, Solution Minimalism).
- **Single writer:** `src/reconcile/**` and the refresh bucket-2 apply must have exactly ONE
  filesystem-write call site (inside `guard.ts`'s writer). A second `fs.write*`/`copyFile*`/`rm*`
  site is an INV-2 regression the static scan (IP-10) must fail on.
- **Mutation-red:** guard-refusal test RED when the guard is removed; fail-open test RED when
  the classifier default flips keep→replace.
- **Build-first + LOCAL binary:** run `node build.js`, then exercise via
  `node dist/cli/index.js reconcile --plan` (never the global `cdd-kit`); run vitest via
  `node node_modules/vitest/vitest.mjs` (never `npx`; never two heavy vitest runs concurrently —
  `test run` records a wrapper timeout as `status: failed`, a false negative the gate enforces).
- **`.cdd/policy.yml` per-KEY, never per-file** (`contracts/upgrade/...` per-key section).
- **Fail-open to keep**, never to replace, on any malformed/unknown/unreadable input (INV-2).
- **Atomic landing:** IP-9 contract edits MUST NOT be committed before IP-8's validator exists
  and its two linchpin tests are red-turns-green proven.
- **Non-goals:** no bucket-3 reconcilers; no default-behavior change to `refresh`/`upgrade`/`update`.

## Handoff Constraints

- Implementation agents must not infer missing requirements from chat history.
- Do not re-copy full design, test strategy, CI policy, or contract prose into this plan; follow the source pointers above.
- If this plan omits a required file, behavior, contract, or test, stop and report `blocked`.
- Keep implementation within the file-level plan unless a Context Expansion Request is approved.
- backend-engineer must NOT author `test/e2e/**` or `test/monkey/**` (IP-11/IP-12 belong to their agents).

## Known Risks

- **Coverage-gap green gate.** A guard matcher that silently omits an enumerated bucket-1
  surface passes a green gate while leaving a hole. IP-8 check (1) must assert the matcher
  COVERS the contract enumeration; the monkey corpus (IP-12) must prove physical refusal
  (`design.md` `## Open Risks`).
- **policy.yml dual classification.** `.cdd/policy.yml` is both bucket-1 (user-set values)
  and bucket-3 (new-key migration); the split must be per-KEY. A whole-file rule either freezes
  migration or risks flipping a user value.
- **Hollow-guarantee risk.** Landing the ci-gate row without the validator, or the validator
  without a PASSED guard-refusal/fail-open pair, is exactly this repo's recurring defect class —
  NOT mergeable (`ci-gates.md` `## Merge Eligibility Decision`).
- **Validator host placement.** `enforceReconciliationInvariants` must be reachable from BOTH
  `validate` and `gate` (both in Allowed Paths); mirror the existing `enforce*` wiring so it is
  not silently skipped in one path.
- Design.md `## Open Risks` flagged `docs/adr/` and `src/reconcile/` missing from Allowed Paths;
  both are now present in `context-manifest.md` `## Allowed Paths` — resolved, no CER needed.
