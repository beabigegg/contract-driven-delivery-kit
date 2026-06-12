# Test Plan: add-order-filter

## Strategy

Tier 2 change to one module's API. Coverage is unit + contract + integration,
with explicit data-boundary cases for invalid input. No E2E/visual/stress is
required (internal API, no UI, no load-profile change). Tests are written before
the implementation and run red first, per the kit's TDD policy.

## Acceptance Criteria → Test Mapping

| AC | Criterion | Test(s) | Type |
|---|---|---|---|
| AC-1 | No `status` → all orders, unchanged shape/pagination | `test_no_filter_returns_all` | integration |
| AC-2 | `status=open` → only open orders | `test_single_status_filter` | integration |
| AC-3 | `status=open,shipped` → union, duplicates deduped | `test_multi_status_filter`, `test_status_dedupes_duplicates` | integration, unit |
| AC-4 | Unknown status → 400 naming allowed values | `test_unknown_status_rejected`, `test_partial_invalid_status_rejected` | data-boundary |
| AC-5 | Pagination applied after filtering; response schema unchanged | `test_pagination_after_filter`, `test_status_filter_options` (contract) | integration, contract |

## Test Inventory

- `tests/orders/test_filter.py`
  - `test_status_filter_options` — contract: request schema accepts `status`; response schema unchanged.
  - `test_no_filter_returns_all` — AC-1.
  - `test_single_status_filter` — AC-2.
  - `test_multi_status_filter` — AC-3.
  - `test_status_dedupes_duplicates` — AC-3 (unit-level parsing).
  - `test_unknown_status_rejected` — AC-4 (`status=banana` → 400).
  - `test_partial_invalid_status_rejected` — AC-4 (`status=open,banana` → 400).
  - `test_pagination_after_filter` — AC-5.

## Bounded Execution Ladder

Recorded in `test-evidence.yml` via `cdd-kit test run`:

1. `collect` — discovery sanity (no execution).
2. `targeted` — the new filter test node(s).
3. `changed-area` — the full `tests/orders/` package.
4. `contract` — `cdd-kit validate --contracts`.

A required-phase failure blocks the gate; there are no waivers.

## Out of Scope

- E2E, visual, resilience, stress, soak — not applicable to this change
  (see change-classification.md "Required Tests").
