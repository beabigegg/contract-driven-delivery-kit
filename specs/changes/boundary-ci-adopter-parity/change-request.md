# Change Request

## Original Request

Source: three GitHub production issues filed 2026-07-14 from real Claude-driven
production use, with maintainer (CODEX) investigation verdicts independently
re-verified against source before this change.

Fix the adopter-facing CI path so it enforces Boundary Guard identically to the
integrated `cdd-kit gate`. All three defects are rooted in the v3.12–3.13.1
agent-native Boundary Guard rearchitecture (PR #59), where the shipped
standalone command + workflow template diverged from the internal gate path.

- **#63 / #65** — standalone `cdd-kit boundary check`
  (`src/commands/boundary.ts` `boundaryCheck`) ignores `.cdd/policy.yml`
  `shadow_mode` and exits 1 on any `failed` status, while `cdd-kit gate`
  (`src/commands/gate.ts`) downgrades error findings to advisory `[shadow]`
  warnings when `shadow_mode` is true (the shipped default). A fresh adopter's
  first API-affecting PR is therefore blocked by the workflow's standalone
  Boundary Guard step even though project policy says the rollout is still in
  shadow mode. Make `boundary check` honor `shadow_mode` by default (findings
  still printed, shadow → exit 0) with an explicit `--enforce` override,
  sharing one enforcement-semantics source with gate. #65 is a duplicate of #63
  (same code path; adds the `cdd-kit refresh` first-onboarding reproduction).

- **#62** — `src/boundary/guard.ts` resolves `CDD_BASE_SHA`/`GITHUB_BASE_SHA`
  for `changedFiles()`, but the changed-contract snapshot path uses only
  `options.base` (`contractAtRevision`). When the API contract itself changes
  and only `CDD_BASE_SHA` is set (exactly what the shipped workflow does — it
  passes `CDD_BASE_SHA` env but not `--base`), `previous` becomes `null` and
  every operation is selected (202 vs 8). Resolve the effective base once and
  use it for both `changedFiles` and `contractAtRevision`; add
  `--base "$CDD_BASE_SHA"` to the workflow template.

- **#61** — the adopter workflow template
  `github-workflows/contract-driven-gates.yml` "Determine changed spec
  directories" step uses a chained `[ -n "$id" ] && [ -d ... ] && printf` loop
  that exits 1 under `bash -eo pipefail` on an archive-only push (every
  `/cdd-close`), while the repo's own `.github/workflows/contract-driven-gates.yml`
  already uses the safe structured-`if` form. Port the structured-`if` form
  into the shipped template (edit source `github-workflows/`; `build.js:116`
  regenerates `assets/`).

## Business / User Goal

## Non-goals

## Constraints

## Known Context

## Open Questions

## Requested Delivery Date / Priority
