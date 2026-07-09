# Context Manifest

This manifest defines the approved context boundaries for agents working on
this change. The forbidden-paths baseline lives in `.cdd/context-policy.json`
and is automatically applied by `cdd-kit gate` — do not duplicate it here.

## Affected Surfaces
- `cdd-kit gate` composition (new `enforceAcceptanceOracle` check)
- Acceptance artifact + schema (`acceptance.yml`, `src/schemas/acceptance.schema.ts`)
- Tamper-evidence: PreToolUse acceptance-write hook + installer arming; hash-lock; mock-of-SUT scan (code-map SUT resolution)
- ADR 0005 evidence harness — new `acceptance` phase in `test-evidence.yml` / `test-evidence.schema.ts`
- Migration/upgrade path (`migrate`, `refresh`, `upgrade`, `update`) + change template set
- Version/content-digest stamping for installed assets + `doctor` drift report
- Asset generation (`build.js`) and `.claude/` source-of-truth for hooks/agents/skills/settings

## Allowed Paths
- specs/changes/acceptance-oracle/
- specs/context/project-map.md
- specs/context/contracts-index.md
- docs/adr/0010-acceptance-oracle.md
- docs/adr/0005-bounded-test-execution-and-structured-evidence.md
- docs/adr/0004-queryable-and-writable-contracts.md
- src/schemas/
- src/commands/gate.ts
- src/commands/gate-evidence.ts
- src/commands/gate-artifacts.ts
- src/commands/gate-agents.ts
- src/commands/gate-contracts.ts
- src/commands/gate-shared.ts
- src/commands/gate-tier.ts
- src/commands/install-agent-hooks.ts
- src/commands/install-hooks.ts
- src/commands/migrate.ts
- src/commands/refresh.ts
- src/commands/upgrade.ts
- src/commands/update.ts
- src/commands/doctor.ts
- src/commands/new-change.ts
- src/commands/init.ts
- src/commands/setup.ts
- src/commands/validate.ts
- src/utils/
- src/code-map/
- hooks/
- specs/templates/
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md
- contracts/env/.env.example.template
- contracts/env/env.schema.json
- ci/gate-policy.md
- ci/required-check-policy.md
- build.js
- package.json
- vitest.config.ts
- test/
- .claude/hooks/
- .claude/settings.json
- .claude/agents/
- .claude/skills/
- .cdd/code-map.yml
- .cdd/context-policy.json

## Required Contracts
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md
- contracts/env/.env.example.template
- contracts/env/env.schema.json

## Required Tests
- test/cli/gate.test.ts
- test/cli/migrate.test.ts
- test/cli/refresh.test.ts
- test/cli/install-agent-hooks.test.ts
- test/cli/contract-write-hook.test.ts (pattern for a new acceptance-write-hook test)
- test/cli/doctor.test.ts
- test/schemas/ (new `acceptance.schema.test.ts`; extend `test-evidence.schema.test.ts`)
- test/utils/digest.test.ts
- new: test/cli/acceptance-oracle.test.ts (gate + hash-lock + mock-scan + backfill E2E)

## Agent Work Packets

### change-classifier
- specs/changes/acceptance-oracle/
- specs/context/project-map.md
- specs/context/contracts-index.md

### spec-architect
- specs/changes/acceptance-oracle/
- specs/context/project-map.md
- specs/context/contracts-index.md
- docs/adr/0010-acceptance-oracle.md
- docs/adr/0005-bounded-test-execution-and-structured-evidence.md
- docs/adr/0004-queryable-and-writable-contracts.md

### implementation-planner
- specs/changes/acceptance-oracle/
- specs/context/project-map.md
- specs/context/contracts-index.md
- docs/adr/0010-acceptance-oracle.md

### backend-engineer
- specs/changes/acceptance-oracle/
- src/schemas/
- src/commands/ (gate*.ts, install-agent-hooks.ts, install-hooks.ts, migrate.ts, refresh.ts, upgrade.ts, update.ts, doctor.ts, new-change.ts, init.ts, setup.ts, validate.ts)
- src/utils/
- src/code-map/
- hooks/
- specs/templates/
- build.js, package.json, vitest.config.ts
- contracts/ci/ci-gate-contract.md, contracts/env/*
- .claude/hooks/, .claude/settings.json
- .cdd/code-map.yml, .cdd/context-policy.json
- test/

### test-strategist
- specs/changes/acceptance-oracle/
- test/
- src/schemas/
- specs/templates/

### contract-reviewer
- specs/changes/acceptance-oracle/
- contracts/ci/ci-gate-contract.md
- contracts/env/env-contract.md
- contracts/env/.env.example.template
- contracts/env/env.schema.json

### ci-cd-gatekeeper
- specs/changes/acceptance-oracle/
- contracts/ci/ci-gate-contract.md
- src/commands/gate.ts
- ci/gate-policy.md
- ci/required-check-policy.md

### qa-reviewer
- specs/changes/acceptance-oracle/
- contracts/ci/ci-gate-contract.md

## Context Expansion Requests
- request-id: CER-001
  requested_paths:
    - .claude/hooks/
    - .claude/settings.json
    - .claude/agents/
    - .claude/skills/
  reason: `.claude/` is the generated-asset install surface and (per repo convention) the source-of-truth for agents/skills/hooks/settings, but it is excluded from `project-map.md`. Arming the acceptance-write hook writes to `settings.json`, and digest-stamping + `doctor` drift compare installed `.claude/` assets against packaged assets; the acceptance guidance may also require agent/skill prompt edits.
  status: approved
- request-id: CER-002
  requested_paths:
    - .cdd/code-map.yml
    - .cdd/context-policy.json
  reason: The mock-of-SUT scan resolves the change's system-under-test from the code-map; the backend/test agents need the code-map index and the context-policy baseline to implement and verify SUT resolution.
  status: approved

## Approved Expansions
- CER-001 (.claude/ assets — hook arming, digest drift, prompt edits) — approved 2026-07-08, folded into Allowed Paths.
- CER-002 (.cdd/ code-map + context-policy — mock-of-SUT resolution) — approved 2026-07-08, folded into Allowed Paths.
