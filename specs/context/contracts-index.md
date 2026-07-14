---
artifact: contracts-index
generated-by: cdd-kit context-scan
schema-version: 1
contract-count: 9
missing-summary-count: 0
inputs-digest: cf10884bec6d85598bfd7ca467e92a6d15cfe4ebaa95e2033de0591191fbb405
---

# Contracts Index

Generated from deterministic metadata. Add YAML frontmatter fields such as `summary`, `owner`, and `surface` to improve classifier accuracy.

## Contract Inventory

| path | type | surface | owner | has-summary |
|---|---|---|---|---|
| contracts/api/api-contract.md | api | api | application-team | yes |
| contracts/api/api-inventory.md | api-inventory | api | application-team | yes |
| contracts/api/error-format.md | api-error-format | api | application-team | yes |
| contracts/business/business-rules.md | business | domain-behavior | application-team | yes |
| contracts/ci/ci-gate-contract.md | ci | delivery-pipeline | platform-team | yes |
| contracts/css/css-contract.md | css | ui | application-team | yes |
| contracts/css/design-tokens.md | design-tokens | ui | design-system | yes |
| contracts/data/data-shape-contract.md | data | data | application-team | yes |
| contracts/env/env-contract.md | env | runtime-config | platform-team | yes |

## Contract Details

## contracts/api/api-contract.md
- path: `contracts/api/api-contract.md`
- type: api
- directory: contracts/api
- title: API Contract
- owner: application-team
- surface: api
- schema-version: 0.1.0
- last-changed: 2026-07-09
- breaking-change-policy: deprecate-2-minors
- applicability: not-applicable
- applicability-reason: cdd-kit is a CLI/agent-orchestration tool with no HTTP API surface of its own; it validates other projects' API contracts, it does not serve one.
- summary: API behavior, compatibility rules, and endpoint contract requirements.


## contracts/api/api-inventory.md
- path: `contracts/api/api-inventory.md`
- type: api-inventory
- directory: contracts/api
- title: API Inventory
- owner: application-team
- surface: api
- summary: Endpoint inventory categories and ownership map for non-standard API surfaces.


## contracts/api/error-format.md
- path: `contracts/api/error-format.md`
- type: api-error-format
- directory: contracts/api
- title: API Error Format
- owner: application-team
- surface: api
- summary: Standard error payload shape, safety rules, and reusable error code table.


## contracts/business/business-rules.md
- path: `contracts/business/business-rules.md`
- type: business
- directory: contracts/business
- title: Business Rules
- owner: application-team
- surface: domain-behavior
- schema-version: 0.1.0
- last-changed: 2026-07-09
- breaking-change-policy: deprecate-2-minors
- applicability: not-applicable
- applicability-reason: cdd-kit is a CLI/agent-orchestration tool with no business-domain logic of its own (no decision tables, no domain rule inventory); its own behavior is the CLI/gate/validator logic covered by the other contracts.
- summary: Business decision tables, rule inventory, and change policy for behavior updates.


## contracts/ci/ci-gate-contract.md
- path: `contracts/ci/ci-gate-contract.md`
- type: ci
- directory: contracts/ci
- title: CI/CD Gate Contract
- owner: platform-team
- surface: delivery-pipeline
- schema-version: 0.11.0
- last-changed: 2026-07-14
- breaking-change-policy: deprecate-2-minors
- summary: CI gate inventory, artifact retention, and rollback requirements.


## contracts/css/css-contract.md
- path: `contracts/css/css-contract.md`
- type: css
- directory: contracts/css
- title: CSS / UI Contract
- owner: application-team
- surface: ui
- schema-version: 0.1.0
- last-changed: 2026-07-09
- breaking-change-policy: deprecate-2-minors
- applicability: not-applicable
- applicability-reason: cdd-kit is a CLI tool with no CSS/UI rendering surface of its own; it validates other projects' CSS contracts, it does not ship one.
- summary: UI token policy, component styling rules, and visual review constraints.


## contracts/css/design-tokens.md
- path: `contracts/css/design-tokens.md`
- type: design-tokens
- directory: contracts/css
- title: Design Tokens
- owner: design-system
- surface: ui
- summary: Canonical design token inventory for colors, spacing, typography, and layering.


## contracts/data/data-shape-contract.md
- path: `contracts/data/data-shape-contract.md`
- type: data
- directory: contracts/data
- title: Data Shape Contract
- owner: application-team
- surface: data
- schema-version: 0.1.0
- last-changed: 2026-07-09
- breaking-change-policy: deprecate-2-minors
- applicability: not-applicable
- applicability-reason: cdd-kit is a CLI tool that reads/writes spec and contract markdown, JSON, and YAML files directly; it has no tabular/row-shaped data surface (no database, no data export/import) of its own to describe.
- summary: Data schema, invalid-data handling, and row-level compatibility rules.


## contracts/env/env-contract.md
- path: `contracts/env/env-contract.md`
- type: env
- directory: contracts/env
- title: Env Contract
- owner: platform-team
- surface: runtime-config
- schema-version: 0.4.0
- last-changed: 2026-07-10
- breaking-change-policy: deprecate-2-minors
- summary: Environment variable inventory, secret handling, and deployment sync policy.

