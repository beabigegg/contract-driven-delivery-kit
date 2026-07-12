# Contract-Driven Delivery

<!-- cdd-kit:managed:start -->

This repository uses cdd-kit. `contracts/` is canonical and deterministic
runtime evidence is authoritative over agent confidence.

For non-trivial work:

1. Run `cdd-kit work <change-id> <objective>`.
2. Follow the execution capsule. Use
   `cdd-kit runtime agent prompt <run-id>` so only risk-selected Doctrine enters
   context.
3. Resolve unknown impact with CDD graph/index/contract tools before broad
   reads or scope expansion.
4. Record implementation and run
   `cdd-kit runtime check run <run-id> --all`.
5. Controlled work requires an independent reviewer and every named approval.
6. Run `cdd-kit runtime verify <run-id>` and `cdd-kit gate <change-id>`.

Lightweight, balanced, and controlled work use runtime state under
`.cdd/runtime/`; do not create legacy Markdown bookkeeping. `cdd-kit new`, the
fixed legacy agents, seven change artifacts, and `test-evidence.yml` are kept
only for strict compatibility.

Evidence is digest-bound. Re-run checks, review, and approvals after source or
policy changes. Never self-approve a human approval.
<!-- cdd-kit:managed:end -->
