# Change Request

## Original Request

"Our support team can't pull up just the open orders — the orders list returns
everything and they scroll forever. Can we let them filter the orders list by
status (open, shipped, cancelled, etc.)?"

## Business / User Goal

Support agents and the internal ops dashboard need to list orders by lifecycle
status without client-side filtering of the full result set. Adding a `status`
filter to the existing `GET /api/orders` endpoint cuts the payload and the
scroll time for the common "show me the open orders" task.

## Non-goals

- No new endpoint — extend the existing list endpoint only.
- No free-text search, date-range filter, or sorting changes (separate request).
- No change to who can read orders (authorization is unchanged).
- No change to how orders are stored or to the order lifecycle itself.

## Constraints

- Backward compatible: a request with no `status` parameter must behave exactly
  as today (return all orders, same shape, same pagination).
- The filter must validate its input — an unknown status is a client error, not
  an empty list that hides a typo.
- Stay within the existing pagination contract (`limit` / `cursor`).

## Known Context

- `GET /api/orders` already supports `limit` and `cursor` pagination.
- Order status is an existing enum on the order record:
  `open | confirmed | shipped | delivered | cancelled`.
- The orders service and its tests live under `src/orders/` and `tests/orders/`.

## Open Questions

- Should multiple statuses be selectable at once (`status=open,shipped`)?
  → Resolved during classification: yes, comma-separated, to avoid a follow-up.

## Requested Delivery Date / Priority

Medium priority; requested within the current iteration.
