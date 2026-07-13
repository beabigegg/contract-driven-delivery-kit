# Design: agent-native CDD rearchitecture

## Architecture Summary

The redesign separates concerns that are currently co-located in skills, agent
prompts, project guidance and Markdown artifacts. Engineering philosophy becomes
modular doctrine; repeatable workflow state becomes runtime state; subagents
become composable roles and capabilities; API/data-shape verification becomes an
independent Boundary Guard; project guidance becomes project-specific and small;
and the current workflow remains available as a strict compatibility profile.

Detailed rationale and examples live in:

- `docs/adr/0013-agent-native-delivery-runtime.md`
- `docs/rfc/agent-native-cdd-rearchitecture.md`
- `docs/migration/agent-native-cdd-migration.md`
- `docs/migration/agent-native-cdd-feature-map.md`

## Affected Components

| component | current location | target responsibility | delivered in this increment |
|---|---|---|---|
| Engineering doctrine | duplicated across `.claude/agents/`, skills and guidance | provider-neutral doctrine modules | extract and deduplicate without changing safety intent |
| Agent roles | `.claude/agents/` | base roles + capability profiles + selected doctrine | shrink static prompts; inject task capsule at runtime |
| Orchestration | `/cdd-new`, `/cdd-resume`, main-agent instructions | thin skill + runtime policy | replace fixed sequence with risk-selected team |
| Workflow state | change artifacts and `tasks.yml` | versioned runtime state | retain strict artifact export and backward readers |
| Context control | context manifest + agent instructions | impact packet and execution capsule | generated for routine work; persisted for strict/audit |
| API/data conformance | contract validators and samples | Boundary Guard | add request, status variants, consumer checks and non-vacuous coverage |
| Test evidence | test plans, runner and evidence files | runtime-selected tests and generated evidence | preserve bounded ladder while removing repeated prompt syntax |
| Human decisions | acceptance/design artifacts and locks | conditional decision records | retain when provenance is materially required |
| Project guidance | `CLAUDE.md`, `AGENTS.md`, templates | project facts and local invariants | move generic CDD manuals to on-demand help |
| Provider integration | Claude/Codex assets | provider adapters | keep one runtime/doctrine source of truth |
| Hooks | `hooks/` and installed provider settings | true chokepoints or advisory steering | stop representing bypassable prompt hooks as hard security |
| Compatibility | current workflow | `strict` profile | remain supported through migration and rollback |

## Target Layering

```text
Engineering Constitution
  stable decision doctrine, selected by affected surface

Thin Orchestration Skill
  intent intake, runtime invocation, approval dialogue, final summary

Dynamic Agent Profiles
  implementer/reviewer/planner + capability packs + selected doctrine

Deterministic Runtime
  impact, risk, scope, capsule, state, tests, evidence, resume

Boundary and Risk Guardrails
  API/data, migration, auth/security, destructive operations, release

Provider Adapters
  Claude Code, Codex and future environments

Minimal Project Guidance
  project facts, commands, architecture, local invariants, policy pointer
```

## Key Decisions

### D-1: Preserve subagent knowledge, remove workflow duplication

Current subagents remain valuable because they encode engineering expertise and
permission boundaries. Their prompts are decomposed into:

- doctrine that should be reusable across roles;
- capability-specific expertise;
- provider/tool adapter instructions;
- workflow instructions that move to the runtime;
- project-specific rules that remain in the project.

A current agent is not removed until every rule has a traceable destination.

### D-2: Boundary Guard is independent of tracked-change workflow

API/data-shape correctness must not depend on whether `/cdd-new` was used. The
Boundary Guard can run directly in local verification and CI. Changed operations
must receive typed and non-vacuous checks according to policy.

### D-3: Dynamic team selection is fail-safe

The runtime selects the smallest sufficient team. Unknown or conflicting risk,
missing policy, incomplete boundary coverage or reviewer disagreement escalates
to controlled or strict mode. An agent cannot downgrade a configured approval.

### D-4: Runtime state replaces routine hand-authored artifacts

Repository-derived facts, selected agents, test runs and check outcomes are
runtime data. They remain inspectable and exportable. Human-authored durable
records are reserved for intent, architecture/interaction decisions and approved
risk.

### D-5: Strict mode is a compatibility contract

The current workflow is not immediately deprecated. It remains available for
existing projects, high-risk changes, audit-heavy contexts and fallback. New
profiles must demonstrate mutation-catching parity and rollback before defaults
change.

### D-6: Project guidance is not the kit manual

Project guidance contains only project facts, commands, local invariants and a
short runtime pointer. Generic CDD commands, agent-log formats, test-runner syntax
and workflow state move to skills/runtime help loaded only when needed.

### D-7: Evidence replaces claims

Agents may report intent and risks, but completion depends on deterministic
checks and independent review selected by policy. Routine evidence is concise
structured data. Detailed prose is created only for failures, human decisions or
approved risk.

## Rejected Alternatives

### R-1: Delete the current workflow and trust stronger agents

Rejected. Strong agents still hallucinate contracts, omit branches and approve
their own mistakes. It would also discard accumulated engineering doctrine.

### R-2: Keep the current architecture and only shorten prompts

Rejected. Prompt trimming alone cannot remove duplicated state, fixed sequencing
or artifact coordination, and does not restore API/data boundaries as the core.

### R-3: Convert the entire kit into one large skill

Rejected. A large skill still consumes context and cannot replace deterministic
validation, CI, runtime state or provider-neutral tools.

### R-4: Remove subagents and use one general agent

Rejected. Independent review, tool permissions and specialist sensitivity remain
valuable. The problem is monolithic prompts and fixed sequencing, not the
existence of expertise.

### R-5: Automatically rewrite all existing projects and archives

Rejected. Historical records remain cold, readable data. Consumer migration must
be incremental and reversible.

### R-6: Make every engineering preference a hard static rule

Rejected. Context-blind rules create false positives and reproduce the same bad
judgment the kit seeks to prevent. Only mechanically provable invariants become
blocking validators.

## Migration and Rollback Strategy

### Migration

1. Inventory current features and rules.
2. Extract doctrine with no behavior change.
3. Strengthen Boundary Guard.
4. Generate execution capsules alongside current artifacts.
5. Shadow dynamic routing and evidence.
6. Allow opt-in balanced/controlled profiles.
7. Change defaults only after parity and token metrics pass.
8. Deprecate duplicated ceremony through a compatibility window.

### Rollback

- Switch project policy back to `strict`.
- Restore previous required CI checks.
- Disable new profile routing or capsule generation.
- Keep contracts, OpenAPI projections, evidence and archives intact.
- Do not migrate active changes automatically.

## Safety Boundaries

The following remain blocking regardless of orchestration simplification:

- changed API with missing typed/non-vacuous boundary evidence;
- stale generated contract artifacts;
- breaking API without approval;
- destructive migration without rollback and approval;
- authorization/security policy changes without independent review;
- secret exposure;
- unauthorized destructive production action;
- required test failure;
- reviewer disagreement on configured high-risk surfaces.

## Program Increments

| increment | outcome | default impact |
|---|---|---|
| I1 | feature inventory and doctrine extraction | none |
| I2 | Boundary Guard preview | informational/shadow |
| I3 | execution capsules and runtime evidence | shadow |
| I4 | dynamic profile shadow routing | shadow |
| I5 | opt-in balanced/controlled profiles | project opt-in |
| I6 | minimal guidance migration | opt-in with dry-run |
| I7 | default change | future major release only |
| I8 | ceremony removals | after compatibility window |

## Observability and Metrics

The runtime must record per change:

- selected profile and reason;
- risk signals;
- agents/capabilities invoked;
- files/symbols supplied and read where available;
- tokens by agent/model;
- changed operations and boundary coverage;
- tests/checks and outcomes;
- approvals and reviewer verdicts;
- artifacts generated;
- fallback/escalation events.

Program evaluation compares strict and new profiles on seeded mutations and real
consumer changes.

## Deferred Promotion Decisions

- Retention policy for `.cdd/runtime/` evidence beyond the current local store.
- Additional first-party backend framework adapters beyond JSON Schema.
- Primary binary naming and compatibility-window length for a future major.
- Human-readable export formats required by audit-heavy consumers.
- The profile/default promotion decision after parity and token measurements.

The persistence location, schema versioning, doctrine format, provider boundary
and strict/shadow policy are fixed by the runtime contract RFC for this increment.
