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
- Do not use broad repository search unless the manifest authorizes it.
- If more context is needed, stop and write a Context Expansion Request in the manifest.
- Record every file read through tools in the relevant `agent-log/*.md` under `- files-read:`.

## Hot And Cold Data

- Hot: `contracts/`, source files, tests, CI config.
- Warm: current `specs/changes/<change-id>/`.
- Cold: `specs/archive/`.

Cold historical data is evidence, not current requirements.
