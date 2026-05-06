# CODEX.md

This project uses Contract-Driven Delivery (CDD).

## Workflow

- Treat `contracts/` as the current source of truth.
- Treat `specs/changes/<change-id>/` as active work context.
- Treat `specs/archive/` as historical context only; do not use it for current planning unless explicitly asked.
- Start non-trivial work by creating a change with `cdd-kit new <change-id>`.
- Run `cdd-kit context-scan` before classification when project context may be stale.
- Run `cdd-kit gate <change-id>` before proposing a commit or PR.

## Context Governance

Read `specs/changes/<change-id>/context-manifest.md` before using file-reading or search tools.

- Read only paths allowed by the manifest or approved expansions.
- Before invoking an agent with known concrete reads, run
  `cdd-kit context check <change-id> --path <paths...>`. If it fails and the
  reads are legitimate, expand `Allowed Paths` or approve a Context Expansion
  Request before the agent reads the files.
- Do not use broad repository search unless the manifest authorizes it.
- If more context is needed, stop and write a Context Expansion Request in the manifest.
- Record every file read through tools in the relevant `agent-log/*.yml` under `files-read:`.

Required `agent-log/*.yml` format:

```yaml
files-read:
  - contracts/api/api-contract.md
  - src/server/routes/users.ts
```

Every entry must be a repo-relative path. Do not omit files, use absolute paths, or use `..`.

## Hot And Cold Data

- Hot: `contracts/`, source files, tests, CI config.
- Warm: current `specs/changes/<change-id>/`.
- Cold: `specs/archive/`.

Cold historical data is evidence, not current requirements.

## Operational Notes

- After each agent returns, verify its agent-log exists, tick the related
  `tasks.yml` items immediately, and only then move to the next agent.
- Pre-existing test failures may be excluded from the current gate only when
  `qa-report.md` records the failing test, baseline evidence, why it is outside
  scope, owner, and follow-up.
- For MySQL migrations, treat ENUM contraction and any DDL requiring
  `ALGORITHM=COPY` as high risk on large tables; require row-count/runtime
  estimate, online migration or maintenance window, and rollback plan.
