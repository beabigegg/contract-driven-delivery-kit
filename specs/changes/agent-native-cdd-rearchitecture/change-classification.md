# Change Classification

## Change Types

- primary: architecture and executable runtime rearchitecture
- secondary: CLI/MCP, provider adapters, contracts, packaging and migration

## Risk and Impact

- **Tier:** Tier 0
- system-wide package and user-install impact
- default behavior remains strict; new enforcement is shadow by default
- architecture review and independent contract/compatibility review required

## Required Artifacts and Contracts

The change requires the normal change artifacts plus versioned contracts for:

- project policy;
- boundary manifests and runtime captures;
- execution capsules;
- persisted runtime state and evidence;
- provider capabilities and user-install ownership.

CSS and browser UI contracts are not applicable. CLI interaction behavior is
documented in `interaction-design.md`.

## Required Tests

- schema validation and forward-version rejection;
- Boundary Guard discovery, typed coverage, variants, captures and mutation;
- deterministic routing, persistence, locking, digest invalidation and evidence;
- CLI and MCP registration/invocation;
- Claude Code and Codex setup/init behavior;
- ownership-aware postinstall/update/backup/migration;
- doctrine-ledger traceability;
- full existing regression suite.

## Acceptance Criteria

- AC-1: Versioned schemas define policy, boundary, capsule, state and evidence.
- AC-2: Changed API operations cannot pass with zero discovered or checked work.
- AC-3: Captured request/response bodies are validated against declared variants.
- AC-4: Runtime routing is deterministic, fail-safe and explainable.
- AC-5: Runtime state is atomically persisted, locked, digest-bound and resumable.
- AC-6: Claude Code and Codex use provider adapters over one canonical runtime.
- AC-7: npm user-level upgrades preserve customized assets and create backups.
- AC-8: Existing contracts, archives and active changes are never auto-rewritten.
- AC-9: Stable subagent engineering rules have traceable doctrine destinations.
- AC-10: Strict stays authoritative until separately approved parity promotion.

## Required Review

- contract reviewer: boundary shape and vacuous-green protection;
- QA reviewer: negative/mutation coverage and regression evidence;
- compatibility reviewer: installed asset ownership, backup and rollback;
- maintainer: human-owned acceptance oracle and any future default promotion.

## Clarifications

- This increment implements a shadow-capable foundation, not the final default
  switch or deletion of legacy ceremony.
- Codex project guidance uses `AGENTS.md`; global Codex skills install under
  `$HOME/.agents/skills`. Claude Code remains fully supported.
- Consumer migration is dry-run first and does not rewrite active/history data.

## Context Scope

Allowed implementation surfaces are documented in `context-manifest.md` and
include runtime, boundary, schemas, commands, MCP, provider adapters, doctrine,
templates, packaging, tests and architecture/migration documentation.
