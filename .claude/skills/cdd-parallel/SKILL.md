---
name: cdd-parallel
description: Develop several tracked changes at once in isolated git worktrees and integrate them without merge conflicts on contracts, versions, or the changelog. Use when multiple proposals are ready (or scaffolded) and should proceed concurrently. Args: <change-ids or natural-language list of the parallel changes>
---

# cdd-parallel — Parallel change fan-out and fan-in

Full method: `contract-driven-delivery/references/parallel-worktree-standard.md`.
Design rationale: `docs/adr/0009-parallel-change-integration.md`.

## When to use

Multiple tracked changes should be developed at the same time in separate
worktrees. Only parallelize changes whose **contract touch-sets are disjoint**
(different endpoints, rules, tokens). If two changes edit the same contract
surface, serialize them or land the shared edit on base first — decide this
during `references/requirement-discovery.md`, not after the conflict.

## Phase 1 — Fan-out (on the base branch, before branching)

1. Confirm each change is scaffolded (`/cdd-new` per change) and its contract
   touch-set is known.
2. Reserve a version lane per (change, contract):
   ```bash
   cdd-kit reserve <change-id> --contract <api|css|env|data|business|ci> \
     --bump <major|minor|patch> --surface <surface...> --branch <branch>
   ```
   Repeat for every contract each change touches. This writes
   `.cdd/reservations.yml` with distinct ascending target versions.
3. Arm the merge drivers once in this clone: `cdd-kit parallel arm`.
4. Verify no contention before you branch: `cdd-kit integrate`. Resolve any
   surface collision now (serialize or land-shared-first).
5. Create one worktree per change from the reserved base commit; run the
   baseline test suite green in each before starting.

## Phase 2 — In each worktree

- Edit **only** the change's reserved surfaces; bump each contract's
  `schema-version` to exactly its reserved `to`.
- Write the changelog entry to `contracts/changelog.d/<change-id>.md` — never
  the shared `contracts/CHANGELOG.md`.
- Run the bounded test ladder and `cdd-kit gate <change-id>` as usual.

## Phase 3 — Fan-in (integration)

1. `cdd-kit integrate` — read the contention matrix and merge order.
   - **Exit 0** → merge in the printed order; after each merge run
     `cdd-kit refresh` (regenerate indexes) and `cdd-kit gate`.
   - **Exit 3** → surface collision; a human resolves it. Do not force-merge.
2. After all merges: `cdd-kit changelog build`, then `cdd-kit validate` / CI.

## What this buys

Conflicts on version lines, the changelog, and generated indexes are pre-empted,
so they never need a human. Only genuine semantic overlap on a shared contract
surface is escalated — everything else is deterministic and scriptable.
