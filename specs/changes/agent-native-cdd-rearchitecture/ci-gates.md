# CI/CD Gate Plan

## Required Gates

| tier | gate | required | trigger | command / evidence |
|---:|---|---:|---|---|
| 0 | lockfile | yes | pull request | `npm run check:lockfile` |
| 0 | encoding | yes | pull request | `npm run check:mojibake` |
| 0 | build | yes | pull request | `npm run build` |
| 0 | typecheck | yes | pull request | `npm run typecheck` |
| 0 | full regression | yes | pull request | `npx vitest run` |
| 0 | runtime schemas | yes | pull request | runtime-contract schema tests |
| 0 | boundary negative/mutation | yes | pull request | Boundary Guard CLI tests |
| 0 | provider compatibility | yes | pull request | Claude/Codex init and setup tests |
| 0 | upgrade safety | yes | pull request | update, upgrade and migration tests |
| 0 | architecture review | yes | maintainer review | ADR/RFC/runtime-contract review |

## Enforcement Staging

Boundary Guard is composed into `cdd-kit gate`. With `shadow_mode: true`, its
findings are informational and the existing strict workflow remains the blocking
authority. A project may explicitly set `shadow_mode: false` after reviewing its
manifest, captures and exceptions. This increment does not change that default.

## Promotion Policy

Balanced or controlled profiles may replace strict only after a separate change
demonstrates:

- seeded mutation-catching parity on boundary and risk cases;
- representative consumer dual-runs and reviewed false positives;
- no regression in required test selection or independent review;
- measured token/call improvement;
- exercised strict rollback;
- maintainer approval.

## Rollback Policy

- set the project policy to strict/shadow;
- stop invoking runtime planning while leaving existing artifacts intact;
- restore package-owned global assets from timestamped backups;
- preserve contracts, archives, active changes and evidence;
- never use a migration rollback to overwrite a customized user asset.

## Merge Eligibility

The implementation is technically eligible when all mechanical checks pass and
the content review confirms the runtime contracts, non-vacuous Boundary Guard,
provider separation and upgrade ownership guarantees. Human acceptance is
required only when the selected profile/capsule says so; strict preserves ADR
0010 unchanged.
