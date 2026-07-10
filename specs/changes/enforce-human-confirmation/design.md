# Design: enforce-human-confirmation

## Summary

Three convention-only holes let an AI agent satisfy the "a human confirmed this
artifact" guarantee of ADR 0010 / ADR 0012 by itself. This change makes the
guarantee mechanical where a mechanism can hold, and honest where none can.
Defect 1 (vacuous derivation chain) is a bounded gate fix inside
`enforceInteractionDesign` on the existing `isNewChange || strict` window.
Defects 2 and 3 (what stops an agent stamping the baseline; how a sanctioned first
write still gets through) become a human-settled fork in this change's
`interaction-design.md ## Open Decisions`, because the honest answer — no hook is
airtight against a `Bash`-holder on a shared machine — is a risk-acceptance only
the human may make. A prior defect underlies both: the three write-block hooks are
**not installed in this repository at all** (verified: `.claude/settings.json`
registers only `Read`→graph-first and `Bash`→test-runner; `install-agent-hooks.ts:205-215`
arms a write-block hook only on an explicit opt), so today they block nothing — the
fork must also make installation observable. No option here weakens "Never Gated".

## Affected Components

| component | file path(s) | nature of change |
|---|---|---|
| interaction-design gate | `src/commands/gate-design.ts` | add non-empty-rows check for `## Presented Information` and `## States`, gated on `isNewChange \|\| strict`, placed after the applicability short-circuit |
| design write-block hook | `hooks/pre-tool-use-design-write.sh` | replace the degenerate `CDD_DESIGN_WRITE_STRICT` global toggle with the fork-chosen discrimination axis (path- or state-based) |
| acceptance write-block hook | `hooks/pre-tool-use-acceptance-write.sh` | parity change to whatever the design hook adopts |
| hook installer + presence check | `src/commands/install-agent-hooks.ts`, `src/commands/gate*.ts` (or `doctor`) | option (g): default-arm the write-block hooks and/or fail the gate when a context-governed change lacks them in the project settings |
| CI gate contract | `contracts/ci/ci-gate-contract.md`, `contracts/CHANGELOG.md` | document non-vacuous derivation, the single working hook config, self-stamp posture |
| env contract | `contracts/env/env-contract.md` | schema-version bump ONLY if the fork retires/redefines a `CDD_*_WRITE_STRICT` variable (see Key Decisions) |
| ADR | `docs/adr/0012-interaction-design-loop.md` §5 | amend per the draft below (edit deferred to implementation, post-fork) |
| this change's dogfood | `specs/changes/enforce-human-confirmation/interaction-design.md`, `.cdd/design-lock.json` | first real `cdd-kit design confirm` execution outside unit tests |

## Key Decisions

- **Defect 1 fix — non-empty rows under the existing migration window.**
  `enforceInteractionDesign` already parses both tables at gate-design.ts:340-341
  via its own local helpers `parsePresentedInformation` / `parseStates`
  (gate-design.ts:178,187 — local to gate-design.ts, NOT in design-provenance.ts,
  which only exports the `parseTable` row splitter they call). The fix reuses the
  already-computed `infoItems` / `states` arrays: if either is `.length === 0`,
  push a gate ERROR when `isNewChange || strict`, else a warning — placed after
  the applicability short-circuit (295-301) and the stub/placeholder checks.
  `isNewChange` is `isContextGovernedChange(changeDir)` (gate-artifacts.ts:129),
  true iff `tasks.yml` has `context-governance: v1`, computed once at gate.ts:94
  and threaded in. Exact condition: **a context-governed change always fails an
  empty chain; a legacy change fails only under `--strict`.** `parseTable` drops
  blank template rows, so an unfilled scaffold reads as zero rows. → rejected:
  firing unconditionally like conditions 1-5 — a pre-existing confirmed design
  with an incidentally empty States table would newly break, violating AC-7.
- **`applicability: not-applicable` stays the sole escape** — `applicability.py`'s
  verdict returns from `enforceInteractionDesign` before the row check
  (gate-design.ts:290-301), so a UI-less change short-circuits ahead of it; a bare
  skip with no reason still fail-closes.
- **The `CDD_*_WRITE_STRICT` global toggle is the wrong axis (root of defect 2).**
  The hook has no agent identity in its payload, so a global switch can only block
  everyone or no one. The axis must be **path** (body vs lock) or **lock state**
  (absent vs present) — which is why forks (a) and (c) dissolve defect 2 and the
  STRICT variable cannot.
- **Env schema-version bump is fork-dependent.** Forks (a)/(c) retire or redefine
  `CDD_DESIGN_WRITE_STRICT` / `CDD_ACCEPTANCE_WRITE_STRICT` (documented behavior →
  env 0.2.0→0.3.0, and flips `tasks.yml` `2.3` from `skipped` to `pending`); (b)
  may retain them. Pre-existing gap: `CDD_DESIGN_WRITE_STRICT` is not documented in
  `env-contract.md` at all (only the acceptance var is) — fix in the same change.

## The defect-2/3 fork (human-settled; do NOT choose here)

Recorded as an `## Open Decisions` item in this change's `interaction-design.md`.
Two honest cruxes bound every option: (1) **the hooks are not installed** — so
defect 2 ("STRICT=1 blocks main Claude's transcription") is what the hook *would*
do if armed, never actually observed here, and any in-process option (a)–(f) is a
no-op until installation is made observable (g); (2) **the agent's `Bash` sandbox
shares the human's filesystem** — no hook is airtight against a determined
`Bash`-holder, and the hooks match only `Write|Edit|MultiEdit`, so a redirect
(`printf > .cdd/design-lock.json`) already bypasses the "guarded" lock.

- **(a) Forbid only direct writes to the lock sidecars; allow the body.** Fixes
  defect 2 (permits the sanctioned first write + transcription); blocks Edit-tool
  lock fabrication. Fails against `cdd-kit design confirm` via `Bash`, `node
  dist/cli/index.js …`, or a shell redirect. Cost: near zero. Mutation: an Edit to
  the lock path exits 2; deleting the lock `case` makes it pass → assert stderr,
  not exit code. **Defeatable: yes, trivially.**
- **(b) A sanctioned CLI writer/patcher is the sole path to body + lock.** One
  audited entry; blocks casual Edit tampering. Fails against a `Bash` agent
  running the same writer unless paired with a human-only secret (e). Cost: high —
  reroutes main Claude's transcription, conflicting with "main Claude writes
  `## Confirmed`". **Defeatable: yes, unless paired with a real token.**
- **(c) Key the hook off lock state — body writes allowed until a baseline
  exists, blocked after.** Fixes defect 2 cleanly; blocks post-confirmation Edit
  tampering (redundant with the hash-lock). Fails to stop an agent creating the
  *first* baseline (no lock yet → nothing blocks) — defect 3's core. Cost:
  moderate. **Defeatable: yes, for the first stamp.**
- **(d) A `Bash` command matcher.** NOT new plumbing: a `Bash`-matcher PreToolUse
  hook already exists and is wired (`TEST_RUNNER`, install-agent-hooks.ts:83-93,
  settings.json:13-21), so installer, matcher, marker, and strict-env machinery
  are reusable — cost is low, not "a new mechanism". Blocks literal `cdd-kit
  design confirm` / lock-redirect strings. Fails against `sh -c`, `npx`, `node
  -e`, aliases, or a helper script — a string matcher over a shell is porous.
  **Defeatable: yes, many ways — a speed bump.**
- **(e) A human-only confirmation token.** Prevents self-stamping IFF the token
  lives where the agent's sandbox cannot read it — which, on this shared box, it
  cannot (any file/env the human sets, the agent reads; a TTY check is weak).
  **Defeatable: yes, until a real trust boundary exists.**
- **(f) Split `confirm` out of the agent-visible CLI.** Fails against `node -e
  "require('…/design-hash.js').writeDesignLock(…)"` — the code is on the machine.
  **Defeatable: yes.**
- **(g) Make hook installation a checked, failing condition — the only
  non-`Bash`-defeatable option, a different kind of defence.** e.g. `cdd-kit gate`
  (or `doctor --strict`) fails when a context-governed change lacks the
  design/acceptance write-block hooks in the resolved settings, and/or `cdd-kit
  setup` arms them by default instead of opt-in (install-agent-hooks.ts:205-209).
  Prevents: the silent no-op state this repo has sat in since ADR 0010 shipped.
  Does NOT prevent a `Bash` bypass of an installed hook — **(g) composes with, not
  replaces, (a)/(c).** Honest limit: the gate can read only the **project**
  `.claude/settings.json`; it cannot see Claude Code's *effective* merged settings
  (`~/.claude`, `settings.local.json`, enterprise), so it can confirm the project
  arms the hook but not that the running harness honors it, and must not hard-fail
  an adopter who deliberately runs hookless. Mutation: remove the hook entry from
  settings → gate error (assert stderr). **Not defeatable by a `Bash`-holder** —
  it targets absence, not the write path.

**Recommendation shape (the human still chooses).** Prevention against a
`Bash`-holder is *unavailable* on this machine; (a)–(f) are speed bumps. What IS
available and strictly stronger is **(g) + a working axis (a or c) + post-hoc
tamper evidence** (git-author / TTY / timestamp provenance in the lock the human
can audit): it removes the silent no-op, gives one working config, and gives
auditable evidence without pretending to be airtight. Prevention-grade closure
would need a signature only the human's environment can produce (hardware key, or
the lock committed under the human's authenticated remote git identity) — a new
trust boundary, deferred, not claimed here.

## Migration / Rollback

A revert restores the pre-fix `enforceInteractionDesign` (empty chains pass again),
the opt-in STRICT-toggle hook scripts, and the un-checked hook-installation state.
A `.cdd/design-lock.json` written under any fork stays readable by the old code:
the lock schema (`src/schemas/design-lock.schema.ts`, a `{changeId:{hash}}` map) is
unchanged by every option and the old gate reads only `lock[changeId].hash`, so a
post-revert gate still validates existing baselines. If the fork triggered the env
bump, a revert restores env 0.2.0 and returns task `2.3` to `skipped`. The
`isNewChange || strict` window keeps legacy change dirs unaffected by the defect-1
fix, in and out.

## Draft: ADR 0012 §5 amendment (transcribe in implementation, post-fork)

The existing §5 claims, present-tense, that `pre-tool-use-design-write.sh`
"blocks agent Edit/Write to `.cdd/design-lock.json`", and §8 claims every
guarantee lives in "settings.json hooks". Both are false as installed: the hook
is opt-in, defaulted off, and absent from this repo's settings. Correct §5 by
replacing the "Agent write-block hook" bullet and adding three bullets:

> - **Hook installation is not assumed — it is checked.** An unregistered hook
>   blocks nothing. `cdd-kit gate` fails a context-governed change whose
>   design/acceptance write-block hooks are absent from the project
>   `.claude/settings.json` (it verifies only the project file, not Claude Code's
>   effective merged settings). §8's "settings.json hooks" clause is corrected: the
>   portable guarantee is the *checked presence* of the hook, not its availability.
> - **Agent write-block hook — path/state-keyed, not a global toggle.** The
>   `CDD_DESIGN_WRITE_STRICT` global switch (block everyone or no one) is
>   retired/redefined; the hook discriminates on **[the settled fork: write target
>   — lock blocked, body allowed / OR lock state — body allowed until a baseline
>   exists]**, keeping the sanctioned human path open while refusing lock fabrication.
> - **Honest scope (non-airtight).** A determined `Bash`-holder can still reach the
>   lock (`cdd-kit design confirm`, `node dist/cli/index.js`, a shell redirect, or a
>   `node -e` into `writeDesignLock`). The hook is a speed bump plus tamper-evidence,
>   not a prevention boundary; prevention-grade closure needs a signature only the
>   human's environment can produce (future work). Stated so the guarantee is never
>   again announced stronger than it holds.
> - **Non-vacuous derivation chain.** Under `isNewChange || strict`,
>   `enforceInteractionDesign` fails a confirmed design whose `## Presented
>   Information` or `## States` table has zero rows; `applicability: not-applicable`
>   remains the single escape and short-circuits ahead of the row check.

## Open Risks

- **The not-installed state is itself a defect** this change must decide to fix
  in scope or split out. Recommendation: fix in scope via option (g) — a
  human-confirmation guarantee whose enforcing hook is absent is the same
  "announced but not real" failure this change exists to close. The installer /
  default-arming change lands under `tasks.yml` task `4.3` (Env/deploy-side
  config); if (g) is adopted, confirm `4.3` stays `pending` and covers it.
- The defect-2/3 fork is unresolved by design until the human answers the
  `## Open Decisions` item. `implementation-planner` must report `blocked` on the
  hook/CLI work until then; only the defect-1 gate fix and option (g)'s
  hook-presence check are plan-ready without it.
- Whether an ADR is warranted depends on the answer: options (a)/(c)/(g) are
  refinements within ADR 0012 §5's existing scope (no new ADR); the
  signature-boundary follow-up is a new trust boundary and would need its own ADR.
- Env-contract requirement is conditional; contract-reviewer and ci-cd-gatekeeper
  must re-check the required-contracts set once the fork is settled.
- The row check does not cover empty `## User Intents` / `## Controls`; those stay
  only referential-integrity checked and can still be vacuous. Scoped out per
  AC-1/defect-1; noted for a follow-up if the human wants the full chain non-vacuous.
