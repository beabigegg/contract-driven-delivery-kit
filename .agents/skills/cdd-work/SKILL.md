---
name: cdd-work
description: Use Contract-Driven Delivery in Codex for non-trivial repository changes that need contract, impact, test, evidence, or risk guardrails.
---

# CDD work

Use the `cdd-kit` CLI and MCP server as the deterministic authority. Do not
recreate CDD workflow state in chat.

1. Read the repository `AGENTS.md` and `.cdd/model-policy.json`.
2. For a new tracked change, run `cdd-kit new <change-id>` and inspect the
   generated classification and context manifest.
3. Query `cdd-kit graph`, `cdd-kit index`, and `cdd-kit contract` before broad
   source reads. Prefer equivalent cdd-kit MCP tools when registered.
4. Treat `contracts/` as canonical. Update affected contracts before or with
   implementation and never hand-edit generated projections.
5. Work only inside the approved scope. Escalate unknown boundaries instead of
   silently widening the change.
6. Select and record bounded tests with `cdd-kit test select` and
   `cdd-kit test run`.
7. Run `cdd-kit gate <change-id>` before completion. A confident agent report is
   not evidence in place of a passing deterministic check.

Use the runtime-selected profile when invoking the gate. Human acceptance is
not routine ceremony: strict always requires it; controlled requires it only
when the capsule lists `acceptance-oracle`. Escalate with
`--require-acceptance`; never invent the human-owned answer key.

For documentation-only or behavior-neutral maintenance, use the lightest
profile allowed by project policy. For API/data shape, migrations,
authorization, secrets, destructive operations or unresolved impact, escalate
to controlled or strict handling and obtain configured approvals.
