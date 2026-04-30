# Changelog

## [2.0.1] - 2026-04-30

### Fixed

- Clarified the agent ownership model in the public docs so read-only reviewers
  and write-capable implementation agents have explicit, non-conflicting file
  ownership rules.
- Aligned bundled prompts so read-only agents emit an `Agent Log` YAML block
  for main Claude to persist, while write-capable agents continue writing their
  own artifacts and `agent-log/*.yml` files.
- Synchronized package version metadata for the post-`2.0.0` publish path.

## [2.0.0] - 2026-04-30

### BREAKING: structured YAML for tasks and agent-log

- `tasks.md` is replaced by `tasks.yml`. The previous markdown-frontmatter +
  checklist hybrid is gone. The new file is a single YAML document validated
  by `src/schemas/tasks.schema.ts` (JSON Schema, draft-07). Task items use
  `status: pending | done | skipped` instead of `[ ] / [x] / [-]` checkboxes.
- `agent-log/<agent>.md` is replaced by `agent-log/<agent>.yml`, validated by
  `src/schemas/agent-log.schema.ts`. The "field: value" prose convention is
  gone; agents now emit a structured YAML record with `change-id`, `agent`,
  `timestamp` (ISO 8601), `status`, `files-read`, `artifacts`, and
  `next-action`.
- `cdd-kit gate` parses both files with `js-yaml` and validates them with
  `ajv`. Errors and warnings now reference YAML paths rather than markdown
  line patterns.
- All bundled templates, skill prompts, agent prompts, and Python helper
  scripts have been updated to point at the new file names.

### Upgrading

Run `cdd-kit migrate <change-id>` (or `cdd-kit migrate --all`) to convert
existing changes:

- `tasks.md` is parsed (frontmatter + markdown checklist) and rewritten as
  `tasks.yml`. The legacy `tasks.md` is deleted.
- Every `agent-log/*.md` is parsed and rewritten as `agent-log/*.yml`. The
  legacy markdown logs are deleted.
- A backup of the change directory is written to
  `.cdd/migrate-backup/<stamp>/<change-id>/` before any rewrite.

### Notes

This is a breaking release; pin to `^1.16.0` if you still depend on the old
markdown formats.

## [1.16.0] - 2026-04-30

### Visual narration: per-agent stage badges

- `/cdd-new` skill now instructs main Claude to prefix every agent
  invocation announcement with a colored emoji badge tagging the role and
  stage. Non-engineer users can scan the chat stream and see "we're at
  review now, not implementation" without reading prompts.
- Six color buckets:
  - 🟣 decision (classifier, architect — opus-class)
  - 🔵 implementation (backend, frontend, ci-cd, sonnet-class)
  - 🟡 test planning (test-strategist)
  - 🟠 heavy testing (e2e, monkey, stress — Tier 0–1 only; orange = scope warning)
  - 🟢 review (read-only verdicts)
  - ⚫ audits & scans (background, read-only)
- `/cdd-resume` references the same badge table so resumed flows look
  consistent.

### Notes

This is the only PR in the v1.13 follow-up series that changes the visible
chat narration. Prompt-only; no code or test changes.

## [1.15.0] - 2026-04-30

### Workflow safety net (defaults that protect non-engineers)

- `cdd-kit new` auto-runs `context-scan` when `specs/context/*.md` indexes are
  missing or stale (B5 hash-based check). Avoids classifier wasting a round
  on outdated paths. New `--skip-scan` for advanced users.
- `cdd-kit gate` now lints `tasks.md` frontmatter:
  - Requires `change-id` and `status`.
  - Validates `status` against known set (`in-progress`, `completed`,
    `gate-blocked`, `abandoned`, `needs-review`, `complete`, `done`).
  - Warns on unknown keys with did-you-mean suggestions (e.g. `Tier:` →
    `did you mean tier?`). Catches the typo class that previously caused
    silent enforcement skips.
- `cdd-kit gate` now detects `depends-on` cycles via DFS and reports the
  full cycle path (e.g. `feat-a → feat-b → feat-c → feat-a`).
- `cdd-kit doctor --fix`: auto-resolves the safe subset of warnings
  - regenerates stale or missing `specs/context/*.md` indexes
  - populates empty `model-policy.json` roles with defaults
  - leaves invasive fixes (`.cdd/*` missing → suggests `cdd-kit upgrade`)
    for the user to confirm
- `cdd-kit gate`: artifact-pointer existence check now runs **by default**
  (previously `--strict`-only). Use `--lax` to skip for legacy repos with
  unfixed agent logs.

### Tests

- 11 new tests across `gate.test.ts` (frontmatter lint, DAG cycle, default
  pointer check), `new.test.ts` (auto-scan), `doctor.test.ts` (--fix).
- Updated `gate.test.ts` test 13b — its premise inverted by PR-3 #6.
- Updated `writeValidChangeArtifacts` helper to include required frontmatter.

## [1.14.0] - 2026-04-30

### Agent efficiency for non-engineer users

- `/cdd-new` Step 0: request-quality pre-lint. Refuses to run when the user's
  request is missing affected-surface, desired-behavior, or success-criterion.
  Avoids one full classifier round-trip on ambiguous requests.
- `change-classifier`: atomic-split detection. Mega-requests crossing 2+
  change-types or 3+ surfaces now return an `## Atomic Split Proposal` table
  with suggested `cdd-kit new --depends-on` commands instead of a single
  Tier 0/1 monolith. Estimated 40-60% token saving on multi-feature requests.
- `references/agent-log-protocol.md`: every agent must self-validate its log
  block before sending its response. Prevents the round-trip where gate
  catches a malformed log and forces a full agent re-run.
- `/cdd-new` Step 4 fix-back: structured error-to-agent routing table. Each
  gate error class now has a defined re-invocation owner and a templated
  prompt prefix that includes the verbatim gate error. No more "blind retry".

### Notes

This release is prompt-only (no code changes in `src/`). Improvements are
qualitative for the AI agent flow, not exposed as new CLI flags.

## [1.13.0] - 2026-04-29

### Token-budget reductions
- Shared `references/agent-log-protocol.md` — extracted the duplicated agent-log
  format block out of all 16 agent prompts. Total agent-prompt size dropped
  from 1675 → 1344 lines (≈20% smaller). One source of truth, no drift.
- `/cdd-new` skill no longer inlines the 5 change-template bodies; `cdd-kit
  new` writes them from disk. Skill went from 483 → ~340 lines (≈30%).
- Tier 5 fast-path for docs/prompts/config-only changes — classifier now
  short-circuits the full agent flow when no source/tests/contracts are
  touched; bounds doc-only token cost to 2 read-only reviews.
- `context-manifest.md` template no longer duplicates the forbidden-paths list
  that `.cdd/context-policy.json` already carries.
- `cdd-kit context-scan` now caps per-directory entries to 50 and supports
  `--surface <path>` to scope the project map to a sub-tree.

### Stability hardening
- Tier source moved to `tasks.md` frontmatter `tier: <0-5>`. The legacy
  `## Tier\n- N` and `**Tier:** Tier N` formats remain as fallback-only;
  bold-only legacy format produces a migration warning instead of silently
  skipping tier-specific agent enforcement.
- Section-7 archive exemption is no longer hard-coded `7\.[12]`; reads from
  `tasks.md` frontmatter `archive-tasks: ["7.1", "7.2"]` (default preserved).
- `cdd-kit migrate` is now atomic: per-session backup at
  `.cdd/migrate-backup/<timestamp>/`, two-phase tmp-write + rename, restore
  hint on failure. New `--no-backup` opt-out.
- `cdd-kit migrate` now backfills `tier:` and `archive-tasks:` into legacy
  `tasks.md` frontmatter automatically.
- `cdd-kit doctor` freshness check is now content-hash based, not mtime.
  `git clone` no longer triggers spurious staleness warnings.
- `cdd-kit context approve|reject --all-pending` resolves every pending
  Context Expansion Request in one command.
- `cdd-kit gate` now reconciles agent self-reported `files-read:` against the
  runtime hook log at `.cdd/runtime/<change-id>-files-read.jsonl`. Undeclared
  reads warn (or fail under `--strict`).
- `hooks/post-tool-use-files-read.sh` — Claude Code PostToolUse hook scaffold
  that records actual Read/Grep/Glob targets for the gate to verify.
- `cdd-kit gate` now invokes `validate` in-process instead of via
  `spawnSync(process.execPath, [process.argv[1], ...])`. No more `argv[1]`
  indirection or extra Node startup.
- `.cdd/model-policy.json` ships with real role-to-model defaults (no longer
  empty `{}`). `cdd-kit doctor` warns when an installed agent's `model:`
  frontmatter drifts from policy. `init`/`upgrade` preserve any custom
  `roles` overrides instead of clobbering them.

### Skill updates
- `/cdd-new` now lints classifier output before writing files (`## Tier`,
  `## Required Agents`, `## Inferred Acceptance Criteria` must be filled).
- `/cdd-new` writes the classifier's tier into `tasks.md` frontmatter as the
  authoritative source.

### Tests
- 19 new tests covering B1–B7 + A5 + B3. 39 gate tests, 15 migrate tests, 9
  context tests, 7 doctor tests all pass.

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
