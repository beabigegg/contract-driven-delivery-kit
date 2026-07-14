---
artifact: project-map
generated-by: cdd-kit context-scan
schema-version: 1
root: contract-driven-delivery-kit
visible-dirs: 75
visible-files: 390
omitted-dirs: 0
truncated-dirs: 2
inputs-digest: 62598949ece3c44e11cc87b1d5fb79466bcb39ac84b8b8b34c84bfd456da8fe7
---

# Project Map

Use this deterministic map to choose candidate context paths before reading files.

## Excluded Paths
- .claude
- .git
- node_modules
- dist
- build
- assets
- specs/archive
- specs/changes
- .cdd/.refresh-backup
- .cdd/migrate-backup
- .cdd/runtime
- .claude/worktrees
- .cdd/acceptance-lock.json
- .cdd/design-lock.json

## Tree

```
contract-driven-delivery-kit/
|-- .agents/
|   \-- skills/
|       \-- cdd-work/
|           \-- SKILL.md
|-- .cdd/
|   |-- approval-policy.yml
|   |-- asset-manifest.json
|   |-- code-graph.index.json
|   |-- code-map.index.json
|   |-- code-map.yml
|   |-- conformance.json
|   |-- context-policy.json
|   |-- model-policy.json
|   |-- policy.yml
|   \-- tier-policy.json
|-- .github/
|   \-- workflows/
|       |-- contract-driven-gates.yml
|       \-- test.yml
|-- .tmp.drivedownload/
|-- .tmp.driveupload/
|-- bin/
|   |-- cdd.js
|   \-- postinstall.js
|-- ci/
|   |-- gate-policy.md
|   \-- required-check-policy.md
|-- ci-templates/
|   |-- bun.yml
|   |-- conda.yml
|   |-- npm.yml
|   |-- pip.yml
|   |-- pnpm.yml
|   |-- poetry.yml
|   |-- unknown.yml
|   |-- uv.yml
|   \-- yarn.yml
|-- contract-harness/
|   |-- samples/
|   |   \-- .gitkeep
|   |-- README.md
|   \-- response-samples.example.json
|-- contracts/
|   |-- api/
|   |   |-- api-contract.md
|   |   |-- api-inventory.md
|   |   \-- error-format.md
|   |-- business/
|   |   \-- business-rules.md
|   |-- ci/
|   |   \-- ci-gate-contract.md
|   |-- css/
|   |   |-- css-contract.md
|   |   \-- design-tokens.md
|   |-- data/
|   |   \-- data-shape-contract.md
|   |-- env/
|   |   |-- .env.example.template
|   |   |-- env-contract.md
|   |   \-- env.schema.json
|   \-- CHANGELOG.md
|-- docs/
|   |-- adr/
|   |   |-- 0001-contract-to-openapi-export.md
|   |   |-- 0002-schema-carrying-contract-format.md
|   |   |-- 0003-code-intelligence-indexing-strategy.md
|   |   |-- 0004-queryable-and-writable-contracts.md
|   |   |-- 0005-bounded-test-execution-and-structured-evidence.md
|   |   |-- 0006-bug-fix-lane-for-symptom-driven-repair.md
|   |   |-- 0007-data-shape-conformance.md
|   |   |-- 0008-required-agent-evidence.md
|   |   |-- 0009-parallel-change-integration.md
|   |   |-- 0010-acceptance-oracle.md
|   |   |-- 0011-not-applicable-contract-marker.md
|   |   |-- 0012-interaction-design-loop.md
|   |   \-- 0013-agent-native-delivery-runtime.md
|   |-- examples/
|   |   \-- bug-fix/
|   |       |-- bug-fix-engineer.sample.yml
|   |       \-- gate-failure.txt
|   |-- migration/
|   |   |-- agent-native-cdd-doctrine-ledger.yml
|   |   |-- agent-native-cdd-feature-map.md
|   |   |-- agent-native-cdd-migration.md
|   |   \-- agent-native-parity-report.md
|   |-- proposals/
|   |   \-- 2026-06-10-total-review-optimization.md
|   |-- rfc/
|   |   |-- agent-native-cdd-rearchitecture.md
|   |   \-- agent-native-cdd-runtime-contracts.md
|   |-- api-conformance.md
|   |-- boundary-guard.md
|   |-- loosening-the-harness.md
|   |-- machine-readable-change-design.md
|   |-- openapi-export.md
|   \-- release-checklist.md
|-- doctrine/
|   |-- api-boundary.md
|   |-- backend.md
|   |-- core-engineering.md
|   |-- data-migration.md
|   |-- frontend.md
|   |-- interaction-accessibility.md
|   |-- operations-resilience.md
|   |-- security-authorization.md
|   \-- testing.md
|-- github-workflows/
|   \-- contract-driven-gates.yml
|-- hooks/
|   |-- post-tool-use-files-read.sh
|   |-- pre-commit
|   |-- pre-tool-use-acceptance-write.sh
|   |-- pre-tool-use-contract-write.sh
|   |-- pre-tool-use-design-write.sh
|   |-- pre-tool-use-graph-first.sh
|   \-- pre-tool-use-test-runner.sh
|-- prompts/
|   |-- api-contract-review.md
|   |-- architecture-review.md
|   |-- business-logic-change.md
|   |-- change-classification.md
|   |-- ci-cd-gate-plan.md
|   |-- css-contract-review.md
|   |-- current-behavior-analysis.md
|   |-- data-contract-review.md
|   |-- env-contract-review.md
|   |-- fixback-loop.md
|   |-- implementation-plan.md
|   |-- qa-review.md
|   |-- requirement-intake.md
|   |-- spec-drift-audit.md
|   |-- test-plan.md
|   \-- visual-review.md
|-- specs/
|   |-- context/
|   |   |-- contracts-index.md
|   |   \-- project-map.md
|   \-- templates/
|       |-- acceptance-driver/
|       |   |-- acceptance_loader.py
|       |   |-- acceptance.loader.ts
|       |   \-- README.md
|       |-- acceptance.yml
|       |-- archive.md
|       |-- change-classification.md
|       |-- change-request.md
|       |-- ci-gates.md
|       |-- context-manifest.md
|       |-- contracts.md
|       |-- current-behavior.md
|       |-- design.md
|       |-- implementation-plan.md
|       |-- interaction-design.md
|       |-- monkey-test-report.md
|       |-- project-profile.md
|       |-- proposal.md
|       |-- qa-report.md
|       |-- regression-report.md
|       |-- spec.md
|       |-- stress-soak-report.md
|       |-- tasks.yml
|       |-- test-evidence.yml
|       |-- test-plan.md
|       \-- visual-review-report.md
|-- src/
|   |-- boundary/
|   |   |-- adapters.ts
|   |   |-- generators.ts
|   |   \-- guard.ts
|   |-- cli/
|   |   \-- index.ts
|   |-- code-graph/
|   |   |-- builder.ts
|   |   |-- queries.ts
|   |   |-- reader.ts
|   |   |-- tsconfig-paths.ts
|   |   \-- types.ts
|   |-- code-map/
|   |   |-- python/
|   |   |   \-- python_scanner.py
|   |   |-- scanners/
|   |   |   |-- common.ts
|   |   |   |-- javascript.ts
|   |   |   |-- python.ts
|   |   |   |-- typescript.ts
|   |   |   \-- vue.ts
|   |   |-- config.ts
|   |   |-- freshness.ts
|   |   |-- include-exclude.ts
|   |   |-- index-reader.ts
|   |   |-- orchestrator.ts
|   |   |-- query-score.ts
|   |   |-- resolve.ts
|   |   |-- types.ts
|   |   |-- worker-dispatch.ts
|   |   \-- yaml-writer.ts
|   |-- commands/
|   |   |-- abandon.ts
|   |   |-- accept.ts
|   |   |-- agent-native-migrate.ts
|   |   |-- archive.ts
|   |   |-- boundary.ts
|   |   |-- bug-suspects.ts
|   |   |-- changelog-build.ts
|   |   |-- chokepoints.ts
|   |   |-- classify-check.ts
|   |   |-- code-map-hook.ts
|   |   |-- code-map-scan-worker.ts
|   |   |-- code-map-watch.ts
|   |   |-- code-map.ts
|   |   |-- context-scan.ts
|   |   |-- context.ts
|   |   |-- contract-locate.ts
|   |   |-- contract-query.ts
|   |   |-- contract-set.ts
|   |   |-- design.ts
|   |   |-- doctor.ts
|   |   |-- gate-acceptance.ts
|   |   |-- gate-agents.ts
|   |   |-- gate-artifacts.ts
|   |   |-- gate-contracts.ts
|   |   |-- gate-dependencies.ts
|   |   |-- gate-design.ts
|   |   |-- gate-evidence.ts
|   |   |-- gate-shared.ts
|   |   |-- gate-tier.ts
|   |   |-- gate.ts
|   |   |-- graph.ts
|   |   |-- guidance.ts
|   |   |-- index-impact.ts
|   |   |-- index-query.ts
|   |   |-- init.ts
|   |   |-- install-agent-hooks.ts
|   |   |-- install-hooks.ts
|   |   |-- integrate.ts
|   |   |-- lint-agents.ts
|   |   |-- list-changes.ts
|   |   |-- manifest.ts
|   |   |-- metadata.ts
|   |   |-- migrate.ts
|   |   |-- new-change.ts
|   |   |-- openapi-export.ts
|   |   |-- parallel-arm.ts
|   |   |-- parallel-shared.ts
|   |   |-- policy.ts
|   |   |-- refresh.ts
|   |   |-- report.ts
|   |   \-- ... (10 more entries truncated; cap=50)
|   |-- contracts/
|   |   \-- parser.ts
|   |-- mcp/
|   |   \-- server.ts
|   |-- policy/
|   |   \-- profile.ts
|   |-- providers/
|   |   |-- registry.ts
|   |   \-- types.ts
|   |-- runtime/
|   |   |-- agent.ts
|   |   |-- checks.ts
|   |   |-- decisions.ts
|   |   |-- engine.ts
|   |   |-- parity.ts
|   |   |-- router.ts
|   |   |-- store.ts
|   |   \-- types.ts
|   |-- schemas/
|   |   |-- acceptance.schema.ts
|   |   |-- agent-log.schema.ts
|   |   |-- boundary-manifest.schema.ts
|   |   |-- bug-fix-evidence.schema.ts
|   |   |-- cdd-policy.schema.ts
|   |   |-- change-metadata.schema.ts
|   |   |-- design-lock.schema.ts
|   |   |-- execution-capsule.schema.ts
|   |   |-- reservations.schema.ts
|   |   |-- runtime-evidence.schema.ts
|   |   |-- runtime-state.schema.ts
|   |   |-- tasks.schema.ts
|   |   |-- test-evidence.schema.ts
|   |   \-- trace.schema.ts
|   \-- utils/
|       |-- acceptance-confirmation.ts
|       |-- acceptance-hash.ts
|       |-- asset-manifest.ts
|       |-- change-id.ts
|       |-- context-inputs.ts
|       |-- copy.ts
|       |-- design-hash.ts
|       |-- design-provenance.ts
|       |-- digest.ts
|       |-- gate-explain.ts
|       |-- git-paths.ts
|       |-- gitignore.ts
|       |-- logger.ts
|       |-- markdown-section.ts
|       |-- markdown-table.ts
|       |-- mcp-hint.ts
|       |-- mock-of-sut-scan.ts
|       |-- paths.ts
|       |-- provider.ts
|       |-- stack-detect.ts
|       |-- tier-floor.ts
|       \-- user-asset-manifest.ts
|-- test/
|   |-- acceptance/
|   |   |-- acceptance-oracle.driver.test.ts
|   |   |-- enforce-human-confirmation.driver.test.ts
|   |   |-- interaction-design-loop.driver.test.ts
|   |   \-- not-applicable-contracts.driver.test.ts
|   |-- agents/
|   |   \-- code-map-rule.test.ts
|   |-- cli/
|   |   |-- abandon.test.ts
|   |   |-- accept-autonomous.test.ts
|   |   |-- accept-relock.test.ts
|   |   |-- acceptance-oracle.test.ts
|   |   |-- acceptance-write-hook.test.ts
|   |   |-- agent-native-migrate.test.ts
|   |   |-- agent-prompts-shape.test.ts
|   |   |-- archive.test.ts
|   |   |-- boundary.test.ts
|   |   |-- bug-suspects.test.ts
|   |   |-- chat-acceptance.test.ts
|   |   |-- code-map-alias-and-retention.test.ts
|   |   |-- code-map-ts-and-config.test.ts
|   |   |-- code-map-watch.test.ts
|   |   |-- code-map.test.ts
|   |   |-- context-auto-approve.test.ts
|   |   |-- context-scan.test.ts
|   |   |-- context.test.ts
|   |   |-- contract-locate.test.ts
|   |   |-- contract-query.test.ts
|   |   |-- contract-set.test.ts
|   |   |-- contract-write-hook.test.ts
|   |   |-- design-confirm.test.ts
|   |   |-- design-write-hook.test.ts
|   |   |-- doctor-chokepoints.test.ts
|   |   |-- doctor-code-map.test.ts
|   |   |-- doctor-conformance-fix.test.ts
|   |   |-- doctor-mcp.test.ts
|   |   |-- doctor-response-shape.test.ts
|   |   |-- doctor-simple.test.ts
|   |   |-- doctor.test.ts
|   |   |-- freshness-mtime-repair.test.ts
|   |   |-- gate-acceptance-rules.test.ts
|   |   |-- gate-design.test.ts
|   |   |-- gate.test.ts
|   |   |-- git-paths.test.ts
|   |   |-- graph-unresolved.test.ts
|   |   |-- graph.test.ts
|   |   |-- guidance.test.ts
|   |   |-- hooks-graph-first.test.ts
|   |   |-- index-impact.test.ts
|   |   |-- index-query-with-source.test.ts
|   |   |-- index-query.test.ts
|   |   |-- init-codegen-script.test.ts
|   |   |-- init-hooks.test.ts
|   |   |-- init.test.ts
|   |   |-- install-agent-hooks.test.ts
|   |   |-- install-hooks.test.ts
|   |   |-- lifecycle-json.test.ts
|   |   |-- lint-agents.test.ts
|   |   \-- ... (32 more entries truncated; cap=50)
|   |-- code-graph/
|   |   \-- queries.test.ts
|   |-- code-map/
|   |   |-- config.test.ts
|   |   |-- query-score.test.ts
|   |   |-- scanners-ts.test.ts
|   |   |-- scanners.test.ts
|   |   \-- worker-dispatch.test.ts
|   |-- commands/
|   |   |-- changelog-build.test.ts
|   |   |-- gate-agents.test.ts
|   |   |-- metadata-build.test.ts
|   |   |-- parallel-shared.test.ts
|   |   |-- reserve-integrate.test.ts
|   |   \-- test-impact-build.test.ts
|   |-- contracts/
|   |   |-- agent-prompt-content.test.ts
|   |   |-- applicability-agreement.test.ts
|   |   |-- applicability-reader.test.ts
|   |   |-- ci-workflow.test.ts
|   |   |-- doctrine-ledger.test.ts
|   |   |-- interaction-design-template.test.ts
|   |   |-- parser.test.ts
|   |   \-- skill-workflow-order.test.ts
|   |-- fixtures/
|   |   \-- code-map/
|   |       |-- broken.py
|   |       |-- comments-only.js
|   |       |-- empty.py
|   |       |-- sample.js
|   |       |-- sample.py
|   |       |-- sample.ts
|   |       |-- sample.tsx
|   |       |-- sample.vue
|   |       \-- types-only.ts
|   |-- policy/
|   |   \-- profile.test.ts
|   |-- runtime/
|   |   |-- parity.test.ts
|   |   \-- router.test.ts
|   |-- schemas/
|   |   |-- acceptance.schema.test.ts
|   |   |-- bug-fix-evidence.schema.test.ts
|   |   |-- design-lock.schema.test.ts
|   |   |-- runtime-contracts.schema.test.ts
|   |   \-- test-evidence.schema.test.ts
|   |-- utils/
|   |   |-- acceptance-driver-templates.test.ts
|   |   |-- acceptance-hash.test.ts
|   |   |-- asset-manifest.test.ts
|   |   |-- design-hash.test.ts
|   |   |-- design-provenance.test.ts
|   |   |-- digest.test.ts
|   |   |-- gate-explain.test.ts
|   |   |-- markdown-section.test.ts
|   |   \-- mock-of-sut-scan.test.ts
|   |-- helpers.ts
|   \-- setup-git-env.ts
|-- tests/
|   |-- contract/
|   |   |-- samples/
|   |   |   \-- .gitkeep
|   |   |-- README.md
|   |   \-- response-samples.example.json
|   \-- templates/
|       |-- data-boundary/
|       |   \-- malformed-data.spec.md
|       |-- e2e/
|       |   \-- critical-journey.spec.md
|       |-- monkey/
|       |   \-- operation-sequence.spec.md
|       |-- resilience/
|       |   \-- api-failure.spec.md
|       |-- soak/
|       |   |-- k6-example.js
|       |   |-- locust-example.py
|       |   \-- soak-profile.md
|       \-- stress/
|           |-- artillery-example.yml
|           |-- k6-example.js
|           |-- load-profile.md
|           \-- locust-example.py
|-- tools/
|   |-- check-lockfile-sync.mjs
|   \-- check-mojibake.mjs
|-- .cdd-retest.log
|-- .gitattributes
|-- .gitignore
|-- AGENTS.md
|-- AGENTS.template.md
|-- build.js
|-- CHANGELOG.md
|-- CLAUDE.md
|-- CLAUDE.template.md
|-- CODEX.template.md
|-- install.md
|-- package-lock.json
|-- package.json
|-- project-profile.generated.md
|-- README.md
|-- skill.zip
|-- tsconfig.json
\-- vitest.config.ts
```
