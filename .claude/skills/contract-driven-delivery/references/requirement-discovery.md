# Requirement Discovery

Adapted from the superpowers brainstorming method (github.com/obra/superpowers).
This is the front stage that runs *before* `change-classifier`, when a request
is vague, large, or its intent is not yet a crisp acceptance criterion. Skip it
for a well-specified change; use it whenever you would otherwise infer intent.

## Rule

Do not scaffold artifacts, pick a tier, or write code from an ambiguous request.
Refine intent into concrete, testable acceptance criteria first. "This is too
simple to need discovery" is itself a signal to spend one exchange confirming
scope — a wrong assumption is cheapest to fix here.

## Method

1. **Explore context.** Read the project profile and the contracts the request
   plausibly touches, so questions are informed, not generic.
2. **Ask one question at a time.** Prefer a multiple-choice question over an
   open one; never batch five questions into one message. Each answer should
   change what you ask next.
3. **Offer 2–3 approaches with tradeoffs** once the problem is clear, and let
   the human choose — do not present a single foregone conclusion.
4. **Decompose oversized requests.** If the ask spans several independent
   outcomes, stop and help split it into separate tracked changes rather than
   designing one monolith. This is also where you decide whether the pieces can
   run as **parallel changes** — see `references/parallel-worktree-standard.md`.
5. **Self-review before handing off.** Re-read the refined intent for
   placeholders, contradictions, ambiguity, and scope creep, and fix them inline
   before it becomes a spec/classification.

## Hand-off into CDD

The output of discovery is the input to `change-classifier`: a crisp problem
statement, in/out-of-scope boundaries, and candidate acceptance criteria. Record
it in `proposal.md` / `spec.md` (per the workflow router), not in chat — the
classifier and every downstream agent read the artifact, not the conversation.

## Just-in-time visuals

Offer a diagram or mockup only when a specific question genuinely needs one to
be answerable, never preemptively, and do not re-offer after a decline.
