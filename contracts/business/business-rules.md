---
contract: business
summary: Business decision tables, rule inventory, and change policy for behavior updates.
owner: application-team
surface: domain-behavior
schema-version: 0.1.0
last-changed: 2026-07-09
breaking-change-policy: deprecate-2-minors
applicability: not-applicable
applicability-reason: cdd-kit is a CLI/agent-orchestration tool with no business-domain logic of its own (no decision tables, no domain rule inventory); its own behavior is the CLI/gate/validator logic covered by the other contracts.
---

# Business Rules

## Rule Inventory
| rule id | name | owner | current behavior | tests |
|---|---|---|---|---|

## Decision Tables
| condition | behavior | test id |
|---|---|---|

## Change Policy

Any business logic change must update this file, the relevant decision table, and regression tests.
