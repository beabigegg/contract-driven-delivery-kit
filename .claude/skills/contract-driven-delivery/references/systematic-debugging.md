# Systematic Debugging

Adapted from the superpowers methodology (github.com/obra/superpowers) into the
CDD bug-fix lane. This is the *method*; `bug-fix-engineer` is the agent that
executes it and records the evidence.

## Iron Law

**No fix without root-cause investigation first.** A change classified
`lane: bug-fix` must not edit source until the symptom is reproduced and a
hypothesis is confirmed (see the Reproduction status table in the
`bug-fix-engineer` agent). "Quick fix for now", "just try changing X", and
"probably this line" are the detection signals that you have skipped
investigation — when you catch yourself saying them, return to Phase 1.

## Four phases

1. **Investigate.** Read the full error, reproduce consistently, trace the
   recent changes that could have introduced it. In multi-component flows, add
   diagnostics at each boundary to localize *where* it fails before asking
   *why*. Prefer `cdd-kit graph context "<symptom>"` over broad source reads.
2. **Analyze the pattern.** Find a working example of the same shape in the
   codebase and diff it against the broken path. Document every difference; the
   root cause is usually one of them.
3. **Hypothesize and test.** State one theory — "X causes this because Y" — and
   test it with the smallest possible change. One variable at a time. A failed
   test produces a *new* hypothesis, never a stacked second guess.
4. **Fix at the root.** Write the failing regression test first, apply a single
   fix targeting the root cause, verify it goes green, and run the bounded test
   ladder (`references/sdd-tdd-policy.md`).

## Three-strike rule

If three fix attempts have failed, **stop and question the architecture.**
Repeated failures on the same symptom mean the mental model is wrong, not that
the next tweak is closer. Escalate to `spec-architect` rather than attempting a
fourth fix. Under time pressure this feels slower; it is faster, because
thrashing is what time pressure actually causes.

## Where this maps in CDD

- Reproduction, hypotheses, root cause, fix, and regression are recorded in the
  schema-validated `bug-fix:` block (`src/schemas/bug-fix-evidence.schema.ts`),
  enforced by `cdd-kit gate` for `lane: bug-fix`.
- High-risk production symptoms (timeouts, queues, caches, DB pools, large
  reports) escalate to the resilience / stress / soak agents after root cause is
  found — the method localizes the bug; the heavy gates prove the fix holds.
