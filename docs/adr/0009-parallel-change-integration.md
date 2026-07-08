# ADR 0009: Parallel-change integration via reservation, fragments, and a contention matrix

- Status: Accepted
- Date: 2026-07-07
- Deciders: maintainer + AI delivery agent
- Relates to: `cdd-kit reserve`, `cdd-kit integrate`, `cdd-kit changelog build`,
  `cdd-kit parallel arm`, `.cdd/reservations.yml`, ADR 0002 (schema-carrying
  contract format), `references/parallel-worktree-standard.md`

## Context

A common workflow is to develop several tracked changes at the same time — one
git worktree per change — either because multiple proposals are already written
and ready, or because they were scaffolded and can proceed independently. The
superpowers methodology (github.com/obra/superpowers) gives good *fan-out*
mechanics for this (isolated worktrees, baseline verification, parallel agent
dispatch) but explicitly says nothing about *fan-in*: how the branches merge
back without conflict.

For cdd-kit that fan-in is where the pain is. Contracts carry a single
`schema-version` line in frontmatter (ADR 0002), the kit ships one shared
`contracts/CHANGELOG.md`, and `.cdd/*` indexes (code-map, policies) are
regenerated per worktree and tracked in git. So N parallel changes reliably
collide at merge time on exactly these shared, append-mostly governance
surfaces:

- two branches both bump `api` 1.2.0 → 1.3.0 → a textual conflict on that line
  **and** a semantic one the version validator rejects as a skip/downgrade;
- both prepend to `contracts/CHANGELOG.md` → a textual conflict;
- both regenerate `.cdd/code-map.yml` (123 KB) → a conflict on a file no human
  should ever hand-merge.

None of these are *logical* conflicts. The only conflict a human should actually
adjudicate is two changes editing the same contract clause. Today the kit
conflates the two, forcing the maintainer to hand-resolve merges or babysit a
`/loop`.

## Decision

Split the problem into **prevention** (make textual conflicts impossible) and
**escalation** (surface only genuine semantic overlap to a human), with three
mechanisms plus a merge-driver policy.

### 1. Reservation ledger (`.cdd/reservations.yml`)

Before branching, a coordinator reserves a distinct contract version lane per
(change, contract) on the base commit every worktree branches from. `cdd-kit
reserve` allocates the next free ascending target (bumping from the max of the
on-disk version and every already-reserved lane), so no two changes target the
same version. The ledger also records the named `surfaces` each change edits and
its changelog fragment path. Schema: `src/schemas/reservations.schema.ts`.

### 2. Changelog fragments (news-fragment / towncrier pattern)

Each change writes `contracts/changelog.d/<change-id>.md` instead of editing the
shared `CHANGELOG.md`. `cdd-kit changelog build` assembles fragments into the
`## Unreleased` section deterministically (sorted by change-id) at integration;
`--check` is a CI drift gate. Concurrent changes touch disjoint files → no
conflict.

### 3. Contention matrix + deterministic merge order (`cdd-kit integrate`)

Reads the ledger and classifies contention:

- **version-lane collision** — two changes reserve the same `to` (a lane-
  allocation bug or bad manual edit); reported as a warning to re-reserve.
- **surface collision** — two changes edit an overlapping named surface on the
  same contract; genuine semantic overlap that a human must resolve.

It emits a merge order sorted by each change's max reserved version ascending
(tie-broken by change-id) so bumps apply monotonically and the version validator
never sees a skip. Exit 0 when there are no surface collisions (integration is
automatable), exit 3 when a human is required.

### 4. Merge-driver policy (`.gitattributes` + `cdd-kit parallel arm`)

Regenerated `.cdd/*` indexes are marked `merge=ours` (keep current on merge, then
regenerate with `cdd-kit refresh`); `contracts/CHANGELOG.md` is `merge=union`.
`cdd-kit parallel arm` registers the `merge.ours.driver` git config the
`merge=ours` attribute needs (git has no built-in "ours" driver); `merge=union`
is built in.

## Consequences

- Textual conflicts on version lines, the changelog, and generated indexes are
  pre-empted; they never reach a human.
- The only escalation is a surface collision — the one decision a human should
  own — so parallel integration becomes a scriptable, deterministic sequence
  instead of a hand-controlled or `/loop`-babysat merge.
- Cost: a reservation step before fan-out, and changes must edit only their
  reserved surfaces and write changelog fragments. This is enforced by
  convention + `cdd-kit integrate`, not (yet) by a hard gate.
- Deliberately out of scope for this ADR: splitting the monolithic contract
  files into per-entry fragments (the deeper fix that would remove even
  same-file textual conflicts on disjoint rows). Reservation + surfaces make
  that unnecessary for version/changelog contention; contract-body fragmentation
  can be a follow-up ADR if same-file row conflicts prove painful in practice.
