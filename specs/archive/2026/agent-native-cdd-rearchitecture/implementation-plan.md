# Implementation Plan: agent-native-cdd-rearchitecture

## Objective

Implement the provider-neutral, contract-first foundation described by ADR 0013
while retaining strict as the authoritative compatibility profile.

## Delivered Workstreams

| workstream | implementation | verification |
|---|---|---|
| runtime contracts | versioned policy, boundary, capsule, state and evidence schemas | schema contract tests |
| Boundary Guard | changed-operation discovery, manifest/capture/type/variant validation and non-vacuous checks | positive, negative and mutation tests |
| runtime | deterministic risk routing, capsules, atomic state, locks, digests and evidence | CLI/runtime tests |
| policy and gates | policy validation, expiry checks, shadow-to-blocking composition | policy/gate regression tests |
| MCP | plan, status, verify and boundary tools | MCP registration tests |
| provider adapters | Claude Code and Codex capabilities, setup and guidance | init/setup/skill tests |
| doctrine | provider-neutral engineering modules and traceability ledger | doctrine contract test |
| migration | dry-run-first project migration and ownership-aware user assets | migration/update/upgrade tests |

## Ownership Boundaries

- Schemas own persisted format; runtime owns generated state and evidence.
- Boundary Guard owns deterministic API/data conformance.
- Provider adapters own installation paths and MCP registration syntax only.
- Doctrine owns reusable engineering judgment, not workflow state.
- Project guidance owns project facts and local invariants.
- The user-asset manifest owns only files previously installed by this package;
  unowned or modified files remain user-owned.

## Compatibility and Rollback

- `.cdd/policy.yml` starts with `shadow_mode: true` and strict compatibility.
- Existing `.claude` flows, contracts, hooks and artifacts remain installed.
- Migration defaults to preview and never rewrites active changes or archives.
- Replaced global assets are backed up and customized files are skipped.
- Disabling the new runtime or reverting policy to strict leaves contract history
  intact.

## Deferred by Explicit Gate

- Changing the package default away from strict.
- Removing legacy agents, skills, hooks or hand-authored artifact paths.
- Claiming token savings or defect parity before representative measurements.
- Automatic bulk migration of consumer repositories.

These are promotion-stage decisions, not incomplete implementation tasks.
