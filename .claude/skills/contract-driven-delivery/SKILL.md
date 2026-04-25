---
name: contract-driven-delivery
description: contract-driven delivery workflow for brownfield full-stack systems. use when handling software requests that require specification-driven development, test-driven development, api/css/env/data/business contracts, ci/cd gates, frontend visual review, e2e/resilience/monkey/stress/soak testing, qa fixback loops, or multi-iteration spec drift control.
---

# Contract-Driven Delivery

## Purpose

Use this skill to turn software requests into traceable, testable, CI/CD-gated changes. This skill is optimized for brownfield internal production systems such as dashboards, reporting apps, workflow tools, and data-heavy full-stack applications.

## Workflow decision tree

1. Classify the request.
   - Use `references/workflow-router.md`.
   - Create or update `classification.md`.
2. Scan project context.
   - Use `scripts/detect_project_profile.py` when useful.
   - Capture stack, commands, contracts, tests, and CI/CD.
3. Select required artifacts.
   - Use templates in `templates/`.
   - Do not force every artifact for tiny changes, but do require `classification.md`, `test-plan.md`, and `ci-gates.md` for implementation changes.
4. Update contracts before or alongside implementation.
   - API: `references/api-contract-standard.md`
   - CSS/UI: `references/css-contract-standard.md`
   - Env: `references/env-contract-standard.md`
   - Data/report shape: `references/data-contract-standard.md`
   - Business logic: `references/business-logic-standard.md`
   - CI/CD: `references/ci-cd-policy.md`
5. Apply SDD + TDD discipline.
   - Use `references/sdd-tdd-policy.md`.
   - Tests should be planned before implementation and should fail first when feasible.
6. Implement through the right role.
   - Backend/frontend work must follow contracts and tests.
   - UI changes require UI/UX and visual review.
7. Run quality gates.
   - Use `references/qa-gates.md`.
   - CI/CD gate plan is mandatory.
8. Archive and audit drift.
   - Use `references/spec-drift-policy.md`.
   - Durable learnings must be promoted back to contracts or CLAUDE.md.

## Required gates by risk

### Low-risk documentation or prompt-only change

- classification
- affected artifact list
- no implementation gate unless code behavior changes

### Normal feature or enhancement

- classification
- current behavior if modifying existing feature
- proposal/spec/design as needed
- contracts
- test-plan
- ci-gates
- tasks
- QA report

### UI change

- CSS/UI contract review
- UI/UX review
- visual review evidence
- E2E or component interaction coverage
- accessibility check

### API/backend/data/report change

- API contract or data-shape contract
- unit, contract, integration tests
- route validation and fuzz tests for user-controlled inputs
- E2E or smoke path when user-visible
- CI/CD gate update

### High-risk production-reality change

Required when the change involves report generation, large queries, auto-refresh, cache, queues, workers, DB pools, exports, imports, long-running sessions, or concurrency.

- resilience tests
- data-boundary tests
- monkey-operation tests
- stress tests
- soak tests or scheduled long-run gate
- telemetry and threshold plan

## Output discipline

When using this skill, produce concrete artifact content instead of vague recommendations. Include exact files to create/update, exact gates to run, exact commands if detectable, and exact acceptance criteria.

## Scripts

- `scripts/detect_project_profile.py`: inspect a repository and emit a Markdown project profile.
- `scripts/generate_change_scaffold.py`: create a change folder from templates.
- `scripts/validate_contracts.py`: check for required contract files.
- `scripts/validate_env_contract.py`: check env contract basics.
- `scripts/validate_ci_gates.py`: check `ci-gates.md` structure.
- `scripts/validate_spec_traceability.py`: check coarse traceability between spec, tasks, tests, and CI gates.

Run scripts with Python 3 from the repository root.
