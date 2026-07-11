---
change-id: agent-native-cdd-rearchitecture
schema-version: 0.1.0
last-changed: 2026-07-11
risk: low
tier: 5
---

# Test Plan: agent-native-cdd-rearchitecture

## Acceptance Criteria -> Test Mapping

| criterion id | test family | test file path / review surface | tier |
|---|---|---|---:|
| AC-1 | documentation review | `change-request.md`; RFC Maintainer concerns | 5 |
| AC-2 | traceability review | feature disposition map | 5 |
| AC-3 | architecture review | RFC Agent model; design D-1 | 5 |
| AC-4 | contract design review | RFC Boundary Guard; ADR invariants | 5 |
| AC-5 | architecture review | RFC Target architecture / Workflow profiles | 5 |
| AC-6 | migration review | migration phases, compatibility and rollback | 5 |
| AC-7 | QA strategy review | mutation corpus and comparison metrics | 5 |
| AC-8 | repository diff / CI | changed files are documentation and change artifacts only | 5 |

## Test Families Required

Documentation consistency, architecture review and existing repository quality
checks only. No executable product behavior changes are introduced.

## Test Execution Ladder

| phase | required | command source | max failures | result artifact |
|---|---:|---|---:|---|
| collect | no | documentation-only change | 1 | PR changed-file list |
| targeted | no | documentation-only change | 1 | PR review |
| changed-area | no | documentation-only change | 1 | PR review |
| contract | no | no contract behavior changed | 1 | n/a |
| quality | yes | `npm run check:mojibake` | 1 | CI log |
| full | CI | existing repository PR workflow | 1 | CI checks |

## Documentation Consistency Checks

- ADR links resolve to RFC and migration documents.
- RFC links resolve to ADR, migration plan and feature map.
- The migration plan does not authorize removing capabilities before parity.
- Feature dispositions cover contracts, context, doctrine, agents, artifacts,
  commands, hooks, guidance and archives.
- The package is described as current 3.x; the proposal does not incorrectly
  call itself CDD 3.0.
- Strict remains the compatibility and rollback profile.
- Boundary Guard requirements include request, response, status variants,
  consumers and non-vacuous coverage.
- No document claims measured token or quality improvement before implementation.

## Test Update Contract

No existing tests are changed or deleted by this PR.

## Stop Rules

- Do not merge if a current safety capability has no documented disposition.
- Do not merge if the RFC can be interpreted as immediate authorization to delete
  the current workflow.
- Do not merge if API/data-shape protection is weaker than the current stated
  objective.
- Do not merge if rollback to strict mode is undefined.
- Do not merge if project-specific doctrine is replaced by generic kit doctrine.

## Out of Scope

- Runtime mutation tests will be implemented in follow-up Boundary Guard PRs.
- Token benchmarks will be implemented when shadow profiles exist.
- Consumer-repository migration tests will be implemented with migration tooling.

## Notes

`tasks.yml` records `test-evidence-not-applicable` because this PR contains no
executable implementation. Existing CI remains the quality backstop for the
documentation diff.
