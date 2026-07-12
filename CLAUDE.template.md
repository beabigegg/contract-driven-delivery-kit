# CLAUDE.md

<TODO: one-sentence project purpose>

## Project commands

<TODO: install, dev, test, lint, build>

## Architecture

<TODO: main modules, boundaries, and entry points>

## Contract-Driven Delivery

- `contracts/` is canonical; tests prove serialized behavior.
- Start non-trivial work with `/cdd-work` or
  `cdd-kit work <change-id> <objective> --provider claude`.
- Follow the execution capsule. Load only selected Doctrine with
  `cdd-kit runtime agent prompt <run-id>`.
- Resolve unknown impact through the CDD graph/contract MCP tools before broad
  source reads or scope expansion.
- Record implementation, run runtime-native checks, satisfy independent review
  and named approvals, then run `cdd-kit runtime verify` and `cdd-kit gate`.
- Digest-bound evidence becomes stale after code or policy changes and must be
  regenerated.
- `cdd-kit new`, seven tracked change artifacts, legacy agent prompts, and
  `test-evidence.yml` are the strict compatibility lane only.

## Recommended MCP Tools

Register MCP once with:

```bash
claude mcp add --scope user cdd-kit -- cdd-kit mcp
```

Prefer `cdd_graph_context`, `cdd_graph_impact`, `cdd_index_query`,
`cdd_contract_query`, and `cdd_boundary_check` before broad reads. The CLI
fallback is `cdd-kit graph ...`. Claude writes this registration to
`~/.claude.json`; do not confuse it with `~/.claude/settings.json`.
Never hand-edit generated contract projections.

### Promoted Learnings

Keep each entry to one rule plus a pointer; merge or replace instead of
appending duplicate guidance.

<!-- cdd-kit:learnings:start -->
<!-- cdd-kit:learnings:end -->
