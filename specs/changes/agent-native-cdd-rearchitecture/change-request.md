---
change-id: agent-native-cdd-rearchitecture
status: in-progress
created: 2026-07-11
---

# Change Request: agent-native CDD rearchitecture

## Original Request

The maintainer wants a fundamental review and redesign of cdd-kit.

The kit was originally created to prevent frontend/backend API contract and data
shape failures during AI-assisted development. Over time it accumulated
contracts, specialist subagents, reviews, gates, context governance, hooks,
evidence, acceptance provenance, interaction design and many other protections.
These features were added because real failures or credible risks were
encountered, so the maintainer does not want to discard them.

At the same time, the workflow and its artifacts have grown substantially. The
maintainer wants to take advantage of stronger AI-agent capabilities, including
subagents, agent teams, hooks, plugins, skills and workflow tooling, to simplify
the kit, reduce token use and make it easier to use.

The redesign must answer these concerns:

1. Simplification must not weaken API/data-shape protection.
2. Stronger agents may receive more autonomy, but they must not be trusted to
   self-certify correctness where deterministic evidence is possible.
3. Existing subagents contain development philosophy and hard-earned engineering
   practices, not only workflow steps; this knowledge must be preserved.
4. `CLAUDE.md` and related guidance currently mix project facts, engineering
   doctrine and kit operating instructions; the useful guidance must survive
   without loading the full workflow manual every session.
5. Existing contracts, gates, tests, hooks, review roles, archives and promoted
   learnings must each receive an explicit keep/move/strengthen/deprecate decision.
6. Existing consumer projects need an incremental, reversible migration path.
7. The current strict workflow should remain available until the new path proves
   equal or better defect detection and materially lower token cost.

## Desired Outcome

Deliver the first complete, shadow-mode implementation of that architecture:

- restores API/data boundaries as the center of the kit;
- separates engineering doctrine from workflow choreography;
- preserves subagent expertise through composable roles/capabilities;
- moves repeatable state and evidence into the CLI/MCP runtime;
- introduces dynamic risk-based agent teams;
- strengthens deterministic Boundary Guard checks;
- minimizes project-local and always-loaded guidance;
- defines compatibility, dual-run, rollback and old-project migration;
- provides a feature-by-feature disposition map;
- does not remove current functionality or change the strict default.

## Success Criteria

The increment is successful when its schemas and ownership boundaries are
versioned, Boundary Guard cannot pass changed API work vacuously, runtime state
is resumable and tamper-aware, Claude Code and Codex are first-class adapters,
and user-level upgrades are ownership-aware and reversible.

## Non-goals for this increment

- Do not remove agents, skills, hooks, validators or artifacts.
- Do not change current defaults.
- Do not automatically migrate consumer repositories or active changes.
- Do not select the final major-version number.
- Do not claim parity, token improvement, or authorize a default switch before
  representative dual-run and mutation evidence exists.
