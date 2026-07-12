---
name: cdd-work
description: Use Contract-Driven Delivery in Codex for non-trivial repository changes that need contract, impact, test, evidence, or risk guardrails.
---

# CDD work

Use the `cdd-kit` CLI and MCP server as the deterministic authority. Do not
recreate CDD workflow state in chat.

1. Read `AGENTS.md`, then create the runtime with
   `cdd-kit work <change-id> <objective> --provider codex`.
2. Read the returned capsule. Generate the bounded implementer instruction with
   `cdd-kit runtime agent prompt <run-id>`; it loads only the selected Doctrine.
3. Resolve empty/unknown scope with `cdd-kit graph`, `cdd-kit index`, and
   `cdd-kit contract` before editing. Treat `contracts/` as canonical and never
   hand-edit generated projections.
4. Work inside the capsule scope. Record completion using
   `cdd-kit runtime agent complete <run-id> --status passed --actor codex --summary "..." --file ...`.
5. Produce runtime-native evidence with
   `cdd-kit runtime check run <run-id> --all`.
6. For Controlled work, use a separate reviewer context with
   `cdd-kit runtime agent prompt <run-id> --role reviewer`, then record the
   verdict with `cdd-kit runtime review`. Obtain every pending named approval
   from a trusted human/provider as a signed envelope, then import it with
   `cdd-kit runtime approval import <file> <run-id>`. The CLI has no free-form
   self-approval command.
7. Run `cdd-kit runtime verify <run-id>` and `cdd-kit gate <change-id>`.

Do not create the seven legacy change artifacts for lightweight, balanced, or
controlled profiles. `cdd-kit new`, tracked `specs/changes/<id>` artifacts, and
legacy `test-evidence.yml` remain the strict compatibility lane only.

Use the runtime-selected profile when invoking the gate. Human acceptance is
not routine ceremony: strict always requires it; controlled requires it only
when the capsule lists `acceptance-oracle`. Escalate with
`--require-acceptance`; never invent the human-owned answer key.

For documentation-only or behavior-neutral maintenance, use the lightest
profile allowed by project policy. For API/data shape, migrations,
authorization, secrets, destructive operations or unresolved impact, escalate
to controlled or strict handling and obtain configured approvals.
