# Workflow Router

## Change classification

Classify every request before implementation. A request may have more than one type.

| Change type | Required path |
|---|---|
| new-feature | proposal, spec, design, contracts, test-plan, ci-gates, tasks |
| feature-enhancement | current-behavior, diff spec, regression scope, contracts, test-plan, ci-gates |
| business-logic-change | current rule, new rule, decision table, examples, edge cases, regression tests |
| bug-fix | reproduction, root cause, failing test, fix, regression test, QA evidence |
| regression-fix | broken prior behavior, regression source, failing test, rollback or forward fix |
| ui-only-change | CSS/UI contract, UI/UX review, visual review, E2E/interaction coverage |
| api-only-change | API contract, endpoint inventory, client/type impact, contract tests |
| env-change | env contract, `.env.example`, deployment impact, secret/public scope review |
| data-contract-change | column/type/nullability contract, malformed data behavior, data-boundary tests |
| performance-change | baseline, target, load profile, stress/soak plan, telemetry thresholds |
| refactor | no behavior change proof, regression tests, architecture note |
| ci-cd-change | pipeline contract, required check impact, rollback policy |
| test-hardening-change | target risk, new test signal, mutation check, CI gate placement |

## Artifact rule

Do not create heavyweight artifacts when a tiny change does not need them. However, any implementation change must record:

- what kind of change it is
- which contracts are affected
- which tests prove it
- which CI/CD gates must run

## Iteration rule

Update an existing change when intent is the same and scope overlap remains high. Start a new change when intent changes, scope explodes, or the original work can be completed independently.
