# ADR 0008: Required-agent evidence in the gate

- Status: Accepted
- Date: 2026-06-26
- Deciders: maintainer + AI delivery agent
- Relates to: `cdd-kit gate`, `change-classification.md` `## Required Agents`,
  `agent-log/*.yml`, ADR 0005 (test evidence), ADR 0006 (bug-fix lane)

## Context

cdd-kit's value proposition is constraining AI agents in a workflow where a
non-engineer cannot read the code to spot-check. The `change-classifier` records
which agents a change needs in `change-classification.md` `## Required Agents`,
and the `/cdd-new` skill commissions them in order. But **nothing verified those
agents actually ran.**

A forensic look at a real adopted project (a Flask+Vue TODO app) made the gap
concrete. A Tier-2, context-governed UI change declared **8 required agents**
including `contract-reviewer`, `ui-ux-reviewer`, and `visual-reviewer`. Its
`tasks.yml` marked all four review tasks (`UI/UX review`, `Visual review`,
`Contract review`, `QA review`) `status: done`. Yet `agent-log/` contained logs
only for the five implementation/planning agents — the three required reviewers
and QA left **zero trace**, even though the classification explicitly routed
"combobox visual evidence to agent-log". And `cdd-kit gate` **passed**.

The root cause is structural:

- Agent invocation is **prose-driven**: the skill tells main Claude to "invoke X
  agent". Nothing mechanically forces a subagent to spawn, and the work can be
  collapsed into main Claude doing it inline.
- `tasks.yml` status is **owned by main Claude**, so a review item can be ticked
  `done` without the reviewer running.
- The gate checked that **artifacts exist**, not that **each required agent left
  evidence**. The one exception was the bug-fix lane (ADR 0006), which already
  requires `agent-log/bug-fix-engineer.yml`.

For a no-human-review workflow, the inability to distinguish "reviewed
thoroughly" from "ticked the box" *is* the failure mode the kit exists to
prevent.

## Decision

**The gate surfaces — as an advisory warning, never an error — any agent listed
in `change-classification.md` `## Required Agents` that left no non-stub
`agent-log/<agent>.yml`.** `agent-log/*.yml` stays *optional*; this check informs,
it does not block.

### Why advisory, not a hard gate

An agent-log is **post-hoc, self-reported** evidence — audit, not prevention.
Making it a hard gate would convert a prevention-first tool into post-run
paperwork, which the kit explicitly rejects ("`cdd-kit gate` focuses on delivery
quality, **not post-run read paperwork**"; `agent-log/*.yml` are "optional
pointers"). It also buys little: a log is fakeable, so a hard requirement mostly
raises the bar on faking it rather than preventing the failure.

Crucially, **the real prevention already exists elsewhere and does not depend on
whether a reviewer agent "ran"**: for mechanically-checkable concerns the
validators, API + data-shape **conformance** (ADR 0007), and **test-evidence**
(ADR 0005, tied to non-fakeable `cdd-kit test run` artifacts) catch the actual
harm directly — a bad contract fails the validators whether or not
`contract-reviewer` was invoked. The forensic case that motivated this ADR
underlines the point: that project's gate also reported `API conformance:
skipped (enabled:false)` — the genuine prevention gap was an **unarmed mechanical
net**, not a missing reviewer log. The prevention-first response is to arm those
nets, not to mandate paperwork proving a judgment review happened.

The genuine residual gap is the **judgment-only** reviews (UI/UX, visual) that
have no mechanical net. For a no-human-review workflow, silently skipping those
leaves no signal at all — so a *warning* is worth surfacing (the operator learns
a required judgment review left no trace), while a hard error is not (it would
block on fakeable prose and duplicate the mechanical layer).

### Shape

- **Warning-only**, even under `--strict` and the pre-commit hook — mirroring the
  advisory chokepoint dashboard and conformance recommendation.
- Surfaces a **missing** log, a **stub** (`< 60` meaningful chars), an
  unparseable log, or one whose `agent:` field names a different agent.
- A change that declares **no `## Required Agents`** is untouched. Filename
  aliases are tolerated (`ci-cd-gatekeeper` ↔ `ci-gatekeeper`).

The bug-fix lane's `bug-fix-engineer.yml` requirement (ADR 0006) stays a hard
error — it is not generalized here. Implemented in `src/commands/gate-agents.ts`
(`parseRequiredAgents`, `enforceRequiredAgentEvidence`). The `/cdd-new` and
`contract-driven-delivery` skills still encourage one log per required agent so
the signal is usually clean.

## Consequences

- **Positive:** a no-human-review operator gets a visible signal when a required
  agent — especially a judgment-only reviewer with no mechanical net — left no
  trace, without converting the gate into a post-hoc-paperwork blocker or
  duplicating the prevention the validators/conformance/test-evidence layer
  already provides. Keeps `agent-log` optional and the gate prevention-first.
- **Negative / accepted:** "a required agent ran" is *not* mechanically
  guaranteed — the warning can be ignored, and a log remains fakeable. That is
  the correct trade: execution-of-a-judgment-review is inherently not provable by
  a deterministic check, and the harms that *are* mechanically checkable are
  caught by the dedicated nets, not by this signal.
- **Revisit when:** a judgment review gains a durable, non-fakeable artifact
  (e.g. a required screenshot for visual review) that could be enforced as
  prevention rather than audited as paperwork.
