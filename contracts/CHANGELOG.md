# Contracts Changelog

All notable contract surface changes belong here.
Format: Keep-a-Changelog (https://keepachangelog.com/).
Versions are semantic per contract type.

While a contract is at 0.x (draft), entries here are optional.
Once a contract reaches 1.0.0, every schema-version bump must have
a corresponding entry below.

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
