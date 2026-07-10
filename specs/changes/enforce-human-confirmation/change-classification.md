# Change Classification

## Change Types
- primary: business-logic-change (gate/hook enforcement of the human-confirmation guarantee), ci-cd-change (CI gate contract + gate behavior)
- secondary: refactor (hook configuration model), security-hardening (agent self-stamping via `Bash`)

Lane promotion note: the source framing is "an external review found three
defects", but `change-request.md` declares this an amendment to ADR 0012 §5 and
the fix requires a contract change (`contracts/ci/ci-gate-contract.md`) plus an
ADR amendment. A bug-fix that requires a contract change is no longer a bug-fix.

## Lane
- feature

## Risk Level
- high

## Impact Radius
- system-wide

The change alters the shared gate-enforcement mechanism (`enforceInteractionDesign`,
`enforceAcceptanceOracle`), both PreToolUse write-block hooks, and the tool-grant
surface of twelve `Bash`-holding agents. Every future change flows through these
gates and hooks. A regression here silently re-opens the loophole this change
exists to close.

## Tier
- 1

## Architecture Review Required
- yes
- reason: Amends ADR 0012 §5 (write-block hook mechanism) and touches the ADR 0010
  acceptance-oracle boundary. Defects 2 and 3 are a genuine design fork (forbid
  direct lock writes / sanctioned CLI writer-patcher / lock-state-keyed hook) that
  only the human may settle, and the resolution must be recorded in
  `interaction-design.md` `## Open Decisions`. A module-boundary change across the
  hook, CLI, and gate layers plus an operational-risk decision requires
  `spec-architect` to write `design.md` and author the ADR amendment before
  `implementation-planner` runs.

## Required Artifacts
Always required: change-request.md, change-classification.md, implementation-plan.md, test-plan.md, ci-gates.md, tasks.yml, context-manifest.md

Additionally MANDATORY for this change: `interaction-design.md` with real content,
plus an executed `cdd-kit design confirm` producing `.cdd/design-lock.json`.
`applicability: not-applicable` (ADR 0011) is forbidden here — see
`change-request.md` `## Constraints`. This is the first real dogfood of the
ADR 0012 confirm path, which has never executed outside unit tests.

## Optional Artifacts (default: no — set yes only with explicit reason)
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | The three defects ARE the current behavior and are documented exhaustively in `change-request.md`. |
| proposal.md | no | The defect-2/3 fork is routed to `interaction-design.md` `## Open Decisions` by the change-request Constraints; `design.md` + the ADR carry rationale. A separate proposal.md would duplicate the fork. |
| spec.md | no | No user-facing product spec; behavior is captured in design.md + interaction-design.md. |
| design.md | yes | Architecture Review Required = yes; the ADR 0012 §5 amendment and the module-boundary decision must be recorded before implementation. |
| qa-report.md | yes | High-risk core-guarantee change. Durable prose evidence needed for the mutation-proof verification and any approved-with-risk sign-off. |
| regression-report.md | yes | Constraint: the defect-1 fix must not newly break existing change directories. Durable evidence that the `isNewChange \|\| strict` migration window holds. |
| visual-review-report.md | no | No UI/visual surface. |
| monkey-test-report.md | no | Not a fuzzable interactive surface. |
| stress-soak-report.md | no | No high-load or long-running path. |

Artifact minimization:
- Prefer optional `agent-log/*.yml` pointers for routine review evidence.
- Later artifacts reference earlier artifacts by path/section/id instead of duplicating content.

## Required Contracts
- API: none (`contracts/api/*` is `applicability: not-applicable` for cdd-kit; no HTTP surface)
- CSS/UI: none (not-applicable; no UI surface)
- Env: none — but see Clarifications: if the chosen fork retires or redefines
  `CDD_DESIGN_WRITE_STRICT` / `CDD_ACCEPTANCE_WRITE_STRICT`, the env contract
  (`contracts/env/`, currently `env 0.2.0`) becomes required. `spec-architect`
  must resolve this.
- Data shape: none (`.cdd/design-lock.json`'s shape is governed by `src/schemas/design-lock.schema.ts`, not a data contract)
- Business logic: none as a contract file; the behavior change is expressed through the CI gate contract and the ADR
- CI/CD: `contracts/ci/ci-gate-contract.md` — must document the non-vacuous
  derivation-chain requirement, the sanctioned design-write configuration, and
  the self-stamp prevention. `contracts/CHANGELOG.md` updated.

## Required Tests
- unit: `enforceInteractionDesign` non-empty-rows enforcement (`test/cli/gate-design.test.ts`, `test/utils/design-provenance.test.ts`); acceptance-gate parity (`test/cli/gate-acceptance-rules.test.ts`, `test/cli/acceptance-oracle.test.ts`). Every new check must be proven by a mutation that turns the test red, asserting the STREAM (`log.warn` → stdout, `log.error` → stderr), never the exit code alone.
- contract: `test/contracts/ci-workflow.test.ts`, `test/contracts/interaction-design-template.test.ts`, `test/contracts/applicability-agreement.test.ts`
- integration: `test/cli/design-write-hook.test.ts`, `test/cli/acceptance-write-hook.test.ts`, `test/cli/design-confirm.test.ts`, `test/cli/accept-relock.test.ts`, `test/cli/gate.test.ts`
- E2E: acceptance drivers `test/acceptance/interaction-design-loop.driver.test.ts`, `test/acceptance/acceptance-oracle.driver.test.ts` (executed, not mocked)
- visual: none
- data-boundary: none
- resilience: none
- fuzz/monkey: none
- stress: none
- soak: none

## Required Agents
- spec-architect — writes `design.md`, authors the ADR 0012 §5 amendment, frames the defect-2/3 fork for the human decision in `interaction-design.md` `## Open Decisions`
- test-strategist — designs the mutation-proof discrimination for each new check and the acceptance-criterion → test mapping
- ci-cd-gatekeeper — writes `ci-gates.md`; verifies each new check runs on a path that can actually fail
- implementation-planner — turns the settled fork + contracts + tests into the execution packet
- backend-engineer — implements the TypeScript gate/CLI changes and the shell hook changes
- contract-reviewer — reviews `contracts/ci/ci-gate-contract.md` and CHANGELOG drift
- dependency-security-reviewer — reviews the self-stamping / privilege-boundary hardening (Bash-holding agents vs. lock writes)
- qa-reviewer — release readiness; verifies the real dogfood (`.cdd/design-lock.json` produced by an executed `cdd-kit design confirm`)

## Inferred Acceptance Criteria
- AC-1: Under the `isNewChange || strict` window, `enforceInteractionDesign` emits a gate ERROR (stderr) when a confirmed `interaction-design.md` has zero rows in `## Presented Information` or zero rows in `## States`, unless the surface is marked `applicability: not-applicable`.
- AC-2: Empty-set provenance reconciliation no longer passes vacuously — a mutation that deletes all Presented-Information / States rows turns a gate test red, stream-asserted rather than exit-code-asserted.
- AC-3: A single documented, working design-write hook configuration exists that permits main Claude's sanctioned first-time write and its transcription of the human's answers, while refusing any `Write`/`Edit`/`MultiEdit` whose target is `.cdd/design-lock.json` or `.cdd/acceptance-lock.json`. Both degenerate configurations (`STRICT=1` blocks everyone; `STRICT=0` blocks nobody) are eliminated and the `CDD_*_WRITE_STRICT` toggles are retired. A mutation proves the test discriminates, stream-asserted.
- AC-4: `enforceConfirmationHookInstallation` detects and reports the ABSENCE of the design/acceptance write-block hooks from the project `.claude/settings.json`, distinguishing "no settings file" from "settings file that does not register this hook" with different message text; it fails on stderr whenever the gate runs in CI or under `--strict`, and warns on stdout otherwise. `.cdd/design-lock.json` records git-author / TTY / timestamp as after-the-fact audit clues. No test, message, or document asserts that a `Bash`-holding agent is prevented from self-stamping.
- AC-5: The defect-2/3 resolution is recorded as a human-settled fork in this change's `interaction-design.md` `## Open Decisions`, decided neither in chat nor by an agent.
- AC-6: This change ships a real, non-empty `interaction-design.md` and an executed `cdd-kit design confirm` that produces `.cdd/design-lock.json` — the first real confirm-path dogfood. `applicability: not-applicable` is not used.
- AC-7: Existing change directories continue to pass `cdd-kit gate`; the AC-1 requirement introduces no new failures for pre-existing changes. Note the deliberate exception: AC-4's hook-presence check is a property of the PROJECT, not of a change directory's vintage, so it is NOT bounded by the `isNewChange` window and WILL fail every change directory in CI until this change tracks `.claude/settings.json` and registers both hooks. Those two edits must land in the same commit as the check, or CI red-lines on changes that did nothing wrong.
- AC-8: `contracts/ci/ci-gate-contract.md`, `contracts/CHANGELOG.md`, and ADR 0012 §5 describe the new mechanism; contract and CI-workflow tests are green.

## Deferred Acceptance Criteria

Recorded, not satisfied, and deliberately not claimed. Listed here so the goal
survives the downgrade instead of vanishing from the record.

- DAC-1 — *"An agent holding `Bash` cannot self-stamp the baseline via `cdd-kit design confirm` / `cdd-kit accept relock`; the attempt is blocked."*
  This was AC-4 as originally inferred. It is **unsatisfiable on the target machine**
  and was downgraded on 2026-07-10 by the human's `interaction-design.md` Decision 1,
  which accepts the residual risk explicitly. The blocker is not effort: a
  `Bash`-holding agent runs as the human, on the human's filesystem, with the
  human's git identity, so every in-process defence (hook matcher, CLI split, env
  token, TTY check) is bypassable by `node -e` straight into the lock writer.
  Closing DAC-1 requires a signature the agent's sandbox cannot produce — a hardware
  key, or a lock committed under an authenticated remote identity — i.e. a new trust
  boundary, which needs its own ADR.
  **Why this is written down:** an acceptance criterion silently lowered to match
  what was built is indistinguishable, later, from an acceptance criterion that was
  always modest. The downgrade is the record.
  **Guard:** any future PR that claims DAC-1 is met must exhibit a test in which a
  real `Bash` invocation of `design confirm` fails. A test that blocks the `Write`
  tool and calls it "Bash blocked" is the vacuous shape this change exists to end.

## Tasks Not Applicable
- not-applicable: 2.1, 2.2, 2.3, 2.4, 2.5, 3.4, 3.5, 4.2, 5.1, 5.2

Retained deliberately: `1.3` (Architecture Review Required = yes), `2.6` (CI/CD
contract), `3.3` (the two acceptance drivers are the E2E family here), `4.3`
(hook installer / agent tool-grant surface counts as deploy-side config).

## Clarifications or Assumptions
- `interaction-design.md` is a mandatory required artifact for this change even
  though the repository has no UI. The "interaction" is the CLI / hook / gate
  surface that a human and an agent both act on.
- The "proposal" the user asked for is realized through `design.md` + the ADR
  amendment + `interaction-design.md` `## Open Decisions`, not a separate
  `proposal.md`.
- Tier 1, not 0: high risk and system-wide, but internal tooling with no external
  runtime or production-data blast radius. Classifying upward would be acceptable.
- Atomic-split check: NOT triggered. The three defects are one coherent risk
  surface with a shared rollback risk and a single ADR amendment. Splitting would
  fragment the fork decision that `change-request.md` requires be settled together.
- Env contract: whether `CDD_DESIGN_WRITE_STRICT` survives the chosen fork is
  itself part of the fork. `spec-architect` must state, in `design.md`, whether
  `contracts/env/` needs a schema-version bump. If it does, task 2.3 flips back
  from `skipped` to `pending`.
- Every new check must run on a path that can fail, and be proven to discriminate
  by mutation before it is trusted. `assets/**` is generated — edit `.claude/**`
  then run `node build.js`. `src/` changes need a build to `dist/` before CLI tests.
  The global `cdd-kit` binary is stale at 2.2.1; always invoke
  `node dist/cli/index.js`.

## Context Manifest Draft

Copied verbatim into `context-manifest.md`.
