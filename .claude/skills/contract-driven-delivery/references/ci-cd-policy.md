# CI/CD Policy

CI/CD is a required delivery artifact.

## Gate tiers

| tier | name | purpose | default merge behavior |
|---:|---|---|---|
| 0 | local fast gate | quick feedback before commit/PR | local only |
| 1 | PR required gate | block unsafe merges | required |
| 2 | PR informational gate | collect signal before promotion | non-blocking |
| 3 | nightly real-infra gate | detect real infrastructure failures | non-blocking unless stable |
| 4 | weekly soak/stress gate | detect long-run/load issues | scheduled/manual |
| 5 | manual production-like gate | high-risk release confidence | manual approval |

## Required for every change

`ci-gates.md` must state:

- which gates apply
- which are required
- which are informational
- workflow or command name
- expected artifact/log location
- promotion criteria for new gates
- rollback path if gate fails after merge

## Promotion policy

New expensive or flaky gates should start as informational. Promote to required only after a stability window, for example 20 days or 60 runs with acceptable pass rate and known failure triage.

## CI truthfulness rule

CI green only proves the exact configured gates passed. Do not claim coverage that the pipeline did not execute.
