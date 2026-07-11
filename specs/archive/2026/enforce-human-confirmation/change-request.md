# Change Request

## Original Request

An external reviewer (codex) reviewed `78331fe` (v3.10.0) and `fcf1937` (v3.11.0).
The user relayed its findings verbatim and instructed: fix items 1 and 5 directly,
route items 2/3/4 through a proposal (`15直接改/234用提案改`). Items 1 and 5 shipped
in `fcf1937`. This change is the proposal for the remaining three.

The user's own summary of what remains (verbatim, Traditional Chinese):

> **仍然存在但你已標為 deferred 的邏輯洞**
>
> - interaction-design.md 的 derivation chain 仍可空過：沒有 Presented Information /
>   States rows 時，provenance reconciliation 對空集合 vacuous pass。這會削弱 ADR 0012
>   的核心目的。
> - design-write strict 沒有好用的官方流程：strict 會擋 main agent 轉錄人類確認，
>   advisory 又擋不住任何人。需要更細的機制，例如只禁止 .cdd/design-lock.json 直接寫入，
>   或提供 sanctioned CLI writer/patcher。
> - 擁有 Bash 的 agent 仍可跑 cdd-kit design confirm / accept relock。目前防的是直接寫
>   lock 檔，不是透過 CLI 寫 lock。若你真的要「human-only」，這裡還不完整。

Restated as three defects:

1. **Vacuous derivation chain.** `enforceInteractionDesign` never requires
   `## Presented Information` or `## States` to contain rows. Provenance
   reconciliation over an empty set passes trivially, so a confirmed
   `interaction-design.md` can assert nothing at all.
2. **The design-write hook admits no working configuration.**
   `CDD_DESIGN_WRITE_STRICT=1` blocks every `Write`/`Edit`/`MultiEdit` to
   `interaction-design.md`, including the first-time write and the human-answer
   transcription that `cdd-new/SKILL.md` designates main Claude to perform.
   `CDD_DESIGN_WRITE_STRICT=0` (the default) blocks nobody.
3. **The lock can be self-stamped through `Bash`.** Twelve agents hold the `Bash`
   tool. Both write-block hooks match only `Write|Edit|MultiEdit`, so any of them
   can run `cdd-kit design confirm` / `cdd-kit accept relock` and record the
   baseline itself. What is guarded today is direct writes to the lock file, not
   writes to the lock file through the CLI.

## Found during design (in scope; not in the original review)

4. **The three write-block hooks are not installed in this repository at all.**
   `.claude/settings.json` registers only `Read` → graph-first and `Bash` →
   test-runner. `installAgentHooks` arms a write-block hook only on an explicit opt
   (`src/commands/install-agent-hooks.ts:212-215`); the default path installs
   graph-first and nothing else. No gate, validator, or doctor check verifies that
   any hook is installed. ADR 0012 §5 nevertheless asserts, present-tense, that
   `pre-tool-use-design-write.sh` "blocks agent Edit/Write to
   `.cdd/design-lock.json`". It blocks nothing. Defect 2's premise has therefore
   never actually been observed here — it describes what the hook *would* do if
   armed. This subsumes defects 2 and 3: an uninstalled hook is a no-op whatever
   discrimination axis it uses.

5. **ADR 0012's provenance reconciliation is unsatisfiable for this repository,
   and for any adopter without an HTTP API.** `contracts/ci/ci-gate-contract.md`
   lines 153-159 admit exactly two join targets, `contracts/api/api-contract.md`
   and `contracts/data/data-shape-contract.md`. Both carry
   `applicability: not-applicable` for this kit (`api-contract.md:9`,
   `data-shape-contract.md:9`), and lines 171-175 make citing a not-applicable
   family its own HARD failure. So every citation any `interaction-design.md` in
   this repo could write is a hard gate failure, and the only escape is marking the
   whole artifact `not-applicable`. That is why `.cdd/design-lock.json` has never
   existed: the one prior change that could have exercised the confirm path
   (`specs/changes/interaction-design-loop/interaction-design.md:13`) took the
   escape because it was the only route. Resolved by this change's Decision 3.

6. ~~**A multi-line HTML comment in `## Confirmed` satisfies the gate's "human
   confirmed" check.**~~ **RETRACTED — this claim was false.** Main Claude asserted
   it after reading only `meaningfulChars` (`gate-artifacts.ts:53-61`), whose
   `startsWith('<!--')` filter does drop only a comment's first line. But
   `hasConfirmed` reads `sectionBody(body, 'Confirmed')`, and `sectionBody`
   (`markdown-section.ts:24`) calls `stripHtmlComments` first, which removes whole
   multi-line comments before `meaningfulChars` ever sees them. Reproduced against
   the real functions: a multi-line comment yields `mc=0`, `hasConfirmed=false`.
   The `startsWith('<!--')` filter is merely redundant on this path, not a hole.

   Recorded rather than deleted, because the mistake is the exact defect class this
   change exists to close: a claim about a mechanism, asserted from a partial read,
   with no reproduction. It reached a committed spec artifact (`bbe21cf`).

   **What survives, narrowly:** `stripHtmlComments` matches `<!--[\s\S]*?-->`, so an
   *unclosed* comment (no `-->` anywhere after it) is not stripped, and its
   continuation lines then count as content — `hasConfirmed=true` with no human
   answer. That requires malformed markdown, and since `fcf1937` the
   missing-baseline error catches such a change regardless. In scope only as a
   one-line hardening if it costs nothing; not a justification for this change.

## Found during external review of the contract phase (2026-07-10)

Codex reviewed commits `bbe21cf..aeb182a`. Six findings; **all six reproduced, none
were false positives.** Four were falsehoods that a human reviewer caught and no gate
in this repository would ever have caught. Recorded in full, because "the review that
found it" is the only durable evidence of what the mechanism cannot see.

7. **A fabricated record of a human action — the worst defect in this change.** The
   `## Confirmed` section of `interaction-design.md` carried the HTML comment
   "Locked with `cdd-kit design confirm enforce-human-confirmation`, run by the
   human." That never happened. `.cdd/design-lock.json` does not exist on disk and
   `git log --all -- .cdd/design-lock.json` returns **zero commits**: the file has
   never existed in this repository's history. Four lines above it, the same document
   said `cdd-kit design confirm` "should not be run until [Decision 3] lands". Main
   Claude wrote both sentences. The confirm path this change exists to dogfood was
   recorded as executed inside the artifact whose purpose is to prove it executed.

   `stripHtmlComments` runs before hashing, so the false claim never entered the
   hash region — the lie was invisible to the very tamper-evidence built to catch
   lies. Retracted in place, not deleted.

   **Root cause, and the rule it produces.** `## Confirmed` is hashed as though a
   human authored every word of it. Main Claude padded each of the human's three
   one-line answers with a paragraph of its own justification. Three of the false
   claims below originated in that padding, laundered into human provenance. New
   rule, now stated in the artifact: `## Confirmed` holds the human's selection and
   mechanically-checkable consequences. Agent reasoning about the answer goes in
   `design.md`.

8. **AC-3 / AC-4 promised what Decision 1 declined.** The classifier inferred AC-4
   ("an agent holding `Bash` cannot self-stamp the baseline; the attempt is blocked")
   before the human decided; Decision 1 then explicitly accepted that residual risk
   as unpreventable. Left standing, AC-4's only route to green was a test that blocks
   the `Write` tool and calls it "Bash blocked" — the vacuous shape. Resolved by the
   human on 2026-07-10: **downgrade AC-3/AC-4 to what was actually bought, and record
   the retired goal by name** as `DAC-1` in `change-classification.md`, with the
   trust-boundary blocker and a guard against a future vacuous claim. A silently
   lowered acceptance criterion is later indistinguishable from one that was always
   modest.

9. **`strict-only` blocked nothing before merge.** Decision 2's original answer rested
   on the premise that `--strict` "blocks the absence where it counts". It does not.
   The CI job sets `--strict` only on `github.event_name == "push"`
   (`.github/workflows/contract-driven-gates.yml:109`) — after merge — and the local
   pre-commit hook is bypassed by `--no-verify`, which every commit in this change has
   used. `pull_request` warned and merged. Amended by the human on 2026-07-10:
   hook-presence is `ci-or-strict` (`contracts/ci 0.7.0`), erroring whenever `CI` is
   truthy. The amendment, and why it was needed, are recorded inside `## Confirmed`.

10. **A contract contradicted itself across two files.** Decision 2's prose claimed
    the hook check "matches the `isNewChange || strict` migration window", while
    `ci-gate-contract.md` said verbatim "This check is NOT gated on `isNewChange`".
    Both were committed by main Claude, hours apart. Removed. The un-caught corollary
    the review did not name: because the check ignores `isNewChange`, it will fail
    *every* change directory in CI until `.claude/settings.json` is tracked and both
    hooks are registered. Now stated in the contract and in AC-7.

11. **`design.md` said the lock schema was "unchanged by every option".** Decision 1
    requires git-author / TTY / timestamp recorded inside the lock, and
    `DesignLockEntry` is `{ hash, 'locked-at'? }` (`src/utils/design-hash.ts:56-59`).
    The schema does change. Corrected, together with `design.md`'s stale "the fork is
    unresolved by design" note, which the human's Decision 1 had already settled.

12. **The audit intent over-claimed.** `intent-audit-confirmation` said the machinery
    could "tell a genuinely human-made baseline apart from a … self-stamp". It cannot:
    git identity, TTY, and timestamp are forgeable by the same `Bash`-holding agent
    they would incriminate, and the gate does not verify them. Corrected, and bound by
    a new `## Consistency Commitments` entry: *tamper evidence is a clue, never a
    verdict.* Telling a recorded baseline from a silent no-op **is** achievable and is
    checked; telling a human from a self-stamp is not, and must never be worded as
    though it were.

## Business / User Goal

ADR 0010 (acceptance oracle) and ADR 0012 (interaction-design loop) both rest on
one claim: the recorded baseline in `.cdd/acceptance-lock.json` /
`.cdd/design-lock.json` proves a **human** confirmed the artifact. Today that claim
is enforced by convention. Defects 2 and 3 mean an agent can produce the baseline;
defect 1 means the baseline may certify an empty document.

The user is a non-coding solo developer whose entire reason for this kit is to
constrain AI agents. A human-confirmation gate that an agent can satisfy by itself
is worse than no gate: it manufactures confidence. Closing these three is what makes
the guarantee real rather than announced.

## Non-goals

- Gating aesthetics, motion, layout taste, typography, colour, or latency /
  round-trip count. ADR 0012 forbids this permanently; nothing here may weaken that.
- Reverse-direction over-fetch (a contract field cited by zero information items)
  stays corpus-wide, `doctor`-reported, advisory-only.
- Making read-scope governance preventive. It remains post-hoc audit.
- Negation-aware tier-floor scanning (deferred; its failure direction is fail-safe).
- `github-workflows/` ↔ `.github/workflows/` drift checking (separate follow-up).

## Constraints

- **This change must author a real `interaction-design.md` and actually run
  `cdd-kit design confirm`.** `applicability: not-applicable` (ADR 0011) is
  forbidden here. `.cdd/design-lock.json` has never existed: ADR 0012's confirm
  path has never executed outside unit tests, because the only change that could
  have exercised it took the not-applicable escape. This change is the first
  dogfood of its own mechanism.
- Defects 2 and 3 are two faces of one question and must be decided together.
  The decision is a design fork only the human can settle, so it belongs in
  `interaction-design.md` `## Open Decisions`, not in chat and not in an agent's
  judgement. Candidate directions the user named:
  - forbid only direct writes to `.cdd/design-lock.json`, allow the artifact body; or
  - provide a sanctioned CLI writer/patcher; or
  - key the hook off lock state (writes allowed while no baseline exists for the
    change; blocked once one does).
- Defect 1's fix must not newly break existing change directories. Every gate
  check in `enforceInteractionDesign` already uses the `isNewChange || strict`
  migration window; this one must too.
- ADR 0011's `applicability: not-applicable` remains the single sanctioned escape
  from defect 1's new requirement.
- `assets/**` is generated by `build.js` from `.claude/**`. Never hand-edit it.
- Any new check must run on a path that can fail (CI, hook, or gate), and must be
  proven to discriminate by mutation before it is trusted. A green test proves
  nothing until a mutation turns it red. In gate tests the exit code is not a
  discriminator; assert the stream (`log.warn` → stdout, `log.error` → stderr).

## Known Context

- `fcf1937` — turned both hash-lock gates from warn-only into hard errors under
  `isNewChange || strict`. Before it, a missing baseline passed the gate.
- `8f6ff32` — lockfile sync guard; unrelated to this change except as precedent
  for the mutation-proof discipline required above.
- ADR 0010 = acceptance oracle. ADR 0012 = interaction design loop, §5 governs the
  write-block hooks and is what this change amends.
- Governing surfaces: `src/commands/gate-design.ts`, `src/commands/design.ts`,
  `hooks/pre-tool-use-design-write.sh`, `hooks/pre-tool-use-acceptance-write.sh`,
  `contracts/ci/ci-gate-contract.md`, `docs/adr/`.
- The twelve `Bash`-holding agents: backend-engineer, bug-fix-engineer,
  ci-cd-gatekeeper, dependency-security-reviewer, e2e-resilience-engineer,
  frontend-engineer, monkey-test-engineer, qa-reviewer, repo-context-scanner,
  spec-drift-auditor, stress-soak-engineer, visual-reviewer.

## Open Questions

Deferred to `interaction-design.md` `## Open Decisions` by design — see Constraints.

## Requested Delivery Date / Priority

High. Two shipped ADRs currently document a guarantee that does not hold.
