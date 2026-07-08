---
artifact: project-map
generated-by: cdd-kit context-scan
schema-version: 1
root: contract-driven-delivery-kit
visible-dirs: 58
visible-files: 299
omitted-dirs: 0
truncated-dirs: 1
inputs-digest: 58ec80699f498bf40074f81de6138b321f2d3ecc03137b33052a2dd7345722a2
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

## Tree

```
contract-driven-delivery-kit/
|-- .agents/
|-- .cdd/
|   |-- code-graph.index.json
|   |-- code-map.index.json
|   |-- code-map.yml
|   |-- conformance.json
|   |-- context-policy.json
|   |-- model-policy.json
|   \-- tier-policy.json
|-- .github/
|   \-- workflows/
|       \-- test.yml
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
|   |   \-- 0010-acceptance-oracle.md
|   |-- examples/
|   |   \-- bug-fix/
|   |       |-- bug-fix-engineer.sample.yml
|   |       \-- gate-failure.txt
|   |-- proposals/
|   |   \-- 2026-06-10-total-review-optimization.md
|   |-- api-conformance.md
|   |-- machine-readable-change-design.md
|   |-- openapi-export.md
|   \-- release-checklist.md
|-- github-workflows/
|   \-- contract-driven-gates.yml
|-- hooks/
|   |-- post-tool-use-files-read.sh
|   |-- pre-commit
|   |-- pre-tool-use-contract-write.sh
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
|   \-- templates/
|       |-- archive.md
|       |-- change-classification.md
|       |-- change-request.md
|       |-- ci-gates.md
|       |-- context-manifest.md
|       |-- contracts.md
|       |-- current-behavior.md
|       |-- design.md
|       |-- implementation-plan.md
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
|   |   |-- archive.ts
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
|   |   |-- doctor.ts
|   |   |-- gate-agents.ts
|   |   |-- gate-artifacts.ts
|   |   |-- gate-contracts.ts
|   |   |-- gate-dependencies.ts
|   |   |-- gate-evidence.ts
|   |   |-- gate-shared.ts
|   |   |-- gate-tier.ts
|   |   |-- gate.ts
|   |   |-- graph.ts
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
|   |   |-- refresh.ts
|   |   |-- reserve.ts
|   |   |-- setup.ts
|   |   |-- suggest-codegen.ts
|   |   |-- test-impact.ts
|   |   |-- test-run.ts
|   |   |-- test-select.ts
|   |   |-- update.ts
|   |   |-- upgrade.ts
|   |   \-- validate.ts
|   |-- contracts/
|   |   \-- parser.ts
|   |-- mcp/
|   |   \-- server.ts
|   |-- schemas/
|   |   |-- agent-log.schema.ts
|   |   |-- bug-fix-evidence.schema.ts
|   |   |-- change-metadata.schema.ts
|   |   |-- reservations.schema.ts
|   |   |-- tasks.schema.ts
|   |   |-- test-evidence.schema.ts
|   |   \-- trace.schema.ts
|   \-- utils/
|       |-- change-id.ts
|       |-- context-inputs.ts
|       |-- copy.ts
|       |-- digest.ts
|       |-- gate-explain.ts
|       |-- git-paths.ts
|       |-- gitignore.ts
|       |-- logger.ts
|       |-- markdown-section.ts
|       |-- markdown-table.ts
|       |-- mcp-hint.ts
|       |-- paths.ts
|       |-- provider.ts
|       |-- stack-detect.ts
|       \-- tier-floor.ts
|-- test/
|   |-- agents/
|   |   \-- code-map-rule.test.ts
|   |-- cli/
|   |   |-- abandon.test.ts
|   |   |-- agent-prompts-shape.test.ts
|   |   |-- archive.test.ts
|   |   |-- bug-suspects.test.ts
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
|   |   |-- doctor-chokepoints.test.ts
|   |   |-- doctor-code-map.test.ts
|   |   |-- doctor-conformance-fix.test.ts
|   |   |-- doctor-mcp.test.ts
|   |   |-- doctor-response-shape.test.ts
|   |   |-- doctor-simple.test.ts
|   |   |-- doctor.test.ts
|   |   |-- freshness-mtime-repair.test.ts
|   |   |-- gate.test.ts
|   |   |-- git-paths.test.ts
|   |   |-- graph-unresolved.test.ts
|   |   |-- graph.test.ts
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
|   |   |-- list.test.ts
|   |   |-- manifest.test.ts
|   |   |-- mcp.test.ts
|   |   |-- metadata-integration.test.ts
|   |   |-- metadata.test.ts
|   |   |-- migrate.test.ts
|   |   |-- new.test.ts
|   |   |-- no-bom.test.ts
|   |   |-- openapi-check.test.ts
|   |   |-- openapi-export.test.ts
|   |   |-- refresh.test.ts
|   |   |-- setup.test.ts
|   |   \-- ... (15 more entries truncated; cap=50)
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
|   |   \-- parser.test.ts
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
|   |-- schemas/
|   |   |-- bug-fix-evidence.schema.test.ts
|   |   \-- test-evidence.schema.test.ts
|   |-- utils/
|   |   |-- digest.test.ts
|   |   \-- gate-explain.test.ts
|   |-- helpers.ts
|   \-- setup-git-env.ts
|-- tests/
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
|   \-- check-mojibake.mjs
|-- .cdd-retest.log
|-- .gitattributes
|-- .gitignore
|-- AGENTS.template.md
|-- build.js
|-- CHANGELOG.md
|-- CLAUDE.template.md
|-- CODEX.template.md
|-- install.md
|-- package-lock.json
|-- package.json
|-- project-profile.generated.md
|-- README.md
|-- reviewbycodex.md
|-- skill.zip
|-- tsconfig.json
\-- vitest.config.ts
```
