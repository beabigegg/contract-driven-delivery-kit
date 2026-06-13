---
name: cdd-consolidate-guidance
description: One-time cleanup of a CLAUDE.md/CODEX.md that has bloated from repeated cdd-kit lesson promotion. Migrates accumulated promoted learnings into the cdd-kit:learnings managed region, consolidates and dedupes them into one-line-plus-pointer entries, and externalizes detail to contracts/ or docs/. Never touches human-authored content. Args: none (operates on CLAUDE.md/CODEX.md in cwd)
---

# cdd-consolidate-guidance — Shrink a bloated cdd-kit CLAUDE.md

## Purpose

`CLAUDE.md` is loaded into **every** session, so its size is a recurring token
cost. Projects that have run `/cdd-close` many times accumulate promoted
"lessons learned" by appending, and the file grows without bound.

This skill is a **one-time migration** for an existing cdd-kit project: it folds
the accumulated promoted guidance into the delimited `cdd-kit:learnings` managed
region in the consolidated **one-line + pointer** format, moves the real detail
to `contracts/` or `docs/`, and removes duplicates and contract-superseded
entries — so future `/cdd-close` runs stay net-zero (see [[cdd-close]] Step 3).

It is **conservative and reversible**: it never edits human-authored content, it
proposes a full plan before writing anything, and it relies on git for undo.

## Scope and safety (read first)

- **Only operate on cdd-kit-promoted guidance.** That means content that is
  clearly kit operational guidance / promoted lessons — e.g. under headings like
  `## CDD Operational Notes`, `### Promoted Learnings`, or bullets that read as
  durable agent/workflow rules promoted by a past `/cdd-close`.
- **Everything else is the human's.** Project overview, architecture, dev
  commands, personal notes, and anything ambiguous → **leave untouched**. When in
  doubt, treat it as human-authored and keep it verbatim.
- **Never delete silently.** Every removal/merge appears in the plan for approval.
- **Detail goes out, not away.** When a long entry is shortened to a pointer, the
  removed detail must first exist in `contracts/` or a `docs/…` file. If it has no
  home yet, create the `docs/…` file (or propose a contract addition) *before*
  shortening the CLAUDE.md line. Never drop information that has no other home.

## Input

No argument. Operates on `CLAUDE.md` (and `CODEX.md` if present) in the current
working directory. If neither exists, stop and report that there is nothing to
consolidate.

## Step 0: Preconditions

1. Confirm the working tree is clean or tell the user to commit/stash first —
   this skill edits `CLAUDE.md` and git is the undo path. Do not proceed with
   uncommitted changes unless the user explicitly says to.
2. Read `CLAUDE.md` (and `CODEX.md`). Record the current line count / approx
   token size for the before/after report.

## Step 1: Classify every section

Walk the file top to bottom and bucket each block:

- **human-authored** — project overview, architecture, dev commands, anything
  not recognizably kit-promoted guidance, anything ambiguous. → keep verbatim,
  never move or edit.
- **kit-boilerplate** — the scaffolded sections (`## CDD Kit Commands`,
  `## Recommended MCP Tools`, `## Context Governance`, `## API Conformance`, the
  default bullets of `## CDD Operational Notes`). → keep as-is; not learnings.
- **promoted-learning** — durable rules a past `/cdd-close` appended (project/
  domain rules, migration cautions, gotchas). → these are the migration targets.

Output the buckets so the user can correct any misclassification before edits.

## Step 2: Consolidate the promoted-learnings bucket

For the promoted-learning entries only:

1. **Dedupe / merge.** Fold entries that say the same thing or where one
   generalizes another into a single entry.
2. **Drop superseded.** Remove anything contradicted by, or already encoded in,
   current `contracts/` (verify with `cdd-kit contract query` / reading the
   contract). A rule that now lives in a contract does not also belong in
   CLAUDE.md.
3. **Externalize detail.** For each surviving entry, ensure the full detail lives
   in `contracts/` (preferred — queried on demand) or a `docs/…` file, then
   reduce the CLAUDE.md entry to **one line: rule + pointer** (`… — see
   contracts/…` or `… — see docs/…`).
4. **Place inside the managed region.** Put the consolidated one-liners between
   `<!-- cdd-kit:learnings:start -->` and `<!-- cdd-kit:learnings:end -->` under a
   `### Promoted Learnings` heading. If the markers do not exist yet, create them
   once at the end of the file. Remove the now-migrated bullets from wherever they
   used to live (only the promoted-learning bucket — never boilerplate or human
   content).

## Step 3: Present the plan and get approval

Before writing, show:

```
## CLAUDE.md consolidation plan

Before: <N> lines (~<T> tokens)
After:  <M> lines (~<t> tokens)   (-<X>%)

Kept untouched (human-authored): <count> sections
Kept (kit boilerplate): <count> sections

Promoted learnings: <A> entries → <B> entries
  - merged:      <list: which entries folded together>
  - dropped:     <list: entry → which contract now owns it>
  - externalized:<list: entry → target contracts/… or docs/… created>
  - kept as-is:  <list>

New files to create: <docs/… or contract additions, with content>
```

Make NO edits until the user approves. If the user flags a misclassification,
re-bucket and re-plan.

## Step 4: Apply

After approval:

1. Create the externalized `docs/…` files / apply approved contract additions
   first (so no detail is lost).
2. Edit `CLAUDE.md` (and `CODEX.md`): write the consolidated managed region,
   remove the migrated source bullets. Touch nothing outside the recognized
   promoted-learning blocks and the managed region.
3. If contracts changed, run `cdd-kit validate --contracts` and
   `cdd-kit context-scan`.
4. Remind the user to review the diff and commit (this is the undo boundary).

## Step 5: Report

```
## cdd-consolidate-guidance complete

CLAUDE.md: <N> → <M> lines  (~<X>% / ~<tokens> tokens saved per session)
Promoted learnings: <A> → <B> entries (now one-line + pointer, inside the managed region)
Detail moved to: <list of contracts/… and docs/… targets>
Human-authored content: unchanged.

Review the diff and commit to lock this in.
```

## Rules

- NEVER edit, move, or delete anything outside recognized kit guidance — human
  content and ambiguous content are off-limits.
- NEVER shorten an entry to a pointer before its detail has a home in
  `contracts/` or `docs/`.
- NEVER write before the user approves the plan.
- Default to `contracts/` for product/behavior detail; CLAUDE.md keeps only the
  one-line rule + pointer.
- This is a one-time cleanup; ongoing net-zero discipline is enforced by
  [[cdd-close]] Step 3.
