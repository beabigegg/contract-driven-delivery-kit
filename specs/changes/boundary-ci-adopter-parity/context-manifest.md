# Context Manifest

This manifest defines the approved context boundaries for agents working on
this change. The forbidden-paths baseline lives in `.cdd/context-policy.json`
and is automatically applied by `cdd-kit gate` — do not duplicate it here.

## Affected Surfaces
- Boundary Guard standalone command — `src/commands/boundary.ts` (`boundaryCheck`)
- Boundary Guard core — `src/boundary/guard.ts` (base resolution + operation selection)
- Gate enforcement semantics (parity target / shared source) — `src/commands/gate.ts` shadow-mode `[shadow]` downgrade
- Adopter CI workflow template (edit source) — `github-workflows/contract-driven-gates.yml`
- Repo's own CI workflow (reference form to port) — `.github/workflows/contract-driven-gates.yml`
- Asset regeneration — `build.js` (regenerates `assets/` from `github-workflows/`; never hand-edit `assets/`)
- CI gate contract — `contracts/ci/ci-gate-contract.md`
- Tests — `test/cli/boundary.test.ts`, `test/contracts/ci-workflow.test.ts`, `test/cli/gate.test.ts`, plus new regression tests

## Allowed Paths
- specs/changes/boundary-ci-adopter-parity/
- specs/context/project-map.md
- specs/context/contracts-index.md
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md
- src/commands/boundary.ts
- src/boundary/guard.ts
- src/boundary/adapters.ts
- src/commands/gate.ts
- src/commands/gate-shared.ts
- src/commands/gate-dependencies.ts
- src/policy/profile.ts
- src/utils/git-paths.ts
- src/schemas/cdd-policy.schema.ts
- src/cli/index.ts
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- docs/boundary-guard.md
- test/cli/boundary.test.ts
- test/cli/gate.test.ts
- test/contracts/ci-workflow.test.ts
- test/helpers.ts
- test/setup-git-env.ts

## Required Contracts
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md (review-only: confirm `CDD_BASE_SHA` / `GITHUB_BASE_SHA` documentation)

## Required Tests
- test/cli/boundary.test.ts
- test/contracts/ci-workflow.test.ts
- test/cli/gate.test.ts (parity reference)
- new regression tests (one per defect): #61 archive-only push exit 0, #62 CDD_BASE_SHA-only operation selection, #63/#65 shadow-mode default + `--enforce`

## Agent Work Packets
<!-- Documentation only — gate enforces Allowed Paths, not individual packets. -->

### change-classifier
- specs/changes/boundary-ci-adopter-parity/
- specs/context/project-map.md
- specs/context/contracts-index.md

### implementation-planner
- specs/changes/boundary-ci-adopter-parity/
- specs/context/project-map.md
- specs/context/contracts-index.md
- contracts/ci/ci-gate-contract.md
- src/commands/boundary.ts
- src/boundary/guard.ts
- src/commands/gate.ts
- src/commands/gate-shared.ts
- src/commands/gate-dependencies.ts
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- docs/boundary-guard.md

### bug-fix-engineer
- specs/changes/boundary-ci-adopter-parity/
- src/commands/boundary.ts
- src/boundary/guard.ts
- src/boundary/adapters.ts
- src/commands/gate.ts
- src/commands/gate-shared.ts
- src/commands/gate-dependencies.ts
- src/policy/profile.ts
- src/utils/git-paths.ts
- src/schemas/cdd-policy.schema.ts
- src/cli/index.ts
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- test/cli/boundary.test.ts
- test/contracts/ci-workflow.test.ts
- test/helpers.ts
- test/setup-git-env.ts
- docs/boundary-guard.md

### ci-cd-gatekeeper
- specs/changes/boundary-ci-adopter-parity/
- contracts/ci/ci-gate-contract.md
- github-workflows/contract-driven-gates.yml
- .github/workflows/contract-driven-gates.yml
- build.js
- .cdd/policy.yml
- test/contracts/ci-workflow.test.ts

### contract-reviewer
- specs/changes/boundary-ci-adopter-parity/
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md
- src/commands/boundary.ts
- src/boundary/guard.ts
- github-workflows/contract-driven-gates.yml

### test-strategist
- specs/changes/boundary-ci-adopter-parity/
- test/cli/boundary.test.ts
- test/cli/gate.test.ts
- test/contracts/ci-workflow.test.ts
- test/helpers.ts
- test/setup-git-env.ts
- src/commands/boundary.ts
- src/boundary/guard.ts

### qa-reviewer
- specs/changes/boundary-ci-adopter-parity/
- contracts/ci/ci-gate-contract.md
- test/cli/boundary.test.ts
- test/contracts/ci-workflow.test.ts

## Context Expansion Requests
-

## Approved Expansions
- CER-001 (RESOLVED at classification): the gate-side shadow-mode `[shadow]`
  downgrade lives in `src/commands/gate.ts` (~lines 243-258), already inside
  Allowed Paths. No expansion needed; the shared enforcement-semantics source
  is extracted from there.
