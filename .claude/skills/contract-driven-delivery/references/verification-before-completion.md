# Verification Before Completion

Adapted from the superpowers methodology (github.com/obra/superpowers). A
discipline layer that complements the CDD gate: the gate proves *recorded
evidence* is valid; this proves you *exercised the change* before claiming it
works.

## Rule

Do not report a change as done, working, or fixed on the strength of "the code
looks right" or "the types compile". Claiming completion is a claim about
observed behavior — so observe it.

## Before saying "done"

1. **Run the thing.** Drive the actual affected flow — the endpoint, the screen,
   the job — not just the unit test. For a runtime change there is always a
   surface to exercise; use the `verify` / `run` project skill if one exists.
2. **Check the evidence exists, not just that you intended it.** Confirm the
   `test-evidence.yml` phases the change required are present and green, the
   regression test fails without the fix, and any visual/data/performance
   evidence pointer resolves on disk.
3. **Re-read the acceptance criteria.** Map each criterion in
   `change-classification.md` / `implementation-plan.md` to a concrete
   observation. An unmapped criterion is unfinished work, not a rounding error.
4. **State what you did NOT verify.** If a path was skipped (environment
   unavailable, out of scope), say so explicitly rather than letting silence
   imply coverage.

## Anti-patterns

- "Tests should pass now" — run them.
- "This should fix it" — reproduce the original symptom and confirm it is gone.
- Reporting green while a required phase was skipped — the gate treats a skipped
  required phase as a failure, and so should you.

This standard is advisory; `qa-reviewer` and `cdd-kit gate` are the enforcement.
It exists to stop the most common failure mode: declaring success from intent
instead of from behavior.
