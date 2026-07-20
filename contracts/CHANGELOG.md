# Contracts Changelog

All notable contract surface changes belong here.
Format: Keep-a-Changelog (https://keepachangelog.com/).
Versions are semantic per contract type.

While a contract is at 0.x (draft), entries here are optional.
Once a contract reaches 1.0.0, every schema-version bump must have
a corresponding entry below.

## [upgrade 0.3.0] — 2026-07-20
### Changed
- **BREAKING (0.x minor) — the kit-shipped files of `tests/contract/**` are no
  longer bucket 1.** Routing `refresh`'s apply through the guard made
  `cdd-kit refresh --yes` THROW: the packaged response-shape harness lands under
  `tests/contract/`, which the whole-`tests/**` rule refused. Recorded as
  breaking because it removes surfaces from absolute bucket-1 protection.

  The narrowing is per-FILE, not per-directory, because `tests/contract/` is
  mixed ownership: the kit ships a README, an example JSON and a
  `samples/.gitkeep`, while `tests/contract/samples/*.json` holds the adopter's
  captured real responses (`docs/boundary-guard.md`) and stays ground truth.
  Membership is DERIVED from what the package actually ships rather than a
  hardcoded filename list, so a growing harness follows automatically and an
  adopter file that merely shares the directory never becomes writable. An
  unreadable asset directory yields "not kit-shipped" — fail safe.

## [upgrade 0.2.0] — 2026-07-16
### Added
- **`## Bucket-1 containers and their narrow channels`** — a binding, closed
  list of the two bucket-1 surfaces that are CONTAINERS (`.cdd/policy.yml`,
  `CLAUDE.md`) and the single narrow channel each permits, plus the four
  conditions a channel must satisfy to be binding (implemented inside the
  guarded writer; proves preservation byte-for-byte FROM DISK and restores on
  failure; never re-serializes a container it only means to extend; refuses or
  reports rather than guessing when the container is malformed or its region
  ambiguous). Adding or widening a channel is a breaking change under the same
  rule as reclassifying a bucket-1 surface.

### Changed
- **BREAKING (0.x minor) — `CLAUDE.md` bucket-1 row narrowed** to "everything
  OUTSIDE its `cdd-kit:learnings` markers". The kit already promised this in the
  CLAUDE.md template itself ("Anything you write outside the markers is yours and
  is never edited or evicted"), but this contract's row claimed the whole file,
  so the promise had no contract behind it and the region had no lawful writer.
  Recorded as breaking because it removes a surface from absolute bucket-1
  protection, which is the write-safety equivalent of disabling a bone.

### Fixed
- **`.cdd/policy.yml` per-key migration was unimplementable.** The contract's
  bucket-1 row already scoped protection to "user-set key values only" and
  `## .cdd/policy.yml is classified PER-KEY` already REQUIRED a genuinely-new key
  to be added at a safe default — but the guard refused the whole file, so the
  plan could print `needs-reconcile` and the apply could never honour it. The
  guard was stricter than its own contract; no protection is removed by fixing
  it. Found by building the first reconciler that had to use it: the framework
  shipped with an empty registry, so nothing had ever hit the wall.

## [upgrade 0.1.0] — 2026-07-14
### Added
- **Initial contract** (added by `reconcile-framework`, ADR 0014). Establishes
  the three-bucket (keep/replace/reconcile) surface taxonomy governing every
  kit upgrade path (`refresh`, `upgrade`, `update`, `reconcile`), the binding
  bucket-1 never-overwrite ground-truth enumeration, INV-1 (fail-open safe
  defaults for new surfaces/keys) and INV-2 (never flip / never overwrite
  existing ground truth via a single guarded writer), the per-key
  classification rule for `.cdd/policy.yml` (adopter-set key stays keep;
  genuinely-new key reconciles with a safe default), and `## Mechanical
  Enforcement` naming the four checks a validator must implement. Mechanically
  backed by the new `enforceReconciliationInvariants` gate check
  (`[ci 0.12.0]` below).

## [ci 0.13.0] — 2026-07-20
### Added
- **`enforceReconciliationInvariants` check #4 is now TWO scans.** The upgrade
  contract's Mechanical Enforcement #4 has two halves — fail-open-to-keep for
  malformed classifier input, AND a non-enforcing default for a newly-added
  surface/`.cdd/policy.yml` key (INV-1) — but only the first was scanned. The
  safe-default evidence could be deleted while a malformed-input test kept the
  check green. A named `safe-default` test whose body inspects `safeDefault` is
  now required, additionally searched under `test/cli/reconcile-bucket3.test.ts`.
  Bucket routing alone is explicitly NOT the evidence: a key correctly routed to
  `reconcile` and then added at an enforcing default still newly blocks the
  adopter.

### Changed (non-breaking)
- The subsection said **"Four checks"** and omitted the two narrow-channel
  checks that shipped in the same change (`narrow-channel-refusal`,
  `container-fail-open`). Now "Five checks (six scans)", with #5 enumerated. A
  binding contract that describes LESS than the code enforces is the same drift
  as one describing more — and only one of those two directions is caught by a
  red build, which is why this one survived.

## [ci 0.12.0] — 2026-07-14
### Added
- **`enforceReconciliationInvariants`** Gate Inventory row and subsection
  (added by `reconcile-framework`, ADR 0014), `ci-or-strict`, hosted by both
  `cdd-kit gate` and `cdd-kit validate` (same "two host commands" shape as
  `enforceConfirmationHookInstallation`). Enforces
  `contracts/upgrade/upgrade-reconciliation-contract.md` `## Mechanical
  Enforcement`'s four checks: bucket-1 matcher coverage, a single-writer static
  scan, and a recorded PASSED test for each of the two linchpin invariants
  (guard-refusal, fail-open). NOT gated on `isNewChange`; carries NO
  shadow-mode knob — a deliberate, permanent divergence from the Boundary
  Guard `shadow_mode` precedent, since INV-2 is contract-binding and
  non-negotiable.

## [ci 0.11.0] — 2026-07-14
### Added
- **Boundary Guard Enforcement Semantics** section (added by `boundary-ci-adopter-parity`,
  production issues #62 / #63 / #65). Binds the invariant that `cdd-kit gate <id>` and
  standalone `cdd-kit boundary check` derive the shadow/blocking decision from ONE shared
  source: with `.cdd/policy.yml` `shadow_mode: true` (shipped default) an `error` finding is
  advisory in both paths (exit 0); `cdd-kit boundary check --enforce` overrides shadow mode
  (exit 1); `shadow_mode: false` blocks both paths. Also binds single effective-base resolution
  reused for both changed-file detection and the changed-contract-operation snapshot (only the
  actually-changed operations selected when given `CDD_BASE_SHA` alone), and requires the
  shipped adopter workflow to pass `--base "$CDD_BASE_SHA"`.
- **Archive-only push robustness** subsection under Gate Inventory (added by
  `boundary-ci-adopter-parity`, production issue #61). Binds AC-6: the "Determine changed spec
  directories" step exits 0 with empty `ids` on an archive-only push under `bash -eo pipefail`,
  using a structured `if` form rather than a chained `&&` list.
### Note
- The underlying standalone `cdd-kit boundary check` exit-code default changes (1 → 0 in shadow
  mode); this is an intended parity correction with `cdd-kit gate`, with `--enforce` as the
  rollback path. Adopters see the behavior change on `npm` upgrade, not on a workflow edit — the
  package release notes must call this out.

## [ci 0.10.0] — 2026-07-13
### Added
- **Loosening policy — bone-audit** subsection under Informational Gate Promotion
  Policy (promoted by `agent-native-cdd-rearchitecture`). States exactly what the
  policy bone-audit mechanically enforces: a disabled bone protection
  (`boundary_guard.*`, `approvals.*` below `required`) fails `cdd-kit policy check`
  / `validate` / `gate` unless `.cdd/policy.yml` records a matching `loosening`
  acknowledgment (`id` + `reason` ≥10 chars); mutation-corpus "no defect escapes"
  evidence is the documented promotion standard carried in the optional `evidence`
  field, recorded and reviewed rather than mechanically gated; and parity reports
  `equivalent` only with per-mutation evidence, never from two green runs alone.

## [ci 0.9.0] — 2026-07-11
### Added
- **Two write-block hook behaviours promoted from implementation detail to contract
  requirement**, so the acceptance oracle can assert them from a real source instead of
  from observed behaviour (external review, round 3, found the oracle asserting both as
  if derived from the human's confirmed decisions when neither was written down):
  - A refusal (exit 2) **names the blocked lock file** on stderr, not merely that
    something failed.
  - A **permitting hook emits nothing** on stdout or stderr. The stated reason is
    corrected here: not "a speaking hook is indistinguishable from an absent one" (that
    is backwards — output would distinguish them), but that the broad `Write|Edit|
    MultiEdit` matcher fires the hook on every edit, so speaking on permit would narrate
    every unrelated write.
- The no-op confirm result line (`already matches …`) was already documented under
  `### Write-block hook discrimination axis` and needed no change; the oracle now cites
  that documented line rather than the incidental `left untouched` addendum.

## [ci 0.8.0] — 2026-07-10
### Changed
- **The write-block axis compares canonical paths, not strings.** External review of
  `920b9cc` found four path forms that reached exit 0 against the hook that had just
  been announced as armed: `.cdd/./design-lock.json`, `.cdd//design-lock.json`,
  `.CDD/design-lock.json`, and `D:\repo\.cdd\design-lock.json`. The last is what Claude
  Code actually sends on Windows, so "blocked unconditionally" was false on the machine
  that armed it. The hook now unescapes, folds separators, collapses runs, deletes `/./`
  segments, and lowercases before matching.
- **Hook commands must run through `sh`.** `chmodSync` is a no-op on Windows, so a
  Windows developer commits mode `100644` and a POSIX CI checkout gets `permission
  denied`; Claude Code treats that as a non-blocking error, so the chokepoint fails OPEN
  while `settings.json` says armed. Both write-block scripts were mode `100644` in this
  repository's own index — they had never carried the executable bit.
- **`enforceConfirmationHookInstallation` grew from two causes to six**, each with its
  own message: settings absent, settings untracked, hook unregistered, hook registered
  in the dormant shape Claude Code never executes, script path untracked, git declined
  to answer. The dormant-shape cause is the registered-looking no-op in its purest form,
  and the previous check certified it as armed.
- **`accept relock` / `design confirm` write nothing when the hash is unchanged.** Both
  called the lock writer before comparing, so a re-run replaced `locked-at`, `timestamp`,
  `tty`, and `git-author` and then printed "no change" — erasing the audit clue of the
  original confirmation while announcing that nothing had happened.
- Corrected a stale sentence in `enforceAcceptanceOracle` condition 2 that still
  described `CDD_ACCEPTANCE_WRITE_STRICT`, retired in `[env 0.3.0]`.

### Added
- **Provider carve-out.** A project whose `.cdd/model-policy.json` names a non-Claude
  provider gets one ADVISORY finding on stdout — never an error, not even in CI —
  stating that the write-block hooks do not exist for that harness. Failing a project
  for not installing a hook it cannot install is the mirror image of announcing a
  guarantee that does not hold. An absent policy file reads as `claude`. Human decision.

## [ci 0.7.0] — 2026-07-10
### Changed
- **`enforceConfirmationHookInstallation` is `ci-or-strict`, not `strict-only`.**
  Found by external review of `[ci 0.6.0]`, one commit after it landed. `--strict`
  names exactly two moments and neither precedes a merge: the CI job sets
  `STRICT_FLAG` only when `github.event_name == "push"`
  (`.github/workflows/contract-driven-gates.yml:109`), which is after the change is
  on the default branch; and the local pre-commit hook, which `--no-verify` bypasses
  — as every commit in this very change has done. `pull_request` warned and merged.
  The check now hard-fails whenever `CI` is truthy (any event) or under `--strict`,
  and warns in a default local run. The `strict-only` vocabulary value is removed and
  documented as un-reintroducible.
- **Consequence, stated in the contract because it bites:** the check is not bounded
  by `isNewChange`, so in CI it fails *every* change directory until the project
  tracks `.claude/settings.json` and registers both write-block hooks. Check and
  arming must land in the same commit.

## [env 0.4.0] — 2026-07-10
### Added
- **`CI`** documented as a consumed input: when truthy,
  `enforceConfirmationHookInstallation` errors rather than warns. Read, never written.
  Chosen over an explicit `--require-hooks` workflow flag, which would have been a
  fifth guarantee that has to be remembered to be wired up.

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
