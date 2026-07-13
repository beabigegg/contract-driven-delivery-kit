# RFC: Agent-native CDD rearchitecture

## Status

Proposed for maintainer review. This RFC defines the target architecture and
migration strategy; it does not directly remove current capabilities.

## Executive summary

CDD should be simplified without abandoning the protections added after real
failures. The redesign must take advantage of stronger AI agents while treating
agent confidence as insufficient proof for API/data shape, migrations,
authorization, destructive operations and release safety.

The central change is:

> Move workflow choreography out of prompts and Markdown, preserve engineering
> doctrine as modular knowledge, move repeatable state into the runtime, and
> make deterministic boundary verification stronger than it is today.

This produces a system with:

- thin orchestration;
- modular engineering doctrine;
- dynamic specialist agents;
- runtime-generated execution capsules;
- an independently runnable Boundary Guard;
- concise machine evidence;
- risk-based human approval;
- a strict compatibility profile for existing projects.

## Maintainer concerns this RFC must answer

The redesign is driven by several concerns that must remain visible throughout
implementation.

### Concern 1: The kit has drifted from its original purpose

The original purpose was to prevent frontend/backend integration failures,
especially endpoint and data-shape drift. The current kit now governs most of
the software-delivery lifecycle. The redesign must restore API/data boundaries
to the center rather than merely make the current workflow faster.

### Concern 2: The added features exist because failures actually happened

Contracts, reviews, gates, TDD, context control, resilience checks, interaction
design and evidence were not added arbitrarily. Removing them wholesale would
repeat old mistakes. Every existing feature needs a disposition and an explicit
replacement before it can be deprecated.

### Concern 3: Strong agents are better, but still make confident mistakes

A stronger agent can plan, explore and implement with less scaffolding. It can
also omit a consumer, validate the wrong branch, invent a response field or
approve its own flawed reasoning. Autonomy must increase only where independent
or deterministic evidence still closes the loop.

### Concern 4: Subagents contain engineering philosophy

Current agents encode valuable doctrine: thin controllers, service boundaries,
boundary validation, generated API types, compatibility rules, accessibility,
minimalism, idempotency, transaction safety and other lessons. They are not
replaceable by generic model intelligence. The redesign must extract and
preserve this knowledge instead of deleting it with the workflow.

### Concern 5: `CLAUDE.md` is both useful and too coupled

Project guidance currently mixes project facts, engineering rules, CDD command
manuals, workflow state and promoted lessons. It reliably steers agents but is
loaded repeatedly and binds projects to one provider's operating model. The
redesign must retain project-specific invariants while moving generic runtime
instructions to on-demand resources.

### Concern 6: Token reduction must not mean reduced assurance

The target is fewer repeated prompts, artifacts and agent round trips. It is not
fewer boundary checks. Assurance should increasingly come from generated data,
framework validation and CI rather than prose claims.

## Diagnosis of the current architecture

CDD currently combines five systems in one workflow.

1. **Knowledge system**: contracts, project guidance, promoted learnings and
   specialist-agent rules.
2. **Planning system**: classification, design, test planning, CI planning and
   implementation planning.
3. **Workflow engine**: agent sequencing, artifact ownership, task status,
   context approvals and resumption.
4. **Verification system**: validators, generated artifacts, tests, gates and
   review agents.
5. **Audit system**: agent logs, test evidence, archives and learning promotion.

The most expensive coupling is that the workflow engine is implemented partly
inside skills and agent prompts. Each agent must understand enough of the whole
system to participate safely. This leads to repeated context and operating
instructions.

The most important assurance gap is that process completeness and boundary
completeness are not equivalent. A change can have classification, plans,
reviewers and green gates while a response schema is too broad, a runtime branch
is unsampled or a frontend interface was hand-written independently.

## Design principles

### P1. Preserve outcomes, not historical implementation forms

A feature introduced to prevent a failure must retain its safety outcome. It
does not need to retain the same Markdown file, hook or agent sequence.

### P2. Doctrine guides; tools prove

Use doctrine for engineering judgment. Use deterministic tools for facts that
can be checked: routes, schemas, generated clients, dependency graphs, test
results, migrations and secret exposure.

### P3. Agent autonomy is scoped, not absolute

Agents choose local implementation strategy inside an execution capsule. They
do not choose whether required boundary evidence may be skipped.

### P4. Diff-first context

Start from affected symbols, endpoints, contracts, consumers and tests. Do not
start by loading the whole repository or the whole CDD manual.

### P5. Fail safe on uncertainty

If risk routing is uncertain, escalate to a stronger profile. If an API claim
cannot be resolved to a typed contract, fail instead of silently skipping for a
changed endpoint.

### P6. No vacuous green checks

A validator that checks zero applicable items must not report success when the
diff indicates that applicable items exist.

### P7. One canonical boundary model

Frontend and backend may project the contract into stack-specific types, but
must not independently define canonical request or response shapes.

### P8. Independent review where self-review is unsafe

The implementer must not be the sole judge for contract compatibility,
migrations, security, production operations or other explicitly high-risk
surfaces.

### P9. Compatibility before replacement

The strict workflow remains available until the new path demonstrates equal or
better defect detection on real repositories.

## Target architecture

```text
User intent
    |
    v
Thin orchestration skill
    |
    +--> Runtime impact/risk analysis
    |         |
    |         +--> doctrine selector
    |         +--> capability/profile selector
    |         +--> execution capsule
    |
    +--> Dynamic agent team
    |         |
    |         +--> implementer + selected capabilities
    |         +--> independent reviewer when required
    |
    +--> Deterministic runtime
              |
              +--> Boundary Guard
              +--> test selection/execution
              +--> migration/security checks
              +--> evidence generation
              +--> policy/approval decision
```

### A. Engineering constitution

Doctrine is organized as small, directly selectable modules.

```text
doctrine/
  core-engineering.md
  api-boundary.md
  backend.md
  frontend.md
  testing.md
  interaction-accessibility.md
  data-migration.md
  security-authorization.md
  operations-resilience.md
```

Each module contains only stable, non-obvious and opinionated guidance. Tool
commands, artifact formats and current workflow state do not belong here.

Example `api-boundary` doctrine:

- never infer a frontend-visible shape from one backend branch;
- identify all producers and consumers before changing a field;
- use generated types when the stack supports them;
- preserve optionality, nullability, enum and error semantics;
- distinguish additive compatibility from semantic compatibility;
- verify cache, fallback, async and error variants separately.

### B. Agent model

Replace many monolithic role prompts with composable profiles.

#### Base roles

- `implementer`: changes code and tests within scope;
- `reviewer`: independently evaluates a completed diff and evidence;
- `planner`: optional for large or ambiguous changes.

#### Capability profiles

- backend;
- frontend;
- contract;
- testing;
- interaction/accessibility;
- migration;
- security;
- resilience/performance;
- release/operations.

A single agent invocation can be composed as:

```yaml
role: implementer
capabilities: [backend, contract]
doctrine: [core, api-boundary, backend, testing]
```

or:

```yaml
role: reviewer
capabilities: [contract, frontend]
doctrine: [core, api-boundary, frontend]
```

#### What remains static in an agent profile

- role responsibility;
- tool permissions;
- doctrine references;
- stop conditions;
- concise return schema.

#### What becomes dynamic

- objective;
- affected files and symbols;
- contracts and consumers;
- allowed write scope;
- non-goals;
- required evidence;
- human-approved decisions;
- relevant project invariants.

### C. Execution capsule

The runtime generates a compact capsule instead of requiring each agent to read
and reconcile the full change folder.

```yaml
change_id: add-package-group
objective: Add packageGroup to resource-status responses and consumers.
profile: controlled
risk_signals:
  - api-response-shape
  - cache-and-database-branches
affected:
  endpoints:
    - GET /api/resource/status
  producers:
    - src/.../resource_service.py
    - src/.../resource_routes.py
  consumers:
    - frontend/src/resource-status/api.ts
    - frontend/src/resource-status/ResourceStatus.vue
  contracts:
    - contracts/api/api-contract.md#ResourceStatusResponse
write_scope:
  - src/.../resource_service.py
  - src/.../resource_routes.py
  - frontend/src/resource-status/
  - tests/
invariants:
  - Existing fields remain backward compatible.
  - Cache and database fallback return the same shape.
  - Frontend response types are generated.
required_evidence:
  - request-schema
  - response-schema-cache
  - response-schema-database
  - generated-client-clean
  - frontend-typecheck
  - targeted-tests
```

Capsules are generated from repository state and policy. They may be exported
for audit, but need not be hand-authored or committed for routine work.

### D. Boundary Guard

Boundary Guard becomes a first-class CLI/MCP subsystem and a required CI check
independent of tracked-change artifacts.

#### D1. Route conformance

- backend route exists in contract;
- contract route exists in backend where expected;
- frontend call uses a contracted method/path;
- dynamic or unresolvable routes require explicit adapter or exception.

#### D2. Request conformance

- path and query parameters;
- JSON bodies;
- multipart/upload metadata;
- optionality, nullability, enum and defaults;
- frontend request builders or generated client compatibility;
- backend request model or boundary test compatibility.

#### D3. Response conformance

- status-specific schemas, not one shape per endpoint only;
- 200, 201, 202 and standard error variants;
- exact field names and types;
- required vs optional fields;
- nullability and enum membership;
- additional-property policy;
- binary/streaming exceptions.

#### D4. Runtime branch variants

The manifest supports multiple cases per operation:

```yaml
POST /api/history/query:
  variants:
    sync-200:
      response: HistoryQueryResponse
    async-202:
      response: JobAcceptedResponse
    worker-unavailable-503:
      response: StandardErrorResponse
```

Project adapters capture real serialized responses using framework test clients.
The validator remains language-neutral by validating boundary JSON.

#### D5. Generic schema policy

Broad schemas are classified:

- `closed`: endpoint-specific, preferred for application APIs;
- `open-content`: intentionally dynamic with documented consumer behavior;
- `legacy`: temporary exception with owner and target date;
- `binary/stream`: non-JSON exception.

An API-affecting diff that touches a `legacy` or unresolved prose schema cannot
silently pass. It must either migrate the endpoint, record an approved exception
or run under strict review.

#### D6. Consumer generation and drift

Where supported:

```text
canonical contract -> OpenAPI/JSON Schema -> frontend types/client
                                     -> backend models/validators
```

CI verifies that generated artifacts are current. Hand-written types that
duplicate generated API shapes are rejected by a project-configurable scanner.

#### D7. Non-vacuous coverage

For an API-affecting diff, Boundary Guard reports and enforces:

- changed operations;
- operations with typed request schemas;
- operations with typed response schemas;
- required response variants;
- captured variants;
- known consumers checked;
- generated artifacts checked.

Zero applicable checks is an error when changed operations are non-zero.

### E. Runtime state and evidence

The runtime owns:

- agent invocation state;
- pending approvals;
- selected profiles;
- test runs;
- check results;
- evidence pointers;
- final verdict.

Default evidence is concise JSON:

```json
{
  "profile": "controlled",
  "changedOperations": 1,
  "boundary": {
    "route": "passed",
    "request": "passed",
    "responseVariants": {
      "cache": "passed",
      "database": "passed"
    },
    "consumer": "passed"
  },
  "tests": "passed",
  "review": "passed",
  "approval": "not-required"
}
```

Detailed logs exist only for failures, human decisions, approved risk or audit
export. Routine success does not create one Markdown file per agent.

Human acceptance follows the same rule. The oracle and its tamper-evident lock
remain available, but become required evidence only in strict or when a
controlled/explicit capsule selects `acceptance-oracle`. Ordinary balanced and
lightweight work is proven by deterministic boundary/test evidence instead.

### F. Project policy

A minimal `.cdd/policy.yml` controls profiles and exceptions.

```yaml
version: 1
default_profile: balanced

boundary_guard:
  enabled: true
  fail_on_zero_coverage: true
  changed_api_requires_typed_request: true
  changed_api_requires_typed_response: true
  generic_schema_policy: controlled

approvals:
  breaking_api: required
  destructive_migration: required
  auth_policy: required
  production_operation: required

profiles:
  lightweight:
    acceptance_oracle: not-required
  balanced:
    acceptance_oracle: not-required
  controlled:
    acceptance_oracle: conditional
  strict:
    legacy_workflow: true
    acceptance_oracle: required

exceptions:
  - id: legacy-ai-output
    operation: POST /api/ai/query
    class: open-content
    reason: model-defined payload intentionally not closed
    owner: application-team
```

### G. Minimal project guidance

`CLAUDE.md`, `AGENTS.md` or provider-equivalent files retain:

- project overview;
- architecture and entry points;
- install/run/test/build commands;
- project-specific invariants;
- one short CDD pointer.

Generic material moves out:

- complete CLI tables;
- agent-log schema;
- context-expansion procedure;
- test-runner syntax;
- upgrade instructions;
- generic engineering doctrine;
- active workflow state.

Example:

```markdown
## CDD
Use the installed CDD delivery capability for non-trivial changes.
Project policy: `.cdd/policy.yml`.
Run `cdd verify` before completion.
```

### H. Hooks and chokepoints

Retain hooks only where they are a real chokepoint.

#### Blocking

- secret exposure;
- destructive migration without approval/evidence;
- stale generated contract artifacts;
- changed API with missing boundary evidence;
- branch protection / required CI checks;
- unauthorized production action.

#### Advisory or runtime-managed

- graph-first exploration;
- broad-test steering;
- prompt workflow order;
- Markdown section wording;
- agent-log formatting;
- routine context expansion.

A hook that can be trivially bypassed by using Bash rather than Edit is not a
security boundary. It may remain advisory but must not be represented as hard
enforcement.

## Workflow profiles and routing

### Lightweight profile

Triggers:

- docs-only;
- comments;
- formatting;
- lint-only;
- behavior-neutral local maintenance.

Default team: one implementer.

Evidence: changed-area check and configured quality checks.

### Balanced profile

Triggers:

- ordinary feature;
- ordinary bug;
- local refactor;
- non-breaking UI behavior.

Default team: one implementer, reviewer only when policy or risk signal requires.

Evidence: affected boundaries, targeted tests, changed-area tests and quality
checks.

### Controlled profile

Triggers:

- API/data shape;
- cross-module behavior;
- cache or async branching;
- background jobs;
- externally visible compatibility;
- shared components or common services.

Default team: implementer plus independent specialist reviewer.

Evidence: Boundary Guard, branch variants, consumer check, targeted/integration
tests and policy-selected checks.

### Strict profile

Triggers:

- critical risk;
- regulated/audited delivery;
- fully autonomous delivery without a human reviewer;
- project opt-in;
- uncertain routing;
- migration fallback.

The current artifact-rich workflow remains supported while equivalent runtime
controls are proven.

## Risk routing

Routing must use evidence from the diff and project graph, not prose keyword
matching alone.

Signals include:

- changed endpoint definitions or frontend calls;
- changed schema files;
- migration files and DDL operations;
- auth middleware and permission checks;
- queue, lock, pool and worker code with changed callers;
- shared component/service consumer count;
- changed deployment or environment surfaces;
- destructive commands.

Keyword matches may raise an advisory suspicion but cannot alone force a
critical tier. Conversely, graph-confirmed high-risk surfaces cannot be waived
without a recorded reason and approval where policy requires it.

## What happens to existing features

No existing capability is deleted by this RFC. Each is classified before
migration.

- **Keep and strengthen**: contracts, OpenAPI/JSON Schema, conformance, code
  graph/index, bounded tests, evidence, compatibility, migration/security gates,
  acceptance provenance, interaction intent.
- **Move to doctrine**: thin controllers, minimalism, accessibility, TDD
  principles, common engineering pitfalls.
- **Move to runtime**: agent sequencing, task state, context packets, test-run
  bookkeeping, evidence aggregation.
- **Make conditional**: specialist agents, design artifacts, stress/soak/monkey,
  deep human confirmation.
- **Retain as strict compatibility**: existing tracked-change artifact set and
  current `/cdd-new` workflow.
- **Deprecate after parity**: duplicated prompt instructions, routine clean-pass
  agent logs, format-only gates and manual task ticking.

The full mapping is maintained in
`docs/migration/agent-native-cdd-feature-map.md`.

## Token-efficiency model

Token reduction comes from architecture rather than asking agents to be terse.

1. Doctrine modules load only when selected.
2. Execution capsules replace repeated artifact reads.
3. Impact results provide exact symbols and relevant source ranges.
4. Agent results use structured verdicts rather than narrative handoffs.
5. Routine evidence is generated, not authored.
6. Archives are cold data and never planning input by default.
7. Project guidance excludes generic CDD manuals.
8. Small changes do not invoke classifier/planner/reviewer chains unless needed.
9. Stronger models are reserved for design, ambiguity and high-risk review;
   deterministic scans and smaller models handle indexing and formatting.

Metrics must include total input/output tokens by change profile, not only prompt
line counts.

## Migration and compatibility

The redesign ships incrementally.

### Compatibility rules

- existing repositories continue to work without migration;
- existing contracts and archives are not rewritten;
- current agents and skills remain available under `strict`;
- new runtime data can be exported to human-readable form;
- new profiles initially run in shadow mode;
- a project can pin strict mode and opt out of new defaults;
- rollback changes policy/profile, not contract history.

### Dual-run parity

Representative changes run both:

- current strict workflow and gate;
- new runtime routing and verification.

Compare:

- defects found;
- false positives;
- escaped API/data-shape issues;
- agent invocations;
- artifacts written;
- human interruptions;
- token use;
- elapsed delivery turns.

Balanced mode becomes a default only after it catches every intentionally seeded
boundary mutation that strict mode catches, plus the new non-vacuous and variant
checks.

Detailed phases are in `docs/migration/agent-native-cdd-migration.md`.

## Proposed public experience

Primary commands become small and intent-oriented:

```bash
cdd setup
cdd work "add packageGroup to resource status"
cdd verify
cdd status
cdd doctor
```

Advanced namespaces remain for direct control:

```bash
cdd contract ...
cdd boundary ...
cdd graph ...
cdd test ...
cdd policy ...
cdd debug ...
```

The current `cdd-kit` binary may retain aliases during migration.

## Anti-goals

This RFC does not propose:

- trusting an agent's statement in place of executable evidence;
- removing contracts or tests;
- making all changes autonomous;
- eliminating specialist review;
- forcing one universal backend/client generator for every stack;
- automatically rewriting historical change archives;
- replacing project-specific engineering rules with generic doctrine;
- changing current defaults before parity data exists;
- representing advisory prompts as security boundaries.

## Implementation workstreams

The normative component, state, provider and upgrade contracts are defined in
`docs/rfc/agent-native-cdd-runtime-contracts.md`. Follow-up implementation must
conform to that document rather than treating the examples in this RFC as
complete schemas.

### Workstream 1: Inventory and doctrine extraction

- enumerate current agents, skills, hooks, validators and artifacts;
- classify every rule and feature;
- deduplicate doctrine;
- add doctrine tests for selection and provider packaging.

### Workstream 2: Boundary Guard

- changed-operation detection;
- request-schema validation;
- status-specific response schemas;
- multi-variant manifests;
- generic-schema policy;
- generated-consumer checks;
- non-vacuous coverage.

### Workstream 3: Runtime state and capsules

- impact packet schema;
- execution capsule schema;
- agent-run state;
- concise evidence schema;
- export/debug views;
- resume semantics.

### Workstream 4: Dynamic profiles

- base roles;
- capability packs;
- doctrine selector;
- fail-safe routing;
- independent-review policy.

### Workstream 5: Project/provider simplification

- minimal guidance templates;
- Claude/Codex adapters;
- on-demand runtime help;
- migration tooling for existing guidance and agents.

### Workstream 6: Compatibility and rollout

- strict compatibility profile;
- shadow/dual-run mode;
- metrics and mutation suite;
- consumer-project migration tooling;
- deprecation timeline.

## Acceptance criteria for the redesign program

1. A changed API operation cannot pass with zero typed boundary checks.
2. Seeded route, request, response, nullability, enum and runtime-branch mutations
   are caught.
3. Frontend generated types and backend boundary behavior reconcile to one
   canonical contract on supported stacks.
4. Existing projects can remain on strict mode without archive rewrites.
5. Doctrine currently embedded in backend, frontend and contract agents is
   preserved and traceably mapped.
6. Balanced-mode standard changes use materially fewer tokens and agent calls
   than strict mode.
7. High-risk changes still require independent review and configured human
   approval.
8. Runtime evidence remains inspectable, exportable and resumable.
9. A project can revert to strict mode without losing contracts or evidence.
10. No current feature is removed until its safety outcome has a tested
    replacement or an explicit maintainer decision to retire it.

## Open decisions

1. Whether the next major release should rename the primary binary from
   `cdd-kit` to `cdd` or retain the current name.
2. Whether `change.yml` is committed by default for controlled changes or stored
   as runtime state with an optional export.
3. Whether doctrine modules are Markdown, structured YAML, or Markdown with
   machine-readable frontmatter.
4. Which stacks receive first-party backend model adapters beyond FastAPI.
5. How long strict mode remains the default after shadow parity is achieved.
6. Which existing artifact views remain first-class exports for audit users.

## Review request

Review this RFC primarily against three questions:

1. Does it preserve every protection that exists because of a real failure?
2. Does it put API/data-shape correctness back at the center?
3. Does it remove workflow/token cost by relocation and automation rather than by
   lowering assurance?
