# Migration plan: current CDD workflow to agent-native runtime

## Purpose

This plan migrates the kit and existing consumer repositories without discarding
contracts, gates, agents, archives or project-specific lessons. The migration is
incremental, reversible and evidence-driven.

The target architecture is defined in:

- `docs/adr/0013-agent-native-delivery-runtime.md`
- `docs/rfc/agent-native-cdd-rearchitecture.md`

## Migration guarantees

1. Existing repositories continue to run the current workflow until they opt in.
2. Existing `contracts/`, `specs/archive/`, active changes and promoted learnings
   are not rewritten automatically.
3. The current workflow remains available as the `strict` profile.
4. New profiles are introduced in shadow mode before they can become defaults.
5. A project can switch back to strict mode without reverting contract history.
6. No safety feature is removed until its outcome has an equivalent tested
   replacement or an explicit retirement decision.
7. API/data-shape protection must improve before workflow ceremony is reduced.
8. Migration tooling reports what it would change before applying changes.

## Terminology

- **Legacy/current workflow**: the artifact-rich `/cdd-new` flow in current
  releases.
- **Strict profile**: compatibility wrapper for the current workflow.
- **Balanced profile**: agent-native default candidate for normal changes.
- **Controlled profile**: stronger path for API/data/cross-module changes.
- **Boundary Guard**: independently runnable API/data-shape verification.
- **Doctrine**: stable engineering principles extracted from prompts and guides.
- **Execution capsule**: runtime-generated task, scope, invariant and evidence
  packet supplied to an agent.
- **Shadow mode**: new routing/verifiers run and report, but current gates remain
  authoritative.

## Phase 0: Freeze further workflow expansion

### Objective

Prevent the current workflow from accumulating new mandatory roles, artifacts or
blocking hooks while the architecture is reassessed.

### Rules

- New checks should prefer deterministic validators over new required Markdown.
- New engineering guidance should identify its future doctrine module.
- New agent roles require evidence that a capability profile cannot cover the
  need.
- New blocking hooks require a real chokepoint and a bypass analysis.
- API/data-shape improvements are allowed and prioritized.

### Exit criteria

- Maintainer accepts ADR 0013 as the architectural direction.
- Feature inventory owner and format are agreed.

## Phase 1: Inventory and classify existing behavior

### Objective

Create a machine-readable inventory of everything the kit currently installs,
runs, validates or documents.

### Inventory classes

- `invariant`: must be mechanically enforced;
- `doctrine`: engineering judgment supplied to agents;
- `heuristic`: risk or impact signal, not proof;
- `runtime-state`: workflow bookkeeping;
- `provider-adapter`: Claude/Codex/platform-specific integration;
- `project-guidance`: project facts or local invariants;
- `historical-evidence`: archive and incident-derived detail;
- `ceremony-candidate`: duplicate or format-only process.

### Required outputs

- feature inventory with owner and current implementation;
- rule-to-doctrine/validator mapping;
- duplicate prompt-rule report;
- hook bypass report;
- artifact producer/consumer graph;
- baseline token and agent-call metrics.

### Exit criteria

Every current feature has one migration disposition:

- retain;
- strengthen;
- move;
- make conditional;
- retain under strict only;
- deprecate after parity;
- retire by explicit decision.

## Phase 2: Extract doctrine without changing workflow

### Objective

Separate engineering philosophy from workflow instructions while preserving
current behavior.

### Actions

1. Create doctrine modules for core, API boundary, backend, frontend, testing,
   interaction/accessibility, migration, security and operations.
2. Map each existing agent rule to a doctrine item, runtime instruction,
   validator or project-local rule.
3. Replace duplicated prompt paragraphs with direct doctrine references during
   packaging.
4. Keep current agent names, tools and workflow order unchanged.
5. Add tests ensuring every removed prompt rule is still delivered through the
   selected doctrine package.

### Validation

- snapshot packaged agent prompts before and after extraction;
- assert doctrine selection contains all mapped safety rules;
- run existing agent/skill tests;
- manually review conflicts exposed by deduplication.

### Rollback

Restore packaged prompts from the previous release. No project repository data is
changed.

## Phase 3: Build Boundary Guard as an independent subsystem

### Objective

Strengthen the original API/data-shape purpose before reducing workflow.

### Capabilities

- changed-operation detection from diff and graph;
- backend route and frontend call reconciliation;
- typed path/query/request validation;
- status-specific typed responses;
- multiple runtime variants per operation;
- real HTTP boundary sample capture;
- generated frontend type/client drift checks;
- backend model/validator adapters where supported;
- explicit generic-schema classification;
- consumer inventory checks;
- non-vacuous coverage enforcement.

### Compatibility

Existing `.cdd/conformance.json` remains readable. A migration command produces a
new policy block without deleting the old file until the project accepts it.

Implemented command shape:

```bash
cdd-kit boundary init
cdd-kit boundary check
cdd-kit runtime migrate
cdd-kit runtime migrate --yes
```

### Ratchet strategy

For legacy repositories:

1. untouched legacy endpoints may remain advisory;
2. any changed operation must meet the configured typed-coverage floor;
3. high-value operations are migrated first;
4. explicit exceptions require class, reason, owner and review date;
5. new operations cannot enter as unresolved prose or broad generic shapes by
   default.

### Exit criteria

- mutation suite catches route, request, response, nullability, enum and branch
  drift;
- API-affecting changes cannot pass with zero checked operations;
- representative consumer repositories run Boundary Guard in CI;
- false-positive rate is acceptable and exceptions are explicit.

## Phase 4: Introduce runtime state and execution capsules

### Objective

Move repeated workflow bookkeeping out of agent-authored artifacts.

### New runtime data

- impact packet;
- selected profile and capabilities;
- execution capsule;
- agent run state;
- approvals;
- test/check results;
- concise evidence.

### Shadow behavior

The current workflow remains authoritative. The runtime generates a capsule from
existing artifacts and repository state, then compares it with the current
implementation plan.

### Parity checks

- objective and non-goals match;
- file scope is not narrower than required;
- contracts and consumers are present;
- tests selected by the runtime include current required tests;
- risk profile is not weaker than current classification.

### Rollback

Disable capsule generation. Existing artifacts remain untouched.

## Phase 5: Add dynamic agent profiles in shadow mode

### Objective

Prove that a smaller dynamically selected team provides equal or better results.

### Initial routing

- docs/micro: implementer only;
- normal local code: implementer, reviewer on risk signal;
- API/data shape: implementer + independent contract/consumer reviewer;
- migration: implementer + migration reviewer + approval;
- auth/security: implementer + security reviewer + approval;
- UI: implementer + interaction/accessibility review as required;
- concurrency/production load: implementer + resilience review.

### Fail-safe behavior

- unknown or conflicting risk signals select strict;
- missing project policy selects strict;
- incomplete Boundary Guard coverage for an API change selects controlled or
  strict;
- reviewer disagreement blocks or escalates;
- human approval policy cannot be downgraded by an agent.

### Comparison metrics

- issues found by each path;
- missed seeded mutations;
- false positives;
- agents invoked;
- prompt/input/output tokens;
- files read;
- permanent artifacts;
- human interruptions;
- delivery turns.

### Exit criteria

Balanced/controlled shadow runs catch all seeded failures caught by strict and
meet the agreed token-reduction target.

## Phase 6: Simplify project guidance and provider packaging

### Objective

Reduce recurring context without losing project-specific knowledge.

### Migration command

```bash
cdd-kit guidance audit
cdd-kit guidance migrate --dry-run
cdd-kit guidance migrate --apply
```

### What remains in project guidance

- project overview;
- architecture and entry points;
- development commands;
- project-specific invariants;
- promoted local rules with pointers;
- short CDD policy/runtime pointer.

### What moves out

- generic command reference;
- context-manifest procedure;
- agent-log schema;
- test-runner syntax;
- generic solution-minimalism text;
- provider installation details;
- active workflow state.

### Preservation rules

- content outside managed markers is never changed;
- promoted project-specific learnings remain local;
- the migration emits a before/after token estimate;
- removed generic sections remain accessible through runtime help.

## Phase 7: Enable opt-in profiles

### Objective

Allow selected projects to use agent-native workflows while strict remains the
default.

Example policy:

```yaml
version: 1
default_profile: strict
shadow_profile: balanced
boundary_guard:
  enabled: true
```

Opt-in promotion:

```yaml
default_profile: balanced
fallback_profile: strict
```

### Promotion criteria per project

- Boundary Guard is enabled and non-vacuous;
- generated client/model checks are configured where supported;
- project-specific invariants are retained;
- shadow parity target is met;
- maintainers know how to force strict for one change;
- rollback has been exercised.

## Phase 8: Change defaults and deprecate duplicated ceremony

### Objective

Make balanced mode the default only after program-level parity is proven.

### Candidate deprecations

- mandatory clean-pass agent logs;
- manual `tasks.yml` ticking;
- repeated test-runner instructions in every agent;
- duplicated solution-minimalism prose;
- routine context-manifest authoring where runtime scope is sufficient;
- fixed specialist-agent sequence;
- format-only gate requirements.

### Deprecation policy

- announce at least one minor release before removal;
- retain strict compatibility for at least two minor releases after default
  change;
- provide automated detection and migration;
- document exact replacement and rollback;
- do not delete archive readers.

## Consumer repository migration

### Repository category A: API-heavy full-stack applications

Examples include dashboards and internal reporting systems with many Flask/Vue
or similar endpoints.

Priority:

1. enable changed-operation detection;
2. classify generic schemas;
3. migrate high-value frontend-consumed endpoints to endpoint-specific schemas;
4. capture cache/database/async/error variants;
5. generate frontend types;
6. dual-run strict and controlled profiles;
7. simplify guidance only after boundary parity.

### Repository category B: typed framework applications

Examples include FastAPI applications.

Priority:

1. select canonical source direction explicitly;
2. bind routes to Pydantic request/response models;
3. generate frontend types from exported OpenAPI;
4. add drift checks;
5. replace static samples with test-client capture for important variants;
6. opt into balanced mode after coverage is broad enough.

### Repository category C: smaller or legacy projects

Priority:

1. keep strict or current behavior initially;
2. enable route/call conformance;
3. protect only changed endpoints with typed-schema ratcheting;
4. avoid mass contract rewrites;
5. use lightweight mode only for behavior-neutral work;
6. migrate guidance last.

## Existing artifact mapping

| Current artifact | New destination | Migration behavior |
|---|---|---|
| `change-request.md` | `change.yml.intent` or runtime request | retained under strict; exportable elsewhere |
| `change-classification.md` | runtime risk/profile result | retained under strict; shadow-compared |
| `context-manifest.md` | runtime scope/capsule | retained when audit or strict requires |
| `test-plan.md` | selected test/evidence plan | retained under strict; generated view later |
| `ci-gates.md` | project policy + runtime gate plan | retained under strict; generated view later |
| `implementation-plan.md` | execution capsule + optional decision record | retained for complex/strict changes |
| `tasks.yml` | runtime state | archive reader retained; no rewrite |
| `agent-log/*.yml` | runtime run/evidence record | detailed export only when needed |
| `qa-report.md` | exception/risk report | remains for blocking or approved-risk cases |
| `design.md` | `decision.md` | remains when architecture decisions are real |
| `interaction-design.md` | human-confirmed decision record | retained where UI intent needs provenance |
| `acceptance.yml` | conditional human-origin evidence | strict keeps current enforcement; non-strict profiles activate it only through policy/capsule |
| `test-evidence.yml` | runtime evidence | schema migration with backward reader |

### Acceptance-oracle migration

Migration never deletes or rewrites an existing oracle or lock. A repository
keeps legacy behavior until it explicitly invokes a profile or produces a
matching runtime capsule. In agent-native mode:

```bash
cdd-kit gate <change-id> --profile balanced
cdd-kit work <change-id> "objective" --require-acceptance
cdd-kit gate <change-id> --profile controlled --require-acceptance
```

The first command does not require an oracle. The latter two make it required
evidence. `--strict` and `--profile strict` always retain ADR 0010 behavior.

## Contract migration

Contracts remain authoritative. Migration changes representation only when it
improves enforceability.

### Rules

- no automatic deletion of prose that carries business meaning;
- generated OpenAPI remains a projection, never an independently edited source;
- changed endpoints must ratchet toward typed request/response schemas;
- schema/version history remains intact;
- compatibility rules remain project-owned;
- contract adapters must fail loudly when they cannot represent semantics.

## Agent migration

For each current agent:

1. extract engineering doctrine;
2. extract capability-specific expertise;
3. identify workflow-only instructions;
4. identify tool-operation instructions;
5. identify project-specific rules that do not belong in the kit;
6. map stop conditions and permissions;
7. create regression fixtures proving the new composed profile still receives the
   required safety rules.

No current agent is removed until its responsibilities are covered by base role,
capability, doctrine and runtime checks.

## CI migration

### Initial state

Current required checks remain authoritative. New checks run informationally.

### Intermediate state

Boundary Guard becomes required; old and new workflow checks coexist.

### Final state

Profile-specific checks are generated from policy. Strict continues to run the
legacy gate. Balanced/controlled run equivalent runtime checks and evidence.

### Rollback

Set project default to strict and restore previous required-check set. Generated
contract artifacts and evidence remain valid.

## Data and archive compatibility

- old change directories remain readable indefinitely;
- archive indexes are not regenerated destructively;
- new runtime evidence includes schema version;
- migration commands are idempotent and create backups where they edit files;
- `doctor` reports mixed-version states;
- export commands provide Markdown for audit users;
- no project is forced to migrate active changes mid-flight.

## Validation strategy

### Mutation corpus

Seed failures for:

- wrong method/path;
- missing request field;
- renamed response field;
- required/optional reversal;
- nullability mismatch;
- enum narrowing;
- cache branch missing a field;
- async 202 using the 200 shape;
- error response with wrong envelope;
- stale generated frontend type;
- hand-written duplicate consumer type;
- destructive migration without approval;
- authorization path bypass;
- zero-check/vacuous pass.

### Representative projects

Use at least:

- a large Flask/Vue API-heavy project;
- a FastAPI/React typed project;
- a smaller Flask/Vue or legacy project;
- the kit itself.

### Program metrics

- seeded mutations caught;
- real escaped defects;
- false positives and overrides;
- token usage by profile;
- agent calls and model mix;
- read volume;
- permanent artifacts;
- human approvals;
- delivery turns;
- rollback success.

## Recommended release sequence

1. Minor release: ADR/RFC, inventory tooling and doctrine extraction.
2. Minor release: Boundary Guard preview and shadow evidence.
3. Minor release: execution capsules and profile shadow mode.
4. Minor release: opt-in balanced/controlled profiles.
5. Major release: default-profile change and first ceremony deprecations.
6. Later major/minor releases: removals only after compatibility windows expire.

Because the package is already in the 3.x line, this architecture should not be
called "CDD 3.0". The default-changing release is a candidate for 4.0.0; preview
capabilities can ship earlier without implying the final major-version decision.

## Maintainer migration checklist

Before approving any phase:

- Which real failure is this feature protecting against?
- Where does that protection live after migration?
- Is it doctrine, deterministic enforcement, independent review or approval?
- Can the replacement be bypassed more easily than the current mechanism?
- How is parity tested?
- What is the rollback?
- What token or complexity reduction is actually measured?
- Does API/data-shape assurance improve, remain equal or regress?

If these questions are not answered, the feature is moved too early.
