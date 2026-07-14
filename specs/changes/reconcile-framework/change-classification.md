# Change Classification

## Change Types
- primary: feature-add (dry-run/plan-mode surface classifier + shared reconciliation registry + plan-mode command surface)
- secondary: contract-addition (new upgrade-reconciliation contract), ci-cd-change (mechanical enforcement of the invariants), upgrade/migration-tooling (extends the refresh/upgrade/asset-manifest path)

## Lane
- feature

## Risk Level
- high

## Impact Radius
- system-wide (every adopter's ground truth flows through the refresh/upgrade/asset-manifest path; a wrong surface disposition can overwrite bucket-1 files across all adopter repos)

## Tier
- 1

## Architecture Review Required
- yes
- reason: introduces a new module boundary (reconciliation registry + plan-mode) and a new cross-cutting data flow over the refresh/upgrade/asset-manifest path, adds a NEW contract surface, and defines a migration/rollback + fail-open story. spec-architect authors design.md before implementation-planner.

## Required Artifacts
Always required: change-request.md, change-classification.md, implementation-plan.md, test-plan.md, ci-gates.md, tasks.yml, context-manifest.md

## Optional Artifacts (default: no — set yes only with explicit reason)
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | existing refresh keep/replace analysis folds into design.md |
| proposal.md | no | scope/direction decided by the epic split |
| spec.md | no | behavior captured by the new contract + design.md + ACs |
| design.md | yes | Architecture Review yes: new registry/plan-mode boundary, new contract, migration/rollback + fail-open decisions |
| qa-report.md | yes | Tier 1, system-wide adopter-ground-truth blast radius + hard never-overwrite invariant; durable release-readiness evidence |
| regression-report.md | yes | extends the existing mutating refresh.ts/upgrade path; must prove force-refresh + never-overwrite not regressed by the registry consolidation |
| visual-review-report.md | no | no UI surface |
| monkey-test-report.md | no | recorded in agent-log/monkey-test-engineer.yml; blocking findings escalate into qa-report.md |
| stress-soak-report.md | no | a plan/dry-run classifier is not load/soak-shaped |

## Required Contracts
- API: none (no HTTP API surface)
- CSS/UI: none (CLI-only)
- Env: none
- Data shape: none
- Business logic: none
- CI/CD: yes — contracts/ci/ci-gate-contract.md (mechanical check that the reconciliation invariants are enforced)
- NEW contract: contracts/upgrade/upgrade-reconciliation-contract.md (path TBD in design.md) — encodes the two non-negotiable invariants: fail-open safe defaults for newly-added surfaces, and never-flip / never-overwrite of existing user-set values or ground-truth files.

## Required Tests
- unit: yes — surface→bucket classification for every kit-shipped surface; registry register/lookup typing; plan-mode formatter; delegation to existing digest/asset-manifest ownership detection
- contract: yes — upgrade-reconciliation invariants mechanically checked; ci-gate-contract addition asserted (pattern of test/contracts/ci-workflow.test.ts)
- integration: yes — plan pass iterates the single registry and mutates nothing; apply pass honors bucket-1; bucket-2 writes a backup before refresh; preserves the user's "Repository-specific fast gate" step
- E2E: yes — full --plan run over a fixture adopter repo (e2e-resilience-engineer)
- resilience: yes — failure injection (unreadable file, partial state, permission-denied, missing files) fails open to keep
- fuzz/monkey: yes — adversarial/malformed inputs never overwrite a bucket-1 file and never crash the plan pass
- visual / data-boundary / stress / soak: n/a

## Required Agents
- spec-architect — authors design.md before planning (Architecture Review yes)
- contract-reviewer — reviews the NEW upgrade-reconciliation contract + ci-gate-contract change
- test-strategist — authors test-plan.md
- ci-cd-gatekeeper — authors ci-gates.md; wires the mechanical invariant check; owns the ci-gate-contract change
- implementation-planner — execution packet before implementation
- backend-engineer — classifier, typed registry, plan/dry-run mode; extends refresh.ts, asset-manifest.ts, user-asset-manifest.ts, digest.ts (reuse-first)
- e2e-resilience-engineer — full plan-mode run over a fixture repo + failure injection
- monkey-test-engineer — adversarial/malformed-input corpus targeting never-overwrite
- qa-reviewer — release readiness; authors qa-report.md
- NOT required: stress-soak-engineer (not-applicable; plan classifier is not load/soak-shaped)

## Inferred Acceptance Criteria
- AC-1: The plan/dry-run mode maps every kit-shipped adopter surface to exactly one bucket (keep / replace / reconcile) and prints its per-surface disposition WITHOUT mutating any file.
- AC-2: In an apply pass, bucket-1 (never-overwrite) files are NEVER written or modified — verified for contracts/**, specs/changes|archive/**, src/**, tests/** (except tests/templates/), .cdd/policy.yml user-set values, .cdd/context-policy.json, code-map config, acceptance.yml/interaction-design.md/locks, and the user's own digest-detected (non-kit) agents/skills.
- AC-3: The reconciliation registry accepts a typed reconciler registration, and the plan pass iterates that single registry rather than four ad-hoc code paths.
- AC-4: Bucket-2 (force-refresh) surfaces are refreshed only after a backup is written first, and the refresh preserves the user's "Repository-specific fast gate" workflow step.
- AC-5: The upgrade-reconciliation contract exists and encodes both invariants (fail-open safe defaults; never-flip / never-overwrite), and these are mechanically checked by a validator/gate — not merely documented.
- AC-6: Malformed or adversarial inputs (corrupt policy.yml, unexpected CLAUDE.md content, missing files, unknown keys) never cause a bucket-1 file to be overwritten and never crash the plan pass — the classifier fails open to the safe keep disposition.
- AC-7: Ownership detection is delegated to the existing digest.ts / asset-manifest.ts / user-asset-manifest.ts utilities; no new digest-based ownership detection is reinvented.

## Tasks Not Applicable
- not-applicable: 2.1 (API contract), 2.2 (CSS/UI contract), 2.3 (Env contract), 2.4 (data-shape contract), 2.5 (business-logic contract), 3.5 (stress/soak), 4.2 (frontend), 5.1 (UI/UX review), 5.2 (visual review)
- applicable (do NOT skip): 1.3 (design review — Architecture Review yes)

## Clarifications or Assumptions
- New contract is genuinely new (contracts-index.md lists no upgrade/migration contract); spec-architect/contract-reviewer confirm the final path and whether any invariant belongs in ci-gate-contract.md instead.
- The plan-mode command surface (`upgrade --plan` vs `reconcile --plan`) is a design.md decision.
- The four bucket-3 reconcilers are OUT OF SCOPE (separate sub-changes); this delivers only the framework + registry + plan mode + bucket-1/2 taxonomy + contract.
- build.js regenerates assets/ from .claude/; template edits require a rebuild before CLI tests.

## Resolved Context Expansion Requests
- CER-001 (RESOLVED): `src/commands/upgrade.ts` and `src/commands/update.ts` both exist (confirmed) alongside `refresh.ts`/`migrate.ts`. No expansion needed; already in Allowed Paths.

## Context Manifest Draft

### Affected Surfaces
- Upgrade/refresh/reconciliation command path (src/commands/refresh.ts, upgrade.ts, update.ts, migrate.ts)
- Kit-vs-user asset ownership detection (src/utils/asset-manifest.ts, user-asset-manifest.ts, digest.ts, .cdd/asset-manifest.json)
- Path resolution + copy (src/utils/paths.ts, src/utils/copy.ts)
- Schemas (new reconciliation-registry / plan-mode schema)
- Contracts (new contracts/upgrade/upgrade-reconciliation-contract.md; contracts/ci/ci-gate-contract.md)
- Bucket-2 refresh scaffold (CLAUDE.template.md, AGENTS.template.md, CODEX.template.md, ci-templates/, specs/templates/, tests/templates/) — preserve the user's "Repository-specific fast gate" step
- Adopter ground-truth references defining bucket-1 (.cdd/policy.yml, .cdd/context-policy.json, .cdd/model-policy.json)

### Allowed Paths
- specs/changes/reconcile-framework/
- specs/context/project-map.md
- specs/context/contracts-index.md
- src/commands/refresh.ts
- src/commands/upgrade.ts
- src/commands/update.ts
- src/commands/migrate.ts
- src/commands/init.ts
- src/commands/install-hooks.ts
- src/cli/index.ts
- src/utils/asset-manifest.ts
- src/utils/user-asset-manifest.ts
- src/utils/digest.ts
- src/utils/paths.ts
- src/utils/copy.ts
- src/schemas/cdd-policy.schema.ts
- src/schemas/reconciliation.schema.ts
- contracts/ci/ci-gate-contract.md
- contracts/upgrade/upgrade-reconciliation-contract.md
- contracts/CHANGELOG.md
- .cdd/policy.yml
- .cdd/context-policy.json
- .cdd/model-policy.json
- .cdd/asset-manifest.json
- CLAUDE.template.md
- AGENTS.template.md
- CODEX.template.md
- ci-templates/
- specs/templates/
- tests/templates/
- build.js
- test/utils/asset-manifest.test.ts
- test/utils/digest.test.ts
- test/cli/refresh.test.ts
- test/cli/reconcile-plan.test.ts
- test/contracts/ci-workflow.test.ts
- .github/workflows/contract-driven-gates.yml

### Agent Work Packets
(Documentation only — gate enforces Allowed Paths.)

#### spec-architect
- specs/changes/reconcile-framework/
- specs/context/project-map.md
- specs/context/contracts-index.md
- src/commands/refresh.ts
- src/commands/upgrade.ts
- src/commands/update.ts
- src/utils/asset-manifest.ts
- src/utils/user-asset-manifest.ts
- src/utils/digest.ts
- src/utils/paths.ts
- contracts/ci/ci-gate-contract.md
- contracts/upgrade/upgrade-reconciliation-contract.md

#### contract-reviewer
- specs/changes/reconcile-framework/
- contracts/upgrade/upgrade-reconciliation-contract.md
- contracts/ci/ci-gate-contract.md
- contracts/CHANGELOG.md

#### test-strategist
- specs/changes/reconcile-framework/
- contracts/upgrade/upgrade-reconciliation-contract.md
- contracts/ci/ci-gate-contract.md
- test/utils/asset-manifest.test.ts
- test/utils/digest.test.ts
- tests/templates/

#### ci-cd-gatekeeper
- specs/changes/reconcile-framework/
- contracts/ci/ci-gate-contract.md
- test/contracts/ci-workflow.test.ts
- ci-templates/
- .github/workflows/contract-driven-gates.yml

#### implementation-planner
- specs/changes/reconcile-framework/
- src/commands/refresh.ts
- src/commands/upgrade.ts
- src/commands/update.ts
- src/utils/asset-manifest.ts
- src/utils/user-asset-manifest.ts
- src/utils/digest.ts
- src/utils/paths.ts

#### backend-engineer
- specs/changes/reconcile-framework/
- src/commands/refresh.ts
- src/commands/upgrade.ts
- src/commands/update.ts
- src/cli/index.ts
- src/utils/asset-manifest.ts
- src/utils/user-asset-manifest.ts
- src/utils/digest.ts
- src/utils/paths.ts
- src/utils/copy.ts
- src/schemas/cdd-policy.schema.ts
- src/schemas/reconciliation.schema.ts
- CLAUDE.template.md
- AGENTS.template.md
- CODEX.template.md
- ci-templates/
- specs/templates/
- tests/templates/
- build.js
- test/cli/reconcile-plan.test.ts

#### e2e-resilience-engineer
- specs/changes/reconcile-framework/
- src/commands/refresh.ts
- tests/templates/
- test/cli/reconcile-plan.test.ts
- .cdd/policy.yml
- .cdd/context-policy.json
- .cdd/asset-manifest.json

#### monkey-test-engineer
- specs/changes/reconcile-framework/
- tests/templates/
- test/cli/reconcile-plan.test.ts
- .cdd/policy.yml
- CLAUDE.template.md

#### qa-reviewer
- specs/changes/reconcile-framework/
- contracts/upgrade/upgrade-reconciliation-contract.md
- contracts/ci/ci-gate-contract.md
