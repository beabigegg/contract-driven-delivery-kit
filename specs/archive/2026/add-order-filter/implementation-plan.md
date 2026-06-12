# Implementation Plan: add-order-filter

## Approach

Extend `GET /api/orders` with an optional, validated `status` query parameter.
Keep the change additive and backward compatible: no parameter means today's
behavior. Filtering happens in the existing query layer, before pagination, so
the `limit` / `cursor` contract is untouched.

Order of work follows the kit's TDD policy: update the API contract first, write
the failing tests against the acceptance criteria, then implement until green.

## Steps

1. **API contract first.** Update `contracts/api/orders.md`: add `status` to the
   orders-list request schema as an optional comma-separated enum
   (`open|confirmed|shipped|delivered|cancelled`). Response schema is unchanged;
   add a `400` error row for an invalid status. (Tasks 2.1, 2.4, 2.5)

2. **Failing tests.** Add `tests/orders/test_filter.py` covering AC-1…AC-5:
   no-filter, single status, multi-status, unknown value → 400, and pagination
   after filtering. Run them red first. (Tasks 3.1, 3.2, 3.4)

3. **Request schema.** In `src/orders/schemas.py`, parse `status` into a
   de-duplicated set, validating each value against the order-status enum;
   raise a 400 with the allowed values on any unknown member. (Task 4.1)

4. **Query filter.** In `src/orders/query.py`, when a non-empty status set is
   present, add a `WHERE status IN (...)` clause; apply pagination after the
   filter. No change when the set is absent. (Task 4.1)

5. **Wire the handler.** In `src/orders/router.py`, read and pass `status`
   through to the query; unchanged response serialization. (Task 4.1)

6. **Green + review.** Run the bounded test ladder (`cdd-kit test run`), then
   contract review and QA review. (Tasks 5.3, 5.4, 6.1, 6.2)

## Rollback

Pure addition behind an optional parameter. Reverting the commit restores the
prior behavior with no data or schema migration — existing callers are
unaffected because they never sent `status`.

## Risks & Mitigations

- **Silent typo → empty list.** Mitigated by validating the value and returning
  400 on an unknown status (AC-4), rather than filtering to nothing.
- **Filtering after pagination would skip pages.** Mitigated by filtering in the
  query layer *before* `limit` / `cursor` are applied (AC-5), proven by an
  integration test.
