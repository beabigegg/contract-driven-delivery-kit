# Change Classification

## Change Types
- primary: API contract change (new optional request parameter on an existing endpoint)
- secondary: Data shape (request query schema gains a validated `status` field)

## Risk Level
- medium

## Impact Radius
- module-level

## Tier
- 2

## Architecture Review Required
- no
- reason: extends an existing endpoint within one module; no new boundary, store, or cross-module data flow.

## Required Artifacts
Always required: change-request.md, change-classification.md, implementation-plan.md, test-plan.md, ci-gates.md, tasks.yml, context-manifest.md

## Optional Artifacts (default: no — set yes only with explicit reason)
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | existing behavior is small and captured in the change request |
| proposal.md | no | no design alternatives to weigh |
| spec.md | no | the API contract row is the spec |
| design.md | no | no architecture review required |
| qa-report.md | no | routine review recorded via agent-log/qa-reviewer.yml (no blocking findings) |
| regression-report.md | no | no regression risk beyond the covered tests |
| visual-review-report.md | no | no UI surface in this change |
| monkey-test-report.md | no | data-boundary cases covered inline in the test plan |
| stress-soak-report.md | no | no load/soak profile change |

## Required Contracts
- API: `GET /api/orders` — add optional `status` query parameter (validated enum, comma-separated multi-select)
- CSS/UI: none
- Env: none
- Data shape: orders list **request** schema gains `status`; response shape unchanged
- Business logic: filtering rule — when `status` is present, return only orders whose status is in the set; pagination applies after filtering
- CI/CD: none (covered by existing contract + test gates)

## Required Tests
- unit: status parsing + validation (valid single, valid multi, unknown value, empty)
- contract: `GET /api/orders` request schema accepts `status`; response schema unchanged
- integration: filtered list returns only matching orders; no-filter returns all; pagination after filter
- E2E: none (internal API; integration coverage is sufficient at tier 2)
- visual: none
- data-boundary: unknown status → 400; mixed valid/invalid → 400; duplicate values deduped
- resilience: none
- fuzz/monkey: malformed `status` values (covered under data-boundary)
- stress: none
- soak: none

## Required Agents
- change-classifier
- test-strategist
- backend-engineer
- contract-reviewer
- qa-reviewer

## Inferred Acceptance Criteria
- AC-1: A request with no `status` parameter returns all orders, unchanged in shape and pagination.
- AC-2: `status=open` returns only orders whose status is `open`.
- AC-3: `status=open,shipped` returns only orders whose status is `open` or `shipped` (comma-separated multi-select, duplicates deduped).
- AC-4: An unknown status value (e.g. `status=banana`, or `status=open,banana`) returns HTTP 400 with a validation error naming the allowed values — never a silent empty list.
- AC-5: Pagination (`limit` / `cursor`) is applied to the filtered result set and the response schema is unchanged.

## Tasks Not Applicable
- not-applicable: 1.3, 2.2, 2.3, 3.3, 3.5, 4.2, 4.3, 4.4, 5.1, 5.2, 6.4

## Clarifications or Assumptions
- Multi-select is comma-separated (`status=open,shipped`); confirmed with the requester to avoid a follow-up change.
- Allowed values are exactly the existing order-status enum; no new states are introduced.

## Context Manifest Draft

### Affected Surfaces
- `GET /api/orders` request handling and query validation
- orders list query/filter logic
- the API contract row for the orders list endpoint

### Allowed Paths
- specs/changes/add-order-filter/
- specs/context/project-map.md
- specs/context/contracts-index.md
- contracts/api/orders.md
- src/orders/router.py
- src/orders/query.py
- src/orders/schemas.py
- tests/orders/

### Agent Work Packets

#### change-classifier
- specs/changes/add-order-filter/
- specs/context/project-map.md
- specs/context/contracts-index.md

#### test-strategist
- specs/changes/add-order-filter/
- contracts/api/orders.md
- tests/orders/

#### backend-engineer
- specs/changes/add-order-filter/
- contracts/api/orders.md
- src/orders/router.py
- src/orders/query.py
- src/orders/schemas.py
- tests/orders/

#### contract-reviewer
- specs/changes/add-order-filter/
- contracts/api/orders.md

#### qa-reviewer
- specs/changes/add-order-filter/
- tests/orders/
