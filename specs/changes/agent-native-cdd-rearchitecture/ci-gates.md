# CI/CD Gate Plan

## Change ID

`agent-native-cdd-rearchitecture`

## Required Gates

| gate | tier | required | trigger | command/workflow | expected artifact |
|---|---:|---:|---|---|---|
| encoding quality | 1 | yes | pull_request | `npm run check:mojibake` | clean CI log |
| lockfile consistency | 1 | existing policy | pull_request | `npm run check:lockfile` | clean CI log |
| build | 1 | existing policy | pull_request | `npm run build` | successful bundle |
| typecheck | 1 | existing policy | pull_request | `npm run typecheck` | zero TypeScript errors |
| unit/regression | 1 | existing policy | pull_request | `npm test` | existing suite passes |
| architecture review | 5 | yes | pull_request review | maintainer review of ADR/RFC/migration | approval or requested changes |
| contract | 1 | no new behavior | pull_request | existing contract checks only | no new drift |
| integration | 3 | no | n/a | documentation-only change | n/a |
| e2e-critical | 1 | no | n/a | documentation-only change | n/a |
| visual | 2 | no | n/a | no UI surface | n/a |
| data-boundary | 1 | no | n/a | no runtime change | n/a |
| resilience | 3 | no | n/a | no runtime change | n/a |
| fuzz/monkey | 3 | no | n/a | no runtime change | n/a |
| stress | 4 | no | n/a | no runtime change | n/a |
| soak | 5 | no | n/a | no runtime change | n/a |

## New Workflow Changes

None. This PR must not alter required checks, hooks, workflows or release policy.
Future workstreams will define their own gate changes.

## Required Check Policy

Use the repository's existing pull-request checks. The architecture RFC requires
maintainer review because it governs future removal, relocation and default
changes, but it does not itself authorize those changes.

## Informational Gate Promotion Policy

Future shadow checks may become required only when:

- they pass the seeded mutation corpus;
- strict/new parity is demonstrated on representative projects;
- false positives and exception behavior are reviewed;
- rollback to strict has been exercised;
- the maintainer approves promotion in a separate PR.

## Rollback Policy

Revert this documentation PR. It does not change runtime behavior, generated
assets, contracts, consumer repositories or project defaults.

Future implementation increments must retain an independent rollback to strict
mode.

## Artifact Retention

Keep the ADR, RFC, migration plan, feature map and change artifacts in repository
history. Follow-up PRs should cite decision IDs and workstreams instead of
copying the complete rationale.

## Merge Eligibility Decision

Eligible for merge when:

- current CI is green;
- architecture/contract/QA review concerns are resolved or explicitly recorded;
- the maintainer agrees that the proposal preserves existing safety outcomes;
- the PR remains documentation-only.

## Notes

This proposal deliberately separates approval of the direction from approval of
any specific runtime or default change.
