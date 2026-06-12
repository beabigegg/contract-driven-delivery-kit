# Context Manifest

This manifest defines the approved context boundaries for agents working on
this change. The forbidden-paths baseline lives in `.cdd/context-policy.json`
and is automatically applied by `cdd-kit gate`.

## Affected Surfaces
- `GET /api/orders` request handling and query validation
- orders list query/filter logic
- the API contract row for the orders list endpoint

## Allowed Paths
- specs/changes/add-order-filter/
- specs/context/project-map.md
- specs/context/contracts-index.md
- contracts/api/orders.md
- src/orders/router.py
- src/orders/query.py
- src/orders/schemas.py
- tests/orders/

## Required Contracts
- contracts/api/orders.md

## Required Tests
- tests/orders/test_filter.py

## Agent Work Packets

### change-classifier
- specs/changes/add-order-filter/
- specs/context/project-map.md
- specs/context/contracts-index.md

### test-strategist
- specs/changes/add-order-filter/
- contracts/api/orders.md
- tests/orders/

### backend-engineer
- specs/changes/add-order-filter/
- contracts/api/orders.md
- src/orders/router.py
- src/orders/query.py
- src/orders/schemas.py
- tests/orders/

### contract-reviewer
- specs/changes/add-order-filter/
- contracts/api/orders.md

### qa-reviewer
- specs/changes/add-order-filter/
- tests/orders/

## Context Expansion Requests
-

## Approved Expansions
-
