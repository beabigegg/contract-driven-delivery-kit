---
change-id: enforce-human-confirmation
schema-version: 0.1.0
last-changed: 2026-07-10
# This change HAS a real surface (the CLI / gate / hook boundary a human and an
# agent both act on), so the ADR 0011 not-applicable escape stays commented out.
# change-request.md forbids not-applicable here on purpose: this change is the
# first real dogfood of the ADR 0012 confirm path.
# applicability: not-applicable
# applicability-reason: <n/a -- this change has a real surface>
---

# Interaction Design: enforce-human-confirmation

## Provenance

This change has no HTTP UI. Its interaction surface is the CLI / gate / hook
boundary that a human and an agent both act on. The honest contract-side source
for every information item and state below is `contracts/ci/ci-gate-contract.md`
(the gate's pass/fail conditions, the confirm CLI's result lines, the write-block
hook's behavior, and the option-(g) hook-presence check).

CONTRACT GAP -- route to `contract-reviewer` before this design can converge
(ADR 0012 §3 back-edge). The `## Provenance Reconciliation Policy` in
`contracts/ci/ci-gate-contract.md` (lines 153-159) names only
`contracts/api/api-contract.md` and `contracts/data/data-shape-contract.md` as
join targets. Both are `applicability: not-applicable` for this kit
(`api-contract.md:9`, `data-shape-contract.md:9`), and citing a not-applicable
family is its own HARD failure (`ci-gate-contract.md:171-175`). Therefore:

- Not one citation below resolves under the current five-form policy. Each cell
  points at the real `ci-gate-contract.md` anchor; none is fabricated into the
  api/data families to force a pass.
- This is not a defect in the design -- it is a policy gap. The reconciliation
  policy cannot express a CLI / gate / hook surface, which is the kit's own
  surface. `contract-reviewer` must add a CLI-surface join target (e.g. accept
  `ci-gate-contract.md` section + exact log string / condition id as a sixth
  citation form) before `cdd-kit gate` can pass this change and before
  `cdd-kit design confirm enforce-human-confirmation` should be run.
- `applicability: not-applicable` is the policy's only other escape, and
  `change-request.md` forbids it here by fiat. So the sole convergence path is the
  policy extension above.

This is why `.cdd/design-lock.json` has never existed. The only prior change that
could have exercised the confirm path took the not-applicable escape, because
under the current policy no `interaction-design.md` written for this repository
can pass. That escape was not laziness; it was the only available route.

Citations below use the form `ci-gate-contract -> <anchor>` to name the true
source. Read every one as "source exists; not yet a policy-recognized join
target -- see the gap above."

## Screens

| screen | who is here | what they are deciding | what they fear | what would make them abandon | what must not be shown |
|---|---|---|---|---|---|
| gate report (terminal) | the solo developer about to commit a change | whether this change really cleared human confirmation, or only looks like it did | a green gate that an agent satisfied by itself -- manufactured confidence | a pass whose "human confirmation" was self-stamped, with no way to tell | a "confirmed" verdict the human never actually produced |
| `design confirm` result (terminal) | the human locking their own transcribed answers | whether their confirmation was recorded, and whether it was new or a re-baseline | recording a baseline over an empty or agent-authored `## Confirmed` | a silent success that locked nothing, or locked the wrong thing | a success line when no human answer was present to lock |
| write-block hook feedback (agent transcript / stderr) | the human watching an agent's tool call | whether the write-block is actually armed or silently absent | an agent writing the human answer key while the hook is not installed | believing a guarantee that no installed mechanism backs | a "blocked" claim from a hook that was never registered |

## Presented Information

| item | rationale | provenance |
|---|---|---|
| gate verdict for `interaction-design.md` (pass / fail) | "did this change clear the human-confirmation gate?" | ci-gate-contract -> Required Check Policy (enforceInteractionDesign) |
| empty-derivation-chain error ("Presented Information / States has zero rows") | "did I just confirm a design that asserts nothing?" (defect 1) | ci-gate-contract -> AC-1 non-empty-rows check |
| unresolved-Open-Decisions error, naming each open item | "are there questions still waiting on me before this can pass?" | ci-gate-contract -> condition 2 (AC-4) |
| "no ## Confirmed section" error | "has a human answer actually been transcribed yet?" | ci-gate-contract -> condition 3 (AC-4) |
| "## Confirmed present but no recorded baseline" error | "did a human actually lock this, or is this just agent-authored prose?" | ci-gate-contract -> condition 6 (AC-3/AC-6) |
| "interaction design modified after confirmation -- human must re-confirm" error | "was the design changed after I locked it?" | ci-gate-contract -> condition 6 (AC-3/AC-6) |
| `design confirm` result line -- new baseline / already-matches / re-confirmed hash | "did my confirmation record, and was it new or a change to what was there?" | ci-gate-contract -> design confirm result (design.ts log.ok) |
| hook-not-installed gate failure, naming the absent write-block hook (option g) | "is the write-block actually armed in this project, or silently absent?" | ci-gate-contract -> option-(g) hook-presence check [NOT YET IN CONTRACT -- see ## Provenance and Open Decision 2] |
| write-block hook message on stderr (advisory) or block (strict) | "is an agent trying to write the human-owned answer key right now?" | ci-gate-contract -> write-block hook (pre-tool-use-design-write.sh) |

## User Intents

| id | intent | frequency | path |
|---|---|---|---|
| intent-run-gate | check whether a change is confirmation-complete before committing | every gate run / every pre-commit -- most frequent | edit change -> `cdd-kit gate <id>` -> read verdict |
| intent-confirm-design | lock the human's transcribed answers as the baseline | once per change, again on each real re-confirm | answer Open Decisions -> transcribe into ## Confirmed -> `cdd-kit design confirm <id>` |
| intent-audit-confirmation | tell a genuinely human-made baseline apart from a silent no-op or a self-stamp | whenever the human reviews whether the guarantee held | `cdd-kit gate <id>` -> read baseline-provenance + hook-presence findings |
| intent-relock-acceptance | re-baseline the acceptance oracle (ADR 0010 parity path) | occasional, when acceptance.yml legitimately changes | edit acceptance.yml -> `cdd-kit accept relock <id>` |
| intent-verify-hooks-armed | confirm the design / acceptance write-block hooks are actually installed | rare -- at setup, or when adopting the kit | `cdd-kit setup` / `install-agent-hooks --design-write` -> re-run gate |

## Controls

| id | control | intent |
|---|---|---|
| ctrl-gate | `cdd-kit gate <id>` (reports pass/fail + every unmet confirmation condition) | intent-run-gate |
| ctrl-design-confirm | `cdd-kit design confirm <id>` (the ONLY sanctioned writer of `.cdd/design-lock.json`) | intent-confirm-design |
| ctrl-hook-presence-check | the gate's hook-presence failing condition (option g) -- surfaces a missing write-block hook as a gate error | intent-audit-confirmation |
| ctrl-accept-relock | `cdd-kit accept relock <id>` (the sanctioned writer of `.cdd/acceptance-lock.json`) | intent-relock-acceptance |
| ctrl-setup-hooks | `cdd-kit setup` / `cdd-kit install-agent-hooks --design-write` (arms the write-block hooks in project settings) | intent-verify-hooks-armed |

### Deleted Controls

| control | reason |
|---|---|
| ctrl-force-confirm (a `--force` / bypass flag on `design confirm`) | No intent derives it. A control that bypasses human confirmation is the exact defect this change exists to close; a bypass path would re-manufacture the "green gate an agent can satisfy alone" failure. Deleted, not hidden behind a flag. |
| ctrl-batch-confirm (a "confirm every change at once" command) | No intent derives it. Confirmation is a per-change human judgement; a batch command invites rubber-stamping many designs the human never actually read, which defeats the per-change human-owned answer key. |
| ctrl-agent-design-confirm (letting a Bash-holding agent run `design confirm` in-flow) | No intent derives it, and it is the live subject of Open Decision 1 (defect 3). It is not "deleted" -- the fork of whether/how to block it is handed to the human below, not decided here. Listed so nobody re-adds it as a convenience before that decision lands. |

## States

Every state below is a state of the confirmation machinery, not of an HTTP
response. Two meaning-distinct states never share a discriminator.

| id | meaning | discriminator |
|---|---|---|
| state-missing-design | no `interaction-design.md` exists for this change | ci-gate-contract -> "missing ... interaction-design.md" (design confirm / gate-design existence check) |
| state-stub | the file exists but is an unfilled scaffold / placeholder | ci-gate-contract -> condition 1 stub/placeholder error (AC-2) |
| state-empty-chain | filled prose but `## Presented Information` or `## States` has zero rows -- the vacuous chain (defect 1) | ci-gate-contract -> AC-1 non-empty-rows error [NEW check this change adds] |
| state-open-decisions-pending | one or more `## Open Decisions` items are still unresolved | ci-gate-contract -> condition 2 unresolved-Open-Decision error (AC-4) |
| state-confirmed-unlocked | a `## Confirmed` section exists but no baseline is recorded -- agent-authorable prose, proves nothing | ci-gate-contract -> condition 6 "no recorded baseline" (error under isNewChange-or-strict; warning legacy) |
| state-confirmed-locked-valid | baseline exists and its hash matches the current confirmed region -- the passing state | ci-gate-contract -> condition 6, baseline.hash == currentHash (gate silent-pass) |
| state-confirmed-tampered | a baseline exists but the confirmed region changed after it was locked | ci-gate-contract -> "interaction design modified after confirmation -- human must re-confirm" (AC-3/AC-6) |
| state-not-applicable | the change declares `applicability: not-applicable` with a reason; conditions 1-6 are skipped | ci-gate-contract -> condition 7 / applicability.py marker (AC-8) |
| state-hooks-absent | the design/acceptance write-block hooks are not registered in the project `.claude/settings.json` (this repo's actual state today) | ci-gate-contract -> option-(g) hook-presence error [NOT YET IN CONTRACT -- Open Decision 2] |
| state-hook-blocked | an agent Edit/Write to the design or lock was blocked by the hook in strict mode (exit 2) | ci-gate-contract -> write-block hook strict branch (exit 2, stderr) |
| state-hook-advised | an agent Edit/Write was allowed but the hook printed guidance (advisory, exit 0) | ci-gate-contract -> write-block hook advisory branch (exit 0, stderr) |

## Reversibility

- state-confirmed-locked-valid: the human can tell they are here -- `design
  confirm` echoes the recorded hash and the gate goes silent on this check. The
  way back is not a separate "unlock" control (deliberately none exists): editing
  the design and re-running `design confirm` re-baselines it. Perceptibility is
  the loop-closer here, so no reversal control is added on top of it.
- state-confirmed-tampered: the "modified after confirmation -- human must
  re-confirm" error IS the perceptibility that tells the human they drifted from
  their locked answer. The single exit is to re-run `design confirm`. One
  loop-closer (re-confirm), not two.
- state-open-decisions-pending: the gate names each unresolved item, so the human
  always knows which questions still block them. Answering, transcribing into
  `## Confirmed`, and confirming exits the state.
- state-empty-chain: the new AC-1 error names which table (Presented Information
  or States) is empty, so a confirmed-but-vacuous design cannot pass silently --
  the perceptibility this whole change adds.
- state-hooks-absent: option (g) makes this state perceptible as a gate error
  naming the missing hook; `cdd-kit setup` / `install-agent-hooks --design-write`
  arms it. This is the exit from the silent no-op the repo has sat in since ADR
  0010 shipped -- the loop-closer for the "is the guarantee even armed?" question.

## Consistency Commitments

- One meaning, one channel. Any situation that REQUIRES a human to act before the
  gate can pass is shown as a failure on stderr (`log.error`). Any situation that
  is merely advisory is shown as a warning on stdout (`log.warn`). The human
  triages by channel, and the exit code is not the discriminator -- so the same
  meaning must never be moved across the stderr/stdout boundary. (This is the
  mutation discipline `change-request.md` names: assert the stream, not the exit
  code.)
- "I locked it" and "the lock still matches" are different meanings and must keep
  different forms. Only `design confirm` (`log.ok`) ever says a baseline was
  recorded; the gate never says "confirmed" -- it only observes that a baseline
  matches, or fails. A reader must never see a "confirmed" claim originate from
  the gate.
- Absent is not the same as advisory. A write-block hook that is not installed
  (state-hooks-absent) and a write-block hook that fired in advisory mode
  (state-hook-advised) are different meanings and must take different visible
  forms: option (g) makes absence a gate ERROR, distinct from the hook's own
  advisory stderr line. The single "warning" form must never quietly carry both
  "the hook advised" and "there is no hook at all" -- conflating them is exactly
  the not-installed blind spot this change exists to remove.

## Open Decisions

<!-- Two cruxes bound Decision 1. Read them first; they make five of the seven
options no-ops or speed bumps, and they are why this is a human risk-acceptance,
not an agent's engineering pick. -->

**Crux A -- the write-block hooks are not installed in this repository.**
`.claude/settings.json` today registers only a Read->graph-first hook and a
Bash->test-runner hook. The three write-block hooks (design, acceptance, contract)
are absent, and the installer arms a write-block hook only on an explicit opt-in.
So defect 2 ("strict mode would block main Claude's transcription") describes what
the hook WOULD do if armed -- it has never actually happened here. Every in-process
option below, (a) through (f), changes a hook that is not running, so each is a
no-op until hook installation is made observable, which is what option (g) does.

**Crux B -- the agent's Bash sandbox shares your filesystem and user account.**
A Bash-holding agent runs as you, on your machine, with your files. No hook can be
airtight against it: it can run `cdd-kit design confirm`, `node
dist/cli/index.js ...`, a shell redirect (`printf > .cdd/design-lock.json`), or
`node -e` straight into `writeDesignLock`. Prevention against a determined
Bash-holder is simply not available on this machine. Options (a)-(f) are speed
bumps and tamper-evidence, never a wall.

- [x] **Decision 1 -- how to keep an agent from stamping the human-confirmation
  baseline itself, while still letting the sanctioned first write and
  transcription through (defects 2 and 3, decided together).** Twelve agents hold
  the Bash tool. Pick the combination you are willing to rely on, knowing Crux A
  and Crux B.

  - **(a) Forbid only direct writes to the lock sidecars (`.cdd/design-lock.json`
    / `.cdd/acceptance-lock.json`); allow the artifact body.**
    - Prevents: an agent fabricating the lock with the Edit/Write tool; and it
      unblocks the sanctioned first write + your transcription (fixes defect 2).
    - Does NOT prevent: `cdd-kit design confirm` via Bash, `node
      dist/cli/index.js`, or a shell redirect into the lock file.
    - Defeated by a Bash-holder: yes, trivially.

  - **(b) A sanctioned CLI writer/patcher is the only path to body + lock.**
    - Prevents: casual Edit-tool tampering; gives one audited entry point.
    - Does NOT prevent: a Bash agent running that same writer -- unless paired with
      a real human-only secret (option e).
    - Defeated by a Bash-holder: yes, unless paired with a token. Cost is high: it
      reroutes main Claude's transcription, which conflicts with "main Claude
      writes `## Confirmed`."

  - **(c) Key the hook off lock state -- body writes allowed until a baseline
    exists, blocked once one does.**
    - Prevents: post-confirmation Edit tampering (fixes defect 2 cleanly; this
      overlaps what the hash-lock already catches).
    - Does NOT prevent: an agent creating the FIRST baseline -- with no lock yet,
      nothing blocks the initial stamp. That first stamp is defect 3's core.
    - Defeated by a Bash-holder: yes, for the first stamp.

  - **(d) A Bash command matcher (reuses the existing Bash->test-runner hook
    machinery -- not new plumbing).**
    - Prevents: literal `cdd-kit design confirm` / lock-redirect command strings.
    - Does NOT prevent: `sh -c ...`, `npx`, `node -e`, an alias, or a one-line
      helper script -- a string matcher over a shell is porous.
    - Defeated by a Bash-holder: yes, many ways. A speed bump.

  - **(e) A human-only confirmation token.**
    - Prevents: self-stamping IF and ONLY IF the token lives where the agent's
      sandbox cannot read it.
    - Does NOT prevent: anything on THIS machine -- any file or environment
      variable you can set, the agent can read; a TTY check is weak.
    - Defeated by a Bash-holder: yes, until a real trust boundary (hardware key,
      authenticated remote identity) exists.

  - **(f) Split `confirm` out of the agent-visible CLI.**
    - Prevents: the obvious `cdd-kit design confirm` invocation.
    - Does NOT prevent: `node -e "require('.../design-hash.js').writeDesignLock(...)"`
      -- the code is still on the machine.
    - Defeated by a Bash-holder: yes.

  - **(g) Make hook installation a checked, failing condition -- a different KIND
    of defence.** The gate (or `doctor --strict`) fails a context-governed change
    whose design/acceptance write-block hooks are absent from the project
    `.claude/settings.json`, and/or `cdd-kit setup` arms them by default instead
    of opt-in.
    - Prevents: the silent no-op state this repo has sat in since ADR 0010
      shipped -- the state where the guarantee is announced but no installed
      mechanism backs it.
    - Does NOT prevent: a Bash bypass of an installed hook. (g) composes WITH a
      working axis (a or c); it does not replace one. Honest limit: the gate can
      read only the PROJECT `.claude/settings.json`, not Claude Code's effective
      merged settings, so it confirms the project arms the hook, not that the
      running harness honors it.
    - Defeated by a Bash-holder: NO. It targets absence, not the write path -- the
      one option a Bash-holder cannot defeat.

  RECOMMENDATION (a recommendation only -- you choose): prevention against a
  Bash-holder is unavailable on this machine, so do not buy it at the price of a
  false sense of security. The strictly stronger, honestly-scoped combination is
  **(g) + a working axis (a or c) + post-hoc tamper evidence** (git-author / TTY /
  timestamp provenance recorded in the lock, which you can audit). That removes the
  silent no-op, gives one working configuration, and produces auditable evidence
  without pretending to be airtight. Prevention-grade closure would need a
  signature only your environment can produce (a hardware key, or the lock
  committed under your authenticated remote git identity) -- a new trust boundary,
  deferred, not claimed here. Nothing above is pre-selected.

- [x] **Decision 2 -- when option (g) finds the write-block hooks are NOT
  installed, should `cdd-kit gate` hard-fail, or only warn?** This changes who can
  use the kit, so it is your call, not an agent's.
  - Hard-fail: strongest -- a context-governed change cannot pass while its
    confirmation hooks are absent, so the guarantee is never silently unarmed.
    Cost: an adopter who deliberately runs without hooks (a different harness, a CI
    box, a hookless workflow) is blocked and must either install the hooks or mark
    an exemption. You would be deciding the kit is only for setups that arm the
    hooks.
  - Warn: most permissive -- the absence is surfaced on every gate run but never
    blocks. Cost: a warning is easy to stop reading, so the repo can drift back
    into the exact silent no-op this change exists to end.
  - A middle option exists -- hard-fail only under `--strict` / pre-commit, warn
    otherwise -- if you want the block where it counts without excluding hookless
    adopters everywhere.

- [x] **Decision 3 -- should this kit treat a CLI / gate / hook surface as
  provenance-eligible at all?** (Surfaced from the `## Provenance` gap above; it is
  a scope decision about your own kit, which only you can make.) The reconciliation
  policy can currently cite only an HTTP API or a data-shape row, and this change
  has neither -- yet `change-request.md` forbids marking it not-applicable. So
  either:
  - Extend the policy so a CLI-surface interaction-design may cite
    `contracts/ci/ci-gate-contract.md` (a real contract that describes exactly
    these gate outputs and states) as a join target -- making the kit's own surface
    describable by its own gate. This is the path that lets THIS change converge,
    and the path every CLI / library / desktop adopter needs too.
  - Or accept that provenance reconciliation is an HTTP-only concept and carve a
    provenance-only exemption for surfaces the api/data contracts don't cover --
    narrower than a full not-applicable, but still an admission that the derivation
    chain here is not contract-backed.

  Whichever you choose, `contract-reviewer` implements it; the gate cannot pass
  this change and `cdd-kit design confirm` should not be run until it lands.

## Confirmed

<!-- AGENT-FORBIDDEN to invent. The three answers below were chosen by the human -->
<!-- on 2026-07-10 and transcribed verbatim by main Claude. No agent selected -->
<!-- any of them. Locked with `cdd-kit design confirm enforce-human-confirmation`, -->
<!-- run by the human. -->

**Decision 1 — answered 2026-07-10: (g) + (a) + tamper evidence.**

Make hook installation a checked, failing condition (g) — it is the only defence a
`Bash`-holding agent cannot defeat, because it targets the hook's *absence* rather
than the write path. Compose it with axis (a): the write-block hooks refuse direct
writes to `.cdd/design-lock.json` and `.cdd/acceptance-lock.json`, while allowing
writes to the artifact body, so main Claude's sanctioned first write and its
transcription of these very answers still go through. Record git-author, TTY, and
timestamp provenance inside the lock so a stamp can be audited after the fact.

Explicitly NOT claimed: prevention against a determined `Bash`-holder. That is
unavailable on a machine where the agent's shell shares the human's filesystem and
user account, and it must not be bought at the price of a false sense of security.
Options (b), (d), (e), and (f) are rejected: each is defeatable, and (d) in
particular would *look* like a wall while being a speed bump — the exact failure
mode this change exists to end. Prevention-grade closure needs a signature only the
human's environment can produce; it is deferred, not claimed.

**Decision 2 — answered 2026-07-10: hard-fail only under `--strict` / pre-commit; warn otherwise.**

When option (g) finds the design/acceptance write-block hooks absent from the
project `.claude/settings.json`, `cdd-kit gate` warns on stdout in its default
mode and fails on stderr under `--strict` (which is what pre-commit and the
push-to-default-branch CI job run). This blocks the absence where it counts
without excluding an adopter who deliberately runs hookless on a CI box or under
a different harness. It also matches the `isNewChange || strict` migration window
every neighbouring check in `enforceInteractionDesign` already uses, so it
introduces no new axis of behaviour.

**Decision 3 — answered 2026-07-10: extend the reconciliation policy with a CLI-surface join target.**

`contracts/ci/ci-gate-contract.md` becomes a legitimate join target for a
CLI / gate / hook interaction-design: an information item or state may cite a
`ci-gate-contract.md` section plus an exact condition id or log string as a sixth
citation form. This is what lets the kit's own surface be described by the kit's
own gate — and it is what every CLI, library, data-pipeline, and desktop adopter
needs, none of whom have an HTTP API or a tabular data contract to cite.

The alternative — conceding that provenance reconciliation is an HTTP-only idea
and carving a provenance-only exemption — is rejected. It would leave ADR 0012's
central guarantee permanently half-applicable to every non-HTTP project, which is
the same "announced but not real" shape this change exists to close.

Consequence accepted: `contracts/ci/ci-gate-contract.md` takes a schema-version
bump and `reconcileProvenance` gains a citation form. `contract-reviewer` owns the
contract edit; it must land before `cdd-kit gate enforce-human-confirmation` can
pass. The `## Provenance` cells above are written against this decision and are
labelled as not-yet-policy-recognized until it lands.
