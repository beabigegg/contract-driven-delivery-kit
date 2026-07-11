# Implementation Plan: agent-native-cdd-rearchitecture

## Objective

Deliver a reviewable architecture and migration RFC that can be decomposed into
small follow-up PRs while preserving every existing safety outcome and restoring
API/data-shape correctness as the central invariant.

This PR is documentation-only. It does not implement the future architecture.

## Execution Scope

### In Scope

- Record maintainer intent, concerns and non-negotiable constraints.
- Propose the target architecture.
- Define how subagent doctrine is preserved.
- Define Boundary Guard requirements.
- Define workflow profiles and dynamic routing.
- Define project-guidance simplification.
- Map current features to future owners/dispositions.
- Define migration, compatibility, parity and rollback.
- Define follow-up implementation workstreams and acceptance criteria.

### Out of Scope

- Runtime, CLI, MCP, validator, agent, skill, hook or template changes.
- Consumer repository migration.
- Current default-profile changes.
- Removal or deprecation of existing capabilities.
- Final package-major-version decision.
- Claims of measured token reduction or defect parity.

## Required Changes

| id | area | required action | owner agent |
|---|---|---|---|
| IP-1 | intent | preserve original purpose and maintainer fears in the change request/RFC | main/spec-architect |
| IP-2 | architecture | define doctrine, profiles, runtime, Boundary Guard, adapters and guidance layers | spec-architect |
| IP-3 | boundary safety | specify typed request/response/status variants, consumers and non-vacuous checks | contract-reviewer |
| IP-4 | feature preservation | map every major current capability to a target disposition | spec-architect + contract-reviewer |
| IP-5 | migration | define phased, reversible old-kit and consumer-project migration | spec-architect |
| IP-6 | evidence | define mutation, parity, token and rollback criteria | qa-reviewer |
| IP-7 | review | open a draft PR and collect maintainer/agent review before implementation | main |

## Source Artifact Pointers

| source | relevant pointer | used for |
|---|---|---|
| `change-request.md` | Original Request / Desired Outcome | intent and non-goals |
| `change-classification.md` | AC-1 through AC-8 | review criteria |
| `design.md` | D-1 through D-7 | target architecture boundaries |
| `docs/adr/0013-agent-native-delivery-runtime.md` | Decision / Non-negotiable invariants | architectural decision |
| `docs/rfc/agent-native-cdd-rearchitecture.md` | Target architecture / Acceptance criteria | detailed program design |
| `docs/migration/agent-native-cdd-migration.md` | Phases 0-8 | rollout and rollback |
| `docs/migration/agent-native-cdd-feature-map.md` | feature tables | no-silent-deletion guarantee |

## File-Level Plan

| path | action | notes |
|---|---|---|
| `docs/adr/0013-agent-native-delivery-runtime.md` | add | concise proposed decision and constraints |
| `docs/rfc/agent-native-cdd-rearchitecture.md` | add | complete rationale and target design |
| `docs/migration/agent-native-cdd-migration.md` | add | phased kit and consumer migration |
| `docs/migration/agent-native-cdd-feature-map.md` | add | feature-by-feature disposition |
| `specs/changes/agent-native-cdd-rearchitecture/` | add | dogfooded proposal artifacts |

## Contract Updates

- API: none in this PR.
- CSS/UI: none.
- Env: none.
- Data shape: none in this PR; future Boundary Guard design is documentation.
- Business logic: none.
- CI/CD: none in this PR.

## Test Execution Plan

| acceptance criterion | test file / command | expected signal |
|---|---|---|
| AC-1 | manual review of change request and RFC | original purpose and fears are explicit |
| AC-2 | feature-map coverage review | no major current capability is silently omitted |
| AC-3 | doctrine/agent section review | subagent philosophy has a target owner |
| AC-4 | Boundary Guard design review | request/response/variant/non-vacuous controls specified |
| AC-5 | architecture review | profiles, capsules, runtime, guidance and approvals are coherent |
| AC-6 | migration review | strict compatibility, dual-run and rollback are explicit |
| AC-7 | validation strategy review | mutation and metrics criteria are measurable |
| AC-8 | git diff / CI | documentation-only; no runtime/default files changed |
| quality | `npm run check:mojibake` | documentation contains no encoding corruption |
| regression | existing PR CI | current test/type/build checks remain green |

## Handoff Constraints

- Follow-up implementers must not remove a current feature without completing the
  safety-outcome checklist in the feature map.
- Stronger agent autonomy must not replace deterministic boundary evidence.
- Existing strict behavior remains available until parity is proven.
- Follow-up PRs should implement one workstream/increment at a time.
- Default changes require a future major-release decision.

## Known Risks

- The proposal is intentionally broad and requires decomposition before coding.
- Some current rules may belong to more than one future layer; inventory work may
  refine the mapping.
- Dynamic routing can under-classify risk if based on prose alone; graph/diff
  evidence and fail-safe escalation are required.
- Boundary Guard expansion may expose substantial legacy schema debt in consumer
  projects; changed-operation ratcheting is required to avoid forced rewrites.
- Runtime evidence must remain inspectable for users who depend on current
  Markdown artifacts.
