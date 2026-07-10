---
contract: ci
summary: CI gate inventory, artifact retention, and rollback requirements.
owner: platform-team
surface: delivery-pipeline
schema-version: 0.7.0
last-changed: 2026-07-10
breaking-change-policy: deprecate-2-minors
---

# CI/CD Gate Contract

## Gate Inventory

**`required` column vocabulary.** `yes` — this check's failing conditions block the
gate in every trigger context listed, for a new or context-governed change. The only
exceptions are named per-condition (e.g. the missing-baseline warn-for-legacy-dirs
branch) and do not change the classification. `ci-or-strict` — this check hard-fails
on stderr whenever the gate runs inside CI (any event) or under `--strict`, and is
advisory (a stdout warning) in a default local run. No row uses any other value.

A check that only warns in the mode most people run must not be listed as `yes`:
that is the same shape as the `pull_request` trigger cell this file already had to
correct once (`[ci 0.4.0]`).

The value `strict-only` was removed in `[ci 0.7.0]` and must not be reintroduced.
It was a lie of omission: `--strict` names only the push-to-default-branch CI job,
which runs *after* merge, and the local pre-commit hook, which `--no-verify`
bypasses. A `strict-only` check therefore blocks nothing before a change lands. Any
future check tempted to use it wants `ci-or-strict`.

| gate | tier | trigger | required | command/workflow | owner | artifact |
|---|---:|---|---:|---|---|---|
| enforceAcceptanceOracle | 1 | pull_request; local (`cdd-kit gate`) | yes | `cdd-kit gate` | platform-team | `specs/changes/<id>/acceptance.yml`, `.cdd/acceptance-lock.json`, `test-evidence.yml` (`acceptance` phase) |
| enforceInteractionDesign | 1 | pull_request; push to default branch (`--strict`); local (`cdd-kit gate`) | yes | `cdd-kit gate` | platform-team | `specs/changes/<id>/interaction-design.md`, `.cdd/design-lock.json` |
| enforceConfirmationHookInstallation | 1 | pull_request; push to default branch (`--strict`); local | ci-or-strict | `cdd-kit gate` AND `cdd-kit validate` | platform-team | `.claude/settings.json` (git-tracked) |

### Trigger truthfulness (corrected by interaction-design-loop, ADR 0012)

Before this change, the `pull_request` half of `enforceAcceptanceOracle`'s trigger
cell was **false**: the shipped workflow ran `cdd-kit validate` only and never
invoked `cdd-kit gate <id>`, so every required check above ran solely in the local
`.git/hooks/pre-commit` hook — which `--no-verify` bypasses. This change adds the
change-id derivation + `cdd-kit gate` steps to both
`github-workflows/contract-driven-gates.yml` (adopter template) and this repo's
`.github/workflows/contract-driven-gates.yml`, making the `pull_request` trigger
true for **both** rows above. `enforceAcceptanceOracle` is the only other check
with an inventory row, so no other claim needed correcting.

`--strict` is applied on `push` to the default branch, not on `pull_request`: a PR
is legitimately opened mid-change with tasks still pending, whereas a merged change
with pending tasks is a defect.

## Required Check Policy

### enforceAcceptanceOracle (added by acceptance-oracle, ADR 0010)

`enforceAcceptanceOracle` ships as a REQUIRED (blocking) check from initial
release — it is **not** phased in as informational first, despite the general
new-gate guidance in `ci/required-check-policy.md` — because a silently-passable
oracle check defeats the mechanism it exists to enforce (design.md Migration/
Rollback: "the oracle is never silently skipped"; AC-7). `ci-cd-gatekeeper` must
sign off this required-from-day-one status against the general informational-
first guidance before this row ships (see CI/CD Gate Impact below).

Pass/fail conditions — ALL must hold to pass; any one failing fails the gate:

1. **AC-1** — `specs/changes/<id>/acceptance.yml` exists, is non-placeholder
   (existing `meaningfulChars`/placeholder detection), and has >=1 case.
2. **AC-2** — the recorded oracle hash (locked region: `cases[].{id,input,expect}`,
   `rules[].{id,statement}`) matches the author-time baseline in
   `.cdd/acceptance-lock.json`; a mismatch fails with "acceptance oracle
   modified after authoring — human must re-confirm." A `acceptance.yml` with **no**
   recorded baseline at all also fails (under `isNewChange || strict`; a legacy dir
   is warned). An unlocked oracle is not evidence of human authorship: the
   acceptance-write hook is advisory unless `CDD_ACCEPTANCE_WRITE_STRICT=1`, so any
   Edit-capable agent can author one. Only `cdd-kit accept relock` writes the lock.
3. **AC-4** — no acceptance driver mocks a module resolved as the change's SUT
   from the code-map ("acceptance test mocks the thing it is supposed to
   verify"); external I/O boundary fakes (network, clock) are allowed.
4. **AC-5** — each case's pass is a recorded, bounded, passed `acceptance`-phase
   run in `test-evidence.yml` (ADR 0005 evidence harness); a self-reported pass
   with no recorded run fails.
5. **AC-7** — a change migrated by `cdd-kit migrate` (placeholder-plus-
   instructions `acceptance.yml`) fails this check until the author supplies
   real, non-placeholder cases; never silently skipped.
6. `--strict` mode additionally requires each `rules[]` invariant to have >=1
   bound test (ADR 0010 §4; implemented by `findUnboundRules`,
   `src/utils/mock-of-sut-scan.ts`, added by interaction-design-loop scope
   expansion 2 — this condition previously named a check that did not exist
   in code). **Binding convention:** a rule is bound when a driver file under
   `test(s)/acceptance/` that belongs to THIS change (`driverBelongsToChange`
   — filename `<change-id>.driver.*`, or its source resolves the emitted
   loader to this change id) contains a word-boundary occurrence
   (`isWordBoundaryOccurrence`) of the rule's id — conventionally inside a
   test title, e.g. `it("rule <id>: ...", ...)`, the same test-title-carries-
   the-id convention this codebase already uses for AC ids. An unbound rule
   fails with `acceptance rule "<id>" has no bound test in test/acceptance/
   (--strict; ADR 0010 §4).` naming the rule id. `rules: []` (or no `rules`
   key) passes trivially — there is nothing to bind, so a change dir that has
   never declared `rules[]` is unaffected. This scan reuses the same two
   guards AC-4's mock-of-SUT/hardcoded-expect scan above already enforces, so
   it cannot reproduce the two false-positive bugs that scan's own dogfooding
   exposed: a driver written for a **different** change never counts toward
   this change's binding (change-scoped), and a rule id that is only a
   substring of a longer token never counts as a match (whole-token).

Non-behavioral (pure refactor) opt-out is permitted only via reference-parity
evidence or an agent-forbidden, review-countersigned `acceptance-not-applicable`
reason — deliberately stricter than the ADR 0005 test-evidence opt-out.

### enforceInteractionDesign (added by interaction-design-loop, ADR 0012)

`enforceInteractionDesign` ships as a REQUIRED (blocking) check for every change
created after this gate lands — it is **not** phased in as purely informational,
for the same reason `enforceAcceptanceOracle` was not: a silently-passable design
gate defeats the mechanism it exists to enforce (ADR 0012 §6). Unlike
`enforceAcceptanceOracle`'s registration above, this row states the migration
device explicitly rather than leaving it to code comments: the check gates on
`isNewChange || strict` — a NEW change directory (`tasks.yml` frontmatter
`context-governance: v1`, per `isContextGovernedChange`) or a `--strict` run must
pass all conditions below unconditionally; a PRE-EXISTING change directory is
exempt from the missing-artifact / missing-confirmation branches until migrated,
exactly as `enforceTestEvidence` / `enforceAcceptanceOracle` are exempted, so no
in-flight change directory fails overnight on introduction. `ci-cd-gatekeeper` has
signed off this required-from-day-one-for-new-changes status.

Pass/fail conditions — ALL must hold to pass; any one failing fails the gate:

1. **AC-2** — the artifact is present and real. `gate-design.ts` evaluates this as
   three separate branches, in order, each with its own message, because "absent",
   "unwritten", and "half-written" are three distinct situations a human resolves
   three different ways. They are enumerated separately here so each is citable:
   1. `specs/changes/<id>/interaction-design.md` exists. Its absence fails with
      "missing required artifact: interaction-design.md" (under
      `isNewChange || strict`; a legacy dir is warned).
   2. The artifact carries at least `MIN_MEANINGFUL_CHARS` (100) of content.
      Below that it fails with "appears to be a stub" — nobody has begun writing it.
   3. The artifact retains no unfilled scaffold token. Any remaining token fails
      with "still contains unfilled template placeholder(s)" — writing began and
      stopped.
2. **AC-1** — the derivation chain is non-vacuous: `## Presented Information` and
   `## States` each carry at least one table row. A confirmed design whose
   `## Presented Information` or `## States` has zero rows fails (under
   `isNewChange || strict`; a legacy dir is warned). Provenance reconciliation
   (condition 6) over an empty set passes trivially, so without this condition a
   human could confirm a document that asserts nothing at all — the check would
   exist and measure nothing. Condition 8's `applicability: not-applicable` remains
   the single sanctioned escape and short-circuits ahead of this row count.
3. **AC-4** — zero unresolved `## Open Decisions` entries.
4. **AC-4** — a human `## Confirmed` section is present.
5. **AC-4 / AC-9** — referential integrity holds: every control cites exactly one
   intent id; every intent has exactly one path; every deleted control records its
   reason.
6. **AC-5** — provenance reconciliation (see `## Provenance Reconciliation Policy`
   below) has zero HARD failures. Reverse-direction findings (a contract field or
   row with zero citing information items) are corpus-wide, `doctor`-reported,
   ADVISORY only, and are never evaluated or blocked by this per-change gate.
7. **AC-3 / AC-6** — the confirmed-region canonical-projection sha256 in
   `.cdd/design-lock.json` matches the parsed `## Confirmed` region; a mismatch
   fails with "interaction design modified after confirmation — human must
   re-confirm." A `## Confirmed` section with **no** recorded baseline at all also
   fails (under `isNewChange || strict`; a legacy dir is warned). An unlocked
   `## Confirmed` is not evidence of human confirmation: any Edit-capable agent can
   author that prose, and the write-block hook that refuses the lock file is armed
   only if this project registered it — see `### enforceConfirmationHookInstallation`.
   Only `cdd-kit design confirm` writes the lock.
8. **AC-8** — a change whose `interaction-design.md` carries
   `applicability: not-applicable` with a non-empty `applicability-reason` SKIPS
   conditions 1–7 entirely. `applicability.py` remains the sole pass/fail authority
   for this marker, applied here to a per-change spec artifact rather than a
   `contracts/` family file (see the `## Contract Applicability Marker (ADR 0011)`
   addendum below) — no second authority is introduced.
9. **AC-7** — a change migrated by `cdd-kit migrate` (placeholder-plus-instructions
   `interaction-design.md`) fails this check until the author supplies a real,
   human-confirmed design; never silently skipped, mirroring
   `enforceAcceptanceOracle` AC-7.

Non-behavioral (pure copy/color) opt-out is permitted only via condition 8 above —
the same discipline `enforceAcceptanceOracle` applies to non-behavioral refactors,
applied here to design instead of function.

**Never gated (ADR 0012 § Never Gated).** This check must never fail a change on
visual aesthetics, animation or motion, layout taste, typography, colour, or
latency / round-trip count. Only derivation, provenance, referential integrity, and
tamper-evidence may block. A rule over taste has no oracle to consult and would
manufacture the very defect this gate exists to prevent.

### enforceConfirmationHookInstallation (added by enforce-human-confirmation)

Verifies that the two write-block PreToolUse hooks the human-confirmation guarantee
(ADR 0010 / ADR 0012) depends on are actually armed in this project, rather than
merely shipped as scripts nobody registered.

**The prerequisite this check's premise requires — stated so it is never silently
false again.** `.claude/settings.json` is a git-tracked file in this repository and
in any adopter using this check. `.claude/settings.local.json` is NOT tracked and is
never read here: a personal override does not mean the project arms the hook. Each
hook entry this check looks for MUST register a `command` whose script path is
**git-tracked** — verifiable with `git ls-files -- <path>` — because a bare CI
checkout contains only tracked files, and a hook script CI cannot see is a hook CI
cannot run. A check whose premise cannot exist in the environment where it is
strictest is the same defect class this change exists to close.

**The check is directory-agnostic, and `[ci 0.7.0]` corrected it to be so.** The
first revision of this section demanded the `command` resolve to `hooks/…` at repo
root and forbade `.claude/hooks/…`. That was wrong, and wrong in the way this whole
change exists to catch: it was inferred from one incidental fact about this
repository — `.claude/hooks/` happens to be untracked here — and never checked
against the shipped installer. `install-agent-hooks.ts:264` creates
`<project>/.claude/hooks/` and writes every bundled script into it, and
`hookRelPath` (`:145-147`) registers exactly that path. `.claude/hooks/` is not in
`.gitignore`; it is merely un-added. So the rule as first written meant **the kit's
own installer produced a settings file that failed the very check the installer
armed**, in this repository and in every adopter's.

What matters is that the path is tracked, not which directory it sits in. An adopter
who runs `install-agent-hooks` and commits `.claude/hooks/` passes. A project that
registers a tracked repo-root `hooks/…` passes. A project that registers a path git
has never seen fails, wherever it lives.

**Two host commands, because one of them can be skipped.** This check runs from
`cdd-kit gate <id>` *and* from `cdd-kit validate`. The workflow's gate step is guarded
by `if: steps.changed.outputs.ids != ''`, so a pull request that de-arms
`.claude/settings.json` while touching no `specs/changes/<id>/` directory would never
invoke `gate` — and the check aimed squarely at that pull request would never run,
while this row's `pull_request` trigger cell claimed otherwise. That is precisely the
false-trigger defect `[ci 0.4.0]` already had to correct once, and it was found by
`ci-cd-gatekeeper` reading the workflow rather than trusting the row.

`cdd-kit validate` runs unconditionally in CI on every event, so hosting the check
there as well makes the trigger cell true without a workflow edit. Hook installation
is a project property; `validate` is the project-scoped command. Adopter cost, stated:
a project whose CI runs `validate` at all must arm both hooks. That is the same rule
Decision 2 already accepted, applied to a larger surface — not a new rule.

**Two DISTINCT absence causes.** The gate reads the PROJECT `.claude/settings.json`.

1. The file itself is absent. Fails with "`.claude/settings.json` not found — the
   design/acceptance write-block hooks cannot be verified because no project settings
   file exists".
2. The file is present but no `PreToolUse` entry matches `Write`, `Edit`, and
   `MultiEdit` with a `command` resolving to the git-tracked hook script. Fails with
   "`.claude/settings.json` exists but does not register the <design|acceptance>-write
   hook", naming which of the two is missing.

These are two reasons for one absence and MUST carry different message text.
Collapsing them would repeat exactly the conflation `interaction-design.md`'s
`## Consistency Commitments` forbids for a different pair of states.

**Pass/fail shape** (`ci-or-strict`, revised in `[ci 0.7.0]`). Either cause is a HARD
failure on stderr (`log.error`) when the gate runs inside CI, or under `--strict`.
In a default local run it is a WARNING on stdout (`log.warn`).

"Inside CI" means the `CI` environment variable is set to a non-empty value other
than `0` or `false`. Every mainstream provider — GitHub Actions, GitLab CI, CircleCI,
Travis, Buildkite — sets `CI=true` unconditionally, so this requires no workflow edit
and cannot be silently forgotten the way an explicit `--require-hooks` flag could be.
`CI` is a consumed configuration input and is therefore documented in
`contracts/env/env-contract.md`.

This check is deliberately NOT keyed on `--strict` alone. `--strict` names only the
push-to-default-branch job, which runs after merge, and the local pre-commit hook,
which `--no-verify` bypasses; a `pull_request` run would have merely warned. The
first revision of this section made exactly that mistake and shipped a check that
blocked nothing before a change landed.

This check is also NOT gated on `isNewChange`: hook installation is a property of the
project, not of one change directory's vintage, so a legacy change and a brand-new one
see the identical shape. **Consequence, stated because it bites:** in CI, every change
directory fails until the project tracks `.claude/settings.json` and registers both
write-block hooks. Adopting this check and arming the hooks must land together.

**Honest limit.** The gate reads only the project `.claude/settings.json` on disk.
It cannot see the harness's effective merged settings (`~/.claude/settings.json`,
`.claude/settings.local.json`, enterprise policy). A pass means the project
*declares* the hook at a real, checkable path. It does not mean the harness running
this session *honours* it.

**Not a prevention boundary.** Passing does not stop a `Bash`-holding agent from
bypassing an installed hook — `cdd-kit design confirm` through `Bash`,
`node dist/cli/index.js`, a shell redirect into the lock, or `node -e` straight into
the lock writer all remain possible where the agent's shell shares the human's
filesystem and user account. This check composes with the write-path axis below; it
does not replace it, and neither of them is a wall.

### Write-block hook discrimination axis (added by enforce-human-confirmation)

`pre-tool-use-design-write.sh` and `pre-tool-use-acceptance-write.sh` discriminate on
the write TARGET PATH, never on a global strict/advisory toggle:

- An agent `Write`/`Edit`/`MultiEdit` whose target is `.cdd/design-lock.json` or
  `.cdd/acceptance-lock.json` is blocked unconditionally (exit 2, stderr), whatever
  any environment variable says.
- An agent `Write`/`Edit`/`MultiEdit` whose target is the artifact BODY
  (`interaction-design.md`, `acceptance.yml`) is always allowed, so the sanctioned
  first write and the transcription of the human's answers still go through.

The retired `CDD_DESIGN_WRITE_STRICT` / `CDD_ACCEPTANCE_WRITE_STRICT` toggle carried
no agent identity in the hook payload, so it could only block everyone — including
the sanctioned transcription — or block nobody, which was its default. It admitted no
working configuration. See `contracts/env/env-contract.md` for its deprecation.

**Confirm result line.** `cdd-kit design confirm <id>` (`design.ts`, `log.ok`) prints
exactly one of three lines according to prior state: "recorded a new baseline for"
(first confirm), "already matches the current interaction-design.md" (re-run, no
change), or "re-confirmed" followed by the old and new hash (design edited after a
prior confirm). This is the only place any command may say a baseline was recorded.
The gate never uses those words; it only observes that a baseline matches, or fails.

**Tamper evidence, not prevention.** `.cdd/design-lock.json` and
`.cdd/acceptance-lock.json` additionally record, per change id, the git author
identity at confirm time, whether the confirming process had a TTY, and the confirm
timestamp. These are auditable evidence for a human asking whether a stamp looks
human-produced. None is verified or enforced by the gate, and a `Bash`-holding agent
can set all three. Prevention-grade closure would need a signature only the human's
environment can produce — a hardware key, or the lock committed under the human's
authenticated remote git identity. That is a new trust boundary. It is deferred, and
it is not claimed anywhere in this contract.

## Provenance Reconciliation Policy (ADR 0012 §2)

Every information item and UI state in `interaction-design.md` must cite a supplier
resolvable against one of three contract families:

- `contracts/api/api-contract.md` — endpoint + `## Schemas` field, its
  `errors`-column HTTP status, or an implicit HTTP status.
- `contracts/data/data-shape-contract.md` — an `## Invalid Data Behavior` row,
  keyed by its `condition` column.
- `contracts/ci/ci-gate-contract.md` — a CLI / gate / hook citation (the sixth
  form, below), for a change whose interaction surface is the gate / CLI / hook
  boundary itself rather than an HTTP API or a tabular dataset.

The `errors` column holds bare comma-separated HTTP-status integers only, never a
semantic error code; `contracts/api/error-format.md` is deliberately NOT a join
target (ADR 0012 § Out of scope).

### Sixth citation form — CLI / gate / hook surface (`ci-gate:`)

Until this form existed, every join target required an HTTP API or a tabular
data-shape row. Both families are `applicability: not-applicable` for this kit —
and for any CLI, library, data-pipeline, or desktop adopter — and citing a
not-applicable family is itself a HARD failure (below). No `interaction-design.md`
written for such a project could satisfy condition 6 without fabricating an
endpoint citation. The only escape was to mark the whole artifact
`not-applicable`, which is why `.cdd/design-lock.json` did not exist in this
repository until `enforce-human-confirmation`: ADR 0012's confirm path had never
run, because it could not.

**Syntax:** `ci-gate: <heading> :: <exact substring>`

`<heading>` names a `##` or `###` heading in `contracts/ci/ci-gate-contract.md`,
matched case-insensitively and trimmed, with a trailing parenthetical annotation
ignored for matching — so `enforceInteractionDesign` matches the heading
`### enforceInteractionDesign (added by interaction-design-loop, ADR 0012)` and no
author has to quote an ADR number into a citation. If one `###` heading text ever
appears under two `##` parents, the citation disambiguates as
`<## parent> > <### heading>`.

**Section-body resolution — two defects in `sectionBody`, both fixed there rather
than routed around.** `src/utils/markdown-section.ts` exists, by its own doc comment,
to stop independent section-parsers drifting apart. A second scanner living in
`design-provenance.ts` would reintroduce exactly that drift at a third call site, so
`sectionBody` is fixed instead:

1. Its terminator is the literal `(?=\n## |$)`, which a `### ` line does not satisfy.
   One `###` section's body therefore swallows every sibling below it, bounded only
   by luck — by being the last `###` before the next real `##`. That luck runs out
   the moment anyone adds a subsection: inserting this contract's own
   `### enforceConfirmationHookInstallation` would have taken the anchor
   `:: zero unresolved` from one occurrence to two and broken a citation for a reason
   with nothing to do with its meaning. `sectionBody` now captures the matched
   heading's level and terminates at the next heading of the same-or-shallower level.
   A `##` body still spans its `###` children, exactly as before; a `###` body now
   ends at its next sibling. Anchors become insertion-order stable.
2. Its opening match is not line-anchored, so `## X` can match inside `### X`. It is
   now anchored to a full line.

Both are behaviour-preserving for every existing call site: all twelve headings the
five current consumers look up (`context.ts`, `gate-artifacts.ts`, `metadata.ts`,
`gate-agents.ts`, `gate-design.ts`, `design-hash.ts`, `mock-of-sut-scan.ts`) are
level-2 and carry no trailing parenthetical, and each returns identical text before
and after. `design-hash.ts`'s `## Confirmed` projection is therefore unchanged, so no
recorded baseline shifts.

The resolver adds one step of its own, in `design-provenance.ts`: mapping a cited
bare name to its full heading line, since `sectionBody` matches a heading exactly and
most headings here carry a trailing parenthetical — `## Provenance Reconciliation
Policy (ADR 0012 §2)` is not found by the bare name, at any level. The resolver scans
for the unique heading line whose text is the cited name optionally followed by a
parenthetical: zero matches is "no such heading", more than one is "ambiguous heading
name". No author has to quote an ADR number into a citation.

**Normalization.** Before comparison, both the resolved section body and the cited
substring are stripped of the inline-formatting characters `*`, `_`, and `` ` ``,
then whitespace-normalized (runs of whitespace collapsed to one space, trimmed).
Comparison is otherwise case-SENSITIVE — this is a quoted fragment, not a loose
phrase. Stripping the formatting characters is not hypothetical tidiness: condition
7's text is `**no** recorded baseline at all also fails`, and without stripping, a
citation of `no recorded baseline at all also fails` finds nothing.

**Uniqueness — what makes this a claim rather than a topic.** The substring must
occur EXACTLY ONCE in the resolved section body.

- Zero occurrences → HARD failure: "substring not found in section '<heading>' of
  ci-gate-contract.md".
- Two or more → HARD failure: "citation is ambiguous in section '<heading>' (<N>
  occurrences) — lengthen the quoted substring until it identifies one place".
- Exactly one → resolves.

Verifying only that the named section exists would be nearly vacuous. So would
accepting any substring: a fragment guaranteed to appear in ordinary prose asserts
nothing. `:: the` occurs many times over in `enforceInteractionDesign` and is
rejected as ambiguous; so is a bare `:: AC-4`, forcing the author to cite the
condition's distinguishing prose (`:: zero unresolved`) instead.

No exact occurrence count is stated here on purpose. `[ci 0.6.0]` asserted "18
times"; the measured value was 23, and it moves with every edit to the section.
A count written into prose is an assertion that drifts silently — the shape this
contract exists to forbid. What is asserted, and tested, is the *rejection*.
Uniqueness turns the citation into an anchor to one place, which is what a
provenance citation is for, and it gives the state-discriminator rule real teeth:
two meaning-distinct states citing one section must anchor to two genuinely
different, individually unique places in it.

**What uniqueness does NOT buy.** It guarantees the citation names one location; it
cannot guarantee that location is the *right* one. `:: condition 6` resolves against
a parenthetical cross-reference inside condition 2, not against condition 6 itself —
a unique anchor to a mention rather than to a definition. No mechanical rule can tell
those apart; only a reviewer reading the cited text can. This limit is written down
here so nobody later mistakes "the citation resolved" for "the citation is correct",
which is precisely the substitution this whole check exists to stop being made.

**Availability is unrestricted** — not limited to projects whose api/data contracts
are `not-applicable`. A project with a real HTTP API may cite this contract for an
information item that is genuinely about the gate/CLI/hook surface, without
fabricating an endpoint for it. This is not a dodge: resolution anchors to literal
text in `ci-gate-contract.md`, which describes gate/CLI/hook behaviour only, so an
information item about application data has nothing here to anchor to and must still
resolve against `api-contract.md` or `data-shape-contract.md`.

**Marker-aware degradation, mirrored.** If `ci-gate-contract.md` itself ever carries
`applicability: not-applicable`, citing it is its own HARD failure category with a
marker-aware message, identical in kind to the api/data-shape case below — never a
bare "reference not found".

**State-discriminator rule, unchanged mechanism.**
`checkStateDiscriminatorUniqueness` groups states by their raw, whitespace-normalized
citation string regardless of form. Under this form the discriminator is the full
`ci-gate: <heading> :: <substring>` string; no new discriminator concept is added.

Field-existence resolution reuses the ADR 0007 `contracts/api/openapi.json`
projection and does not re-derive it. If that projection is missing or stale
(`openapi export --check` would fail), OR the cited endpoint's `response schema`
cell is unresolved prose with no matching `## Schemas` entry, then any
endpoint+field citation is a HARD failure naming the fix — it never silently
passes: a citation asserting a field exists is a positive claim, and an
unverifiable positive claim must not pass a required blocking gate. Citations of a
bare HTTP status or an `errors`-column status do not require the projection and
remain checkable when `## Schemas` is empty.

If `contracts/api/api-contract.md` or `contracts/data/data-shape-contract.md`
itself carries `applicability: not-applicable`, citing that family's supplier kinds
is its own HARD failure category, with a marker-aware message naming the marker and
its reason — distinct from a bare "reference not found". Citing a family the
project has declared it does not have is a different, more actionable error.

Two UI states that differ in meaning MUST cite distinct discriminators. A state
citing a discriminator absent from the contract is a HARD error that drives the
convergence back-edge to `contract-reviewer`: the contract must supply the
discriminator (a field, a distinct HTTP status, an enum-pinned success-envelope
value) before either side freezes.

## Informational Gate Promotion Policy

`enforceAcceptanceOracle` ships required (see Required Check Policy) and has no
promotion-policy entry — it does not go through an informational period. This
is a deliberate exception to `ci/required-check-policy.md`'s general "new gates
begin as informational" guidance; the exception rationale is recorded above and
requires `ci-cd-gatekeeper` sign-off, not silent adoption.

`enforceInteractionDesign` is a second deliberate exception, bounded by
`isNewChange || strict` rather than being an unconditional day-one requirement.

The reverse/over-fetch advisory (a contract field with zero citing information
items) is a corpus-wide `cdd-kit doctor` report, permanently informational. It may
never be promoted to a gate finding: a per-change artifact cannot see sibling
screens, so a per-change computation would emit false advisories — the
context-blind failure ADR 0012 § Never Gated condemns.

## Artifact Retention Policy

- `specs/changes/<id>/acceptance.yml` is a first-class spec artifact: retained
  indefinitely as part of repo/change history (never pruned), same class as
  other required change artifacts.
- `.cdd/acceptance-lock.json` (per-change hash baseline) and
  `.cdd/asset-manifest.json` (install/refresh digest stamps) are regenerable
  sidecars, not source of record — safe to delete/regenerate, no retention
  requirement beyond current state (design.md Migration/Rollback).
- `specs/changes/<id>/interaction-design.md` is a first-class spec artifact:
  retained indefinitely, same class as `acceptance.yml`.
- `.cdd/design-lock.json` is a regenerable sidecar (per-change hash baseline), not
  source of record — safe to delete/regenerate, same class as
  `.cdd/acceptance-lock.json`.

## Rollback Policy

`enforceAcceptanceOracle` is additive: reverting the change removes the gate
check, the `acceptance.yml` template, `pre-tool-use-acceptance-write.sh`, and
digest stamping, with no data migration required. The `.cdd/acceptance-lock.json`
and `.cdd/asset-manifest.json` sidecars are regenerable and safe to delete on
rollback (design.md Migration/Rollback).

`enforceInteractionDesign` is additive: reverting the change removes the gate
check, the `interaction-design.md` template, `pre-tool-use-design-write.sh`, the
`design confirm` CLI, and the CI gate steps, with no data migration required.
`.cdd/design-lock.json` is regenerable and safe to delete on rollback.

## Contract Applicability Marker (ADR 0011)

Contract frontmatter may declare `applicability: not-applicable` with a
required, non-empty `applicability-reason: "<why>"` when a contract family
describes a surface the project genuinely does not have (e.g. a CLI has no
HTTP API / CSS / business-domain layer). The marker is read by a single shared
Python reader (`applicability.py`) imported by every semantic validator — the
Python layer is the SOLE pass/fail authority for this marker. `validate.ts`
reads the same field only to DISPLAY it in `doctor` output; it never makes its
own skip/fail decision from it (design.md decision 2 — no second authority, no
AC-6 divergence).

Marker semantics — fail-closed by default:

1. No `applicability` field, or `applicability: applicable` — validated
   exactly as today; an empty/placeholder stub still HARD-FAILS
   `cdd-kit validate`/`gate` unchanged (AC-2).
2. `applicability: not-applicable` + non-empty `applicability-reason` — the
   contract's presence/stub check and its family-specific semantic validator
   are SKIPPED, and `cdd-kit validate` emits an informational note naming the
   surface and the reason (not a failure, not silent) (AC-1).
3. `applicability: not-applicable` with a missing or empty
   `applicability-reason` — HARD ERROR, mirroring the tier-floor-override
   required-reason discipline: a bare skip with no justification is never
   allowed (AC-3).
4. Any unrecognized `applicability` value (e.g. a typo toward
   "not-applicable") — HARD ERROR; an unrecognized value is never treated as
   applicable-by-default or not-applicable-by-default.
5. A `not-applicable` contract whose body later exceeds the stub/placeholder
   threshold (i.e. now looks filled) is surfaced by `doctor`/`validate` as an
   advisory drift WARNING only — the mark may be stale — never a hard fail in
   this change (AC-7). Escalating drift to a hard error is an open follow-up,
   not yet scheduled.

**Fail-closed invariant:** a marker only suppresses its own family's check; an
unmarked stub still fails; a marker requires a reason.

`cdd-kit doctor` lists every not-applicable surface with its recorded reason as
informational output (AC-4).

First consumers: the kit's own `contracts/{api,css,business,data}` are marked
`applicability: not-applicable` (empty template stubs for surfaces this CLI
does not have) so `cdd-kit gate` on the kit itself goes green on those four
surfaces; `contracts/{ci,env}` are filled and remain unmarked, validated as
today.

Second consumer (ADR 0012): `specs/changes/<id>/interaction-design.md` — a
per-change spec artifact, not a `contracts/` family file — now also carries this
marker. `enforceInteractionDesign` reads it via the same `applicability.py` sole
authority, applied per-change rather than per-contract-family. This does not create
a second authority; it is a second file type read by the one existing reader.
