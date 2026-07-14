---
change-id: boundary-ci-adopter-parity
schema-version: 0.1.0
last-changed: 2026-07-14
---

# Implementation Plan: boundary-ci-adopter-parity

## Objective

Make the adopter-facing CI path enforce Boundary Guard identically to the
integrated `cdd-kit gate`, closing the three shipped v3.12–3.13.1 divergences:

1. Standalone `cdd-kit boundary check` honors `.cdd/policy.yml` `shadow_mode`
   by default (findings printed, shadow → exit 0), with an explicit `--enforce`
   override — sharing ONE enforcement-semantics source with `gate` so the two
   paths cannot diverge again (#63/#65 — AC-1/AC-2/AC-3).
2. `src/boundary/guard.ts` resolves the effective base ONCE and reuses it for
   BOTH `changedFiles()` and the changed-contract snapshot (`contractAtRevision`),
   so a `CDD_BASE_SHA`-only run against an API-contract change selects only the
   changed operations, not all 202 (#62 — AC-4).
3. The shipped adopter workflow template and this repo's own workflow are fixed:
   structured-`if` changed-dirs loop (#61 — AC-6) and `--base "$CDD_BASE_SHA"`
   on the Boundary Guard step (#62 — AC-5); `assets/` regenerated from source via
   `node build.js` (AC-7). `contracts/ci/ci-gate-contract.md` already documents
   the semantics (AC-8) — this change makes the code match it.

The contract edit is ALREADY APPLIED (`## Boundary Guard Enforcement Semantics`,
`### Archive-only push robustness`). This is a code/config + test + docs change
that conforms to the existing contract; contract-reviewer confirms parity.

## Execution Scope

### In Scope
- Shared enforcement-semantics helper consumed by BOTH `gate.ts` and
  `boundaryCheck` (extracted from the gate-side `[shadow]` downgrade at
  `src/commands/gate.ts` ~251-256).
- `--enforce` flag on the `boundary check` CLI command.
- Effective-base resolution reused for `changedFiles()` and `contractAtRevision`
  in `src/boundary/guard.ts`.
- Both workflow YAMLs (`github-workflows/…` template + `.github/workflows/…`
  own) + `node build.js` asset regeneration.
- `docs/boundary-guard.md` standalone-parity + `--enforce` prose.
- Failing-first regression tests: `test/cli/boundary.test.ts` (AC-1..AC-4),
  `test/contracts/ci-workflow.test.ts` (AC-5/AC-6/AC-7).

### Out of Scope (do NOT do these)
- `contracts/env/env-contract.md` documentation accuracy for `CDD_BASE_SHA` /
  `GITHUB_BASE_SHA` — review-only (contract-reviewer confirms), NO new test, NO
  edit unless review finds a factual error.
- Promoting Boundary Guard to blocking in the integrated gate or standalone
  default — `shadow_mode: true` stays the shipped default; `--enforce` is a
  per-invocation opt-in only (ci-gates.md `## Promotion Policy`).
- Issues #66 / #67 — separate changes.
- Any refactor of `runBoundaryGuard`'s finding logic, adapters, or generators
  beyond the base-resolution change; any change to gate checks other than
  routing Boundary findings through the shared helper.
- Editing `assets/**` by hand (regenerate via `build.js` only).

## Required Changes

| id | area | required action | owner agent |
|---|---|---|---|
| IP-1 | shared enforcement semantics | Extract the shadow/enforce decision (currently inline at `src/commands/gate.ts` ~251-256) into ONE reusable helper in an **already-allowed** file (recommend `src/boundary/guard.ts`, co-located with `runBoundaryGuard` which both callers already import; `src/commands/gate-shared.ts` is the acceptable alternative). Helper takes (findings + policy `shadow_mode` + `enforce` override) → per-finding stream classification (error vs warning) + `[shadow]` message prefix + overall blocking/exit decision. Do NOT create a brand-new module file — not in Allowed Paths, would need a CER. | bug-fix-engineer |
| IP-2 | gate parity | Replace the inline loop at `src/commands/gate.ts` ~251-256 with a call to the IP-1 helper. Preserve the existing try/catch throw path (~257-259): a `runBoundaryGuard` throw stays an advisory warning, never a gate error. | bug-fix-engineer |
| IP-3 | standalone semantics | `src/commands/boundary.ts` `boundaryCheck`: replace the unconditional `return result.status === 'failed' ? 1 : 0` (line 108) with the IP-1 helper's decision; print findings via the shared classifier (advisory `Boundary Guard [shadow]: …` under shadow, exit 0). Surface `shadow_mode` from `runBoundaryGuard` (recommended: add it to `BoundaryGuardResult` — additive) OR read `.cdd/policy.yml` in `boundaryCheck`; prefer surfacing so there is no second policy read. Add `enforce?: boolean` to `BoundaryCheckOptions`. | bug-fix-engineer |
| IP-4 | CLI flag | `src/cli/index.ts` `boundary check` (registration ~200-216): add `.option('--enforce', 'Fail on any error-level finding even under shadow_mode', false)` and thread `enforce` into the `boundaryCheck({ … })` call. Additive/backward-compatible. | bug-fix-engineer |
| IP-5 | effective-base reuse | `src/boundary/guard.ts`: resolve the effective base ONCE (extract the `changedFiles` `ciBase` chain at ~130-133 into e.g. `resolveEffectiveBase(cwd, options.base)` = `options.base ?? CDD_BASE_SHA ?? GITHUB_BASE_SHA ?? origin/GITHUB_BASE_REF ?? (CI ? HEAD^ : undefined)`). Call it once in `runBoundaryGuard`; pass the resolved value to `changedFiles()` AND to `contractAtRevision(cwd, <resolvedBase>, contractRel)` at ~284 (today `options.base ? … : null` makes `previous=null` and selects every operation when only `CDD_BASE_SHA` is set). | bug-fix-engineer |
| IP-6 | adopter workflow template | `github-workflows/contract-driven-gates.yml`: (a) replace the chained `… && [ -d … ] && printf` `IDS=` line (~79) with the structured `… ; then printf '%s\n' "$id"; fi` form already in `.github/workflows/…` (~69); (b) append `--base "$CDD_BASE_SHA"` to the `cdd-kit boundary check` run line (~94). | ci-cd-gatekeeper |
| IP-7 | repo's own workflow | `.github/workflows/contract-driven-gates.yml`: append `--base "$CDD_BASE_SHA"` to the `node dist/cli/index.js boundary check` run line (~84). Changed-dirs loop already structured — leave it. | ci-cd-gatekeeper |
| IP-8 | asset regeneration | Run `node build.js` so `assets/github-workflows/contract-driven-gates.yml` is byte-identical to the edited source; never hand-edit `assets/` (`build.js:116` copies `github-workflows/` → `assets/github-workflows/`). | ci-cd-gatekeeper |
| IP-9 | docs | `docs/boundary-guard.md` (near the shadow-mode note ~66-68): state that standalone `cdd-kit boundary check` honors the SAME `shadow_mode` default as the gate and document `--enforce`. | bug-fix-engineer |
| IP-10 | regression tests (src) | `test/cli/boundary.test.ts`: add AC-1/AC-2/AC-3/AC-4 tests (see Test Execution Plan). Each MUST fail on pre-fix code first. | bug-fix-engineer |
| IP-11 | regression tests (workflow) | `test/contracts/ci-workflow.test.ts`: re-arm AC-6 (replace the vacuous archive-only test at lines 142-166), add AC-5 `--base` assertions for both labels, add AC-7 byte-identity check. Each MUST fail on pre-fix code first. | ci-cd-gatekeeper |

**Ownership note.** bug-fix-engineer owns all `src/**` + `docs/boundary-guard.md`
+ `test/cli/boundary.test.ts`, and records ADR 0006 typed `bug-fix:` / `artifacts:`
evidence (one set per defect #61-side src impact via base fix, #62, #63/#65).
ci-cd-gatekeeper owns both workflow YAMLs + `node build.js` +
`test/contracts/ci-workflow.test.ts`. The shared helper (IP-1) is authored by
bug-fix-engineer; ci-cd-gatekeeper only consumes its behavior through the
workflow/contract tests. Land IP-1..IP-5 before IP-6..IP-8 is not required, but
each AC's mutation-red proof is recorded before that AC's fix.

## Source Artifact Pointers

| source | relevant pointer | used for |
|---|---|---|
| contracts/ci/ci-gate-contract.md | `## Boundary Guard Enforcement Semantics` AC-1..AC-5 (~402-448) | the ONE spec for shadow-default, `--enforce`, single effective base, workflow `--base` wiring |
| contracts/ci/ci-gate-contract.md | `### Archive-only push robustness` AC-6 (~54-71) | structured-`if` form + `bash -eo pipefail` exit-0 requirement |
| test-plan.md | `## Acceptance Criteria → Test Mapping` AC-1..AC-8 | which test file/name proves each AC |
| test-plan.md | `## Mutation-Red Proof` (all 7 rows) | the exact pre-fix mutation each test must catch red |
| test-plan.md | Notes (AC-3 lives in boundary.test.ts; AC-6 fixture ALL-archived; AC-1/AC-2 assert stream text AND exit) | test-authoring constraints |
| ci-gates.md | `## Required Gates` + `## Workflow Changes Required` items 1-6 | verification commands + exact workflow/test edits |
| ci-gates.md | vitest command note (`node node_modules/vitest/vitest.mjs`, not `npx`) | how to run the suite without the timeout false-negative |
| change-classification.md | `## Bug Evidence Required` (ADR 0006, one set per defect) | bug-fix-engineer evidence obligation |

## File-Level Plan

| path or glob | action | notes |
|---|---|---|
| src/boundary/guard.ts | edit | IP-5 effective-base helper + reuse for `changedFiles`/`contractAtRevision`; (recommended) host IP-1 helper here and surface `shadow_mode` on `BoundaryGuardResult` (additive). |
| src/commands/boundary.ts | edit | IP-3: `boundaryCheck` uses shared helper for exit + finding presentation; add `enforce?` to `BoundaryCheckOptions`. |
| src/commands/gate.ts | edit | IP-2: replace inline `[shadow]` loop (~251-256) with the shared helper; keep the throw→warning catch. |
| src/commands/gate-shared.ts | edit (only if chosen as helper home) | acceptable alternative home for IP-1; otherwise untouched. |
| src/cli/index.ts | edit | IP-4: add `--enforce` option + thread it into `boundaryCheck`. |
| github-workflows/contract-driven-gates.yml | edit | IP-6: structured-`if` `IDS=` line + `--base "$CDD_BASE_SHA"`. |
| .github/workflows/contract-driven-gates.yml | edit | IP-7: `--base "$CDD_BASE_SHA"` on the boundary step. |
| assets/github-workflows/contract-driven-gates.yml | generated | IP-8: produced by `node build.js`; do NOT hand-edit. |
| docs/boundary-guard.md | edit | IP-9: standalone-parity + `--enforce`. |
| test/cli/boundary.test.ts | edit (add tests) | IP-10: AC-1..AC-4 regression, failing-first. |
| test/contracts/ci-workflow.test.ts | edit (re-arm + add) | IP-11: AC-6 re-arm (replace 142-166), AC-5 `--base` regex both labels, AC-7 byte-identity. |
| src/schemas/cdd-policy.schema.ts | read-only | reference for `shadow_mode` field; do NOT change (schema already permits it). |

## Contract Updates

- API: none — `contracts/api/*` is `applicability: not-applicable` (no HTTP surface).
- CSS/UI: none — no UI surface.
- Env: review-only — contract-reviewer confirms `CDD_BASE_SHA` / `GITHUB_BASE_SHA`
  are documented in `contracts/env/env-contract.md`; no new variable/secret. No edit
  unless a factual error is found.
- Data shape: none.
- Business logic: none as a standalone contract; enforcement-semantics rule lives
  in the CI contract.
- CI/CD: **already applied** — `contracts/ci/ci-gate-contract.md`
  `## Boundary Guard Enforcement Semantics` (AC-1..AC-5) and
  `### Archive-only push robustness` (AC-6). Implementation must make the code and
  workflows match this text; contract-reviewer confirms parity (AC-8). No further
  contract authoring by implementation agents.

## Test Execution Plan

Required phases (floor): `collect`, `targeted`, `changed-area`; add `contract`
(workflow YAML + asset drift affected) and `full` (final/CI). Ladder + result
artifacts: test-plan.md `## Test Execution Ladder`; policy:
`references/sdd-tdd-policy.md`. Implementation agents generate evidence with
`cdd-kit test run`; the gate validates `test-evidence.yml`.

Discipline (non-negotiable):
- **Mutation-red first**: every row below MUST be shown red on pre-fix code and
  recorded in `test-evidence.yml` (test-plan.md `## Mutation-Red Proof`; CLAUDE.md
  "vacuous tests"). No waiver.
- **Build before testing the CLI**: `node build.js` (esbuild → `dist/`, regenerates
  `assets/`) then exercise the LOCAL build `node dist/cli/index.js …`. NEVER the
  global `cdd-kit` on PATH — a stale global binary is literally production issue
  #64's root cause.
- **Run vitest as** `node node_modules/vitest/vitest.mjs` (not `npx`) per
  ci-gates.md / MEMORY test-run-timeout lesson.

| acceptance criterion | test file / command | expected signal |
|---|---|---|
| AC-1 | test/cli/boundary.test.ts | `shadow_mode: true`: error finding printed as `Boundary Guard [shadow]: …` on stdout AND exit 0 (pre-fix: exits 1). |
| AC-2 | test/cli/boundary.test.ts | `boundary check --enforce`: same error finding, exit 1 (pre-fix: `--enforce` unread, exits 0). |
| AC-3 | test/cli/boundary.test.ts | identical policy+manifest fixture → `boundary check` and `gate <id>` derive identical shadow/enforce decision (pre-fix: divergent inline checks mismatch). |
| AC-4 | test/cli/boundary.test.ts | real git fixture, only `CDD_BASE_SHA` set (no `--base`), API contract changed → `changed_operations` is exactly the changed subset, not every contracted op (pre-fix: `previous=null` → all ops). |
| AC-5 | test/contracts/ci-workflow.test.ts | both workflow labels: boundary `run:` line matches `--base "$CDD_BASE_SHA"` (pre-fix: env var only, regex fails). |
| AC-6 | test/contracts/ci-workflow.test.ts | all-archived fixture (NO live id) via `bash -c 'set -eo pipefail; …'` → exit 0, empty `ids`; AND regex asserts the structured-`if` form specifically (pre-fix: chained form exits non-zero / bare-substring assertion passes both forms). |
| AC-7 | test/contracts/ci-workflow.test.ts | `assets/github-workflows/contract-driven-gates.yml` byte-identical to `github-workflows/…` after build (pre-fix: hand-edit drift fails). |
| AC-8 | n/a — contract-reviewer sign-off | mechanically backed by AC-1..AC-5 green + `ci-gate-contract.md` diff review. |
| acceptance (ADR 0010) | test/acceptance/boundary-ci-adopter-parity.driver.test.ts vs specs/changes/boundary-ci-adopter-parity/acceptance.yml | driver runs the real built CLI (shadow exit, `--enforce` exit, changed-op count) against the human-locked `expect`. Oracle is human-authored/confirmed, NOT written by implementation agents. |

## Handoff Constraints

- Implementation agents must not infer missing requirements from chat history.
- Do not re-copy full design, test strategy, CI policy, or contract prose into this plan; follow the source pointers above.
- If this plan omits a required file, behavior, contract, or test, stop and report `blocked`.
- Keep implementation within the file-level plan unless a Context Expansion Request is approved. The shared helper (IP-1) must live in an already-Allowed file — creating a new module file requires a CER first.
- `--enforce` is additive/backward-compatible. The standalone default change (exit 1 → exit 0 under shadow mode) is the INTENDED parity correction with `cdd-kit gate`; rollback for any adopter who relied on always-block is `--enforce` (ci-gates.md `## Rollback Policy`).

## Known Risks

- **`[shadow]` prefix under `--enforce`**: the contract (AC-1/AC-2) fixes the exit
  codes but does not spell out whether the printed message keeps the `[shadow]`
  label when `--enforce` makes a shadow finding blocking. Resolve consistently in
  the shared helper: the label reflects ACTUAL treatment, so a finding being
  enforced should not read as `[shadow]`. Pin the exact expected text in the AC-2
  test and against the human-locked `acceptance.yml` — do NOT invent it from
  observed output (CLAUDE.md acceptance-oracle lesson).
- **Surfacing `shadow_mode` on `BoundaryGuardResult`** is additive but changes the
  `--json` output shape; confirm no existing consumer/test asserts the exact key
  set. If risky, have `boundaryCheck` read `.cdd/policy.yml` instead.
- **AC-6 fixture must contain ONLY archived ids** (no live id) — a trailing live id
  masks the failing loop iteration under `bash -eo pipefail` (test-plan.md Notes;
  ci-gates.md item 5). The old test at 142-166 is vacuous for exactly this reason.
- **Global-binary staleness**: any CLI assertion run against the global `cdd-kit`
  instead of `node dist/cli/index.js` after `node build.js` can false-pass/fail —
  this is issue #64's root cause. Gate against the local build only.
- **Effective-base helper drift**: `resolveEffectiveBase` must reproduce the
  EXACT existing `ciBase` precedence (including the `CI && HEAD^` guard) so no
  non-CI local behavior regresses; AC-4's fixture only covers the `CDD_BASE_SHA`
  branch — add/keep coverage for the `--base` and no-input branches if feasible.
- **`.cdd/code-map.yml` currency**: this plan's line pointers were taken from
  direct reads of source (map not consulted for these ranges); if an implementation
  agent finds a pointer stale, trust the source and note it — do not widen reads
  beyond Allowed Paths.
- **Acceptance oracle dependency**: `enforceAcceptanceOracle` is a REQUIRED gate
  (ci-gates.md). `acceptance.yml` + `.cdd/acceptance-lock.json` must be
  human-authored/confirmed before the gate passes; implementation agents drive the
  real CLI but never author the oracle `expect`.
