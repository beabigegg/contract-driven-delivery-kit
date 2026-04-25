# Stress and Soak Standard

Use stress and soak tests for high-load, long-running, cache-heavy, queue-heavy, report, dashboard, export, import, and auto-refresh behavior.

## Stress test

Stress tests answer: what happens under high concurrency or high data volume?

Define:

- concurrent users or requests
- request mix
- data size
- ramp-up and duration
- success criteria
- error budget
- system metrics

## Soak test

Soak tests answer: what happens after sustained operation?

Define:

- duration
- refresh interval
- cache TTL expectations
- DB/worker/cache pool stability
- RSS/memory trend
- queue backlog trend
- temp file growth
- circuit breaker transitions
- artifacts retained

## Required outputs

- workload model
- thresholds
- commands/workflows
- raw logs or metrics
- pass/fail conclusion
- follow-up issues for degraded but non-blocking findings
