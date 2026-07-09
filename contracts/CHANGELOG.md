# Contracts Changelog

All notable contract surface changes belong here.
Format: Keep-a-Changelog (https://keepachangelog.com/).
Versions are semantic per contract type.

While a contract is at 0.x (draft), entries here are optional.
Once a contract reaches 1.0.0, every schema-version bump must have
a corresponding entry below.

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
