# Change Request

## Original Request

Implement the Acceptance Oracle mechanism specified in ADR 0010
(`docs/adr/0010-acceptance-oracle.md`).

Add a first-class, human-owned artifact — `acceptance.yml` — per change, holding
business-language `input → expected` cases plus never-break invariant `rules`,
and a hard `cdd-kit gate` check (`enforceAcceptanceOracle`) that requires the
implementation to pass those cases against the real system, with the author's
expected values locked against agent tampering via four mechanisms:

1. **Hash-lock** — the gate records a checksum of the human region
   (`cases[].input/expect`, `rules`); an agent altering an expected value makes
   the hash diverge and the gate fails "acceptance oracle modified after
   authoring — human must re-confirm."
2. **Agent-write block** — a `pre-tool-use-acceptance-write.sh` PreToolUse hook
   (modeled on `pre-tool-use-contract-write.sh`) blocks agent Edit/Write to
   `acceptance.yml`; advisory by default, `CDD_ACCEPTANCE_WRITE_STRICT=1` hard-
   blocks; armed via `install-agent-hooks --acceptance-write`.
3. **Mock-of-SUT ban** — the gate scans each acceptance driver for mocking of
   the change's own system-under-test (resolved from the code-map) and fails.
4. **Executed-and-passed evidence** — acceptance runs through the ADR 0005
   evidence harness as a new `acceptance` phase; passing is a recorded bounded
   run, not a self-report.

Supporting pieces: `src/schemas/acceptance.schema.ts`, non-placeholder detection
(reuse existing `meaningfulChars`/placeholder logic), template + `migrate` /
`refresh` / `upgrade` backfill (a migrated change fails the new gate until the
author supplies real cases), and version + content-digest stamping for installed
agents/skills/hooks/templates so `doctor` can prove a complete, current
re-scaffold.

## Business / User Goal

Close the intent gap that no mechanical check can close on its own (the oracle
problem): the non-coding author supplies a few real examples/rules the AI did
not write, and the kit enforces the implementation against them on the real
system. This makes "AI did the correct thing" mechanically checkable instead of
prompt-/self-report-dependent.

## Non-goals

- Z3/SMT contract & business-rule consistency (follow-up ADR).
- Mutation testing as an evidence phase (follow-up ADR).
- Property-based generation from contracts (follow-up ADR).
- Promoting the `cdd-new` skill into a deterministic Workflow script (follow-up).
- Splitting monolithic contract files into per-entry fragments.

## Constraints

- **Portable enforcement, harness automation (ADR 0010 §5):** all guarantees
  live in the portable layer (CLI validators, `gate`, settings.json hooks) so
  they hold for Claude, Codex, and plain CI alike. Never let a correctness
  guarantee depend only on a Claude Code harness primitive (Workflow/Loop/
  Worktree).
- Reuse existing patterns: the contract-write hook shape, the ADR 0005 evidence
  harness, gate placeholder detection, and the code-map for SUT resolution.
- The acceptance opt-out (pure refactor) must be strictly harder than ADR 0005's
  test-evidence opt-out — reference-parity or an agent-forbidden, review-
  countersigned reason only.
- Cross-platform (Windows PowerShell + POSIX sh); UTF-8 safe.

## Known Context

- ADR 0010 (this change's spec), ADR 0004 §6 (contract-write chokepoint hook),
  ADR 0005 (bounded test evidence), ADR 0007 (data-shape conformance).
- Existing hook: `hooks/pre-tool-use-contract-write.sh`; installer
  `src/commands/install-agent-hooks.ts`.
- Gate composition: `src/commands/gate.ts` +
  `src/commands/gate-evidence.ts` / `gate-artifacts.ts` / `gate-agents.ts`.
- Upgrade/migration surface: `src/commands/upgrade.ts`, `refresh`, `migrate.ts`.
- Assets are generated from `.claude/` via `build.js`; templates live in
  `specs/templates/`.

## Open Questions

- Exact serialization for the hash-locked human region (stable key ordering).
- How the acceptance driver loader is emitted per stack (Python first vs. JS).
- Digest-stamping storage location (`.cdd/` manifest vs. per-asset frontmatter).

## Requested Delivery Date / Priority

High priority — this is the kit's central correctness mechanism. No hard date;
correctness and portability over speed.
