# CI/CD Gates: add-order-filter

## Local (pre-commit)

- `cdd-kit gate add-order-filter --strict` — all required artifacts present and
  substantive, tier floor satisfied, contracts valid, test-evidence passing.
- The bounded test ladder via `cdd-kit test run` (collect, targeted,
  changed-area, contract) — recorded in `test-evidence.yml`.

## Required (PR — must pass to merge)

- **build + typecheck** — host project build and type check.
- **unit + contract + integration tests** — `tests/orders/` plus the contract
  validation step; the same phases recorded in `test-evidence.yml`.
- **contract validation** — `cdd-kit validate --contracts` (the orders API row
  stays consistent with the request/response schemas).

## Informational (non-blocking)

- coverage delta report for `src/orders/`.
- lint / formatting advisory.

## Not Applicable

- Nightly / weekly / manual gates — no soak, load, or scheduled job is affected
  by this change.

## Evidence

The required test phases and their run summaries are recorded in
`test-evidence.yml` and `test-runs/`; the gate validates that evidence rather
than trusting assistant claims.
