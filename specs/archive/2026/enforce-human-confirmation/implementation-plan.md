---
change-id: enforce-human-confirmation
schema-version: 0.1.0
last-changed: 2026-07-10
---

# Implementation Plan: enforce-human-confirmation

## Objective

Make the "a human confirmed this artifact" guarantee of ADR 0010 / ADR 0012
mechanical where a mechanism can hold and honest where none can, by landing seven
code/config changes across `src/`, `hooks/`, `.claude/settings.json`, and
`docs/adr/0012` that satisfy AC-1..AC-8 with mutation-proven, stream-asserted
tests. The contracts are already written and landed (`contracts/ci 0.7.0`,
`contracts/env 0.4.0`); this plan makes source conform to them. It does NOT attempt
DAC-1 (self-stamp prevention against a `Bash`-holder — unavailable on this machine;
see `change-classification.md` `## Deferred Acceptance Criteria`). No test, message,
or document produced here may claim a `Bash`-holding agent is prevented from
self-stamping.

## Execution Scope

### In Scope
- Level-aware, line-anchored `sectionBody` (`src/utils/markdown-section.ts`).
- The sixth `ci-gate: <heading> :: <substring>` citation form
  (`src/utils/design-provenance.ts`).
- AC-1 non-empty derivation-chain check in `enforceInteractionDesign`
  (`src/commands/gate-design.ts`).
- Path-keyed rewrite of both write-block hooks; retire `CDD_*_WRITE_STRICT`
  (`hooks/pre-tool-use-design-write.sh`, `hooks/pre-tool-use-acceptance-write.sh`).
- `enforceConfirmationHookInstallation` gate check + wiring.
- Git-tracked `.claude/settings.json` registering both write-block hooks at
  repo-root `hooks/…` paths.
- Provenance fields (git-author / TTY / timestamp) in `DesignLockEntry` +
  `src/schemas/design-lock.schema.ts` + `writeDesignLock`.
- Transcribe the pre-drafted ADR 0012 §5 amendment (`docs/adr/0012-...md`).
- The test deletions/updates in `test-plan.md` `## Test Update Contract`.
- `npm run build` (tsc → `dist/`) and `node build.js` (regenerate `assets/`).

### Out of Scope
- DAC-1 self-stamp prevention. No test/message/doc may claim it.
- A standalone diff-independent CI hook-presence step (hazard B full closure) —
  deferred follow-up per `change-request.md` `## Non-goals`.
- `github-workflows/` ↔ `.github/workflows/` structural drift checking (follow-up).
- Empty `## User Intents` / `## Controls` row checks (`design.md` `## Open Risks`).
- Any `install-agent-hooks` refactor beyond what IP-6's contradiction note forces.
- Writing `.cdd/design-lock.json`, `.cdd/acceptance-lock.json`, or `acceptance.yml`
  by any means (human-owned; ADR 0010/0012).
- Any workflow YAML edit — `ci-gates.md` `## Workflow Changes Applied` verified none
  is needed.

## Required Changes

| id | area | required action | owner agent |
|---|---|---|---|
| IP-1 | `src/utils/markdown-section.ts` | Make `sectionBody` level-aware (a `###` body terminates at the next same-or-shallower heading; a `##` body still spans its `###` children) and anchor its opening match to a full line. Measured zero drift across 12 headings / 5 call sites, so any drift a test detects is a real regression. | backend-engineer |
| IP-2 | `src/utils/design-provenance.ts` | Add the sixth citation form `ci-gate: <heading> :: <exact substring>` in `resolveCitation` (new branch before the endpoint match at :460): map the bare/parenthetical-tolerant heading to its unique full heading line, read its body via `sectionBody`, normalize (strip `* _ \``, collapse whitespace), case-SENSITIVE substring compare, require EXACTLY ONE occurrence (0 → not-found, ≥2 → ambiguous). | backend-engineer |
| IP-3 | `src/commands/gate-design.ts` | Add the AC-1 non-empty-rows check: reuse `infoItems`/`states` already computed at :340-341 (parsed by local `parsePresentedInformation` :178 / `parseStates` :187); if either `.length === 0`, push a gate ERROR when `isNewChange || strict`, else a warning. Place it AFTER the `applicability: not-applicable` short-circuit (:295-301) and the stub/placeholder checks. Update the "fully valid" test fixture per `test-plan.md` Test Update Contract. | backend-engineer |
| IP-4 | `hooks/pre-tool-use-design-write.sh`, `hooks/pre-tool-use-acceptance-write.sh` | Rewrite to key off the write TARGET PATH: lock sidecar (`.cdd/design-lock.json` / `.cdd/acceptance-lock.json`) → block unconditionally (exit 2, stderr) regardless of any env var; artifact body (`interaction-design.md` / `acceptance.yml`) → allow (exit 0). Remove the `CDD_*_WRITE_STRICT` branch entirely. Update the header-comment example to reference repo-root `hooks/…`, not `./.claude/hooks/…`. | backend-engineer |
| IP-5 | `src/commands/gate-design.ts` (or `gate-shared.ts`) + `src/commands/gate.ts` | Add `enforceConfirmationHookInstallation`. Read PROJECT `.claude/settings.json`. Two DISTINCT absence messages (no settings file vs settings-without-the-named-hook), naming which of design/acceptance is missing. A hook entry counts only if its `command` resolves to a git-tracked repo-root `hooks/…` path — an entry pointing at `.claude/hooks/…` does NOT satisfy it. Hard-fail on stderr (`log.error`) when `CI` is truthy (set, non-empty, not `0`/`false`) OR `--strict`; else warn on stdout (`log.warn`). NOT gated on `isNewChange`. Wire the call in gate.ts near :181-184, threading the same `isNewChange` (unused by this check) / `strict`. **ATOMIC with IP-6.** | backend-engineer |
| IP-6 | `.claude/settings.json`, `.claude/hooks/` | Arm the two write-block hooks with the real installer (`node dist/cli/index.js install-agent-hooks --design-write --acceptance-write`), then `git add .claude/settings.json .claude/hooks/`. Leave the existing graph-first/test-runner entries as-is. **ATOMIC with IP-5.** See Contradiction 1: the check is directory-agnostic and requires only that the registered script path be git-tracked. Do NOT hand-author the entries — doing so hides that the installer's own output must pass. | backend-engineer |
| IP-7 | `src/utils/design-hash.ts`, `src/schemas/design-lock.schema.ts` | Extend `DesignLockEntry` (:56-59, today `{ hash, 'locked-at'? }`) with `git-author`, `tty`, `timestamp`; have `writeDesignLock` (:95-101) record them (git author via `git config user.name`/`user.email`; `tty` via `process.stdin.isTTY`; timestamp = the existing ISO stamp). Add the three properties to `designLockEntrySchema` (`additionalProperties: false` requires explicit addition). These are audit CLUES only — no gate reads or verifies them; "clue, never a verdict". `design.ts:52` confirm call site is unchanged. | backend-engineer |
| IP-8 | `docs/adr/0012-interaction-design-loop.md` §5 | Transcribe the four-bullet §5 amendment already drafted in `design.md` `## Draft: ADR 0012 §5 amendment` (checked presence not assumed; path/state-keyed hook not a global toggle; honest non-airtight scope; non-vacuous derivation chain). Fill the `[settled fork: …]` placeholder with the human's Decision 1 = write-target axis (lock blocked, body allowed). Transcription only — spec-architect owns the wording; do not invent new design. | backend-engineer (spec-architect review) |
| IP-9 | build | After IP-1..IP-8: `npm run build` (tsc → `dist/`) so CLI tests exercise `dist/`; `node build.js` to regenerate `assets/hooks` from `hooks/`. Run the CLI as `node dist/cli/index.js`, never the stale global `cdd-kit`. | backend-engineer |
| IP-10 | dogfood confirm (`.cdd/design-lock.json`) | **HUMAN ONLY — BLOCKED.** Run `cdd-kit design confirm enforce-human-confirmation` to produce `.cdd/design-lock.json` (AC-6). Only after IP-1+IP-2 land so `reconcileProvenance` resolves the `ci-gate:` citations. No agent may run this or write the lock by any means. | human |
| IP-11 | `acceptance.yml` (if wanted) | **HUMAN ONLY — BLOCKED.** If the oracle should pin the two business-language guarantees (distinct not-found/not-registered messages; gate never claims a baseline is human-made), the human authors `acceptance.yml`. Candidate cases listed under Known Risks. No agent may write it. | human |

## Source Artifact Pointers

| source | relevant pointer | used for |
|---|---|---|
| test-plan.md | `## Mutation Matrix` (T1a-e, T3a-d, T4a-h, T6a-h) | the mutation that proves each test discriminates |
| test-plan.md | `## Test Update Contract` | which existing tests to DELETE vs UPDATE (IP-3, IP-4) |
| test-plan.md | `## Notes` "CI-env trap" | warn-path tests pass `env:{CI:''}`; error-path `env:{CI:'true'}` (hazard C) |
| ci-gates.md | `## Sequencing` | the atomic settings.json/arming landing order (hazard A) |
| ci-gates.md | `## Can this check actually fail?` item 1 | the residual skipped-step gap (hazard B) |
| change-classification.md | AC-1..AC-8, DAC-1 | acceptance mapping and the forbidden claim |
| interaction-design.md | `## Confirmed` Decision 1/2/3 | the three binding human decisions the code must honour |
| contracts/ci/ci-gate-contract.md | `### enforceConfirmationHookInstallation` (:189-255) | check message text, `ci-or-strict`, tracked-path requirement |
| contracts/ci/ci-gate-contract.md | `### Sixth citation form` (:308-378) + sectionBody defects (:330-378) | IP-1/IP-2 exact semantics |
| contracts/ci/ci-gate-contract.md | `### Write-block hook discrimination axis` (:257-289) | IP-4 path-keyed behaviour; IP-7 provenance-is-a-clue |
| contracts/env/env-contract.md | `CI` row (:15) + `## Deprecated: the *_WRITE_STRICT toggle` | IP-5 CI truthiness; IP-4 toggle retirement |
| design.md | `## Key Decisions`, `## Draft: ADR 0012 §5 amendment` | IP-3 placement; IP-8 transcription |

## File-Level Plan

| path or glob | action | notes |
|---|---|---|
| `src/utils/markdown-section.ts` | edit | IP-1: level-aware terminator + line-anchored opening in `sectionBody` (:22-28). |
| `src/utils/design-provenance.ts` | edit | IP-2: sixth `ci-gate:` citation branch + heading→line resolver; before the endpoint match in `resolveCitation` (:452-474). |
| `src/commands/gate-design.ts` | edit | IP-3: AC-1 row check after :341; possibly IP-5 check body. Reuse `infoItems`/`states` from :340-341. |
| `src/commands/gate-shared.ts` | edit (optional) | IP-5: `enforceConfirmationHookInstallation` may live here if shared with acceptance; otherwise gate-design.ts. |
| `src/commands/gate.ts` | edit | IP-5: dispatch the new check near :181-184; thread `strict` (and the `CI` read). |
| `hooks/pre-tool-use-design-write.sh` | edit | IP-4: path-keyed axis, drop `CDD_DESIGN_WRITE_STRICT`. |
| `hooks/pre-tool-use-acceptance-write.sh` | edit | IP-4: parity path-keyed axis, drop `CDD_ACCEPTANCE_WRITE_STRICT`. |
| `.claude/settings.json` | create-tracked/edit | IP-6: git-track + two write-block entries at repo-root `hooks/…`. ATOMIC with gate.ts/IP-5. |
| `src/utils/design-hash.ts` | edit | IP-7: `DesignLockEntry` + `writeDesignLock` provenance fields. |
| `src/schemas/design-lock.schema.ts` | edit | IP-7: add `git-author`/`tty`/`timestamp` to `designLockEntrySchema`. |
| `docs/adr/0012-interaction-design-loop.md` | edit | IP-8: transcribe §5 amendment. |
| `test/utils/design-provenance.test.ts` | edit/add | T6a-h. |
| `test/cli/gate-design.test.ts` | edit/add | T1a-e; fixture update (Test Update Contract). |
| `test/cli/design-write-hook.test.ts` | edit + DELETE cases | T3a-b; DELETE the two `CDD_DESIGN_WRITE_STRICT` toggle cases. |
| `test/cli/acceptance-write-hook.test.ts` | edit + DELETE cases | T3c-d; DELETE the toggle-based body-block cases. |
| `test/cli/gate.test.ts` | add | T4a-f, T4h (CI-env trap applies). |
| `test/cli/design-confirm.test.ts` | add | T4g provenance fields. |
| `test/utils/design-hash.test.ts` | add | AC-4 unit (provenance shape). |
| `assets/**` | generated | via `node build.js`; NEVER hand-edit. |
| `dist/**` | generated | via `npm run build`; CLI tests run against `dist/`. |

## Contract Updates

All contract files are already written and landed by the contract phase; source
must conform. No contract authoring is in this plan.

- API: none (`contracts/api/*` is `applicability: not-applicable`).
- CSS/UI: none.
- Env: `contracts/env/env-contract.md` already at 0.4.0 (adds `CI` row; deprecates
  `*_WRITE_STRICT`). IP-4/IP-5 must match it; no further edit.
- Data shape: none — the lock shape is governed by `src/schemas/design-lock.schema.ts`
  (IP-7), not a data contract.
- Business logic: expressed through the CI gate contract + ADR (IP-8).
- CI/CD: `contracts/ci/ci-gate-contract.md` already at 0.7.0. IP-1..IP-7 implement it.
  `contracts/CHANGELOG.md` already updated. **Open item — see Contradiction 2:** the
  contract's `### Write-block hook discrimination axis` "Tamper evidence" paragraph
  (:281-283) states BOTH locks record provenance, but IP-7 / AC-4 / test-plan cover
  only the design lock. Route to contract-reviewer + human before close.

## Test Execution Plan

Required phases (floor): collect, targeted, changed-area. Add `contract` (contracts
affected) and `full` (final/CI). Full ladder in `test-plan.md` `## Test Execution
Ladder`; policy in `references/sdd-tdd-policy.md`. Implementation agents generate
evidence with `cdd-kit test run`; the gate validates `test-evidence.yml`. Every
green test below is worthless until its `test-plan.md` mutation turns it red;
`gate`-family tests assert the STREAM, never the exit code.

| acceptance criterion | test file / command | expected signal |
|---|---|---|
| AC-1 | test/cli/gate-design.test.ts | T1a stderr has `## Presented Information` + `zero rows`; T1b `## States` + `zero rows`; T1c both populated → no `zero rows` any stream; T1d not-applicable+empty → no error; T1e non-strict legacy → stdout, `--strict` → stderr |
| AC-2 | test/cli/gate-design.test.ts | deleting the row-count check turns T1a/T1b red (empty-set no longer vacuously passes) |
| AC-3 | test/cli/design-write-hook.test.ts | T3a lock write → exit 2 + stderr with AND without env; T3b body write → exit 0 either way |
| AC-3 | test/cli/acceptance-write-hook.test.ts | T3c lock → exit 2 + stderr regardless of env; T3d body → exit 0 regardless of env |
| AC-4 | test/cli/gate.test.ts | T4a not-found on stdout when `CI=''`, non-strict; T4b on stderr when `CI='true'`; T4c on stderr under `--strict`; T4d not-registered text ≠ T4b text; T4e both tracked hooks → no finding, `.claude/hooks/…` path fails; T4f legacy dir `CI='true'` → stderr; T4h output never matches /human-made\|human-verified\|authentic/i |
| AC-4 | test/cli/design-confirm.test.ts | T4g parsed lock entry has `git-author`, `tty`, `timestamp` |
| AC-4 | test/utils/design-hash.test.ts | provenance shape unit-asserted |
| AC-5 | test/acceptance/interaction-design-loop.driver.test.ts | resolved Open Decisions + a locked baseline (consequences of the human fork; cannot mechanically prove a human chose it) |
| AC-6 | test/acceptance/interaction-design-loop.driver.test.ts | executed confirm path drives a real lock (the human-produced `.cdd/design-lock.json` is IP-10; qa-reviewer verifies) |
| AC-7 | test/cli/gate-design.test.ts, test/cli/gate.test.ts | T1e legacy dir empty chain warns (not errors) without `--strict`; T4f hook check still errors for a legacy dir in CI |
| AC-8 | test/contracts/ci-workflow.test.ts, test/contracts/interaction-design-template.test.ts | workflow-shape invariants + template stay green |
| sixth citation form (enables AC-6) | test/utils/design-provenance.test.ts | T6a unique → ok; T6b ≥2 → `ambiguous`; T6c 0 → `not found`; T6d parenthetical heading resolves; T6e level-aware terminator; T6f line-anchored opening; T6g normalization+case; T6h real-contract: 16 anchors resolve, `:: the`/`:: AC-4`/`:: AC-7` rejected ambiguous |

## Hazard A — the atomic commit boundary

`enforceConfirmationHookInstallation` is NOT gated on `isNewChange`
(`contracts/ci/ci-gate-contract.md:238-242`). `git ls-files .claude/settings.json`
returns nothing today, so the moment the check lands it errors in CI for every
change directory until the project tracks `.claude/settings.json` with both hooks.

**One atomic commit / PR must contain, together:**

1. IP-5 — the `enforceConfirmationHookInstallation` implementation in `src/`, built
   into `dist/` (IP-9).
2. IP-6 — `.claude/settings.json` git-tracked, registering the design-write AND
   acceptance-write `PreToolUse` hooks, each `command` resolving to a git-tracked
   repo-root path (`hooks/pre-tool-use-design-write.sh` /
   `hooks/pre-tool-use-acceptance-write.sh`), matching `Write`, `Edit`, `MultiEdit`.
   NOT `.claude/hooks/…` (contract :199-205; a bare CI checkout lacks that copy).

IP-4 (the path-keyed hook scripts the arming points to) and IP-9 (the `dist/` build)
must be present in the SAME PR so the referenced scripts exist and the check is real,
not merely declared. This PR is self-protecting: it modifies its own
`specs/changes/enforce-human-confirmation/` dir, so its own `pull_request` CI runs
`cdd-kit gate enforce-human-confirmation` with `CI=true` — it cannot merge itself
unarmed. (`ci-gates.md` `## Sequencing`; AC-7.)

## Hazard B — the skipped-step hole (OPEN; two costed options for the human)

The CI gate step is guarded by `if: steps.changed.outputs.ids != ''`
(`ci-gates.md` `## Can this check actually fail?` item 1). A PR that de-arms
`.claude/settings.json` but touches no `specs/changes/<id>/` directory never runs
`cdd-kit gate`, so `enforceConfirmationHookInstallation` never fires on it. The
contract Gate Inventory row (`ci-gate-contract.md:36`) lists trigger
`pull_request; …`, which is true for a spec-touching PR but overclaims for a
pure-settings/workflow PR — the same shape §22-24 of that contract warns against and
that `[ci 0.4.0]` already had to correct once. This is a human decision; here are
two honest, costed options. **I do not pick.**

**Option (i) — also run the check from `cdd-kit validate`.**
- What changes: factor the hook-presence check so `validate` (which runs
  unconditionally in CI on every event, `ci-gates.md` row `cdd-kit validate`) invokes
  it, in addition to `gate`. No workflow YAML edit needed — `validate` already runs.
- Cost to adopters: BROADER than gate. Every adopter whose CI runs `cdd-kit validate`
  must now arm both write-block hooks or their `validate` step red-lines — even
  adopters who never run `cdd-kit gate`. This widens the "must arm hooks" population
  from "whose CI runs gate" to "whose CI runs validate".
- Test that proves it: a `test/cli/validate*.test.ts` (or extend `gate.test.ts`)
  case: `CI='true'`, settings without the hook → `validate` errors on stderr; a
  mutation removing the check from the validate path turns it red. Requires a new
  test target not currently in the manifest's Required Tests (file a CER if the human
  picks this).

**Option (ii) — leave the hole; correct the trigger cell to tell the truth.**
- What changes: no code. contract-reviewer qualifies the
  `enforceConfirmationHookInstallation` Gate Inventory trigger cell
  (`ci-gate-contract.md:36`) to state the `pull_request` teeth exist only for a PR
  that also changes a `specs/changes/<id>/` directory, matching the honest limit
  already written at `ci-gate-contract.md` §Sequencing consequence and `ci-gates.md`.
- Cost to adopters: none new. The residual gap (a pure settings/workflow PR can
  de-arm without CI catching it) stays open — recorded, not closed. Consistent with
  `change-request.md` `## Non-goals` deferring the standalone check.
- Test that proves it: `test/contracts/ci-workflow.test.ts` already asserts the gate
  step is gated on changed dirs; add/keep an assertion that the contract cell does
  not claim unconditional `pull_request` teeth. No new production code.

**Third option (noted, not strictly better within this change's scope):** a dedicated
standalone CI step running the hook-presence check once per run regardless of changed
dirs. This is the real full closure, but it is a workflow YAML edit and is explicitly
a deferred follow-up (`change-request.md` `## Non-goals`), so it is out of scope here;
mentioned only so the human sees the eventual endgame behind (i)/(ii).

## Hazard C — the `CI` env var trap (must survive task ordering)

`runCli` spreads `process.env`, which includes `CI=true` on the CI runner. A
warn-path test that does not explicitly set `CI` silently tests the error path on a
runner and the warn path locally. Per `test-plan.md` `## Notes` "CI-env trap":
warn-path tests (T4a) MUST pass `env:{CI:''}`; error-path tests (T4b/T4c/T4f) MUST
pass `env:{CI:'true'}`. IP-5's tests are authored with this pinning; do not drop it.

## Handoff Constraints

- Implementation agents must not infer missing requirements from chat history.
- Do not re-copy full design, test strategy, CI policy, or contract prose into this
  plan; follow the source pointers above.
- If this plan omits a required file, behavior, contract, or test, stop and report
  `blocked`.
- Keep implementation within the file-level plan unless a Context Expansion Request
  is approved.
- IP-10 and IP-11 are HUMAN-ONLY and BLOCKED for every agent. No agent may run
  `cdd-kit design confirm` / `cdd-kit accept relock` or write
  `.cdd/design-lock.json` / `.cdd/acceptance-lock.json` / `acceptance.yml` by any
  means (including `node -e`, a shell redirect, or the CLI).
- Nothing produced here may claim a `Bash`-holding agent is prevented from
  self-stamping (DAC-1).

## Known Risks

- **Contradiction 1 (LOUD — affects hazard A). CONFIRMED, and the proposed resolution
  was REJECTED by main Claude. The contract was wrong, not the installer.**

  The finding is real and important: `install-agent-hooks.ts:264` creates
  `<project>/.claude/hooks/` and writes every bundled script there, and `hookRelPath`
  (`:145-147`) registers exactly that path. The first revision of
  `ci-gate-contract.md` demanded repo-root `hooks/…` and forbade `.claude/hooks/…`.
  So `cdd-kit install-agent-hooks --design-write --acceptance-write` produced a
  settings file that failed the very check the installer armed.

  The plan's proposed fix — hand-author the entries and bypass the installer — repairs
  this repository and leaves the defect shipped to every adopter. That is the disease
  this change exists to cure, applied as a cure. Rejected.

  **Measured, not assumed:** `.claude/hooks/` is absent from `.gitignore` (which lists
  only `.claude/settings.local.json` and `.claude/worktrees/`). It is untracked here
  because nobody ran `git add`, not because it may not be tracked. The three script
  copies (`hooks/`, `assets/hooks/`, `.claude/hooks/`) are currently byte-identical.

  **Resolution (`ci-gate 0.7.0`, already landed):** the check is directory-agnostic.
  It requires the registered `command`'s script path to be **git-tracked**
  (`git ls-files -- <path>`), wherever it lives. The installer is left alone. IP-6
  becomes: `git add .claude/settings.json .claude/hooks/`, keeping the installer's own
  output. Test T4e must assert *tracked vs untracked*, not a directory name — a test
  that asserts the directory would re-freeze the bug.
- **Contradiction 2. CONFIRMED. RESOLVED IN FAVOUR OF THE CONTRACT — option (a).**
  `ci-gate-contract.md` "Tamper evidence" says BOTH `.cdd/design-lock.json` AND
  `.cdd/acceptance-lock.json` record git-author / TTY / timestamp. IP-7, AC-4, and
  `test-plan.md` T4g covered only the design lock.

  Option (b) — narrow the contract to design-only — is **rejected on principle**. It
  is lowering a claim to match what happened to get built, which is the move `DAC-1`
  was created two hours earlier to forbid. Both lock sidecars are human-owned
  (ADR 0010 forbids agents authoring `acceptance.yml` at all), both are written by a
  single sanctioned CLI writer, and Decision 1's axis (a) blocks direct writes to
  both. Evidence parity is what the contract already promises and what the mechanism
  should deliver; `acceptance-hash.ts` mirrors `design-hash.ts`, so the cost is small.

  **IP-7 is extended** to `src/utils/acceptance-hash.ts` and
  `src/schemas/acceptance.schema.ts`, and AC-4 now names both sidecars. `test-plan.md`
  needs a T4g-parity case on the acceptance lock; test-strategist to add it.
- **Contradiction 3 (minor; already flagged by test-strategist).**
  `ci-gate-contract.md:383` says `:: the` occurs 18×; `interaction-design.md`
  `## Provenance` says 23×. Both ≥2 so T6h rejects either way, but contract-reviewer
  should reconcile the count.
- **Minor prose drift.** `design.md` `## Migration / Rollback` says the schema change
  moves `contracts/data/` — but the lock shape is governed by
  `src/schemas/design-lock.schema.ts`, not a data contract (`change-classification.md`
  `## Required Contracts` Data shape = none). IP-7 touches the schema, not
  `contracts/data/`. Non-load-bearing; noted.
- **Settings coherence (out of scope).** Once `.claude/settings.json` is tracked, its
  pre-existing graph-first/test-runner entries still reference untracked
  `.claude/hooks/…` scripts, which a fresh clone lacks. The IP-5 check ignores those
  entries, so no CI failure results; flagged so no one "fixes" it inside this change.
- **Acceptance-oracle questions for the human (IP-11, I may not author).** Candidate
  cases if `acceptance.yml` is wanted: (a) a settings file missing the design hook
  yields a "does not register the design-write hook" message distinct from the
  "not found" message; (b) gate output for a recorded baseline never asserts it is
  human-made/human-verified/authentic. Both are business-language guarantees only the
  human may author (ADR 0010).
- **code-map freshness.** `.cdd/code-map.yml` is modified in the working tree
  (git status `M`); line ranges cited here were cross-checked against direct reads of
  each file, so they are current regardless.
