# Archive — enforce-human-confirmation

## Change Summary

Made the ADR 0010 (acceptance-oracle) and ADR 0012 (interaction-design) human-confirmation
guarantees mechanically real instead of announced-but-unenforced. The two write-block
PreToolUse hooks were actually armed, git-tracked, path-canonicalized, and made silent on
permit; a new `enforceConfirmationHookInstallation` gate check surfaces six distinct
hook-absence causes and hard-fails in CI (`ci-or-strict`) with a provider carve-out; the
no-op `design confirm` / `accept relock` re-run was fixed to preserve the recorded
provenance instead of overwriting it. The change is the first real dogfood of the ADR 0012
confirm path, which required adding a sixth (`ci-gate:`) provenance citation form so a
CLI/gate/hook surface could reconcile against `contracts/ci/ci-gate-contract.md` at all.
It carries a human-authored acceptance oracle that main Claude drafted under explicit,
recorded human delegation, with the hash-lock relock performed by the human alone.

## Final Behavior

- An agent `Write`/`Edit`/`MultiEdit` targeting `.cdd/design-lock.json` or
  `.cdd/acceptance-lock.json` is refused (exit 2, stderr naming the file), in every path
  shape a real editor sends (relative, `./`, `//`, `/./`, Windows absolute, case-variant);
  writes to the artifact bodies pass, silently.
- `cdd-kit gate` / `cdd-kit validate` hard-fail in CI (or `--strict`) when a project's
  `.claude/settings.json` does not arm both write-block hooks at a git-tracked path, with
  six distinct messages (absent / untracked-settings / unregistered / dormant-shape /
  untracked-script / git-declined); a non-Claude provider gets one advisory line instead.
- A confirmed interaction-design whose `## Presented Information` or `## States` has zero
  rows fails (AC-1, new); a re-run of `design confirm`/`accept relock` with an unchanged
  hash writes nothing and says so, preserving the original stamp's provenance.
- Prevention against a shell-holding agent is explicitly NOT claimed anywhere (DAC-1):
  tamper evidence (git-author/tty/timestamp) is recorded as a clue, never verified.

## Final Contracts Updated

- `contracts/ci/ci-gate-contract.md`: 0.6.0 → 0.9.0. Added `enforceConfirmationHookInstallation`
  (six causes, ci-or-strict, provider carve-out, honest-limit + not-a-prevention-boundary),
  the sixth `ci-gate:` citation form and the `sectionBody` level-aware fixes, the write-block
  discrimination axis (canonicalization, silence-on-permit, refusal-names-the-file, confirm
  result lines, tamper-not-prevention), and the AC-2 `narrative-not-locked` accepted tradeoff.
- `contracts/env/env-contract.md`: 0.3.0 → 0.4.0. `CDD_*_WRITE_STRICT` deprecated (the path
  axis retired the toggle); `CI` documented as a consumed input.

## Final Tests Added / Updated

- `test/utils/markdown-section.test.ts` (line-anchored, level-aware section body; 8 mutations).
- `test/utils/design-provenance.test.ts` (sixth citation form T6a-h).
- `test/cli/gate-design.test.ts` (AC-1 empty-chain), `test/cli/gate.test.ts` (T4a-h incl.
  git-cannot-answer), `test/cli/install-agent-hooks.test.ts` (path-keyed).
- `test/cli/design-write-hook.test.ts` / `acceptance-write-hook.test.ts`: un-skipped on win32
  (`sh` on PATH, not `/bin/sh`); added path-variant, payload-robustness, and the
  permitted⟺unreachable equivalence (T3g).
- `test/acceptance/enforce-human-confirmation.driver.test.ts`: 13 cases + 4 bound rules,
  real hooks via `sh` + real CLI, no mocks, every leaf read from the case. 17/17 on win32.
- `test/contracts/ci-workflow.test.ts`: both workflows invoke the gate, no `continue-on-error`,
  no `doctor`, `--strict` only on push.

## Final CI/CD Gates

- `enforceConfirmationHookInstallation` (NEW, Tier 1, `ci-or-strict`) — inside the existing
  `cdd-kit gate <id>` call and `cdd-kit validate`; real pre-merge teeth on any PR touching a
  spec dir via `CI=true`. Ships required from day one (no informational period).
- `enforceInteractionDesign` AC-1 non-vacuous-rows (NEW condition, `isNewChange || strict`).
- No workflow YAML edit was required: the checks self-arm off the `CI` env var and run inside
  the gate call the workflows already make.

## Production Reality Findings

- **The recurring "guarantees that never happened" class kept surfacing** — including in the
  first cut of this very change: the write-block was announced armed while a Windows absolute
  path reached exit 0; the presence check was first written directory-specific and would have
  failed the kit's own installer; the six-cause check was first bound by a test proving only
  two. Every one was caught by measurement (external review or a mutation), never by reading.
- **Round-3 external review caught an oracle-independence failure by the author (main Claude):**
  three `expect` leaves were read off the running system, not derived from a source. Fixed by
  promoting the properties into the contract; QA (qa-reviewer) then re-verified APPROVED with
  its own independent mutation and a gate-tamper check confirming the hash-lock is live.
- **Tooling bugs found during close:** (1) `cdd-kit test run --command "npx vitest …"` hangs to
  the 300s timeout without a TTY and records the timeout as `status: failed` — a false failure
  the gate would enforce; use `node node_modules/vitest/vitest.mjs`. (2) The `install-hooks`
  pre-commit gates via the global `cdd-kit` (here a stale 2.2.1 that predates the applicability
  marker and false-fails the not-applicable api-contract); repointed the local hook to
  `node dist/cli/index.js`, matching the CI workflow's deliberate choice.

## Lessons Promoted to Standards

Gated by `contract-reviewer` (evidence-checked, both approved as ≤1-line guidance; candidate 3
rejected). Product-behavior lessons were already promoted into `contracts/ci/ci-gate-contract.md`
(0.9.0) during the change itself; only the two cross-cutting methodology rules remained:

1. **Oracle/answer-key independence** → `CLAUDE.md` Promoted Learnings (managed region).
   Every `expect` leaf must trace to a human `## Confirmed` decision or a contract, never to
   observed implementation behavior. Evidence: `agent-log/main-claude-oracle.yml`
   round-3-external-review; `agent-log/qa-reviewer.yml` oracle-independence check.
2. **Mutation discipline / stream-not-exit-code** → `CLAUDE.md` Promoted Learnings.
   A green test proves nothing until a mutation reddens a case; assert the stream, not the exit
   code. Evidence: `agent-log/main-claude-oracle.yml` fresh-mutation-proof + my-own-errors.

Rejected (candidate 3, "gate against your own build"): NOT promoted — `install-agent-hooks`
still generates the global-`cdd-kit` pre-commit form, so a guidance line would be contradicted
by the shipped default. Filed as follow-up (below) instead of promoted as a false standing rule.

## Follow-up Work

- Standalone hook-presence CI step independent of the changed-dir diff (a settings-only/
  workflow-only PR that de-arms `.claude/settings.json` skips the gate step today).
- Fix `cdd-kit install-hooks` to generate a pre-commit that prefers `node dist/cli/index.js`
  (this change fixed only the local `.git/hooks/pre-commit`, which is untracked).
- Fix `cdd-kit test run` to record a wrapper timeout as its own status, not `failed`.
- Publish backlog: global `cdd-kit` is 2.2.1; `package.json` is 3.11.0; npm latest is 3.6.0.
- `contracts/api/api-contract.md` carries `applicability: not-applicable` but its body now
  looks filled — the stale-mark advisory (AC-7) should be reconciled.
- `github-workflows/` ↔ `.github/workflows/` full structural drift checking (declared a
  non-goal here; only gate-relevant invariants are synced by `ci-workflow.test.ts`).

## Cold Data Warning

This archive is historical evidence. Current requirements live in `contracts/` and active
project guidance (`CLAUDE.md`). Do not treat anything here as a current requirement.
