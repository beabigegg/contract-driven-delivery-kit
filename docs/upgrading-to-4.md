# Upgrading to 4.0.0

4.0.0 is a major release **because upgrading asks you to do something**: run
`cdd-kit reconcile` once. Everything else about the release was engineered so
that nothing you own changes without you seeing it first.

## TL;DR

```bash
npm install -g contract-driven-delivery   # 4.0.0
cdd-kit reconcile --plan                  # read-only: what would change, per surface
cdd-kit reconcile --yes                   # apply: refresh kit-managed files (backup first) + typed migrations
cat .cdd/migration/behavior-change-report.md   # what moved between YOUR old version and 4.0.0
cdd-kit doctor --strict                   # confirm chokepoints are live
```

`reconcile` supersedes the old "run `refresh`, then `upgrade`, then `migrate`
and hope the order was right" sequencing for version upgrades. Those commands
still exist and still work; `reconcile` is the one that understands the
difference between *your* files and *the kit's* files.

## What `reconcile` will and will not touch

Every surface in your repo resolves to exactly one bucket
(`contracts/upgrade/upgrade-reconciliation-contract.md` is the binding source):

| bucket | policy | examples |
|---|---|---|
| 1 — keep | **never overwritten** — mechanically refused by a write guard, not by convention | `contracts/**`, `src/**`, `tests/**` (your tests), `specs/changes/**`, `CLAUDE.md` outside the learnings markers, `.cdd/policy.yml` keys you set, `acceptance.yml`, `interaction-design.md`, hash-lock files, any agent/skill you modified |
| 2 — replace | force-refreshed, **after a backup** is written to `.cdd/.refresh-backup/` | `specs/templates/**`, `tests/templates/**`, unmodified kit-shipped agents/skills |
| 3 — reconcile | migrated by a typed migration with a reviewable plan | new `.cdd/policy.yml` keys (added at their SAFE default — a new gate never arrives armed), the `CLAUDE.md` `cdd-kit:learnings` region, the behaviour-change report |

Two invariants are enforced by a single guarded writer and checked by
`cdd-kit validate` on every run — they are promises, not intentions:

- **INV-1**: a key or surface new to this version arrives at its fail-open safe
  default. Upgrading never newly blocks you.
- **INV-2**: your ground truth is never flipped or overwritten. The guard
  refuses symlinked, junctioned, and hard-linked spellings of protected paths,
  fails closed on anything it cannot verify, and byte-proves from disk that
  protected content survived every narrow-channel write.

## The behaviour-change report

`reconcile --yes` writes `.cdd/migration/behavior-change-report.md`, comparing
**the version that last installed into this repo** (read from your asset
manifest, before the refresh re-stamps it) against 4.0.0. If you are jumping
several versions — the 3.6.0 → 3.13.1 case that motivated this feature — this
is the document that tells you which gate semantics moved, instead of you
finding out from a red CI.

## New changes scaffold smaller (`context-governance: v2`)

`cdd-kit new` now scaffolds **5 files (~310 lines)** instead of 9 (~674):
`change-classification.md`, `test-plan.md`, and `ci-gates.md` fold into
`tasks.yml` frontmatter (`classification:` block) and two sections of
`implementation-plan.md` (`## Test Plan`, `## CI Gates`). The gate holds v2
changes to the same substance checks in the new locations.

**Existing change directories are grandfathered forever.** A directory whose
`tasks.yml` says `context-governance: v1` (or predates the marker) keeps the
v1 artifact set and v1 gate rules. There is no migration to run and none is
planned — do not hand-convert old changes.

## If your install is old or messy: the clean-reinstall path

Uninstalling and reinstalling the **npm package** is always safe and fixes
version-skew phantoms (an old global binary answering for a new project):

```bash
npm uninstall -g contract-driven-delivery
npm install -g contract-driven-delivery
cdd-kit reconcile --yes
```

**Never hand-delete project files that look kit-ish.** `contracts/`,
`.cdd/policy.yml`, `acceptance.yml`, `interaction-design.md`, and everything
under `specs/changes/` LOOK like kit files but are YOUR ground truth — the
bucket map above exists precisely because humans (and agents) cannot reliably
tell the two apart under deadline. Let `reconcile` do the cleaning; it can
prove what it is allowed to touch.

## MCP note

If you registered the MCP server (`claude mcp add --scope user cdd-kit -- cdd-kit mcp`),
it launches the **global** binary: the new version is picked up the next time
your MCP host starts a session. If tool behavior looks stale, verify with
`cdd-kit --version` in the shell first — a lagging global binary answering for
a newer repo is the most common "phantom bug" report we receive.

## Why this is a major version

Nothing in 4.0.0 breaks an existing repo — v1 changes are grandfathered, every
command keeps working, and INV-2 mechanically guarantees your files survive.
It is major because SemVer's real signal is "read the notes, an action is
expected of you": here, one `reconcile` run. A version number that whispers
"patch" while the workflow visibly reshapes (5-file scaffolds, folded
sections, a new upgrade verb) would be the same defect this kit exists to
prevent — a claim narrower than the change.
