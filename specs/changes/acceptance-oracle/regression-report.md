# Regression Report: acceptance-oracle

This change alters existing behavior of `gate`, `migrate`, `refresh`, `upgrade`,
`doctor`, and `test run`/`test select` for the kit's installed base, so regression
scope is recorded here as durable evidence (classifier-required).

## Behavior changes to existing surfaces
| surface | change | back-compat handling |
|---|---|---|
| `cdd-kit gate` | adds required `enforceAcceptanceOracle` check | `isNewChange \|\| strict` migration-window split (mirrors `enforceTestEvidence`): legacy/non-strict changes without `acceptance.yml` or an acceptance-phase run get a **warning**, not a hard error, so existing change dirs are not failed overnight. New changes and `--strict` are hard-gated. |
| `cdd-kit new` | scaffolds `acceptance.yml` for every new change | placeholder fails `enforceAcceptanceOracle` until authored (AC-1, intended fail-until-filled) |
| `cdd-kit migrate` | backfills placeholder `acceptance.yml` into in-flight change dirs | migrated change fails-until-filled (AC-7), never silently skipped |
| `cdd-kit refresh` / `upgrade` | pick up the new template generically; write `.cdd/asset-manifest.json` digest stamps | no code change needed for template pickup; stamping is additive |
| `cdd-kit doctor` | new asset-manifest drift check + acceptance-write chokepoint probe | additive findings only |
| `cdd-kit test run` / `test select` | new `acceptance` phase (discovers drivers under `test/acceptance/`, `tests/acceptance/`) | additive phase; NOT in `DEFAULT_REQUIRED_PHASES`, so only oracle-carrying changes need it |
| env contract | new `CDD_ACCEPTANCE_WRITE_STRICT` (default `0`) | additive, opt-in; default preserves current no-op behavior |

## Regression evidence
- **Full suite green:** `npm test` → 88 files passed, 1125 tests passed, 57 skipped
  (win32 POSIX-only skips for the sh-hook subprocess tests). Baseline before this
  change was 996 tests (release 3.7.0/3.7.1) — the delta is net-new coverage plus
  updated fixtures, with no pre-existing test removed or weakened.
- **Existing tests updated, not deleted** (Test Update Contract, test-plan.md): the
  new required check meant several "scaffold + fill → expect full gate pass"
  fixtures in `test/cli/gate.test.ts` (`feat-004`, `feat-004b`, `feat-015d`,
  `feat-015e`, `floor-pass`, `E4/ev-pass`) needed a real oracle + matching lock +
  an acceptance-phase evidence run added — this is the intended ADR 0010 behavior
  ("never silently skipped"), verified as such, not a masked regression.
- **Bug found & fixed during implementation:** `scanDriverForHardcodedExpect` was
  too strict where case ids share words with their expect values; tightened with a
  stopword list + id-overlap exclusion (3 new unit tests), all prior scan tests
  still green.

## Not a regression (pre-existing, unrelated)
- Repo-level `cdd-kit gate` red on empty `contracts/{api,css,business}` templates —
  byte-identical to HEAD, not touched by this change (git-clean). Tracked as a
  separate follow-up (see qa-report.md).
