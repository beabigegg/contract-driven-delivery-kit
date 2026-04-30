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
Always required: change-request.md, change-classification.md, test-plan.md, ci-gates.md, tasks.yml

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

## Context Manifest Draft
<!-- Classifier fills this section. In /cdd-new Step 2.3, Claude copies it verbatim into
     specs/changes/<change-id>/context-manifest.md, replacing the scaffold.
     All paths must be repo-relative. Gate enforces Allowed Paths against agent files-read logs. -->

### Affected Surfaces
-

### Allowed Paths
<!-- Union of ALL paths any agent will read. Add change-specific paths below the defaults. -->
- specs/changes/<change-id>/
- specs/context/project-map.md
- specs/context/contracts-index.md

### Agent Work Packets
<!-- One sub-section per required agent (paths must be a subset of Allowed Paths above). -->

#### change-classifier
- specs/changes/<change-id>/
- specs/context/project-map.md
- specs/context/contracts-index.md
