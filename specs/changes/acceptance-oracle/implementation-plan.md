---
change-id: acceptance-oracle
schema-version: 0.1.0
last-changed: 2026-07-08
---

# Implementation Plan: acceptance-oracle

## Objective

Deliver ADR 0010's Acceptance Oracle as a fully portable enforcement layer:
a human-owned `acceptance.yml` per change, an `enforceAcceptanceOracle` gate
check composed into `cdd-kit gate`, and the four tamper layers (hash-lock,
acceptance-write hook, mock-of-SUT / hardcoded-answer scan, executed
`acceptance`-phase evidence), plus backfill (migrate/refresh/upgrade) and asset
version+content-digest stamping with `doctor` drift detection. Every AC (AC-1..
AC-8) must be satisfiable by `cdd-kit gate` + settings.json hooks with NO Claude
harness present (design.md "Binding constraint"). Both Python (pytest) and JS/TS
(vitest) driver-loader emission and scans ship in this change (design.md
Maintainer Decisions).

## Execution Scope

### In Scope
- New `src/schemas/acceptance.schema.ts` (AC-6) + `acceptance` phase added to
  `src/schemas/test-evidence.schema.ts` `PHASES` vocabulary (AC-5).
- Oracle canonical-hash util + `.cdd/acceptance-lock.json` baseline read/write
  (design.md Q1; AC-2).
- `enforceAcceptanceOracle(errors, warnings)` composed into `src/commands/gate.ts`
  alongside the existing `enforce*` calls (gate.ts:173-178): placeholder/≥1-case
  (AC-1), hash-lock reconcile (AC-2), executed `acceptance`-evidence (AC-5),
  migrated fail-until-filled (AC-7).
- Mock-of-SUT + hardcoded-`expect` scan for BOTH pytest and vitest drivers,
  SUT resolved from `.cdd/code-map.yml` (AC-4; design.md Q2).
- `hooks/pre-tool-use-acceptance-write.sh` (clone of contract-write hook) +
  `install-agent-hooks.ts` `--acceptance-write` arming + `CDD_ACCEPTANCE_WRITE_STRICT`
  (AC-3); add `.cdd/acceptance-lock.json` to `.cdd/context-policy.json` forbidden
  paths as a HARD path from day one (design.md Maintainer Decisions).
- Per-stack acceptance-driver loader emission (pytest + vitest) into
  `specs/templates/` scaffold (design.md Q2).
- `specs/templates/acceptance.yml` + backfill in `new-change.ts`, `migrate.ts`,
  `refresh.ts`, `upgrade.ts` (AC-7).
- Digest stamping: `.cdd/asset-manifest.json` written by refresh/upgrade/
  install-agent-hooks; `doctor.ts` drift compare (AC-8; design.md Q3).
- `build.js` wiring for the new hook asset; CLI flag registration in
  `src/cli/index.ts`; `.claude/` source-of-truth edits then `node build.js`.
- Contract sync: env (`CDD_ACCEPTANCE_WRITE_STRICT`) already applied — keep
  env.schema.json / .env.example.template / env-contract.md consistent if edited.

### Out of Scope (non-goals — do not implement, do not opportunistically add)
- Z3/SMT contract & business-rule consistency checking.
- Mutation testing as an evidence phase.
- Property-based generation from contracts.
- Promoting the `cdd-new` skill into a deterministic Workflow script.
- Splitting monolithic contract files into per-entry fragments.
- Any correctness guarantee that depends only on a Claude harness primitive
  (Workflow/Loop/Worktree) — forbidden by design.md Binding constraint.
- Refactoring unrelated gate checks or the ADR 0005 harness beyond adding the
  `acceptance` phase.

## Required Changes

| id | area | required action | owner agent |
|---|---|---|---|
| IP-1 | schema | Add `src/schemas/acceptance.schema.ts` (oracle-version, authored-by, cases[].{id,given,when,then,input,expect}, rules[].{id,statement}; `additionalProperties:false`). | backend-engineer |
| IP-2 | schema | Add `acceptance` to `PHASES` in `test-evidence.schema.ts`; keep `PROHIBITED_WAIVER_FIELDS` applying to it (no waivers). | backend-engineer |
| IP-3 | util | New oracle-hash helper in `src/utils/` — parse+canonical-project locked region (lock `cases[].{id,input,expect}` + `rules[].{id,statement}`; exclude given/when/then, oracle-version, authored-by), recursive key sort, sort cases/rules by id, canonical JSON, `normalizeContentForHash`, sha256. Reuse `src/utils/digest.ts:normalizeContentForHash`. | backend-engineer |
| IP-4 | util | `.cdd/acceptance-lock.json` read/write keyed by change-id (author-time baseline). Human relock only via explicit command; never an agent side effect. | backend-engineer |
| IP-5 | gate | `enforceAcceptanceOracle(errors, warnings)` in a new `src/commands/gate-acceptance.ts` (mirror gate-evidence/gate-contracts module shape); compose into `gate.ts` after line 178. Covers AC-1/AC-2/AC-5/AC-7 as blocking errors. | backend-engineer |
| IP-6 | gate/scan | Mock-of-SUT + hardcoded-`expect`-literal scan for pytest AND vitest; SUT resolved via `src/code-map/` reader; conservative rule set (external I/O boundary fakes pass; unresolved SUT does not false-fail). AC-4. | backend-engineer |
| IP-7 | hook | `hooks/pre-tool-use-acceptance-write.sh` cloned from `hooks/pre-tool-use-contract-write.sh`; advisory default, hard-block under `CDD_ACCEPTANCE_WRITE_STRICT=1`; matches `acceptance.yml` + `.cdd/acceptance-lock.json`. AC-3. | backend-engineer |
| IP-8 | installer | `install-agent-hooks.ts` `--acceptance-write` arming (new marker/HookDef mirroring `CONTRACT_WRITE` at install-agent-hooks.ts:34/64); doctor-detectable. AC-3. | backend-engineer |
| IP-9 | policy | Add `.cdd/acceptance-lock.json` to `.cdd/context-policy.json` forbidden paths (HARD from day one). | backend-engineer |
| IP-10 | templates | `specs/templates/acceptance.yml` (placeholder-plus-instructions, must fail `meaningfulChars`) + per-stack driver-loader templates (pytest + vitest). AC-6/AC-7. | backend-engineer |
| IP-11 | backfill | Scaffold `acceptance.yml` in `new-change.ts`; backfill in `migrate.ts`, `refresh.ts`, `upgrade.ts`; migrated change FAILS `enforceAcceptanceOracle` until real cases supplied. AC-7. | backend-engineer |
| IP-12 | digest | `.cdd/asset-manifest.json` written by refresh/upgrade/install-agent-hooks (reuse `sha256OfFileNormalized`); `doctor.ts` recompute+compare (installed vs manifest = partial copy; installed vs packaged = stale global). AC-8. | backend-engineer |
| IP-13 | build/CLI | `build.js` copy the new hook asset; register `--acceptance-write` flag in `src/cli/index.ts`; edit `.claude/` source then `node build.js`, `npm run build` before CLI tests. | backend-engineer |
| IP-14 | contracts | Verify env + ci-gate contracts (already applied) stay in sync with implemented behavior; do not re-author (contract-reviewer owns review). | backend-engineer |

## Source Artifact Pointers

| source | relevant pointer | used for |
|---|---|---|
| design.md | Key Decisions Q1 (canonical hash + locked fields + `.cdd/acceptance-lock.json`) | IP-3, IP-4 hashing/baseline rules |
| design.md | Key Decisions Q2 (kit EMITS per-stack loader; driver must reference loader symbol + no hardcoded expect) | IP-6, IP-10 |
| design.md | Key Decisions Q3 (single `.cdd/asset-manifest.json` sidecar) | IP-12 |
| design.md | Binding constraint (ADR 0010 §5) | every AC portable via gate+hooks, no harness |
| design.md | Maintainer Decisions (lock sidecar HARD day one; both stacks now) | IP-6, IP-9 |
| change-classification.md | Inferred Acceptance Criteria AC-1..AC-8 | AC definitions |
| test-plan.md | AC → Test Mapping table + Test Update Contract | Test Execution Plan below |
| ci-gates.md | Required Gates table + Sign-off (required-from-day-one) | verification / gate behavior |
| contracts/ci/ci-gate-contract.md (0.2.0) | pass/fail conditions + AC mapping | gate check conformance (IP-5/IP-6) |
| contracts/env/env-contract.md + env.schema.json + .env.example.template | `CDD_ACCEPTANCE_WRITE_STRICT` | IP-7/IP-8 env sync |
| docs/adr/0010-acceptance-oracle.md | full mechanism spec | authoritative behavior |
| .cdd/code-map.yml | gate.ts:173-178, install-agent-hooks.ts:34/64, digest.ts:17-40, gate-evidence.ts | precise touch points |

## File-Level Plan

| path or glob | action | notes |
|---|---|---|
| src/schemas/acceptance.schema.ts | create | IP-1; ajv schema, `additionalProperties:false`. |
| src/schemas/test-evidence.schema.ts | edit | IP-2; add `acceptance` to `PHASES` (line ~34). |
| src/utils/acceptance-hash.ts (or similar in src/utils/) | create | IP-3; reuse digest.ts `normalizeContentForHash`. |
| src/utils/acceptance-lock.ts (or fold into hash util) | create | IP-4; `.cdd/acceptance-lock.json` read/write. |
| src/commands/gate-acceptance.ts | create | IP-5+IP-6; `enforceAcceptanceOracle` + scan; mirror gate-evidence.ts module shape. |
| src/commands/gate.ts | edit | IP-5; add `enforceAcceptanceOracle(...)` call after line 178. |
| src/code-map/ (reader) | read/reuse | IP-6; resolve change SUT from code-map index (name-based; conservative). |
| hooks/pre-tool-use-acceptance-write.sh | create | IP-7; clone of pre-tool-use-contract-write.sh. |
| .claude/hooks/pre-tool-use-acceptance-write.sh | create | IP-7; `.claude/` source-of-truth copy (assets regen via build.js). |
| src/commands/install-agent-hooks.ts | edit | IP-8; new marker + HookDef mirroring CONTRACT_WRITE (34/64), `--acceptance-write` handling. |
| .claude/settings.json | edit if needed | IP-8; only if default arming changes; keep user's own agents intact. |
| .cdd/context-policy.json | edit | IP-9; add `.cdd/acceptance-lock.json` to forbidden paths. |
| specs/templates/acceptance.yml | create | IP-10; placeholder-plus-instructions (must fail meaningfulChars). |
| specs/templates/ (driver-loader: pytest + vitest) | create | IP-10; read-only loader exposing id→{input,expect}. |
| src/commands/new-change.ts | edit | IP-11; scaffold acceptance.yml + driver loader. |
| src/commands/migrate.ts | edit | IP-11; backfill into in-flight change dirs (same path as tasks.yml/agent-log upgrade). |
| src/commands/refresh.ts | edit | IP-11+IP-12; backfill template + write asset-manifest. |
| src/commands/upgrade.ts | edit | IP-11+IP-12; backfill + write asset-manifest. |
| src/utils/digest.ts | reuse/extend | IP-12; `sha256OfFileNormalized` for manifest stamping. |
| src/commands/doctor.ts | edit | IP-12; asset-manifest drift compare + acceptance-write hook armed/missing (AC-3). |
| build.js | edit | IP-13; ensure new hook asset copied (see shouldCopyAsset/copy at 51-72). |
| src/cli/index.ts | edit | IP-13; register `--acceptance-write` flag on install-agent-hooks command. |
| contracts/env/*, contracts/ci/ci-gate-contract.md | verify | IP-14; already applied — keep consistent, do not re-author. |
| test/** | create/edit | per Test Execution Plan + test-plan.md Notes/Test Update Contract. |

Note: `.claude/` is the source of truth for hooks/agents/skills/settings; edit
the `.claude/` copy (and `hooks/` source) then run `node build.js` to regenerate
`assets/`. Never hand-edit `assets/`. `src/` changes require `npm run build`
before CLI subprocess tests.

## Contract Updates

- API: none (change-classification.md §Required Contracts).
- CSS/UI: none.
- Env: `CDD_ACCEPTANCE_WRITE_STRICT` — already applied to
  `contracts/env/env-contract.md`, `contracts/env/env.schema.json`,
  `contracts/env/.env.example.template`. Backend keeps all three in sync with the
  hook's actual behavior; contract-reviewer reviews.
- Data shape: internal schema files only (`acceptance.schema.ts` + `acceptance`
  phase in test-evidence) — no change to `contracts/data/data-shape-contract.md`.
- Business logic: none.
- CI/CD: `enforceAcceptanceOracle` required check — already applied to
  `contracts/ci/ci-gate-contract.md` (0.2.0). Gate implementation (IP-5/IP-6)
  must conform to that contract's pass/fail conditions; ci-cd-gatekeeper signs off.

## Test Execution Plan

Authoritative AC→test mapping and file paths live in `test-plan.md`
(§Acceptance Criteria → Test Mapping + §Notes + §Test Update Contract). TDD:
AC-2 and AC-4 mechanisms must be RED before their implementation lands
(test-plan.md Notes); no waiver fields permitted in `acceptance`-phase evidence.

| acceptance criterion | test file / command | expected signal |
|---|---|---|
| AC-1 | test/cli/acceptance-oracle.test.ts | gate fails on missing/all-placeholder acceptance.yml; passes with ≥1 real case + passed evidence |
| AC-2 | test/utils/acceptance-hash.test.ts | hash stable across key-order/whitespace; diverges on input/expect/rule-id change; unchanged on given/when/then reword |
| AC-3 | test/cli/acceptance-write-hook.test.ts | advisory exit 0, strict exit 2, ignores non-acceptance files, allows first human scaffold |
| AC-4 | test/utils/mock-of-sut-scan.test.ts | pytest+vitest SUT-mock fail; network/clock fake pass; unresolved-SUT no false-fail; hardcoded expect literal fails |
| AC-5 | test/schemas/test-evidence.schema.test.ts | accepts `acceptance` phase; gate fails self-report with no recorded run |
| AC-6 | test/schemas/acceptance.schema.test.ts | accepts well-formed; rejects missing id/input/expect, missing rule fields, unknown top-level; shipped template validates |
| AC-7 | test/cli/migrate.test.ts, test/cli/refresh.test.ts, test/cli/acceptance-oracle.test.ts | scaffolds placeholder oracle; migrated change fails until filled |
| AC-8 | test/utils/digest.test.ts, test/cli/doctor.test.ts | manifest stamps version+digest; doctor reports partial-copy + stale-global drift; no drift on clean re-scaffold |
| e2e | test/cli/acceptance-oracle.test.ts | full lifecycle scaffold→author→driver→green, then tamper→red, mock-of-SUT→red |

Existing tests to UPDATE (not duplicate): test/cli/gate.test.ts,
test/schemas/test-evidence.schema.test.ts, test/cli/migrate.test.ts,
test/cli/refresh.test.ts, test/cli/install-agent-hooks.test.ts,
test/cli/doctor.test.ts, test/utils/digest.test.ts.

Required phase floor (produce recorded evidence via `cdd-kit test run`, gate
validates `test-evidence.yml`): `collect`, `targeted`, `changed-area`. Add
`contract` (contracts affected), `quality` (if configured), `full` (final/CI) per
test-plan.md §Test Execution Ladder. This change also produces the new
`acceptance`-phase evidence. Contract-write-hook-style POSIX tests use
`describe.skipIf(win32)` (test-plan.md §Test Families Required).

## Handoff Constraints

- Implementation agents must not infer missing requirements from chat history.
- Do not re-copy full design, test strategy, CI policy, or contract prose into
  this plan; follow the source pointers above.
- If this plan omits a required file, behavior, contract, or test, stop and
  report `blocked`.
- Keep implementation within the file-level plan unless a Context Expansion
  Request is approved.
- Never write or repair `design.md`; design decisions are owned by spec-architect.
  If a design decision is missing, route back to spec-architect rather than
  guessing.

## Sequencing (incremental validation)

Order for TDD; each numbered block can be built + validated before the next:
1. IP-1/IP-2 schema (+ acceptance.schema.test.ts, test-evidence.schema.test.ts).
   Validate: `npm run build` + `vitest` schema tests green.
2. IP-3/IP-4 hash + lock util (acceptance-hash.test.ts RED first). Pure/no-process.
3. IP-5 `enforceAcceptanceOracle` (AC-1/AC-2/AC-5/AC-7) composed into gate.ts +
   acceptance-oracle.test.ts. Validate: gate.test.ts + acceptance-oracle.test.ts.
4. IP-6 mock-of-SUT + hardcoded-expect scan, pytest+vitest (mock-of-sut-scan.test.ts
   RED first). Validate independently before wiring to gate error path.
5. IP-7/IP-8/IP-9 acceptance-write hook + installer arming + forbidden-path.
   Edit `.claude/` + `hooks/`, `node build.js`. Validate: acceptance-write-hook.test.ts,
   install-agent-hooks.test.ts, doctor hook-armed test.
6. IP-10 templates + per-stack driver loaders.
7. IP-11 backfill (new-change/migrate/refresh/upgrade). Validate migrate/refresh tests.
8. IP-12 asset-manifest stamping + doctor drift (AC-8).
9. IP-13 build.js + CLI flag wiring; then full E2E lifecycle test + `--phase full`.

## Known Risks

- Mock-of-SUT precision depends on code-map name-based cross-file resolution
  (known weak spot; MEMORY: DashBoard_clone has no aliases). Start conservative
  (minimal-then-grow, ADR 0004 §5); unresolved SUT must NOT false-fail (AC-4
  data-boundary test). A false positive blocking a real PR is a P0 gate-defect
  bug fix (tighten rule, do not disable) per ci-gates.md Sign-off caveat.
- Baseline co-update residual (design.md Open Risks): if the write hook is
  off/bypassed an agent could re-stamp `.cdd/acceptance-lock.json`. Mitigated by
  the HARD forbidden-path (IP-9) + layered defense; do not weaken IP-9.
- Irreducible residual: no mechanism detects a lazy-but-well-formed oracle; gate
  only requires ≥1 non-placeholder case. This is the author's role by design.
- `.cdd/code-map.yml` header is dated 2026-06-26 (cdd-kit 3.6.0) — verify it is
  fresh before relying on SUT resolution; run `cdd-kit code-map` if stale.
- Both-stacks scope (design.md) widens work ~1.5–2× vs Python-first; sequence
  pytest and vitest scan/loader together but land pytest path first within IP-6/IP-10
  to keep an incrementally validatable slice.
- Cross-platform: POSIX `sh` hook must be `describe.skipIf(win32)`-tested; CLI
  behavior must work under PowerShell and POSIX (UTF-8 safe).
