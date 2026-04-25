# E2E and Resilience Standard

E2E tests prove user-visible workflows. Resilience tests prove safe behavior under failure.

## Critical journey E2E

Cover at least:

- page load
- primary task completion
- validation errors
- empty data
- reload and URL state restoration
- browser back/forward
- permission or session error when applicable

## Resilience coverage

Cover as applicable:

- API 500/503
- timeout
- aborted request
- slow network
- stale cache/snapshot
- Redis/cache disabled
- worker/job pending/running/failed
- double submit prevention
- repeated filter changes

## Evidence

E2E changes should record commands, test files, screenshots/videos/traces when available, and CI gate placement.
