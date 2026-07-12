---
change-id: agent-native-cdd-rearchitecture
applicability: not-applicable
applicability-reason: "This increment changes CLI commands, MCP tools, local files and provider installation behavior only. It adds no screen, visual control or browser/application state; CLI behavior is specified in the runtime contracts and implementation plan."
last-changed: 2026-07-11
---

# Interaction Design: not applicable

The user-facing surfaces are terminal commands and machine-readable MCP tools,
not screens or visual controls. Their observable states are contractually
defined: migration is dry-run first, customized assets are preserved during
automatic migration, runtime invalidation is explicit, and Boundary Guard
distinguishes shadow warnings from blocking findings.

If a future increment adds a runtime dashboard or other visual UI, that change
must supply a full interaction derivation and human confirmation rather than
inheriting this CLI-only applicability decision.
