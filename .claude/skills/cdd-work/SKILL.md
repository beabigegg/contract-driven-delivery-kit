---
name: cdd-work
description: Run an agent-native Contract-Driven Delivery change with a risk-selected capsule, Doctrine, checks, review, and approvals.
---

# CDD work

1. Run `cdd-kit work <change-id> <objective> --provider claude`.
2. Read the capsule and run `cdd-kit runtime agent prompt <run-id>`. Apply only
   the selected Doctrine and bounded scope. Resolve unknown impact with the CDD
   graph/contract MCP tools before editing.
3. Treat `contracts/` as canonical. Update contracts and generated projections
   with implementation changes.
4. Record work using `cdd-kit runtime agent complete`, then run
   `cdd-kit runtime check run <run-id> --all`.
5. Controlled work requires a separate reviewer using
   `cdd-kit runtime agent prompt <run-id> --role reviewer` and a recorded
   `cdd-kit runtime review` verdict. Named human approvals cannot be self-issued.
6. Finish with `cdd-kit runtime verify <run-id>` and `cdd-kit gate <change-id>`.

Lightweight, balanced, and controlled profiles use runtime-native state and do
not create the seven legacy change artifacts. Use `/cdd-new` and the original
fixed agent workflow only when strict compatibility is explicitly selected.
