---
change-id: <id>
schema-version: 0.1.0
last-changed: <date>
# ADR 0011 skip escape -- leave both lines commented out for any change that has
# a real screen, control, or user-facing state (almost every change does).
# Uncomment BOTH only if this change truly has NO user-facing surface (a pure
# backend job, a migration, a CLI-only change). `applicability-reason` is then
# REQUIRED and non-empty or `cdd-kit gate` HARD-fails: a bare skip with no
# justification is never allowed. When set, DELETE THE REST OF THIS FILE -- the
# gate reads only the marker, and empty tables left behind are pure noise.
# applicability: not-applicable
# applicability-reason: <why this change genuinely has no UI surface>
---

# Interaction Design: <change-id>

**How to fill this in: `docs/interaction-design-guide.md`.** Read it once; it has
the five provenance citation forms, a worked example per section, and the rules for
who writes what. It is not repeated here — this file is your answers, not the manual.

The short version: every row answers a real question a real user has, every citation
points at a specific row in `contracts/api/api-contract.md` or
`contracts/data/data-shape-contract.md`, and nothing here is ever about colour,
spacing, motion, or taste.

## Screens

| screen | who is here | what they are deciding | what they fear | what would make them abandon | what must not be shown |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Presented Information

| item | rationale | provenance |
|---|---|---|
|  |  |  |

## User Intents

| id | intent | frequency | path |
|---|---|---|---|
|  |  |  |  |

## Controls

<!-- `intent` cites EXACTLY ONE id from User Intents. A control that cannot name
     the one intent it serves does not exist -- it goes to Deleted Controls. -->

| id | control | intent |
|---|---|---|

### Deleted Controls

| control | reason |
|---|---|

## States

<!-- `discriminator` is how the CONTRACT tells this state apart from every other
     one. Two rows with different meanings can never cite the same discriminator --
     the gate enforces that mechanically. -->

| id | meaning | discriminator |
|---|---|---|
|  |  |  |

## Reversibility


## Consistency Commitments


## Open Decisions

<!-- Mark `- [x]` only once the human's real answer is transcribed below. An
     unresolved `- [ ]` fails the gate on purpose. -->

- [ ] <a real open question, with the options and trade-offs the human must decide between>

## Confirmed

<!-- AGENT-FORBIDDEN. No agent -- not interaction-designer, not main Claude acting on its own judgment, not any other role -- may invent, paraphrase, or "fill in" an answer here. -->
<!-- Only a real, transcribed human answer belongs in this section, one per resolved Open Decisions item above, dated. -->
<!-- Once every Open Decisions item above has a real transcribed answer here, lock this file against later tampering by running: cdd-kit design confirm <this-change-id> -->
<!-- That command is the ONLY sanctioned writer of .cdd/design-lock.json. A pre-tool-use-design-write.sh hook additionally blocks any agent from writing that lock file directly. -->
<!-- If this section is edited after locking, cdd-kit gate fails with: "interaction design modified after confirmation -- human must re-confirm." That is intentional: re-confirm, never silently trust an unreviewed edit. -->
