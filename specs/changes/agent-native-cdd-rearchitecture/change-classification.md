# Change Classification

## Change Types
- primary: architecture RFC / documentation
- secondary: workflow redesign / compatibility and migration planning

## Risk Level
- current PR delivery risk: low (documentation only)
- proposed program risk: high (system-wide architecture and future default changes)

## Impact Radius
- system-wide, but no executable behavior changes in this PR

## Tier
- 5 for this documentation-only proposal

## Architecture Review Required
- yes
- reason: the proposal changes the long-term ownership of agents, skills,
  runtime state, gates, project guidance and compatibility profiles.

## Required Artifacts
Always required: change-request.md, change-classification.md,
implementation-plan.md, test-plan.md, ci-gates.md, tasks.yml,
context-manifest.md

## Optional Artifacts
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | Current behavior is described and linked from the RFC and feature map. |
| proposal.md | no | The detailed proposal is `docs/rfc/agent-native-cdd-rearchitecture.md`. |
| spec.md | no | This PR is an architecture RFC, not an executable product specification. |
| design.md | yes | Captures the architecture decomposition and implementation boundaries. |
| qa-report.md | no | Review findings should be PR comments unless a blocking risk needs durable prose. |
| regression-report.md | no | No runtime behavior changes. |
| visual-review-report.md | no | No UI surface. |
| monkey-test-report.md | no | No executable interaction changes. |
| stress-soak-report.md | no | No runtime/load changes. |

## Required Contracts
- API: no contract behavior change in this PR
- CSS/UI: not applicable
- Env: not applicable
- Data shape: no contract behavior change in this PR
- Business logic: no runtime business-rule change in this PR
- CI/CD: no workflow change in this PR

## Required Tests
- unit: not applicable to documentation-only proposal
- contract: reference and consistency review only
- integration: not applicable
- E2E: not applicable
- visual: not applicable
- data-boundary: not applicable
- resilience: not applicable
- fuzz/monkey: not applicable
- stress: not applicable
- soak: not applicable

## Required Agents
- spec-architect
- contract-reviewer
- qa-reviewer

## Inferred Acceptance Criteria
- AC-1: The RFC states the maintainer's original purpose and explicit fears.
- AC-2: Every major current CDD capability has a migration disposition.
- AC-3: Subagent engineering doctrine is preserved separately from workflow
  choreography.
- AC-4: The target architecture strengthens API/request/response/data-shape
  protection and prevents vacuous green checks.
- AC-5: The proposal defines dynamic agent profiles, runtime execution capsules,
  minimal project guidance and risk-based approvals.
- AC-6: Existing projects can remain on a strict compatibility profile and
  migrate incrementally with rollback.
- AC-7: The migration plan defines dual-run parity, mutation tests and measurable
  token/quality criteria before defaults change.
- AC-8: This PR makes no executable behavior or default changes.

## Tasks Not Applicable
- not-applicable: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3,
  3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 6.4

## Clarifications or Assumptions

- The package is already in the 3.x release line. The RFC therefore uses
  "agent-native CDD" or "next architecture" rather than incorrectly naming the
  proposal CDD 3.0.
- A default-changing release is a candidate for a future major version, but this
  PR does not decide the number.
- The current strict workflow remains authoritative until parity is demonstrated.

## Context Manifest Draft

### Affected Surfaces
- architecture documentation
- agent and skill ownership model
- future runtime and policy model
- compatibility and consumer-project migration

### Allowed Paths
- docs/adr/
- docs/rfc/
- docs/migration/
- .claude/agents/
- .claude/skills/
- CLAUDE.md
- CLAUDE.template.md
- AGENTS.template.md
- specs/templates/
- specs/changes/agent-native-cdd-rearchitecture/
- src/cli/
- src/commands/
- src/mcp/
- src/code-map/
- src/code-graph/
- src/contracts/
- hooks/
- package.json
- README.md

### Agent Work Packets

#### spec-architect
- docs/adr/
- docs/rfc/
- docs/migration/
- .claude/agents/
- .claude/skills/
- CLAUDE.template.md
- specs/changes/agent-native-cdd-rearchitecture/

#### contract-reviewer
- docs/adr/
- docs/rfc/
- docs/migration/
- src/contracts/
- specs/changes/agent-native-cdd-rearchitecture/

#### qa-reviewer
- docs/adr/
- docs/rfc/
- docs/migration/
- specs/changes/agent-native-cdd-rearchitecture/
- package.json
