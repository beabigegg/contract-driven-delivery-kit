# Context Manifest

The forbidden-paths baseline lives in `.cdd/context-policy.json` and is applied
automatically by `cdd-kit gate` — not duplicated here.

## Affected Surfaces
- CLI validate/gate orchestration (`src/commands/validate.ts`, `gate*`)
- Contract frontmatter parsing (`src/contracts/parser.ts`)
- Python semantic validators (`.claude/skills/contract-driven-delivery/scripts/validate_*.py`)
- Doctor reporting (`src/commands/doctor.ts`)
- CI/CD gate contract (`contracts/ci/ci-gate-contract.md`)
- The kit's own empty contracts (`contracts/{api,css,business}`) as first consumers

## Allowed Paths
- specs/changes/not-applicable-contracts/
- specs/context/project-map.md
- specs/context/contracts-index.md
- src/commands/validate.ts
- src/commands/doctor.ts
- src/commands/gate.ts
- src/commands/gate-contracts.ts
- src/contracts/parser.ts
- src/utils/tier-floor.ts
- src/utils/mock-of-sut-scan.ts
- src/schemas/
- .claude/skills/contract-driven-delivery/scripts/
- contracts/api/api-contract.md
- contracts/css/css-contract.md
- contracts/business/business-rules.md
- contracts/ci/ci-gate-contract.md
- test/cli/gate.test.ts
- test/cli/doctor.test.ts
- test/cli/doctor-simple.test.ts
- test/contracts/parser.test.ts
- test/acceptance/
- test/utils/mock-of-sut-scan.test.ts

## Required Contracts

<!-- Scope note (2026-07-09): src/utils/mock-of-sut-scan.ts + its test added to
     Allowed Paths after dogfooding surfaced a real bug in the acceptance-oracle
     hardcoded-expect scanner (ADR 0010, shipped 3.8.0): it scanned sibling
     changes' drivers (cross-change contamination) and matched a generic expect
     word as a substring of a larger token. Fixed here as a blocking bug for this
     change's gate. -->

- contracts/ci/ci-gate-contract.md (gate-semantics change)

## Required Tests
- test/cli/gate.test.ts
- test/cli/doctor.test.ts
- test/contracts/parser.test.ts
- (new) integration test exercising validate.ts + Python validators with a marked-not-applicable contract and an unmarked stub

## Agent Work Packets

### change-classifier
- specs/changes/not-applicable-contracts/
- specs/context/project-map.md
- specs/context/contracts-index.md

### spec-architect
- specs/changes/not-applicable-contracts/
- src/commands/validate.ts
- src/contracts/parser.ts
- src/utils/tier-floor.ts
- contracts/ci/ci-gate-contract.md

### implementation-planner
- specs/changes/not-applicable-contracts/
- src/commands/validate.ts
- src/commands/doctor.ts
- src/contracts/parser.ts
- contracts/ci/ci-gate-contract.md

### backend-engineer
- specs/changes/not-applicable-contracts/
- src/commands/validate.ts
- src/commands/doctor.ts
- src/commands/gate.ts
- src/commands/gate-contracts.ts
- src/contracts/parser.ts
- src/utils/tier-floor.ts
- src/schemas/
- .claude/skills/contract-driven-delivery/scripts/
- contracts/api/api-contract.md
- contracts/css/css-contract.md
- contracts/business/business-rules.md
- contracts/ci/ci-gate-contract.md
- test/

### test-strategist
- specs/changes/not-applicable-contracts/
- test/
- src/commands/validate.ts

### contract-reviewer
- specs/changes/not-applicable-contracts/
- contracts/ci/ci-gate-contract.md
- contracts/api/api-contract.md
- contracts/css/css-contract.md
- contracts/business/business-rules.md

### ci-cd-gatekeeper
- specs/changes/not-applicable-contracts/
- contracts/ci/ci-gate-contract.md
- src/commands/gate.ts
- src/commands/gate-contracts.ts

### qa-reviewer
- specs/changes/not-applicable-contracts/
- contracts/ci/ci-gate-contract.md

## Context Expansion Requests
- request-id: CER-001
  requested_paths:
    - .claude/skills/contract-driven-delivery/scripts/
  reason: The Python semantic validators are the second half of the applicability-read contract; `.claude/` is on project-map Excluded Paths so not indexed. Explicitly named in change-request. Needed for backend implementation + integration tests.
  status: approved
- request-id: CER-002
  requested_paths:
    - src/schemas/
  reason: If applicability is schema-validated (mirroring acceptance/tasks schemas), the frontmatter field may need a schema entry. Confirm during design.
  status: approved

## Approved Expansions
- CER-001 (.claude/skills/.../scripts) — approved 2026-07-09, folded into Allowed Paths.
- CER-002 (src/schemas) — approved 2026-07-09, folded into Allowed Paths.
