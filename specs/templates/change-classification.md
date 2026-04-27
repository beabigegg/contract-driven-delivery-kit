# Change Classification

## Change Types
- primary:
- secondary:

## Risk Level
- low / medium / high / critical

## Impact Radius
- isolated / module-level / cross-module / system-wide

## Required Artifacts

The following 5 artifacts are always required for implementation changes:
`change-request.md`, `change-classification.md`, `test-plan.md`, `ci-gates.md`, `tasks.md`

Optional artifacts — only create when explicitly needed:

| artifact | create? (yes / no) | reason |
|---|---|---|
| current-behavior.md | no | |
| proposal.md | no | |
| spec.md | no | |
| design.md | no | |
| qa-report.md | no | |
| regression-report.md | no | |
| archive.md | no | |

Default is **no**. Change classifier must explicitly set `yes` with a reason.

## Required Contracts
- API:
- CSS/UI:
- Env:
- Data shape:
- Business logic:
- CI/CD:

## Required Test Families
- unit:
- contract:
- integration:
- E2E:
- visual:
- data-boundary:
- resilience:
- fuzz/monkey:
- stress:
- soak:

## Required Agents

## Assumptions / Clarifications
