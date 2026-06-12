# Archive: add-order-filter

## Change Summary

Added an optional, validated `status` query parameter to `GET /api/orders` so
callers (support tooling and the ops dashboard) can list orders by lifecycle
state. Backward compatible: a request with no `status` returns all orders,
unchanged. Tier 2; classified, tested (TDD), reviewed, and gated green.

## Final Behavior

- `GET /api/orders` accepts `status=<value>` or `status=<a>,<b>` where each value
  is one of `open | confirmed | shipped | delivered | cancelled`.
- Values are de-duplicated; the result is the union of matching orders.
- An unknown status (alone or mixed with valid ones) returns **400** with the
  allowed values — never a silent empty list.
- Filtering is applied before pagination; `limit` / `cursor` and the response
  schema are unchanged.

## Final Contracts Updated

- `contracts/api/orders.md` — orders-list request schema gained the optional
  `status` enum (comma-separated multi-select) and a `400` invalid-status row.
  Response schema unchanged.

## Final Tests Added / Updated

- `tests/orders/test_filter.py` — 8 tests covering AC-1…AC-5 (no-filter, single,
  multi, dedupe, unknown → 400, partial-invalid → 400, pagination-after-filter,
  request/response contract).
- Evidence in `test-evidence.yml` (collect, targeted, changed-area, contract —
  all passed); run summaries under `test-runs/`.

## Final CI/CD Gates

- Local: `cdd-kit gate add-order-filter --strict` passed.
- Required: build + typecheck, unit/contract/integration tests, contract
  validation — all green.
- Informational: coverage delta for `src/orders/` reviewed.

## Production Reality Findings

- None outstanding. The validation-on-unknown-status decision (400 vs empty
  list) was the one behavior worth pinning down up front; the data-boundary
  tests lock it in.

## Lessons Promoted to Standards

- **Validate filter inputs against the source enum and 400 on unknown values.**
  A filter that silently returns nothing for a typo hides bugs from callers.
  This is now the house rule for any new list-filter parameter — captured here
  as the canonical example; promote to `contracts/api/*` review checklist when a
  second filtered endpoint appears.
- **Filter before paginate.** Any new list filter must be applied in the query
  layer before `limit` / `cursor`, proven by an integration test, so pages are
  never skipped.

## Follow-up Work

- Date-range filter and sort options for the orders list (separate request,
  explicitly out of scope here).
