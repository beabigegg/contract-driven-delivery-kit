---
contract: env
summary: Environment variable inventory, secret handling, and deployment sync policy.
owner: platform-team
surface: runtime-config
schema-version: 0.2.0
last-changed: 2026-07-08
breaking-change-policy: deprecate-2-minors
---

# Env Contract

| name | scope | environments | required | secret | default | example | owner | validation | restart required | failure behavior |
|---|---|---|---:|---:|---|---|---|---|---:|---|
| `CDD_ACCEPTANCE_WRITE_STRICT` | cli (agent PreToolUse hook) | local (Claude Code / agent session) | no | no | `0` | `1` | platform-team | boolean-ish (`0`=advisory / `1`=hard-block); mirrors `CDD_CONTRACT_WRITE_STRICT` | no | `0` (default): `pre-tool-use-acceptance-write.sh` prints guidance to stderr and allows the Edit/Write/MultiEdit of `acceptance.yml`; `1`: hook exits 2 and blocks the edit, feeding the routing reason back to the agent |

## Public Frontend Env Policy

Variables such as `VITE_`, `NEXT_PUBLIC_`, and `PUBLIC_` are browser-exposed. Never store secrets in them.

## Secret Policy

## Deployment Sync Policy
