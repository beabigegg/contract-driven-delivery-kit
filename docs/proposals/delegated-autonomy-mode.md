# PROPOSAL — Delegated-autonomy mode

Status: **proposal, not binding**. Nothing here is implemented beyond the
primitives listed under "What exists today". The Open Decisions at the end are
the human maintainer's to answer; an agent must not resolve them by picking.

## Problem

The kit's safety story is built on human chokepoints: hash-lock confirmations
(`accept confirm`, `design confirm`), strict-gate sign-off, publish. That is
correct for the default trust model — but the maintainer sometimes runs fully
delegated sessions (remote development, long autonomous loops) where they have
explicitly pre-authorized the whole run and cannot be prompted per step. Today
that authorization lives in chat history and memory files, invisible to the
gate. The kit should be able to *record* delegation mechanically — without
weakening what "human-confirmed" means.

The governing principle (already enforced, and not up for revision): **an agent
never forges a human action.** Delegation produces a *receipt* that says "an
agent did this under authorization X", never a lock that claims a human did it.

## What exists today (4.x)

- `cdd-kit accept confirm <id> --autonomous --reason "..."` writes an
  acceptance receipt with `mode: 'autonomous'` + the reason. It is honored by
  the non-strict gate (surfaced loudly as agent-delegated) and **rejected by
  `--strict`**, which still demands a human lock.
- The interactive path is TTY-gated: an agent shelling out cannot silently
  satisfy the human keystroke.
- Convention (memory, not mechanism): agents drafting human-owned artifacts
  must use forceful wording demanding explicit approval before any lock.

## Proposed shape

A `delegated_autonomy:` block in `.cdd/policy.yml` — a bucket-3 surface with
safe default **off**, so upgrading never enables it:

```yaml
delegated_autonomy:
  enabled: false            # safe default: everything below is inert
  authorized_by: ""         # human name/handle; empty = not authorized
  authorized_at: ""         # ISO date of the standing authorization
  expires: ""               # optional ISO date; empty = per-session only
  allowed_receipts:         # which steps MAY be receipt-ed by an agent
    - acceptance            # accept confirm --autonomous
    # - design              # (open decision 1)
```

Mechanics:

- When `enabled` with a non-empty `authorized_by`, `--autonomous` invocations
  additionally record `authorized_by`/`authorized_at` into the receipt, so a
  reviewer sees *whose* standing authorization the agent acted under — not just
  the agent's own claim.
- `cdd-kit gate` prints every receipt-based pass with its authorization line.
- **Hard floor (not policy-configurable):** `npm publish`, writing a
  `mode: 'human'` lock, and history rewrites can never be receipt-ed. The
  enum of `allowed_receipts` simply has no such members.

## Why policy, not a CLI flag

A flag authorizes one invocation and evaporates; the authorization is a standing
fact about the repo's trust model and belongs in the policy file the gate
already reads — reconciled on upgrade (INV-1: arrives disabled), diffable in
review, and visible to every future session without chat archaeology.

## Open Decisions (human-only)

1. **Design-side parity.** Should `design confirm` gain the same
   `--autonomous --reason` receipt path as acceptance? The interaction-design
   loop (ADR 0012) was argued to be *more* taste-laden and less mechanizable.
2. **Strict-gate stance.** Today `--strict` rejects autonomous receipts
   unconditionally. Should `enabled + authorized_by` change that, or is strict
   the permanent human floor? (Recommendation embedded in current code:
   strict stays human-only; delegation covers the non-strict path.)
3. **Authorization lifetime.** Per-change, per-repo standing, or expiring
   (`expires`)? An unbounded standing grant is the most convenient and the
   least auditable.
4. **Receipt visibility in CI.** Should the shipped workflow annotate PRs when
   any gate passed on a receipt (a bot comment), or is the gate log enough?
