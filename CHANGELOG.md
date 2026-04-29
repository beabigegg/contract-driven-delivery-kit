# Changelog

## [1.12.0] - 2026-04-29

### Added
- `cdd-kit doctor --json` for CI and machine-readable repository health checks.
- `cdd-kit upgrade --migrate-changes [--enable-context-governance]` to combine repo-level upgrade work with legacy change migration.
- `cdd-kit context request`, `cdd-kit context reject`, and `cdd-kit context list [--json]` for a fuller context expansion workflow.

### Changed
- Default contract templates now include deterministic `summary`, `owner`, and `surface` metadata so fresh repos do not start with avoidable `contracts-index` warnings.
- `cdd-kit context-scan` now excludes `contracts/CHANGELOG.md` from the contracts index.
- Shared provider inference is now reused by `update`, `doctor`, and `upgrade`.
- Migration messaging now refers to the current cdd-kit format instead of pinning docs to one release number.

### Docs
- README now includes production rollout guidance for old repos, with separate migration paths for completed specs and in-progress specs.
- Release checklist now covers `doctor --json`, `upgrade --migrate-changes`, and post-upgrade context governance decisions.

## [1.11.0] - 2026-04-28

### Added
- Context Governance v1 for new changes: `context-manifest.md`, `files-read` audit expectations, default forbidden paths, and legacy-vs-new gate behavior.
- Provider adapter scaffold for Claude Code and Codex: `init --provider claude|codex|both`, provider-aware `update`, and `.cdd/model-policy.json`.
- `cdd-kit context-scan`: deterministic `specs/context/project-map.md` and `specs/context/contracts-index.md` indexes for lower-token classification.
- `cdd-kit doctor`: repo health checks for missing config, provider guidance, stale context indexes, and contract summary gaps.
- `cdd-kit upgrade`: dry-run-first repo-level upgrade command that adds missing cdd-kit files without overwriting existing project guidance or contracts.
- `cdd-kit context approve <change-id> <request-id>`: approves pending expansion requests and records approved paths in the manifest.
- Atomic change dependencies with `cdd-kit new --depends-on` and gate blocking until upstream changes complete or archive.
- `/cdd-new`, `/cdd-resume`, and `/cdd-close` prompt hardening for manifest-scoped reads, hot/warm/cold data handling, and context index usage.

### Changed
- `cdd-kit migrate` can add legacy or context-governed manifests and opt old changes into `context-governance: v1`.
- README now describes provider-neutral usage, context governance, upgrade flow, and context expansion approval.

### Notes
- Context Governance audits and discourages unauthorized reads. It is not a runtime sandbox and still depends on agent-log evidence plus gate review.

## [1.10.0] - 2026-04-27

### Added
- `cdd-kit gate --strict`: pending `[ ]` tasks are errors in strict mode; pre-commit hook now uses `--strict` by default. Section-7 archive tasks (7.1, 7.2) are exempt.
- `cdd-kit gate`: artifact pointer validation in strict mode. Each path listed under `- artifacts:` in agent logs is verified to exist on disk.
- `cdd-kit gate`: tier-based agent-log requirements. Tier 0-1 changes must have `e2e-resilience-engineer`, `monkey-test-engineer`, and `stress-soak-engineer` logs; Tier 0-3 must have `contract-reviewer` and `qa-reviewer`.
- `cdd-kit gate`: differentiated minimum char counts per artifact (change-classification and test-plan >= 200, ci-gates >= 150, others >= 100).
- `cdd-kit gate`: scoped validate call to `--contracts --env --ci --versions`.
- `cdd-kit abandon <change-id> --reason <text>`: marks a change as abandoned in `tasks.md` and records it in `specs/archive/INDEX.md`.
- `cdd-kit archive <change-id>`: moves a completed change from `specs/changes/` to `specs/archive/<year>/`.
- `/cdd-close` skill synthesizes `archive.md` from `agent-log/` and `qa-report.md` before archiving, then invokes `contract-reviewer` for durable promotion diffs.
- `/cdd-resume` resumes an in-progress change across sessions by reading `tasks.md` and `agent-log/` to determine the next pending agent.
- `change-classifier` now outputs `## Inferred Acceptance Criteria` and `## Tasks Not Applicable`.
- All agents require `CURRENT_CHANGE_ID: <id>` in every prompt.
- `cdd-new` injects `CURRENT_CHANGE_ID` into every agent call, auto-marks N/A tasks with `[-]`, and passes acceptance criteria to `test-strategist`.
- `cdd-kit migrate <change-id> | --all [--dry-run]`: upgrades existing change directories from pre-v1.11 format. Adds YAML frontmatter plus `[x]/[-]/[ ]` legend to `tasks.md`; converts old `**Tier:** Tier N` to `## Tier\n- N`.

### Fixed
- Tier detection regex tightened to avoid matching unfilled classifier templates.
- Agent read-scope placeholder `<current-change-id>` replaced with runtime `CURRENT_CHANGE_ID` injection.
- `archive.md` removed from `/cdd-new` opt-in surface because it is synthesized at close time.

## [1.0.1] - 2026-04-20

### Fixed
- CLI binary renamed from `cdd` to `cdd-kit` for npm uniqueness.
- Corrected bin path format for npm 11.x compatibility.

## [1.0.0] - 2026-04-20

### Added
- Initial release of the contract-driven-delivery CLI (`cdd-kit`).
- Commands: `init`, `new`, `gate`, `validate`, `detect-stack`.
- Tier-based change classification, contract scaffolding, and agent-log validation.
