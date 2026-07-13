# CODEX.md

<!-- cdd-kit:managed:start -->

This project uses Contract-Driven Delivery (CDD).

Codex reads the repository `AGENTS.md` as the durable project instruction file.
This file is retained for compatibility with older cdd-kit installations; keep
authoritative project rules in `AGENTS.md`.

## Workflow

- Treat `contracts/` as the current source of truth.
- Treat `specs/archive/` as historical context only; do not use it for current planning unless explicitly asked.
- Start work with `cdd-kit work <change-id> <objective> --provider codex`.
- Follow the execution capsule and load only its selected Doctrine through
  `cdd-kit runtime agent prompt <run-id>`.
- Run `cdd-kit runtime check run <run-id> --all`, satisfy review/approval
  requirements, then run `cdd-kit runtime verify <run-id>` and
  `cdd-kit gate <change-id>`.
- Use `cdd-kit new` and `specs/changes/<id>` only when the capsule selects the
  strict legacy workflow.

## Recommended MCP Tools

Configure MCP-capable agents to use the cdd-kit server:

```bash
codex mcp add cdd-kit -- cdd-kit mcp
codex mcp list
```

Codex stores MCP configuration in `~/.codex/config.toml`. The CLI command above
is preferred over editing the TOML by hand.

Prefer these MCP tools before reading source files: `cdd_graph_context`,
`cdd_graph_query`, `cdd_graph_impact`, `cdd_index_query`, and
`cdd_index_impact`. They use `.cdd/code-map.yml` and
`.cdd/code-graph.index.json` as the project exploration layer. If MCP is not
available, use the equivalent CLI commands: `cdd-kit graph ...` and
`cdd-kit index ...`.

## Context Governance

Use capsule `affected` and `write_scope` as the active context boundary. If it
is empty or incomplete, resolve impact with graph/contract tools and escalate
unknown boundaries before editing. Strict legacy runs continue to use
`context-manifest.md`.

## Hot And Cold Data

- Hot: `contracts/`, source files, tests, CI config.
- Warm: current `specs/changes/<change-id>/`.
- Cold: `specs/archive/`.

Cold historical data is evidence, not current requirements.

Runtime evidence, reviewer verdicts, and approvals are digest-bound. Re-run them
after implementation changes; stale evidence never passes.
<!-- cdd-kit:managed:end -->
