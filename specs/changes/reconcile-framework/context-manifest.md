# Context Manifest

This manifest defines the approved context boundaries for agents working on
this change. The forbidden-paths baseline lives in `.cdd/context-policy.json`
and is automatically applied by `cdd-kit gate` — do not duplicate it here.

## Affected Surfaces
- Upgrade/refresh/reconciliation command path (src/commands/refresh.ts, upgrade.ts, update.ts, migrate.ts)
- Kit-vs-user asset ownership detection (src/utils/asset-manifest.ts, user-asset-manifest.ts, digest.ts)
- Path resolution + copy (src/utils/paths.ts, src/utils/copy.ts)
- New reconciliation-registry / plan-mode schema (src/schemas/reconciliation.schema.ts)
- Contracts (new contracts/upgrade/upgrade-reconciliation-contract.md; contracts/ci/ci-gate-contract.md)
- Bucket-2 refresh scaffold (CLAUDE.template.md, AGENTS.template.md, CODEX.template.md, ci-templates/, specs/templates/, tests/templates/)
- Adopter ground-truth references defining bucket-1 (.cdd/policy.yml, .cdd/context-policy.json, .cdd/model-policy.json)

## Allowed Paths
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
- src/reconcile/
- docs/adr/
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
- test/reconcile/
- test/e2e/
- test/monkey/
- test/contracts/ci-workflow.test.ts
- test/contracts/reconciliation-invariants.test.ts
- src/commands/validate.ts
- src/commands/gate.ts
- contracts/business/business-rules.md
- .github/workflows/contract-driven-gates.yml

## Required Contracts
- contracts/upgrade/upgrade-reconciliation-contract.md (new)
- contracts/ci/ci-gate-contract.md

## Required Tests
- test/utils/asset-manifest.test.ts
- test/utils/digest.test.ts
- test/cli/reconcile-plan.test.ts (new)
- test/contracts/ci-workflow.test.ts
- new adversarial/resilience/e2e specs

## Agent Work Packets
See change-classification.md `## Context Manifest Draft` → Agent Work Packets (spec-architect, contract-reviewer, test-strategist, ci-cd-gatekeeper, implementation-planner, backend-engineer, e2e-resilience-engineer, monkey-test-engineer, qa-reviewer). Gate enforces Allowed Paths above.

## Context Expansion Requests
-

## Approved Expansions
- CER-001 (RESOLVED at classification): src/commands/upgrade.ts + update.ts confirmed to exist; already in Allowed Paths.
