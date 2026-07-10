# Contracts Changelog

All notable contract surface changes belong here.
Format: Keep-a-Changelog (https://keepachangelog.com/).
Versions are semantic per contract type.

While a contract is at 0.x (draft), entries here are optional.
Once a contract reaches 1.0.0, every schema-version bump must have
a corresponding entry below.

## [ci 0.6.0] — 2026-07-10
### Added
- **Sixth provenance citation form, `ci-gate:`.** Until now every join target
  required an HTTP API endpoint or a tabular data-shape row. Both families are
  `applicability: not-applicable` for this kit — and for any CLI, library,
  data-pipeline, or desktop adopter — and citing a not-applicable family is itself
  a HARD failure. So **no `interaction-design.md` written for this repository could
  ever pass**, and the only escape was to mark the whole artifact not-applicable.
  That is why `.cdd/design-lock.json` had never existed: ADR 0012's confirm path had
  never once run outside unit tests, because it could not. Measured, not argued —
  `cdd-kit gate` on this change emitted 20 hard failures, one per Presented-
  Information and States row, all reading "does not match any of the ADR 0012 §2
  citation forms". `contracts/ci/ci-gate-contract.md` is now itself a join target:
  `ci-gate: <heading> :: <exact substring>` resolves only when the substring occurs
  EXACTLY ONCE in the named section. Zero occurrences fails as not-found; two or
  more fails as ambiguous. Section-existence alone would be nearly vacuous, and so
  would any-substring: `:: the` occurs 23 times and is rejected, a bare `:: AC-4`
  occurs 3 times and is rejected, forcing the author to cite distinguishing prose.
  The contract also records what uniqueness does NOT buy — a unique anchor to a
  mention is not an anchor to a definition, and no mechanical rule can tell them
  apart.
- **`sectionBody` (`src/utils/markdown-section.ts`) fixed, not routed around.** Two
  defects: its terminator was the literal `\n## `, which a `### ` line does not
  satisfy, so a `###` section's body swallowed every sibling below it — bounded only
  by being the last `###` before the next `##`. Inserting this change's own
  `### enforceConfirmationHookInstallation` would have taken the anchor
  `:: zero unresolved` from one occurrence to two. And its opening match was not
  line-anchored, so `## X` could match inside `### X`. It now captures the matched
  heading's level and terminates at the next same-or-shallower heading, anchored to a
  full line. A first draft of the sixth citation form put a second scanner in
  `design-provenance.ts` to avoid touching the shared util; that would have
  reintroduced, at a third call site, exactly the parser drift `markdown-section.ts`
  was centralized to prevent. Verified behaviour-preserving: all twelve headings the
  five current consumers look up return identical text before and after, including
  `design-hash.ts`'s `## Confirmed` projection, so no recorded baseline shifts.
- **`enforceConfirmationHookInstallation`.** Verifies the design/acceptance
  write-block PreToolUse hooks are registered in the project `.claude/settings.json`,
  with two distinct absence causes (file missing; file present but the entry absent)
  carrying distinct messages. `strict-only`: warns on stdout by default, hard-fails
  on stderr under `--strict`. The registered `command` must resolve to a git-tracked
  path — a first draft of this check read `.claude/settings.json`, which is untracked,
  and would therefore have hard-failed every push to the default branch forever,
  reproducing the very defect it was written to catch.
- **`required` column vocabulary** (`yes` / `strict-only`) above the Gate Inventory.
  A check that only warns in the mode most people run must not be listed as `yes`.

### Fixed
- **Write-block hook discrimination axis.** `CDD_DESIGN_WRITE_STRICT` /
  `CDD_ACCEPTANCE_WRITE_STRICT` were a global toggle with no agent identity in the
  hook payload: `1` blocked every write, including the sanctioned first write and the
  transcription of the human's own answers; `0`, the default, blocked nobody. It
  admitted no working configuration. Both hooks now discriminate on the write TARGET
  PATH — a direct `Write`/`Edit`/`MultiEdit` of `.cdd/design-lock.json` /
  `.cdd/acceptance-lock.json` is blocked unconditionally; the artifact body stays
  writable. Not claimed as prevention: a `Bash`-holding agent shares the human's
  filesystem and user account and can still reach the lock. The contract now says so
  in those words, and records the git-author / TTY / timestamp provenance the lock
  carries as *evidence*, explicitly not as a boundary.
- **`enforceInteractionDesign` condition 1 bundled three distinct runtime branches**
  ("exists and is non-placeholder") into one sentence, while `gate-design.ts` has
  always evaluated existence, stub-detection, and placeholder-detection separately
  with three different messages. Split into three citable sub-conditions, because
  "absent", "unwritten", and "half-written" are three situations a human resolves
  three different ways.
- **New condition 2 (`AC-1`): the derivation chain may no longer be vacuous.**
  `## Presented Information` and `## States` must each carry at least one row.
  Provenance reconciliation over an empty set passed trivially, so a human could
  confirm — and the gate would bless — a design document that asserted nothing.
  `applicability: not-applicable` remains the single sanctioned escape.
- **ADR 0012 §5 and §8 no longer announce a guarantee that does not exist.** §5
  asserted, present-tense, that `pre-tool-use-design-write.sh` "blocks agent
  Edit/Write to `.cdd/design-lock.json`". The hook was never registered in this
  repository — `.claude/settings.json` arms only a Read→graph-first and a
  Bash→test-runner hook, and `installAgentHooks` arms a write-block hook only on an
  explicit opt. It blocked nothing. §8 claimed every guarantee "lives in
  settings.json hooks" without saying that registration is opt-in and unverified.

## [env 0.3.0] — 2026-07-10
### Deprecated
- **`CDD_ACCEPTANCE_WRITE_STRICT`.** `pre-tool-use-acceptance-write.sh` no longer
  consults it (see `[ci 0.6.0]` above). Accepted and ignored; retained for the
  `deprecate-2-minors` window (removal at env >= 0.5.0). `CDD_DESIGN_WRITE_STRICT`
  — read by `pre-tool-use-design-write.sh` yet never documented in this contract, a
  pre-existing gap — is deliberately NOT added as a newly documented variable: the
  same change retires the axis it controlled. Recorded so a later maintainer does not
  "fix" the gap by documenting a variable that does nothing.

## [ci 0.5.0] — 2026-07-09
### Fixed
- **Hash-lock truthfulness (`enforceInteractionDesign` cond. 6, `enforceAcceptanceOracle`
  cond. 2).** Both checks treated a MISSING lock baseline as a warning and passed the
  gate. Because both write-block hooks are advisory unless their `*_WRITE_STRICT` env
  var is set, any Edit-capable agent could author its own `## Confirmed` section (or its
  own `acceptance.yml` answer key), never run the confirm/relock command, and sail
  through — so the human-confirmation guarantee at the centre of ADR 0010 and ADR 0012
  did not exist in the default configuration. `cdd-new/SKILL.md` stated the opposite
  outright ("Until that command runs, `cdd-kit gate` keeps failing this artifact on
  purpose"). A missing baseline is now an ERROR under `isNewChange || strict` — the same
  migration window every neighbouring check already uses, so no legacy change dir is
  newly broken. Reported by an external review of `3.10.0`; same defect class as the
  three trigger/`rules[]`/`abandon` fixes below, in the very change that shipped them.
- **CI changed-spec detection hardened.** The detect step now declares `shell: bash`
  (the implicit default is `bash -e {0}` — *without* `pipefail`), so a genuine
  `git diff` failure fails the step instead of being masked by the last pipeline
  stage's exit status. Enabling `pipefail` makes `grep -oE`'s exit-1-on-no-match
  load-bearing, so the extraction is now `sed -n .../p` (silent, exit 0). The first-push
  fallback also switched to `git rev-parse --verify --quiet HEAD^`: a bare
  `git rev-parse HEAD^` echoes the unresolvable argument to stdout before failing, so
  the `||` fallback concatenated `HEAD^` with the empty-tree sha. A stray file directly
  under `specs/changes/` (e.g. a README) is no longer mistaken for a change id.
- **This repo's own workflow invoked a script that does not exist.** The fast-gate
  step ran `npm run lint && npm run typecheck && npm test`; `package.json` defines
  no `lint` script, so the job would have failed on its first execution. It never
  executed: the workflow file was untracked until 3.10.0 added it. Replaced with the
  scripts that exist (`typecheck`, `check:mojibake`, `test`), each verified to pass
  locally. Adopter template unaffected (its fast-gate step is a documented placeholder).

## [ci 0.4.0] — 2026-07-09
### Added
- `enforceInteractionDesign` required gate check (ADR 0012): fails a change whose
  `interaction-design.md` is missing or placeholder, has any unresolved
  `## Open Decisions`, lacks a human `## Confirmed`, breaks control↔intent /
  intent↔path referential integrity, whose provenance reconciliation has any HARD
  failure (unresolvable endpoint/schema-field, `errors`-column HTTP status,
  implicit HTTP status, or `## Invalid Data Behavior`-row citation; or two
  meaning-distinct UI states sharing one discriminator), or whose confirmed-region
  hash diverges from `.cdd/design-lock.json`. Uses `isNewChange || strict`;
  skippable via `applicability: not-applicable` on `interaction-design.md`
  (ADR 0011). Reverse-direction over-fetch (a contract field with zero citing
  information items) is corpus-wide, `doctor`-reported, advisory-only, and may
  never be promoted to a gate finding.
- `## Provenance Reconciliation Policy` — the join rules, citation forms, and
  degradation rules for the above check.
- Explicit never-gated prohibition: this check may never fail a change on visual
  aesthetics, motion, layout taste, typography, colour, or latency / round-trip
  count.

### Fixed
- **Trigger truthfulness.** The Gate Inventory claimed `enforceAcceptanceOracle`
  ran on `pull_request`, but the shipped workflow only ran `cdd-kit validate` and
  never invoked `cdd-kit gate <id>` — every required check ran solely in a local
  pre-commit hook that `--no-verify` bypasses. Both workflow files now derive the
  touched `specs/changes/<id>/` from the PR/push diff and run `cdd-kit gate` on
  each (`--strict` on push to the default branch), making the documented trigger
  true for both inventory rows.
- **`rules[]` binding truthfulness.** `enforceAcceptanceOracle` condition 6 and
  ADR 0010 §4 both documented a `--strict`-mode requirement that each
  `acceptance.yml` `rules[]` invariant have >=1 bound test; the identifier
  `rules` never appeared in `gate-acceptance.ts` — the check did not exist.
  Implemented (`findUnboundRules`, `src/utils/mock-of-sut-scan.ts`), reusing
  the same change-scoped (`driverBelongsToChange`) and whole-token
  (`isWordBoundaryOccurrence`) guards AC-4's mock-of-SUT scan already applies,
  so this new scan does not reproduce that scan's own two dogfooding-exposed
  false-positive bugs (cross-change contamination; substring matching).
  `--strict` only; `rules: []` (or no `rules` key — every pre-existing change
  dir except this one) passes trivially and is not newly broken.
- **`cdd-kit abandon` truthfulness.** `abandon.ts` skipped its status write when
  the change directory had no `tasks.yml` (the normal state of a stale directory)
  and then unconditionally printed `Change <id> marked as abandoned.` — announcing
  a guarantee that had not happened. It now returns a discriminated result, creates
  a minimal `tasks.yml` when absent, hard-fails on an empty `--reason` before
  writing anything, and the CLI prints what actually occurred. Same defect class as
  the `installHooks` soft-skip false success.
- **`validate_spec_traceability.py` understands `status: abandoned`.** The
  validator enforced its five required artifacts unconditionally and had no concept
  of an abandoned change, so `cdd-kit abandon` could never make `cdd-kit validate`
  pass — a permanently red `validate` (and, once this change wires `validate` into
  CI, a permanently red CI) for any adopter who abandoned a change. It now skips a
  directory marked `status: abandoned` with a non-empty `abandoned-reason`, printing
  an informational note; a marker with no reason is a HARD ERROR; an unmarked
  incomplete directory still HARD-FAILS. Same marker discipline as ADR 0011.
- **Acceptance drivers survive archival.** Both shipped loaders
  (`specs/templates/acceptance-driver/acceptance.loader.ts` and
  `acceptance_loader.py`) hardcoded `specs/changes/<id>/acceptance.yml`, so every
  acceptance driver broke the moment `cdd-kit archive` moved its change to
  `specs/archive/<year>/<id>/` — the ADR 0010 oracle silently stopped being proven
  at exactly the moment the change was closed. Both now resolve the archived
  location too, with a regression test.

No `schema-version` bump accompanies these three fixes: `validate_spec_traceability.py`
and the driver loaders are not governed by a `contracts/` schema-version, and the
`abandon` fix makes a documented promise real rather than changing a contract surface.

## [ci 0.3.0] — 2026-07-09
### Added
- Contract applicability marker semantics (ADR 0011): a contract frontmatter
  `applicability: not-applicable` field with a required non-empty
  `applicability-reason` causes that contract's presence/stub check and
  family-specific semantic validator to be SKIPPED with an informational
  note; an unmarked empty/placeholder contract still HARD-FAILS unchanged; a
  marker without a reason, or with an unrecognized value, is a HARD ERROR; a
  marked contract that later gains real content surfaces as an advisory drift
  WARNING only. Enforcement authority is the Python semantic-validator layer
  (`applicability.py`); `validate.ts` reads the marker for `doctor` display
  only, never for pass/fail.

## [ci 0.2.0] — 2026-07-08
### Added
- `enforceAcceptanceOracle` required gate check (ADR 0010): fails a change
  whose `acceptance.yml` is missing/placeholder, whose oracle hash diverges
  from its author-time baseline, whose driver mocks the SUT, or whose case
  pass is not a recorded `acceptance`-phase evidence run; migrated changes
  fail-until-filled. Ships required, not phased in as informational.

## [env 0.2.0] — 2026-07-08
### Added
- `CDD_ACCEPTANCE_WRITE_STRICT` (boolean-ish `0`/`1`, default `0`, not secret):
  advisory-vs-hard-block mode for the `pre-tool-use-acceptance-write.sh`
  PreToolUse hook. Mirrors `CDD_CONTRACT_WRITE_STRICT`.

## [api 0.1.0] — 2026-04-27
Initial draft.

## [css 0.1.0] — 2026-04-27
Initial draft.

## [env 0.1.0] — 2026-04-27
Initial draft.

## [data 0.1.0] — 2026-04-27
Initial draft.

## [business 0.1.0] — 2026-04-27
Initial draft.

## [ci 0.1.0] — 2026-04-27
Initial draft.
