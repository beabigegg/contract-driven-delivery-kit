# Changelog

## [1.11.0] — 2026-04-27

### Added
- `cdd-kit gate --strict`: pending `[ ]` tasks are errors in strict mode; pre-commit hook now uses `--strict` by default. Section-7 archive tasks (7.1, 7.2) are exempt.
- `cdd-kit gate`: artifact pointer validation in strict mode — each path listed under `- artifacts:` in agent-logs is verified to exist on disk.
- `cdd-kit gate`: tier-based agent-log requirements — Tier 0-1 changes must have `e2e-resilience-engineer`, `monkey-test-engineer`, and `stress-soak-engineer` logs; Tier 0-3 must have `contract-reviewer` and `qa-reviewer`.
- `cdd-kit gate`: differentiated minimum char counts per artifact (change-classification and test-plan ≥ 200, ci-gates ≥ 150, others ≥ 100).
- `cdd-kit gate`: scoped validate call to `--contracts --env --ci --versions` (was bare `validate`).
- `cdd-kit abandon <change-id> --reason <text>`: marks a change as abandoned in `tasks.md` and records it in `specs/archive/INDEX.md`. Directory is preserved for git history.
- `cdd-kit archive <change-id>`: moves a completed change from `specs/changes/` to `specs/archive/<year>/`. Supports cross-device moves (EXDEV fallback). Warns on gate-blocked or pending tasks.
- `/cdd-close` skill: Step 2.5 synthesises `archive.md` from `agent-log/` and `qa-report.md` before archiving; Step 3 invokes `contract-reviewer` to propose promotion diffs.
- `/cdd-resume` skill: resumes an in-progress change across sessions by reading `tasks.md` and `agent-log/` to determine the next pending agent.
- `change-classifier` agent: now outputs `## Inferred Acceptance Criteria` (AC-1/AC-2/AC-3 stubs) and `## Tasks Not Applicable` for auto-marking.
- All agents: require `CURRENT_CHANGE_ID: <id>` header in every prompt; ask caller if not provided.
- `cdd-new` skill: injects `CURRENT_CHANGE_ID` into every agent call, auto-marks N/A tasks with `[-]` from classifier output, and passes AC list to test-strategist.

### Added (migration)
- `cdd-kit migrate <change-id> | --all [--dry-run]`: upgrades existing change directories from pre-v1.11 format. Adds YAML frontmatter + `[x]/[-]/[ ]` legend to `tasks.md`; converts old `**Tier:** Tier N` to `## Tier\n- N` in `change-classification.md` so tier-based gate checks activate. Run after upgrading if you have mid-flight changes.

### Fixed
- Tier detection regex tightened to `/^## Tier\s*\n\s*-\s*(\d)\s*$/m` — prevents matching unfilled classifier template (`- 0 / 1 / 2 / 3 / 4 / 5`).
- Agent read-scope placeholder `<current-change-id>` replaced with runtime `CURRENT_CHANGE_ID` injection pattern.
- `archive.md` removed from `/cdd-new` opt-in surface (it is synthesised at close time, not classification time).

## [1.10.0] — 2026-04-25

### Added
- `cdd-kit list`: lists all changes in `specs/changes/` with their status and pending task count.
- Agent-log format standardised to Markdown with `- key: value` notation (gate regex requires `- status:` with dash prefix).
- `[-]` N/A notation standardised in `tasks.md`; gate accepts both `[x]` and `[-]` as complete.
- `specs/archive/` directory structure for closed changes.

## [1.0.1] — 2026-04-20

### Fixed
- CLI binary renamed from `cdd` to `cdd-kit` for npm uniqueness.
- Corrected bin path format for npm 11.x compatibility.

## [1.0.0] — 2026-04-20

### Added
- Initial release of the contract-driven-delivery CLI (`cdd-kit`).
- Commands: `init`, `new`, `gate`, `validate`, `detect-stack`.
- Tier-based change classification, contract scaffolding, and agent-log validation.
