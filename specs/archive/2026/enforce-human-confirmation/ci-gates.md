# CI/CD Gate Review

## Change ID

enforce-human-confirmation

Gate-policy authority for this change only. Test strategy lives in
`test-plan.md` and `change-classification.md` `## Inferred Acceptance Criteria`
(AC-1..AC-8, DAC-1); this file references those ids and the contract condition
ids, it does not restate them. Gate semantics are governed by
`contracts/ci/ci-gate-contract.md` (schema-version 0.7.0) and
`contracts/env/env-contract.md` (0.4.0).

Every mechanism claim below is marked `[read]` (I read the file) or `[ran]`
(I executed it). Claims I could not verify from my read scope are marked
`[contract-asserted, not independently read]`.

## Required Gates for This Change

The unit of enforcement in CI is a single step — `cdd-kit gate (changed specs)`
— that runs `node dist/cli/index.js gate "$id"` for each changed
`specs/changes/<id>/` directory. The rows below are the *checks inside that gate
call* that this change adds or depends on, plus the workflow-level jobs that
carry them. The `can fail before merge?` column is the one that matters: it names
the concrete trigger in which a real defect turns CI red **before** a merge, or
says plainly that it cannot.

| gate / check | tier | required | trigger context(s) | command / workflow | failure stream | can fail before merge? | owner | artifact it reads |
|---|---:|---|---|---|---|---|---|---|
| `enforceConfirmationHookInstallation` (NEW) | 1 | `ci-or-strict` | pull_request (via `CI` env); push-to-default (`--strict` + `CI`); local (`cdd-kit gate`) | `cdd-kit gate <id>` inside `contract-and-fast-tests` | stderr (`log.error`) in CI/strict; stdout (`log.warn`) locally | **YES, conditionally** — on any `pull_request` that changes a `specs/changes/<id>/` dir, `CI=true` makes it error → job red → PR blocked. **Cannot fire on a PR that touches no spec dir** (gate step is skipped); see § "Can this check actually fail?" | platform-team | `.claude/settings.json` (git-tracked) |
| `enforceInteractionDesign` AC-1 (non-vacuous rows, NEW condition) | 1 | `yes` | pull_request; push-to-default (`--strict`); local | `cdd-kit gate <id>` | stderr under `isNewChange \|\| strict`; stdout (warn) for legacy dirs | **YES for a new/context-governed change** — `isNewChange=true` errors on `pull_request` without needing `--strict`. **Detection-only pre-merge for a legacy dir** (warned until the post-merge `push --strict`) | platform-team | `specs/changes/<id>/interaction-design.md`, `.cdd/design-lock.json` |
| `enforceInteractionDesign` (existing conditions 1,3-9: presence, confirm baseline, provenance, tamper) | 1 | `yes` | pull_request; push-to-default (`--strict`); local | `cdd-kit gate <id>` | stderr under `isNewChange \|\| strict`; else warn | YES for this (context-governed) change on `pull_request` | platform-team | `interaction-design.md`, `.cdd/design-lock.json` |
| `enforceAcceptanceOracle` (parity — unchanged by this change) | 1 | `yes` | pull_request; local | `cdd-kit gate <id>` | stderr under `isNewChange \|\| strict`; else warn | YES for a new change on `pull_request` | platform-team | `acceptance.yml`, `.cdd/acceptance-lock.json`, `test-evidence.yml` |
| `cdd-kit validate` (contracts + env + ci) | 0/1 | `yes` | pull_request; push; local; run inside `gate` too | `node dist/cli/index.js validate` step, and re-run at end of `gate` | stderr / non-zero exit | YES — runs unconditionally on every `pull_request` | platform-team | `contracts/**`, incl. `contracts/ci/ci-gate-contract.md`, `contracts/env/env-contract.md` |
| `test/contracts/ci-workflow.test.ts` (workflow-shape invariants) | 1 | `yes` | pull_request; push; local (`npm test`) | `npm test` step | non-zero exit | YES — a workflow edit that drops the gate step, adds `continue-on-error`, adds `doctor`, or moves `--strict` off push-only turns it red on `pull_request` | platform-team | both workflow YAMLs |
| Write-block hook discrimination (design + acceptance) | n/a (PreToolUse hook, not a CI gate) | n/a | agent tool-call time, local only | `hooks/pre-tool-use-{design,acceptance}-write.sh` | hook exit 2 → stderr | **NO — not a CI gate.** Detection/prevention at author time only; explicitly NOT a merge gate and NOT a wall against `Bash` (DAC-1) | platform-team | agent Write/Edit/MultiEdit payload target path |

Tier mapping: all three `cdd-kit gate` checks are **Tier 1 (PR required gate)** per
the contract inventory. In a default *local* run `enforceConfirmationHookInstallation`
degrades to an advisory warning (Tier-0-like), but its binding classification is
Tier 1 / `ci-or-strict`.

## Can this check actually fail? (the anti-vacuous audit)

This repository has shipped four checks whose promised trigger never fired. Each
new/relevant check is stated here against that history.

1. **`enforceConfirmationHookInstallation` — real pre-merge teeth, with one honest
   gap.** `[read]` I read both workflows. The `cdd-kit gate (changed specs)` step
   runs on `pull_request` (`.github/workflows/contract-driven-gates.yml:97-117`,
   `github-workflows/contract-driven-gates.yml:81-101`) with **no**
   `continue-on-error`, so a failing gate fails the job. `[read]` I read
   `contracts/env/env-contract.md:15` and `contracts/ci/ci-gate-contract.md:221-236`:
   the check keys on the `CI` env var (truthy = set, non-empty, not `0`/`false`),
   which GitHub Actions sets to `true` unconditionally — so on `pull_request` the
   check hard-fails on stderr **without** needing `--strict`. This is the mechanism
   that the removed `strict-only` classification lacked, and it is why the amendment
   was needed. **Not implemented yet:** `[ran]` `git grep enforceConfirmationHookInstallation -- src/` and
   `git grep 'process.env.CI' -- src/` both return **nothing**. The check does not
   exist in `src/` today; this plan governs the check backend-engineer will add. It
   is a *planned* gate, and this document says so rather than announcing it as real.
   **The gap:** the gate step is guarded by `if: steps.changed.outputs.ids != ''`.
   A PR that de-arms `.claude/settings.json` but changes **no** `specs/changes/<id>/`
   directory skips the step entirely, so the check never runs on that PR. The check
   therefore has pre-merge teeth **only for PRs that also touch a change directory**
   — which is every normal CDD change, but not a pure settings/workflow PR. This is a
   residual gap, recorded, not dressed up. Closing it (a standalone hook-presence CI
   step independent of the changed-dir diff) is a follow-up, not in this change.

2. **`enforceInteractionDesign` AC-1 (empty derivation chain) — real teeth for the
   changes it targets.** `[read]` Bounded by `isNewChange || strict`
   (`contracts/ci/ci-gate-contract.md:142-149`; dispatch confirmed at
   `src/commands/gate.ts:184` threading `isNewChange` computed at `:94`). A
   context-governed change (`tasks.yml` `context-governance: v1`) has
   `isNewChange=true`, so AC-1 errors on `pull_request` with no `--strict` required
   — genuine pre-merge failure. **Detection-only for a *legacy* change directory:**
   such a dir is warned (stdout) until the post-merge `push --strict` run, so a
   legacy dir's empty chain does not block its own PR. That is by design (the
   migration window) and is stated so nobody mistakes the warn path for a gate.

3. **`test/contracts/ci-workflow.test.ts` — real teeth via `npm test`.** `[read]`
   Runs in the `npm test` step on every `pull_request`. `[read]` It asserts, for
   BOTH workflow files, the gate step exists, is gated on changed dirs, applies
   `--strict` only on `push`, has no `continue-on-error`, and never calls `doctor`.
   A regression in either file turns it red before merge.

4. **Whether a red job actually blocks merge is a branch-protection setting, not a
   file I can see.** `[read]` The job id is `contract-and-fast-tests` and it declares
   no separate `name:`, so GitHub exposes the required-status-check under the id
   `contract-and-fast-tests`. Branch protection on `main`/`master` must bind the
   required check to that exact name, or every failure above is informational
   regardless of the stream it wrote to. I cannot verify branch-protection config
   from the repo; merge-eligibility below is stated conditional on it.

## Workflow Changes Applied

**None. No workflow YAML edit is required for this change, and I verified why.**

- `[read]` `enforceConfirmationHookInstallation` self-arms off the `CI` env var
  (`contracts/env/env-contract.md:20-27` records that this was the deliberate design
  choice over an explicit `--require-hooks` flag, precisely because a flag "is a
  guarantee that has to be remembered — this repository has shipped four such
  guarantees that were never wired up"). GitHub Actions sets `CI=true`
  unconditionally, so no step, flag, or env block needs adding to either workflow.
- `[read]` Both workflows **already** invoke `node dist/cli/index.js gate "$id"` /
  `cdd-kit gate "$id"` per changed spec dir, on `pull_request` and `push`
  (`.github/workflows/…:97-117`, `github-workflows/…:81-101`). The new check runs
  inside that existing call. Nothing to add.
- `[read]` The `--strict`-only-on-`push` conditional
  (`.github/workflows/contract-driven-gates.yml:105-111`; `[ran]`
  `git grep STRICT_FLAG` confirms lines 105/110/115) is **correct as-is** for this
  change and must not be widened to `pull_request`: the amended Decision 2
  deliberately does NOT key the hook check on `--strict`, so no strict change is
  needed or wanted.
- No `Makefile` gate target applies (this repo has no Makefile gate layer; gates run
  through `node dist/cli/index.js`).

The workflow files are therefore left byte-for-byte unchanged by this gate review.
The single remaining wiring obligation is not a workflow edit — it is arming
`.claude/settings.json` (see § Sequencing), which is backend-engineer's task, not a
CI-file change and outside this reviewer's write scope.

## Sequencing (the settings.json / hook-arming hazard)

`enforceConfirmationHookInstallation` is **not** gated on `isNewChange`
(`contracts/ci/ci-gate-contract.md:238-242`) — it is a property of the project, not
of a change directory's vintage. Consequence, stated because it bites:

- `[ran]` `git ls-files .claude/settings.json` returns **nothing** — the file is
  untracked today. `[ran]` `git log --all -- .cdd/design-lock.json` returns
  **nothing** — the confirm path has never run here.
- The moment the check lands, every `cdd-kit gate <id>` that runs in CI evaluates it.
  Until `.claude/settings.json` is **git-tracked** and registers **both** write-block
  hooks, that check errors in CI.

**Required landing order — one atomic commit / PR:**

1. The `enforceConfirmationHookInstallation` implementation (in `src/`, built to
   `dist/`), AND
2. `.claude/settings.json` git-tracked, registering the `design`-write and
   `acceptance`-write PreToolUse hooks, each `command` resolving to a **git-tracked
   repo-root path** (`hooks/pre-tool-use-design-write.sh` /
   `hooks/pre-tool-use-acceptance-write.sh`), matching `Write`, `Edit`, and
   `MultiEdit`. **Not** a path under `.claude/hooks/` — the contract
   (`ci-gate-contract.md:199-205`) forbids that because a bare CI checkout does not
   contain the install-time `.claude/hooks/` copy, which would make the check's
   premise false in the environment where it is strictest.

must land **together**. This is AC-7's recorded consequence.

- Self-protecting for *this* PR: because this change modifies its own
  `specs/changes/enforce-human-confirmation/` directory, its `pull_request` CI runs
  `cdd-kit gate enforce-human-confirmation` with `CI=true`. If the arming is missing
  from the same PR, this PR's own CI red-lines — the check cannot merge itself
  unarmed. Good.
- Steady state after landing: any later PR touching a *different* spec dir runs
  `cdd-kit gate <that-id>`; the check passes as long as `.claude/settings.json`
  stays armed. The arming is a one-time landing cost, not a recurring one.
- Backend-engineer owns the `.claude/settings.json` edit (via `install-agent-hooks`
  default-arming or a tracked settings file); it is application/config, outside this
  reviewer's CI-only write scope. This section is the policy; that task is the
  execution.

## Drift (`github-workflows/` ↔ `.github/workflows/`)

- **Does the adopter template need the same edit?** No — because neither file needs
  an edit at all (§ Workflow Changes Applied). The adopter template
  (`github-workflows/contract-driven-gates.yml`) already runs `cdd-kit gate "$id"`
  per changed spec dir on `pull_request`/`push`, so an adopter's CI arms the new
  check automatically via `CI`. The adopter's own onboarding obligation is the same
  arming hazard: they must git-track their `.claude/settings.json` with both hooks or
  every spec-touching PR red-lines in their CI. That is an adopter-docs note, not a
  template edit.
- **Is drift asserted anywhere?** Partially, and I read exactly what.
  `[read]` `test/contracts/ci-workflow.test.ts:52-81` loops over **both** files and
  asserts the shared invariants stay in sync: no `continue-on-error`, no `doctor`,
  the changed-dirs gate step present, `--strict` applied only on `push`, and
  `fetch-depth: 0`. It then asserts each file's *divergent* install strategy
  separately (adopter pins `contract-driven-delivery@{{cdd-kit-version}}` and calls
  the global `cdd-kit`; this repo builds from source and calls
  `node dist/cli/index.js`, never installing the published package). It does **not**
  assert byte-level or full-structural parity — the adopter template's
  `Repository-specific fast gate` placeholder and the own-workflow's
  `npm ci`/`build`/`typecheck`/`check:mojibake`/`npm test` steps legitimately differ.
- **Bottom line:** the gate-relevant behaviour of the two files is kept in sync by
  that test; general structural drift is **not** guarded and is explicitly out of
  scope (`change-request.md` `## Non-goals`: "`github-workflows/` ↔
  `.github/workflows/` drift checking (separate follow-up)"). Nothing in this change
  widens or narrows that.

## Promotion Policy

- `enforceConfirmationHookInstallation` does **not** go through an informational-first
  period. It ships as a required (`ci-or-strict`) check from day one, consistent with
  `enforceAcceptanceOracle` / `enforceInteractionDesign` (contract
  `## Informational Gate Promotion Policy`): a silently-passable
  human-confirmation-arming check would re-manufacture the exact silent no-op this
  change exists to end. As `ci-cd-gatekeeper` I sign off this required-from-day-one
  status against the general informational-first guidance, because the check's entire
  purpose is to stop a guarantee being announced-but-unarmed; an informational period
  would be that unarmed state by another name.
- Its one honest concession to adopters is built into the classification, not the
  promotion schedule: `ci-or-strict` means a *local, hookless* run is warned, never
  blocked. An adopter whose CI runs the gate must arm the hooks; an adopter running
  hookless outside CI is only warned. That is the permissiveness knob — not a phased
  promotion.
- The reverse/over-fetch advisory stays permanently informational (`doctor`-only) and
  must never be promoted to a CI finding; both workflows are asserted never to invoke
  `doctor` (`ci-workflow.test.ts:61-63`).

## Rollback Policy

- `enforceConfirmationHookInstallation` is additive. Reverting the change removes the
  check and the two arming entries from `.claude/settings.json`. No data migration.
  `.cdd/design-lock.json` / `.cdd/acceptance-lock.json` are regenerable sidecars
  (contract `## Artifact Retention Policy`) — safe to delete on rollback.
- On rollback, `.claude/settings.json` may retain harmless hook entries; they become
  no-ops once the hook scripts / check are gone. No orphaned required check remains as
  long as branch protection is not separately pinned to a check name this change
  introduces (this change introduces no new *job* name — the check lives inside the
  existing `contract-and-fast-tests` job — so branch protection needs no update on
  rollback).
- The existing `enforceInteractionDesign` / `enforceAcceptanceOracle` rollback
  behaviour is unchanged (contract `## Rollback Policy`).

## Artifact Retention

Governed by `contracts/ci/ci-gate-contract.md` `## Artifact Retention Policy`, not
restated here. In one line: `interaction-design.md` and `acceptance.yml` are
first-class, retained indefinitely; `.cdd/design-lock.json`, `.cdd/acceptance-lock.json`,
and `.cdd/asset-manifest.json` are regenerable sidecars with no retention requirement.
CI produces no new uploaded artifact for this change, so no `retention-days` setting is
added.

## Merge Eligibility

**mergeable — conditional on two things this reviewer cannot fully verify.**

The gate design is sound and the pre-merge failure paths are real (not the fifth
detection-only ghost): on this change's own `pull_request`, `CI=true` +
`isNewChange=true` give both the new hook-presence check and AC-1 genuine stderr teeth
that block the PR. But merge eligibility is *blocked until*:

1. The `enforceConfirmationHookInstallation` implementation and the git-tracked,
   both-hooks-armed `.claude/settings.json` land in the **same** commit (§ Sequencing).
   Today `git ls-files .claude/settings.json` is empty, so a merge before that arming
   would either (a) red-line this PR's own CI, or (b) if the check is not yet
   implemented, ship an announced-but-absent guarantee — the precise defect class this
   change closes. Neither is acceptable.
2. Branch protection on the default branch binds the required status check to the job
   `contract-and-fast-tests` (§ "Can this check actually fail?" item 4). Not verifiable
   from repo files; must be confirmed by a repo admin, or every stderr failure above is
   informational.

Informational-risk residue (does not block merge, is recorded): the hook-presence
check has **no** pre-merge teeth on a PR that changes zero spec directories, because
the CI gate step is skipped when the changed-dirs list is empty. Acceptable for this
change (a follow-up owns a diff-independent standalone check); named so it is not
mistaken for full coverage.
