# CLAUDE.md

This repository follows the Contract-Driven Delivery workflow.

## First response rule

Before implementing any request, classify the change type and determine which contracts, tests, CI/CD gates, and review agents are required.

Do not start production code changes until the required artifacts are created or explicitly judged unnecessary with rationale.

## Change types

Classify every request as one or more of:

- `new-feature`
- `feature-enhancement`
- `business-logic-change`
- `bug-fix`
- `regression-fix`
- `ui-only-change`
- `api-only-change`
- `env-change`
- `data-contract-change`
- `performance-change`
- `refactor`
- `ci-cd-change`
- `test-hardening-change`

## Required context discovery

Inspect the repository before planning:

- package manager and lockfiles
- frontend framework and build tool
- backend framework and app entrypoints
- routing/controllers/API layers
- API contract and inventory files
- CSS/design token/component contract files
- env files, `.env.example`, deployment configs, secret handling
- test frameworks and existing test folders
- CI/CD workflows and required checks
- data/report schemas and column contracts
- worker, queue, cache, database, storage, and external service boundaries

Write or update a project profile when working in an unfamiliar repo.

## Required artifact path

For a meaningful change, use or create:

```text
specs/changes/<change-id>/
├── change-request.md
├── change-classification.md
├── current-behavior.md
├── proposal.md
├── spec.md
├── design.md
├── contracts.md
├── test-plan.md
├── ci-gates.md
├── tasks.md
├── qa-report.md
├── regression-report.md
└── archive.md
```

## Contract rules

### API

Any API behavior change must update API contract, endpoint inventory, response/error format expectations, frontend service/types, and contract tests.

### CSS/UI

Any visual or component behavior change must update CSS/UI contract, token usage, component states, responsive behavior, and visual review evidence.

### Env

Any new or changed environment variable must update env contract, `.env.example`, validation rules, runtime scope, deployment documentation, and secret policy.

### Data/report shape

Any report, dashboard, export, import, or table-like data change must define required columns, types, nullability, coercion/rejection rules, row limits, empty-state behavior, and malformed-data behavior.

### Business logic

Any business rule change must include current rule, new rule, decision table, examples, edge cases, backward compatibility, migration/data impact, and regression tests.

### CI/CD

Every change must define the required gates. CI/CD is part of delivery, not an afterthought.

## Testing rules

Use the lowest necessary test level, but do not skip production-reality coverage when risk requires it.

Required test families:

- unit tests
- contract tests
- integration tests
- E2E tests
- visual regression or visual review evidence
- data-boundary tests
- resilience tests
- fuzz or monkey-operation tests
- stress tests for concurrency/load-sensitive paths
- soak tests for long-running or auto-refresh/report systems

For bug fixes, write or identify a failing test before fixing whenever feasible.

For resilience or fault tests, include a mutation check where practical: remove or bypass the intended handler and confirm the test fails.

## CI/CD gate policy

Use these tiers:

- Tier 0: local fast gate
- Tier 1: PR required gate
- Tier 2: PR informational gate
- Tier 3: nightly real-infra gate
- Tier 4: weekly soak/stress gate
- Tier 5: manual production-like dispatch gate

Long-running or flaky gates may start as informational, but must have promotion criteria and owners.

## Visual review policy

Frontend changes that alter UI output require:

- affected screen list
- viewport list
- state list: default, loading, empty, error, disabled, long text, no permission
- screenshot or video evidence where possible
- CSS contract check
- accessibility check for focus, keyboard, labels, and contrast

## Forbidden practices

- Do not implement before classifying the change.
- Do not introduce undocumented API endpoints.
- Do not change response shape without contract and client updates.
- Do not add undocumented env vars.
- Do not expose secrets through frontend-public env vars such as `VITE_`, `NEXT_PUBLIC_`, or `PUBLIC_`.
- Do not hard-code visual tokens when a token system exists.
- Do not bypass CI/CD gate planning.
- Do not mark tasks complete without implementation evidence.
- Do not hide production-reality failures by converting tests into superficial assertions.

## Done criteria

A change is complete only when:

- specs and contracts reflect the final behavior
- test coverage maps to acceptance criteria
- CI/CD gates pass or are explicitly documented as informational with promotion path
- QA report records commands, evidence, and known residual risks
- archive captures reusable learnings and standard updates
