# SDD + TDD Policy

## SDD policy

Specifications are the source of intent. Code serves the specification, not the other way around.

A good spec must include:

- user/business intent
- in-scope and out-of-scope boundaries
- acceptance criteria
- edge cases
- non-functional requirements
- compatibility constraints
- observable success signals

For existing systems, never write a future spec without documenting current behavior when the change modifies existing behavior.

## TDD policy

Tests define expected behavior before or alongside implementation.

Preferred order:

1. write or update spec
2. write or update contracts
3. write test plan
4. write failing tests when feasible
5. implement minimal production code
6. run local gate
7. run CI/CD gate
8. archive learning

## Test-first exceptions

Test-first can be softened for exploratory spikes, but spikes must not be merged as production work until tests, contracts, and CI gates exist.

## Production-reality TDD

For dashboards, reports, long-running jobs, auto-refresh, and data-heavy views, TDD includes:

- malformed input
- wrong columns and wrong types
- empty data
- large data
- partial data
- slow network
- aborted requests
- double submit
- repeated clicks
- back/forward navigation
- cache stale/miss behavior
- long-run memory and pool stability
