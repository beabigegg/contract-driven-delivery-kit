# Parallel Worktree Standard

How to develop several tracked changes at once in isolated git worktrees and
integrate them without hand-babysitting the merge. The fan-out mechanics are
adapted from the superpowers git-worktrees / parallel-agents skills
(github.com/obra/superpowers); the fan-in (reservation → contention → merge
order) is CDD-specific and is defined by ADR 0009.

## When to parallelize

Parallelize only changes whose **contract touch-sets are disjoint** — they edit
different endpoints, different rules, different tokens. Overlapping touch-sets
must be serialized, or the shared contract edit landed on the base branch first
so both changes branch from it (decided during `references/requirement-discovery.md`).

## Fan-out (before branching)

1. **Reserve version lanes on the base commit.** For each change × each contract
   it will touch, run `cdd-kit reserve <change-id> --contract <key> --bump
   <major|minor|patch> --surface <surface...> --branch <branch>`. This writes
   `.cdd/reservations.yml`, giving every change a distinct, ascending target
   version so no two branches bump the same contract to the same version.
2. **Arm the merge drivers once per clone:** `cdd-kit parallel arm`. With
   `.gitattributes` this keeps `.cdd/*` indexes as "ours" on merge (regenerate
   after) and union-merges the changelog append surface.
3. **Create one worktree per change**, branching from the reserved base commit.
   Prefer the harness's native worktree tool; else `git worktree add
   .worktrees/<branch> -b <branch>`. Verify the worktree dir is git-ignored and
   run the baseline test suite green before starting — you cannot tell a new
   failure from a pre-existing one otherwise.

## During development (per worktree)

- Each change edits **only its reserved surfaces** and bumps each contract's
  `schema-version` to exactly its reserved `to` value.
- Each change writes its changelog entry to its **own fragment file**
  `contracts/changelog.d/<change-id>.md` — never the shared
  `contracts/CHANGELOG.md` directly.
- Run the normal bounded test ladder and `cdd-kit gate <change-id>` inside the
  worktree.

## Fan-in (integration)

1. Run `cdd-kit integrate` from the base. It reads the ledger and prints a
   **contention matrix** plus a deterministic merge order (lowest reserved
   version first, so bumps apply monotonically and the version validator never
   sees a skip).
2. **Exit 0 / "no surface collisions"** → merge in the printed order. After each
   merge, regenerate indexes (`cdd-kit refresh`) and re-run `cdd-kit gate`.
3. **Exit 3 / surface collisions** → two changes edit the same contract surface.
   This is genuine semantic overlap; a human resolves it. Options: serialize the
   two, or land the shared edit on base and re-branch both.
4. After all merges, run `cdd-kit changelog build` to assemble the fragments
   into the `## Unreleased` section, then `cdd-kit validate` / the CI gate.

## Why this removes the "human-only / /loop" bottleneck

Textual conflicts on version lines, the changelog, and generated indexes are
pre-empted by reservation + fragments + merge drivers, so they never reach a
human. The only thing escalated is real semantic overlap on a shared surface —
which is the one decision a human *should* own. Everything else is a scriptable,
deterministic sequence.
