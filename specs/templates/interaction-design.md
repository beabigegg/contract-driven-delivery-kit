---
change-id: <id>
schema-version: 0.1.0
last-changed: <date>
# ADR 0011 skip escape -- leave the two lines below commented out for any
# change that has a real screen, control, or user-facing state (almost every
# change does). Only uncomment BOTH lines if this specific change truly has
# NO user-facing surface at all (a pure backend job, a database migration, a
# CLI-only change with no screens). If you uncomment `applicability`,
# `applicability-reason` becomes REQUIRED and must be non-empty, or
# `cdd-kit gate` HARD-fails on purpose -- a bare skip with no justification
# is never allowed (ADR 0011; see docs/adr/0011-not-applicable-contract-marker.md).
# applicability: not-applicable
# applicability-reason: <why this change genuinely has no UI surface>
---

# Interaction Design: <change-id>

<!--
WHAT THIS FILE IS FOR (read this before touching anything below).

Every other kind of mistake in this kit gets caught by a contract. This file
closes the one gap nothing else catches: an AI agent quietly deciding, on its
own judgment, what a screen shows, why a button exists, and how a user tells
one state of the world apart from another. Those are HUMAN decisions. This
file forces them into human hands and then locks the human's answer so no
later agent edit can quietly change it back.

WHO WRITES WHAT (the roles are strict; do not blur them):
  1. `interaction-designer` (an AI agent, READ-ONLY) fills in the derivation
     chain below -- Screens, Presented Information, User Intents, Controls,
     States, Reversibility, Consistency Commitments -- and writes the open
     questions into `## Open Decisions`. It is structurally incapable of
     writing `## Confirmed` (its tools are Read/Grep/Glob only).
  2. Main Claude runs a plain-language conversation with YOU (the human) to
     work through `## Open Decisions`.
  3. YOU decide. Main Claude transcribes your actual answers -- not a
     paraphrase, not "close enough" -- into `## Confirmed`.
  4. YOU (or whoever runs the CLI on your behalf) lock it in:
         cdd-kit design confirm <this-change-id>
     Until step 4 happens, `cdd-kit gate` will keep failing this change on
     purpose -- that is not a bug, it is the whole point (mirrors how
     `specs/changes/<id>/acceptance.yml` works for behavior, ADR 0010).

HOW TO FILL THIS IN, IN PLAIN LANGUAGE (no code-reading required):
  - Every row you add should answer a real question a real user has. If you
    cannot say which question an item answers, it probably should not be on
    the screen (this is the same "does this need to exist at all" question
    the kit already asks about code, now asked about the interface).
  - Every citation (the `provenance` / `discriminator` columns) points at a
    specific row in `contracts/api/api-contract.md` or
    `contracts/data/data-shape-contract.md` -- see `## Provenance` below for
    the exact five ways to write one. If nothing in those contracts can back
    up what the screen wants to show, that is not a template-filling
    problem -- it means the backend contract needs to grow a field first.
    `interaction-designer` will loop back to `contract-reviewer` when that
    happens; you do not need to fix contracts by hand here.
  - A control you thought about and decided NOT to build still belongs in
    `### Deleted Controls`, with the real reason. A "reset" or "clear" button
    that nobody asked for and nothing derives is exactly the kind of
    gratuitous control this file exists to catch before it ships.
  - Nothing here is about color, spacing, font, animation, or "looking
    modern". None of that is ever checked by `cdd-kit gate` and none of it
    belongs in this file (see docs/adr/0012-interaction-design-loop.md
    "Never Gated"). This file is about what is shown, why, and how a user
    tells two situations apart -- never about taste.
-->

## Provenance

<!--
Reference only -- read this once, then use it while filling in the
`provenance` column below (## Presented Information) and the
`discriminator` column (## States). Every citation must be one of these five
forms, written EXACTLY like this (a human reviewer or `cdd-kit gate` reads
these mechanically, so the format matters):

  1. A field in an API response:
       GET /orders → items.status
     (dotted path for a nested field; bare name is enough for a field inside
     a list -- you never need to spell out "the third item's status", just
     `items.status`.)

  2. A field pinned to one specific value (use this when two states share
     the same field but mean different things -- e.g. "rejected" vs
     "approved" both live in a `status` field):
       POST /orders → status=rejected

  3. A specific HTTP status already listed for that endpoint's errors:
       POST /orders → 409

  4. The plain "it worked" status for that kind of request (201 for
     creating something, 200 for everything else) -- write it out so a
     reviewer does not have to guess:
       POST /orders → HTTP 201

  5. A named row in the data-shape contract's invalid-data table (copy the
     `condition` value exactly, e.g. `empty dataset`, `wrong type`,
     `missing required column`, `over max row limit`, `unexpected enum`):
       data-shape: empty dataset

If none of the five forms can describe where a piece of information or a
state actually comes from, that is a real signal -- it usually means the
backend contract is missing something (a field, a distinct error code, a
timestamp) and needs to grow before this screen can honestly show what it
promises. See docs/adr/0012-interaction-design-loop.md §2 for the full
reasoning (the "blank cheque" table).
-->

## Screens

<!--
One row per distinct screen or view in this change. Write like you are
describing a real person sitting in front of it, not a component name.

Example (delete or replace with your own):
| checkout summary | a shopper who has items in their cart | whether to trust this site enough to pay | being charged twice, or charged the wrong amount | seeing a total that does not match what they expect, with no way to check | the shopper's stored card number in full |
-->

| screen | who is here | what they are deciding | what they fear | what would make them abandon | what must not be shown |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Presented Information

<!--
One row per distinct piece of information the screen shows. `rationale` is
the user question this item answers -- if you cannot write a real question,
reconsider whether the item should be on the screen at all. `provenance` is
one of the five citation forms from ## Provenance above.

Example (delete or replace with your own):
| order total | "how much am I actually being charged?" | POST /orders → total_amount |
-->

| item | rationale | provenance |
|---|---|---|
|  |  |  |

## User Intents

<!--
List what users actually come here to DO, ordered by how often it really
happens -- not by how important the feature feels to build. Each intent
needs a stable `id` (referenced by ## Controls below) and the concrete path
(screen/step sequence) that serves it.

Example (delete or replace with your own):
| intent-checkout | complete a purchase | most requests, every day | checkout summary -> confirm -> receipt |
-->

| id | intent | frequency | path |
|---|---|---|---|
|  |  |  |  |

## Controls

<!--
One row per interactive control (button, link, toggle, filter chip -- any
element a user acts on). `intent` must cite EXACTLY ONE id from the User
Intents table above -- a control that cannot name the one intent it serves
should not exist (see Deleted Controls below for where it goes instead).

Example (delete or replace with your own):
| ctrl-confirm-pay | "Confirm and pay" button | intent-checkout |
-->

| id | control | intent |
|---|---|---|

### Deleted Controls

<!--
Controls that were considered and deliberately NOT built -- recorded WITH
the real reason, so nobody re-proposes the same gratuitous control later.
This is where a "reset all filters" button dies honorably when the same
need is already met another way (e.g. each active filter already shows its
own dismissible chip). A control here with no reason is a gate failure --
"we didn't think of a reason" is not an allowed reason.

Example (delete or replace with your own):
| clear-all-filters button | each active filter already renders as its own visible, individually-dismissible chip; a second global control would be a redundant, unrequested way to do the same thing (ADR 0012 rejected-proposal #2) |
-->

| control | reason |
|---|---|

## States

<!--
One row per meaning-distinct state a screen can be in (loading, empty,
error, success, offline, partial, etc.). `discriminator` is how the CONTRACT
tells this state apart from every other state -- one of the five citation
forms from ## Provenance above. This is the single most important table in
this file: an empty list from the backend often means two completely
different things to a user ("nothing happened yet" vs "the system is
broken") and if the contract does not supply a way to tell them apart, this
file's whole job is to surface that gap before it ships silently. Two rows
here with genuinely different meanings can never cite the same
discriminator -- `cdd-kit gate` enforces that mechanically.

Example (delete or replace with your own):
| state-empty | the search really did return zero results | GET /orders → HTTP 200 (empty items array, no error) |
| state-blocked | the search could not run because the backend is unavailable | GET /orders → 503 |
-->

| id | meaning | discriminator |
|---|---|---|
|  |  |  |

## Reversibility

<!--
For every state above where a user can end up (a filter applied, an item
added, a step advanced): once they are there, can they tell where they are,
and can they get back? Write this in plain language -- one or two sentences
per state that needs it is enough. A state with no way back and no way to
tell you are in it is the failure mode this section exists to catch.
-->


## Consistency Commitments

<!--
The rule this section exists to enforce: the SAME meaning must always take
the SAME visible form, and a DIFFERENT meaning must always take a
DIFFERENTLY visible form. Write down the pairs that matter for this change --
e.g. "a clickable row and a non-clickable row must never share the exact
same hover/shadow treatment, because that visual language is reserved for
'you can act on this'." This is not about banning any particular visual
style (motion, color, and animation are never gated by this kit) -- it is
about making sure one visual form never quietly carries two different
meanings.
-->


## Open Decisions

<!--
Questions `interaction-designer` could not answer on its own -- each one
needs real options and real trade-offs, not a rhetorical "should we do X?".
Main Claude turns each one into a real conversation with you. Mark a
question `- [x]` only once your actual answer has been transcribed into the
Confirmed section below; an unresolved `- [ ]` item fails `cdd-kit gate` on
purpose, so a question can never be silently skipped.
-->

- [ ] <a real open question, with the options and trade-offs the human must decide between>

## Confirmed

<!-- AGENT-FORBIDDEN. No agent -- not interaction-designer, not main Claude acting on its own judgment, not any other role -- may invent, paraphrase, or "fill in" an answer here. -->
<!-- Only a real, transcribed human answer belongs in this section, one per resolved Open Decisions item above, dated. -->
<!-- Once every Open Decisions item above has a real transcribed answer here, lock this file against later tampering by running: cdd-kit design confirm <this-change-id> -->
<!-- That command is the ONLY sanctioned writer of .cdd/design-lock.json. A pre-tool-use-design-write.sh hook additionally blocks any agent from writing that lock file directly. -->
<!-- If this section is edited after locking, cdd-kit gate fails with: "interaction design modified after confirmation -- human must re-confirm." That is intentional: re-confirm, never silently trust an unreviewed edit. -->
