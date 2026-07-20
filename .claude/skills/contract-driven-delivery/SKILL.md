---
name: contract-driven-delivery
description: contract-driven delivery workflow for brownfield full-stack systems. use when handling software requests that require specification-driven development, test-driven development, api/css/env/data/business contracts, ci/cd gates, frontend visual review, e2e/resilience/monkey/stress/soak testing, qa fixback loops, or multi-iteration spec drift control.
---

# Contract-Driven Delivery

## Purpose

Use this skill to turn software requests into traceable, testable, CI/CD-gated changes. This skill is optimized for brownfield internal production systems such as dashboards, reporting apps, workflow tools, and data-heavy full-stack applications.

## Workflow decision tree

1. Classify the request.
   - If the request is vague, oversized, or its intent is not yet a crisp,
     testable acceptance criterion, run requirement discovery first
     (`references/requirement-discovery.md`) to refine intent and decide whether
     the work should be split into independent (optionally parallel) changes.
   - Use `references/workflow-router.md`.
   - Record the classification in `tasks.yml`: the `classification:` frontmatter
     block (types, risk, impact, and architecture-review with a real reason if true)
     plus the top-level `tier:`. Under `context-governance: v1` this lived in a
     separate `change-classification.md`; do not create that file for a new change.
   - Invoke change-classifier to perform classification.
2. Scan project context.
   - Use `scripts/detect_project_profile.py` when useful.
   - Capture stack, commands, contracts, tests, and CI/CD.
   - Invoke repo-context-scanner to capture project profile and standardization gaps.
   - Refresh the structural index before any planning agent reads it: run `cdd-kit code-map`. The planning agents (`test-strategist`, `spec-architect`, `implementation-planner`) have no shell access and read `.cdd/code-map.yml` as a static snapshot, so a stale map hands them wrong file/line ranges. Implementation agents (backend/frontend/bug-fix) auto-refresh via their own `cdd-kit graph/index` queries, so this one refresh covers the no-shell planning stage.
3. Select required artifacts.
   - Templates live in the repo at `specs/templates/`, and `cdd-kit new` scaffolds
     from there. This skill deliberately ships no second copy: it had one, the two
     drifted, and agents were being pointed at the stale set — the exact failure the
     "one authoritative artifact" rule below exists to prevent.
   - Do not force every artifact for tiny changes, but do require
     `change-request.md`, `implementation-plan.md` (including its `## Test Plan` and
     `## CI Gates` sections), and `tasks.yml` (including its `classification:`
     frontmatter block) for implementation changes.
   - `change-classification.md`, `test-plan.md`, and `ci-gates.md` are the OLD
     (`context-governance: v1`) shape. Do not create them for a new change:
     `cdd-kit new` no longer scaffolds them and the gate no longer asks for them, so
     a hand-written one is an orphan nothing reads. An existing v1 change directory
     keeps them — never migrate one by hand.
   - Keep each fact in one authoritative artifact. Later artifacts should
     reference earlier artifacts by path, section, criterion id, decision id, or
     gate name instead of duplicating full prose.
   - Write an `agent-log/<agent>.yml` for every agent in `## Required Agents` so
     its run leaves a verifiable trace; the gate surfaces a missing one as an
     advisory warning (ADR 0008), not an error. `agent-log/*.yml` is optional for
     agents not on that list.
     Create report markdown only for blocking findings, approved-with-risk,
     visual evidence bundles, or high-risk load/soak results.
4. Update contracts before or alongside implementation. Invoke contract-reviewer to validate API/CSS/env/data/business/CI-CD contracts before or alongside implementation.
   - API: `references/api-contract-standard.md`
   - CSS/UI: `references/css-contract-standard.md`
   - Env: `references/env-contract-standard.md`
   - Data/report shape: `references/data-contract-standard.md`
   - Business logic: `references/business-logic-standard.md`
   - CI/CD: `references/ci-cd-policy.md`
   - Deps/migrations: invoke `dependency-security-reviewer` whenever the change touches lockfiles, dependency manifests, or database migrations.
5. Apply SDD + TDD discipline and commission test engineers.
   - Use `references/sdd-tdd-policy.md`.
   - Tests should be planned before implementation and should fail first when feasible.
   - `test-strategist` authors the test plan (write target: the `## Test Plan` section of specs/changes/<id>/implementation-plan.md only).
   - `e2e-resilience-engineer` implements E2E, failure-injection, and data-boundary tests.
   - `monkey-test-engineer` implements adversarial-input, fuzz, and rapid-UI-action tests.
   - `stress-soak-engineer` implements load, soak, and long-running stability tests.
   - Invoke the relevant test engineer(s) before or alongside implementation based on the risk tier.
   - Each engineer must read the matching standard before authoring tests: e2e-resilience-engineer → references/e2e-standard.md, monkey-test-engineer → references/monkey-operation-standard.md, stress-soak-engineer → references/stress-soak-standard.md.
6. Confirm design decisions when required.
   - If classification marks `Architecture Review Required: yes`, Optional Artifacts `design.md: yes`, or Required Agents includes `spec-architect`, invoke `spec-architect` before `implementation-planner`.
   - `spec-architect` owns `specs/changes/<id>/design.md`.
   - `implementation-planner` must not create or repair `design.md`; if required design is missing, route back to `spec-architect`.
7. Produce the implementation plan.
   - Invoke `implementation-planner` after classification, contracts, test-plan, required design, and CI gate plan are known.
   - `implementation-plan.md` is the execution packet for implementation agents: scope, non-goals, file-level plan, contract updates, tests, acceptance criteria, and constraints.
   - Keep the plan concise. It should not duplicate the full investigation history or user discussion.
   - If the planner reports missing decisions or context, stop before implementation and resolve that gap.
8. Implement through the right role.
   - Backend/frontend work must follow contracts and tests.
   - Backend/frontend/test implementation agents must read `implementation-plan.md` and should report `blocked` instead of inferring missing requirements from chat history.
   - Before invoking an agent with known concrete read paths, run
     `cdd-kit context check <change-id> --path <paths...>` and expand the
     manifest before the agent reads legitimate missing paths.
   - After each agent finishes, verify the required artifact files exist and
     tick the related `tasks.yml` items before starting the next agent.
   - UI changes require UI/UX and visual review.
   - Invoke ui-ux-reviewer for interaction, copy, accessibility, and information hierarchy review whenever UI changes.
   - Invoke visual-reviewer for layout, responsive, CSS contract, and screenshot diff review whenever UI changes.
   - If implementation reveals an unexpected boundary or architectural constraint, halt and re-invoke `spec-architect` before continuing.
9. Run quality gates.
   - Use `references/qa-gates.md`.
   - Before claiming a change is done, apply
     `references/verification-before-completion.md`: exercise the affected flow
     and confirm required evidence exists — do not report success from intent.
   - CI/CD gate plan is mandatory.
   - `qa-reviewer` decides release readiness; Tier 1 gates must be green; Tier 3+ gates must be green or explicitly deferred with a recorded promotion policy.
   - Invoke ci-cd-gatekeeper to design and enforce the gate plan.
10. Archive and audit drift.
   - Use `references/spec-drift-policy.md`.
   - General agents record evidence and findings only; durable learning
     promotion happens only during `/cdd-close` Step 3.
   - Durable learnings must be promoted back to `contracts/` or project
     guidance (`CLAUDE.md`/`CODEX.md`).
   - `spec-drift-auditor` must run before every release to main and weekly during active multi-iteration development.

## Required gates by risk

### Low-risk documentation or prompt-only change

- classification
- affected artifact list
- no implementation gate unless code behavior changes

### Normal feature or enhancement

- classification
- current behavior if modifying existing feature
- proposal/spec/design as needed
- implementation-plan
- contracts
- test-plan
- ci-gates
- tasks
- QA verdict; `qa-report.md` only when blocked, approved-with-risk, or required by classification

### UI change

- CSS/UI contract review
- UI/UX review
- visual review evidence
- E2E or component interaction coverage
- accessibility check
- See references/visual-review-standard.md for the required state matrix.

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

## Parallel changes (multiple worktrees)

When several tracked changes are developed at once in separate git worktrees,
follow `references/parallel-worktree-standard.md`. Reserve a distinct contract
version lane per (change, contract) with `cdd-kit reserve` **before** branching,
write changelog entries as `contracts/changelog.d/<change-id>.md` fragments (not
the shared `CHANGELOG.md`), and integrate with `cdd-kit integrate` (contention
matrix + deterministic merge order) followed by `cdd-kit changelog build`. Only
parallelize changes with disjoint contract surfaces; overlapping surfaces are
serialized or landed on base first. See docs/adr/0009-parallel-change-integration.md.

## Output discipline

When using this skill, produce concrete artifact content instead of vague recommendations. Include exact files to create/update, exact gates to run, exact commands if detectable, and exact acceptance criteria.

Avoid artifact sprawl: do not create optional markdown when a concise verdict
or `agent-log/*.yml` pointer is enough. Do not duplicate full test strategy,
CI policy, design rationale, or contract prose across artifacts.

## Scripts

- `scripts/detect_project_profile.py`: inspect a repository and emit a Markdown project profile.
- `scripts/generate_change_scaffold.py`: create a change folder from templates.
- `scripts/validate_contracts.py`: check for required contract files.
- `scripts/validate_env_contract.py`: check env contract basics.
- `scripts/validate_ci_gates.py`: check CI-gate structure — `ci-gates.md` when a change has one (v1), otherwise the `## CI Gates` section of `implementation-plan.md` (v2). Each shape is checked against the terms it actually declares; whether the section is authored at all is the gate's job (`v2PlanSectionFinding`).
- `scripts/validate_spec_traceability.py`: check coarse traceability between spec, tasks, tests, and CI gates.

Run scripts with Python 3 from the repository root.

## Output discipline (file formats)

- `tasks.yml`: structured YAML, validated by `src/schemas/tasks.schema.ts`.
- `agent-log/<agent>.yml`: structured handoff note per `references/agent-log-protocol.md`. Write one for every agent in `## Required Agents` so its run is traceable; the gate flags a missing one as an advisory warning (ADR 0008). Optional for agents not on that list.
- `implementation-plan.md`: required execution handoff for implementation agents.
- Report markdown is optional and reserved for durable review evidence. Routine
  pass/fail evidence belongs in short `agent-log/*.yml` pointers or the final
  assistant summary.
