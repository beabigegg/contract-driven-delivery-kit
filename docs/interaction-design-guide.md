# Interaction design: how to fill it in

Read this once. `specs/changes/<id>/interaction-design.md` points here rather than
carrying a copy of it, because this is a manual for a person, and a manual copied
into every change directory is the same words committed to git fifty times.

No code-reading is required to do anything on this page.

## What the file is for

Every other kind of mistake in this kit gets caught by a contract. This file
closes the one gap nothing else catches: an AI agent quietly deciding, on its own
judgment, what a screen shows, why a button exists, and how a user tells one state
of the world apart from another. Those are human decisions. The file forces them
into human hands and then locks the answer so no later agent edit can quietly
change it back.

## Who writes what

The roles are strict; do not blur them.

1. **`interaction-designer`** (an AI agent, read-only) fills in the derivation
   chain — Screens, Presented Information, User Intents, Controls, States,
   Reversibility, Consistency Commitments — and writes open questions into
   `## Open Decisions`. It is structurally incapable of writing `## Confirmed`:
   its tools are Read/Grep/Glob only.
2. **Main Claude** runs a plain-language conversation with you to work through
   `## Open Decisions`.
3. **You decide.** Main Claude transcribes your actual answers — not a paraphrase,
   not "close enough" — into `## Confirmed`.
4. **You lock it in** (or whoever runs the CLI on your behalf):

   ```
   cdd-kit design confirm <change-id>
   ```

Until step 4 happens, `cdd-kit gate` keeps failing the change on purpose. That is
not a bug; it is the whole point, and it mirrors how `acceptance.yml` works for
behaviour (ADR 0010).

## When this file does not apply

Most changes have a real screen, control, or user-facing state. If yours genuinely
has none — a pure backend job, a database migration, a CLI-only change — uncomment
both marker lines in the frontmatter:

```yaml
applicability: not-applicable
applicability-reason: <why this change genuinely has no UI surface>
```

`applicability-reason` is then REQUIRED and must be non-empty, or the gate hard-fails
on purpose: a bare skip with no justification is never allowed (ADR 0011). When the
marker is set, **the rest of the file can be deleted** — the gate skips every
condition and only reads the marker. Do not leave the empty tables behind.

## The two rules that decide what belongs on a screen

- **Every row answers a real question a real user has.** If you cannot say which
  question an item answers, it probably should not be on the screen. This is the
  same "does this need to exist at all" question the kit already asks about code,
  now asked about the interface.
- **Nothing here is about taste.** Colour, spacing, font, animation, "looking
  modern" — none of it is ever checked by `cdd-kit gate` and none of it belongs in
  this file (ADR 0012, "Never Gated"). This file is about what is shown, why, and
  how a user tells two situations apart.

## Provenance: the five citation forms

Every citation in the `provenance` column (## Presented Information) and the
`discriminator` column (## States) must be one of these five forms, written exactly
like this — a human reviewer and `cdd-kit gate` both read them mechanically, so the
format matters.

| # | form | example |
|---|---|---|
| 1 | a field in an API response (dotted path for nested; a bare name is enough for a field inside a list — never spell out "the third item's status") | `GET /orders → items.status` |
| 2 | a field pinned to one value — use when two states share a field but mean different things | `POST /orders → status=rejected` |
| 3 | a specific HTTP status already listed for that endpoint's errors | `POST /orders → 409` |
| 4 | the plain "it worked" status (201 for creating, 200 otherwise), written out so a reviewer need not guess | `POST /orders → HTTP 201` |
| 5 | a named row in the data-shape contract's invalid-data table (copy the `condition` value exactly) | `data-shape: empty dataset` |

If none of the five can describe where a piece of information or a state actually
comes from, that is a real signal, not a formatting problem: it usually means the
backend contract is missing something — a field, a distinct error code, a timestamp
— and needs to grow before the screen can honestly show what it promises.
`interaction-designer` loops back to `contract-reviewer` when that happens; you do
not fix contracts by hand here. See ADR 0012 §2 (the "blank cheque" table).

## Section by section

### Screens

One row per distinct screen or view. Write like you are describing a real person
sitting in front of it, not a component name.

```
| checkout summary | a shopper who has items in their cart | whether to trust this site enough to pay | being charged twice, or charged the wrong amount | seeing a total that does not match what they expect, with no way to check | the shopper's stored card number in full |
```

### Presented Information

One row per distinct piece of information the screen shows. `rationale` is the user
question this item answers. `provenance` is one of the five forms above.

```
| order total | "how much am I actually being charged?" | POST /orders → total_amount |
```

### User Intents

What users actually come here to DO, ordered by how often it really happens — not
by how important the feature feels to build. Each intent needs a stable `id`
(referenced by Controls) and the concrete path that serves it.

```
| intent-checkout | complete a purchase | most requests, every day | checkout summary -> confirm -> receipt |
```

### Controls

One row per interactive control — button, link, toggle, filter chip, anything a
user acts on. `intent` must cite EXACTLY ONE id from User Intents. A control that
cannot name the one intent it serves should not exist.

```
| ctrl-confirm-pay | "Confirm and pay" button | intent-checkout |
```

### Deleted Controls

Controls considered and deliberately NOT built, recorded with the real reason, so
nobody re-proposes the same gratuitous control later. This is where a "reset all
filters" button dies honorably when the same need is already met another way. A row
here with no reason is a gate failure — "we didn't think of a reason" is not an
allowed reason.

```
| clear-all-filters button | each active filter already renders as its own visible, individually-dismissible chip; a second global control would be a redundant, unrequested way to do the same thing (ADR 0012 rejected-proposal #2) |
```

### States

One row per meaning-distinct state a screen can be in: loading, empty, error,
success, offline, partial. `discriminator` is how the CONTRACT tells this state
apart from every other one — one of the five citation forms.

**This is the single most important table in the file.** An empty list from the
backend often means two completely different things to a user ("nothing happened
yet" vs "the system is broken"), and if the contract supplies no way to tell them
apart, surfacing that gap before it ships silently is this file's whole job. Two
rows with genuinely different meanings can never cite the same discriminator — the
gate enforces that mechanically.

```
| state-empty   | the search really did return zero results          | GET /orders → HTTP 200 (empty items array, no error) |
| state-blocked | the search could not run; the backend is unavailable | GET /orders → 503 |
```

### Reversibility

For every state a user can end up in — a filter applied, an item added, a step
advanced — can they tell where they are, and can they get back? Plain language, one
or two sentences per state that needs it. A state with no way back and no way to
tell you are in it is the failure mode this section exists to catch.

### Consistency Commitments

The same meaning must always take the same visible form, and a different meaning
must always take a differently visible form. Write down the pairs that matter for
this change — e.g. "a clickable row and a non-clickable row must never share the
exact same hover treatment, because that visual language is reserved for 'you can
act on this'." This is not about banning any particular visual style; motion,
colour, and animation are never gated. It is about making sure one visual form never
quietly carries two different meanings.

### Open Decisions

Questions `interaction-designer` could not answer on its own. Each needs real
options and real trade-offs, not a rhetorical "should we do X?". Main Claude turns
each into a real conversation with you. Mark an item `- [x]` only once your actual
answer has been transcribed into `## Confirmed`; an unresolved `- [ ]` fails the
gate on purpose, so a question can never be silently skipped.

### Confirmed

Agent-forbidden. Only a real, transcribed human answer belongs here, one per
resolved Open Decisions item, dated. Once every item has an answer, lock the file:

```
cdd-kit design confirm <change-id>
```

That command is the only sanctioned writer of `.cdd/design-lock.json`, and
`pre-tool-use-design-write.sh` additionally blocks any agent from writing that lock
directly. If the section is edited after locking, the gate fails with "interaction
design modified after confirmation — human must re-confirm." That is intentional:
re-confirm, never silently trust an unreviewed edit.

## See also

- `docs/adr/0012-interaction-design-loop.md` — why this loop exists, and the
  "Never Gated" prohibition on gating aesthetics
- `docs/adr/0011-not-applicable-contract-marker.md` — the applicability marker
- `docs/adr/0010-acceptance-oracle.md` — the behaviour-side twin of this loop
