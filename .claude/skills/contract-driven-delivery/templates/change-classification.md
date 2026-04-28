# Change Classification

## Change Types
- primary:
- secondary:

## Risk Level
- low / medium / high / critical

## Impact Radius
- isolated / module-level / cross-module / system-wide

## Tier
- 0 / 1 / 2 / 3 / 4 / 5

## Architecture Review Required
- yes / no
- reason: (fill only if yes)

## Required Artifacts
Always required: change-request.md, change-classification.md, test-plan.md, ci-gates.md, tasks.md

## Optional Artifacts (default: no — set yes only with explicit reason)
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | |
| proposal.md | no | |
| spec.md | no | |
| design.md | no | |
| qa-report.md | no | |
| regression-report.md | no | |

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
