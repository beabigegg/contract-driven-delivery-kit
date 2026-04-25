# Agents Overview

Use these agents as reusable Claude Code subagents. Project-level agents may be placed in `.claude/agents/`; user-level agents may be placed in `~/.claude/agents/`.

## Core agents

- `change-classifier`: routes requests into change types and required artifacts.
- `repo-context-scanner`: detects tech stack, commands, contracts, tests, and CI/CD.
- `spec-architect`: evaluates architectural impact and produces design constraints.
- `contract-reviewer`: owns API, CSS, env, data, business, and CI contract consistency.
- `test-strategist`: maps acceptance criteria to test families.
- `ci-cd-gatekeeper`: makes CI/CD gates mandatory and auditable.
- `backend-engineer`: implements backend tasks under contract and tests.
- `frontend-engineer`: implements frontend tasks under API/CSS/visual contracts.
- `ui-ux-reviewer`: reviews interaction quality, states, copy, accessibility, and flow.
- `visual-reviewer`: reviews screenshots, layout, responsive behavior, and CSS contract drift.
- `e2e-resilience-engineer`: writes real user journey, failure, data-boundary, and browser-behavior tests.
- `stress-soak-engineer`: designs load, stress, soak, and long-running stability tests.
- `monkey-test-engineer`: designs invalid-operation and adversarial user-operation coverage.
- `qa-reviewer`: runs quality gates and routes failures back to the right owner.
- `spec-drift-auditor`: audits multi-iteration drift between spec, contract, code, tests, CI, and archive.
