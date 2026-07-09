---
contract: css
summary: UI token policy, component styling rules, and visual review constraints.
owner: application-team
surface: ui
schema-version: 0.1.0
last-changed: 2026-07-09
breaking-change-policy: deprecate-2-minors
applicability: not-applicable
applicability-reason: cdd-kit is a CLI tool with no CSS/UI rendering surface of its own; it validates other projects' CSS contracts, it does not ship one.
---

# CSS / UI Contract

## Token Source of Truth

## Component Rules
| component | variants | states | responsive behavior | allowed overrides |
|---|---|---|---|---|

## Forbidden Practices
- hard-coded visual tokens when token system exists
- global leakage from feature styles
- unreviewed shared component overrides
- unreviewed z-index additions

## Visual Review Policy
