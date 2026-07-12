# Loosening the harness: what to let go of as agents get stronger (and what not to)

CDD is thick on purpose: each protection exists because a real failure or a
credible risk was hit. As agents improve, the natural instinct is to remove
guardrails and give the agent more room. That instinct is mostly right -- but it
has one trap, and this page is the decision rule for loosening without cutting
into bone.

Companion to `docs/rfc/agent-native-cdd-rearchitecture.md` (see its principles
P2, P3, P5, P6, P8) and the promotion gates in
`docs/rfc/agent-native-cdd-runtime-contracts.md` (section 9).

## The one rule

Loosen the freedoms whose mistakes are **cheap and self-revealing** -- a test,
a typecheck, or Boundary Guard catches them in seconds. Keep the checks whose
absence makes a mistake **expensive and silent**.

> Decision test for any check you want to remove:
> **"If the agent were wrong here, would I still find out?"**
> If the answer depends on the agent's own judgment, the check is load-bearing.

## Two axes -- do not conflate them

- **Freedom** = the agent decides HOW: explore, plan, implement, choose a local
  strategy. Grow this freely as agents get stronger.
- **Trust-as-proof** = the agent's own claim is accepted as evidence: it says it
  passed, or it accepts the requirements on your behalf. Do NOT grow this for the
  load-bearing core, no matter how capable the agent is.

Stronger agents earn more freedom. They do not earn more trust-as-proof: a
stronger agent produces more *plausible* wrong work, which is exactly what a
self-certified check fails to catch.

## The counterintuitive part

Weak agents fail loudly -- syntax errors, obvious breakage, anything catches it.
Strong agents fail invisibly: an invented response field, the wrong branch
validated, a confident-but-wrong acceptance oracle, a self-review that
rubber-stamps a subtle bug. The harder a mistake is to see, the more you need a
check that does not depend on the agent's judgment. So **independent checks get
more valuable as agents improve, not less.**

## Classification for this kit

### Fat -- safe to drop or relocate (ceremony, not safety)

- The seven mandatory change artifacts for routine (lightweight / balanced) work
- Per-agent Markdown logs on clean passes
- Manual task-ticking
- Format-only gates and Markdown section-wording checks
- The classifier / planner / reviewer chain for small changes
- Workflow choreography embedded in prompts
- Advisory hooks a plain Bash call can bypass (never present these as enforcement)

### Bone -- keep regardless of agent capability (independent; catches invisible errors)

- Boundary Guard: route / request / response conformance, capture provenance,
  and no-vacuous-green (RFC P6, D7)
- Signed approval envelopes for high-risk surfaces -- breaking API, destructive
  migration, auth policy, production operations (`src/runtime/decisions.ts`)
- Independent review for contract / migration / security / auth diffs (RFC P8)
- Human acceptance of intent -- the oracle, your actual "yes", not the agent's
  paraphrase of it (`src/commands/gate-acceptance.ts`)
- Fail-upward-on-uncertainty routing (RFC P5)

### Knobs -- loosen WITH these, not by deleting checks

- `default_profile` in `.cdd/policy.yml` -- lower it to give routine work more autonomy
- What counts as high-risk -- the risk-router floors and the `approvals` map
- Reviewer independence per profile
- `acceptance_oracle: required | conditional | not-required` per profile

Loosening means moving these knobs. It does NOT mean removing the checks that
fire once a knob says "high-risk".

### Human review of acceptance criteria: default on, explicit per-run bypass

The acceptance oracle records what "done" means in the user's own words. By
default the agent cannot self-sign it: a human runs `cdd-kit accept confirm
<id>`, which shows the criteria and requires an interactive keystroke (an agent
shelling out non-interactively is refused). For an explicitly delegated loop run
-- where the user told the agent to handle the whole thing -- `cdd-kit accept
confirm <id> --autonomous --reason "..."` records the acceptance without human
review. That is a deliberate, recorded loosening: the gate passes the non-strict
change but always surfaces it as agent-delegated (never a human sign-off), and
strict refuses it outright. Autonomy waives human review of the criteria, never
the test evidence.

## How to loosen responsibly: reversible + evidence-gated

1. Move one knob (for example, drop a check from `balanced`).
2. Run the mutation corpus. Ask: does a real defect now ESCAPE that strict would
   have caught? (runtime-contracts.md section 9)
3. Promote only if nothing escapes. Keep the previous profile one command away --
   `strict` stays as the rollback lane.

Loosen on escaped-defect evidence, never on confidence in the agent. This is why
an honest parity signal matters: if parity reports `equivalent` from two green
runs with no mutation evidence, you are loosening on vibes. A parity verdict of
`inconclusive` means "not yet safe to let go".

## Red flags: you are cutting bone, not fat

- "The agent is good enough now, we can skip the boundary / acceptance check."
  (Stronger agent = more plausible-wrong work. This reasoning is backwards.)
- The thing you are removing is an *independent* check -- one that did not rely
  on the agent's own judgment.
- The green signal you are keeping only proves "the agent said so": self-review,
  self-acceptance, or parity with no mutation corpus.
- You are loosening because it feels safe with a good agent, not because defects
  measurably stopped escaping.
- The decision test fails: if the agent were wrong here, you would not find out.

## When in doubt

Fail upward: keep the check, raise the profile, and let the mutation evidence --
not the agent's confidence, and not yours -- tell you when it is safe to let go.
