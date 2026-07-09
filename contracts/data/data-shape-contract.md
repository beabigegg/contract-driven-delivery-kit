---
contract: data
summary: Data schema, invalid-data handling, and row-level compatibility rules.
owner: application-team
surface: data
schema-version: 0.1.0
last-changed: 2026-07-09
breaking-change-policy: deprecate-2-minors
applicability: not-applicable
applicability-reason: cdd-kit is a CLI tool that reads/writes spec and contract markdown, JSON, and YAML files directly; it has no tabular/row-shaped data surface (no database, no data export/import) of its own to describe.
---

# Data Shape Contract

## Required Columns
| column | type | nullable | allowed values | fallback | validation |
|---|---|---:|---|---|---|

## Optional Columns
| column | type | default | notes |
|---|---|---|---|

## Invalid Data Behavior
| condition | expected behavior | error code / UI state | test |
|---|---|---|---|
| missing required column |  |  |  |
| wrong type |  |  |  |
| empty dataset |  |  |  |
| over max row limit |  |  |  |
| unexpected enum |  |  |  |

## Export / Import Format

## Row Limit / Truncation Policy
