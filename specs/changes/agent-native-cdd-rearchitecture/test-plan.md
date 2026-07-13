---
change-id: agent-native-cdd-rearchitecture
schema-version: 0.1.0
last-changed: 2026-07-11
risk: critical
tier: 0
---

# Test Plan: agent-native-cdd-rearchitecture

## Acceptance Mapping

| criteria | test surface |
|---|---|
| AC-1 | `test/schemas/runtime-contracts.schema.test.ts` |
| AC-1, AC-10 | `test/cli/policy.test.ts` |
| AC-10 | `test/policy/profile.test.ts`; acceptance-oracle profile matrix |
| AC-2, AC-3 | `test/cli/boundary.test.ts` |
| AC-4, AC-5 | `test/cli/runtime.test.ts` |
| AC-6 | init, setup, skill-prompt and MCP tests |
| AC-7, AC-8 | update, upgrade and agent-native migration tests |
| AC-9 | `test/contracts/doctrine-ledger.test.ts` |
| AC-10 | gate composition tests and shadow-mode defaults |

## Test Ladder

| phase | command | required signal |
|---|---|---|
| targeted | `npx vitest run test/schemas/runtime-contracts.schema.test.ts test/cli/boundary.test.ts test/cli/runtime.test.ts test/cli/agent-native-migrate.test.ts test/contracts/doctrine-ledger.test.ts` | all pass |
| contract | wrong response variant mutation | `variant-shape-mismatch` blocks |
| quality | `npm run check:lockfile && npm run check:mojibake` | clean |
| build | `npm run build && npm run typecheck` | clean |
| full | `npx vitest run` | all repository tests pass |

## Negative and Non-vacuous Cases

- API-looking changed files with no operation mapping are findings.
- A changed operation with no required variants or real capture cannot pass.
- A capture whose body violates the selected JSON Schema is rejected.
- Missing/expired exception metadata cannot silently downgrade enforcement.
- Runtime input digest drift invalidates resume.
- A customized global Claude/Codex asset is skipped and preserved.
- Unsupported providers fail explicitly instead of falling back silently.

## Human-owned Acceptance

The repository's ADR 0010 oracle must be authored and locked by the maintainer.
An implementation agent must not invent `acceptance.yml` expectations. Automated
test evidence therefore proves the implementation, while final change archival
waits for maintainer-authored acceptance confirmation.

## Stop Rules

- no default switch without separate parity evidence and approval;
- no silent overwrite of user-owned global assets;
- no vacuous green result for changed API work;
- no auto-rewrite of active changes or history;
- no removal of a current safety capability without a mapped replacement.
