# ADR 0013: Agent-native delivery runtime with doctrine-preserving guardrails

- Status: Proposed
- Date: 2026-07-11
- Deciders: maintainer + AI delivery agent
- Relates to: ADR 0001 (contract to OpenAPI), ADR 0007 (response-shape
  conformance), ADR 0008 (agent evidence), ADR 0010 (acceptance oracle), ADR
  0012 (interaction-design loop), `cdd-kit gate`, `cdd-kit graph`,
  `.claude/agents/`, `.claude/skills/`, `CLAUDE.template.md`
- Detailed design: `docs/rfc/agent-native-cdd-rearchitecture.md`
- Migration plan: `docs/migration/agent-native-cdd-migration.md`
- Feature disposition: `docs/migration/agent-native-cdd-feature-map.md`

## Context

CDD began with a narrow and valuable purpose: prevent frontend/backend drift,
especially API method/path mismatches and request/response data-shape
incompatibility when implementation is delegated to AI agents.

The kit then accumulated protections in response to real failures:

- contracts-first and test-first discipline;
- API, data, environment, business-rule and CI contracts;
- code maps and graphs to reduce broad repository reads;
- risk classification and tier floors;
- specialist implementation and review agents;
- context manifests and read-scope governance;
- bounded test evidence;
- acceptance and interaction-design provenance;
- pre-tool, pre-commit and CI chokepoints;
- archival learning promotion.

These additions are individually defensible. Together, however, they have
shifted the center of gravity from protecting delivery boundaries to operating a
large workflow. A normal implementation can require multiple agents, seven or
more change artifacts, repeated restatement of the same intent, manual task
state transitions, and several prompts that combine engineering doctrine with
CDD operating instructions.

This creates four problems.

1. **The process can become the product.** Agents learn how to satisfy the kit's
   file formats and gate wording instead of focusing on the software boundary
   the kit was created to protect.
2. **Token use grows faster than implementation complexity.** The same rules,
   artifacts and handoff details are loaded or restated by the classifier,
   planner, implementers and reviewers.
3. **A complete-looking workflow can still miss the original failure mode.** A
   route gate may pass while response bodies differ; a generic response schema
   may validate almost any payload; one sample may cover only one of several
   cache, database, async or error branches.
4. **The valuable engineering philosophy is coupled to the heavy workflow.**
   Current subagent prompts do not merely define roles. They encode thin
   controllers, boundary validation, generated API types, compatibility,
   minimalism, accessibility, idempotency, migration safety and many other
   lessons. Removing the agents or shrinking `CLAUDE.md` without extracting this
   doctrine would discard hard-earned knowledge.

The maintainer's concern is therefore not to remove safety. It is to preserve
all evidence-backed protections while relying more on stronger agents for local
planning and implementation, reducing ceremony and tokens, and keeping
mechanical checks at the boundaries where agent confidence is not sufficient.

## Decision

CDD will evolve from a workflow-heavy orchestration kit into an **agent-native
delivery runtime** with six explicit layers.

### 1. Engineering constitution

Extract stable development philosophy from agent prompts, skills and project
guidance into provider-neutral doctrine modules:

- core engineering;
- API and data boundary;
- backend;
- frontend and accessibility;
- testing;
- data migration and operations;
- security and authorization.

Doctrine is guidance for decisions that cannot be fully proven by a tool. It is
not a replacement for validators. Modules are selected per change so agents do
not receive every rule on every run.

### 2. Dynamic agent profiles

Retain subagents because they provide stable expertise, tool permissions and
independent review. Decompose each current agent into:

- a small base role (`implementer`, `reviewer`, optional `planner`);
- one or more capability profiles (`backend`, `frontend`, `contract`,
  `migration`, `security`, `resilience`, `interaction`);
- selected doctrine modules;
- a runtime-generated execution capsule for the current task.

The default is no longer a fixed procession of classifier, contract reviewer,
test strategist, architect, gatekeeper, planner, backend, frontend and QA. The
runtime selects the smallest sufficient team from risk and affected surfaces.

### 3. Deterministic runtime

Move workflow state and repeatable operations out of Markdown prompts and into
the CLI/MCP runtime:

- repository and change impact discovery;
- affected endpoint, producer, consumer, contract and test mapping;
- risk signals and profile selection;
- execution-capsule generation;
- test selection and evidence collection;
- agent run state;
- final verification and concise evidence output.

Information derivable from repository state must not require an agent-authored
artifact.

### 4. Boundary Guard

Make the original purpose a permanent, independently runnable subsystem. It
must work even when the full tracked-change workflow is not used.

Boundary Guard covers:

- backend route vs canonical contract;
- frontend call vs canonical contract;
- typed request schemas;
- typed response schemas;
- status-specific response variants;
- generated frontend clients/types where supported;
- backend boundary models or captured HTTP samples;
- known consumer compatibility;
- non-vacuous coverage checks.

If an API-affecting diff is detected, zero typed endpoints, zero samples or zero
consumer checks is a failure, not a green skip. Broad schemas such as
`GenericSuccessResponse` are permitted only through an explicit legacy or
open-content exception policy.

### 5. Risk and approval guardrails

Agents may autonomously plan and implement ordinary work. Human approval and
stronger gates remain mandatory for irreversible or high-impact surfaces,
including:

- breaking API changes;
- destructive or table-rewriting migrations;
- authentication and authorization policy;
- secrets and production environment changes;
- destructive data operations;
- concurrency, queues and production connection budgets when materially
  changed;
- production deployment or irreversible release actions.

Trust the agent to execute inside an approved boundary; do not trust the agent
to self-certify that the boundary is safe.

### 6. Minimal project guidance and provider adapters

Project-local guidance contains only:

- project purpose and architecture;
- development commands;
- project-specific invariants;
- pointers to `.cdd/policy.yml` and installed CDD capabilities.

Kit command manuals, agent-log schemas, context procedures and upgrade
instructions move to runtime help, skills or references loaded only when
needed. Provider-specific assets for Claude Code, Codex and other environments
become adapters over the same runtime and doctrine.

## Workflow profiles

The current strict workflow is retained during migration and remains available
as a policy profile.

### Lightweight

For documentation, comments, formatting and behavior-neutral maintenance.

- one agent;
- narrow checks;
- no committed change artifacts by default.

### Balanced

Default for ordinary bugs and features.

- impact analysis;
- one implementer;
- optional independent reviewer based on affected boundaries;
- deterministic verification;
- concise machine evidence.

### Controlled

For API/data shape, cross-module architecture, queues, caching, async behavior,
or other broad surfaces.

- persisted `change.yml` or equivalent decision record;
- selected specialist profiles;
- strengthened Boundary Guard and tests;
- human PR review.

### Strict

The current full tracked workflow, retained for high-risk work, regulated
contexts, fully autonomous delivery without a human reviewer, and migration
fallback.

## Artifact policy

The long-term authoritative set becomes:

1. `change.yml` when a durable tracked change is needed;
2. `decision.md` only when architecture, interaction, compatibility or human
   approval decisions must be preserved;
3. `evidence.json` generated by the runtime.

Existing artifacts remain readable and valid. Migration does not rewrite
archives. The strict profile may continue to use the current detailed artifact
set until equivalent runtime state and evidence are proven.

## Non-negotiable invariants

The redesign is accepted only if all of the following remain true.

1. API and data-shape protection is not weaker than the current strict path.
2. Contract, generated projection and real HTTP behavior can be reconciled.
3. Frontend and backend do not maintain independent canonical payload shapes.
4. High-risk operations still require deterministic checks and human approval.
5. Independent review remains available and is automatically selected for the
   surfaces where self-review is unsafe.
6. Current projects can remain on the strict profile without immediate rewrites.
7. Existing archives, contracts and promoted learnings remain usable.
8. A project can roll back from the new runtime to strict mode without losing
   contract or evidence history.
9. Token reduction is measured, not assumed.

## Consequences

### Positive

- Engineering philosophy is preserved as a first-class reusable asset rather
  than duplicated inside workflow prompts.
- Stronger agents receive autonomy where judgment is useful while deterministic
  tools remain authoritative at delivery boundaries.
- Routine changes require fewer agents, artifacts and repeated reads.
- API/data-shape safety becomes stronger and independently runnable.
- Provider-specific prompts become smaller and easier to maintain.
- Existing safety features are relocated rather than discarded.

### Negative

- The redesign is a major architectural change and likely requires a major
  package version when defaults change.
- Doctrine extraction can expose conflicting rules that were previously hidden
  in separate agents.
- Dynamic routing must be tested against under-classification; an insufficient
  team must fail safe to a stronger profile.
- Dual-running old and new verification temporarily increases maintenance.
- Some current Markdown traceability will become runtime state and must remain
  inspectable and exportable.

### Risks

- Over-trusting agent planning could reintroduce omitted tests or consumers.
- Over-mechanizing doctrine could create new false-positive gates.
- Aggressive prompt reduction could hide important project-specific rules.
- A new generic schema/code-generation layer could itself become another source
  of drift.

Mitigations are defined in the RFC and migration plan.

## Rollout

1. Inventory and classify every existing feature as invariant, heuristic,
   doctrine, provider adapter, historical evidence or ceremony.
2. Extract doctrine without changing current behavior.
3. Build Boundary Guard coverage and non-vacuous checks.
4. Introduce execution capsules and runtime evidence alongside current
   artifacts.
5. Add `lightweight`, `balanced`, `controlled` and `strict` profiles; keep
   `strict` as the default initially.
6. Dual-run verification on representative consumer repositories.
7. Promote `balanced` only after defect-catching parity and token reduction are
   demonstrated.
8. Deprecate, but do not immediately delete, duplicated choreography and
   artifact requirements.

## Decision status

This ADR proposes the target architecture and migration constraints. It does
not authorize immediate removal of existing agents, hooks, gates or artifacts.
Those changes require follow-up PRs with parity evidence and rollback paths.
