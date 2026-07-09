# Design: not-applicable-contracts

## Summary
Add a per-family `applicability: not-applicable` frontmatter marker (with a
required `applicability-reason`) so a contract for a surface a project genuinely
lacks (a CLI has no HTTP API / CSS / business-domain) is SKIPPED by the semantic
validators, while a genuinely unfilled template stub still hard-fails. The
marker lives in contract frontmatter as the single source of truth; the Python
validators are the single pass/fail authority (they self-skip via one shared
reader); the TS side reads the same marker only for read-only reporting. The
change moves the gate strictly in the safe direction — a previously-failing
EMPTY contract can pass, and only when explicitly, reasonedly marked — and never
lets an UNMARKED stub pass.

## Affected Components
| component | file path(s) | nature of change |
|---|---|---|
| Applicability reader (Python, shared) | `.claude/skills/contract-driven-delivery/scripts/applicability.py` (new) | Reads a contract's frontmatter; returns `applicable` / `not-applicable(+reason)` / `invalid`; enforces required-reason + allowed values. Single definition all validators call. |
| Presence + empty-stub validator | `.claude/skills/contract-driven-delivery/scripts/validate_contracts.py` | Per-contract loop consults the reader: `invalid`→hard-fail (AC-3); `not-applicable`→skip stub check + print info note (AC-1); else stub check unchanged (AC-2). Primary fix for api/css/business. |
| API semantic validator | `.claude/skills/contract-driven-delivery/scripts/validate_api_semantic.py` | Self-skip (info note, exit 0) when the api contract is `not-applicable`; else unchanged. Defensive same call in `validate_api_conformance.py` / `validate_response_shape.py` (already opt-in-skip, so low risk). |
| Contract frontmatter parser (TS) | `src/contracts/parser.ts` | Add a read-only helper projecting `applicability` + `applicability-reason` off the existing `stripFrontmatter` result — for reporting only, no pass/fail authority. |
| Doctor | `src/commands/doctor.ts` | AC-4: list not-applicable surfaces + reasons (informational); AC-7: WARN on drift (a marked surface whose body now looks filled). |
| Validate orchestrator | `src/commands/validate.ts` | No pass/fail logic change; Python info/skip notes flow through the existing `stdio: 'inherit'`. |
| CI/CD gate contract | `contracts/ci/ci-gate-contract.md` | Record the gate-semantics: marked+reason→skip-with-info; unmarked stub→hard-fail; marker requires a reason; drift is advisory this change. |
| Kit's own empty contracts | `contracts/{api,css,business}/*.md` | Data edit: add `applicability: not-applicable` + honest reason (AC-5). Filled `ci`/`env` contracts untouched. |

## Key Decisions

- **Frontmatter is the single source of truth** (confirm change-request lean).
  Co-located with the contract, versioned in the same commit, human-editable,
  and already the home of `contract`/`schema-version`/`last-changed`. Both
  readers already open the file and skip frontmatter (`stripFrontmatter` in
  parser.ts; `strip_frontmatter` in each Python validator), so the field costs
  no new file I/O.
  → Rejected `.cdd/contract-applicability.json`: a second, detached source of
  truth that drifts from the contract it describes and needs its own sync
  discipline. → Rejected "both": two sources = guaranteed divergence, the exact
  AC-6 failure mode.

- **Python is the single pass/fail authority; validators self-skip (option b).**
  The empty-stub check (AC-2) and the natural per-surface enforcement both live
  in the Python layer, and `validate_contracts.py` checks ALL contracts in one
  invocation — so an orchestration-layer skip in `validate.ts` (option a) is too
  coarse (it can only drop a whole script, not one surface inside it) and would
  force TS to reimplement frontmatter-reading + required-reason logic, creating a
  second rule that can diverge from Python.
  → Rejected option (a) orchestration-skip: coarse + duplicated rule.
  → Rejected option (c) both-decide: two authorities = the AC-6 divergence risk.
  A single shared `applicability.py` (mirroring parser.ts's "one deterministic
  reader" role) is imported by every validator; sibling import works cross-platform
  because Python puts the run script's dir on `sys.path[0]`. TS reads the marker
  only to DISPLAY (doctor AC-4), which cannot cause a pass/fail divergence.

- **Fail-closed invariant, spelled out** (enforced in `applicability.py`):
  no `applicability` field or `applicability: applicable` → validated as today,
  empty stub still hard-fails (AC-2); `not-applicable` + non-empty reason → skip
  + info note (AC-1); `not-applicable` with missing/empty reason → HARD ERROR
  (AC-3, mirrors tier-floor-override required-reason discipline); any unrecognized
  `applicability` value → hard error (a typo toward "not-applicable" fails safe
  because it does not match the literal). A marker never suppresses anything but
  the stub/semantic check for its own family, and never for a body that has real
  content.
  → Rejected treating unknown values as "applicable-by-default": ambiguous; a
  hard error is cheap and unmistakable.

- **Drift (AC-7) reuses the existing `meaningful_chars` metric.** A
  `not-applicable` contract whose body exceeds the placeholder threshold (i.e.
  now "looks filled") is surfaced by doctor/validate as a WARNING (the mark may
  be stale), never a hard fail this change. Escalation to hard error deferred —
  recorded as follow-up in the CI contract.
  → Rejected a bespoke drift heuristic: the stub-threshold already defines
  "empty vs filled"; reuse keeps one definition.

- **No `src/schemas/` entry (CER-002 answer: not needed).** Contract frontmatter
  is not JSON-schema-validated today (fields are regex-extracted in parser.ts);
  adding schema machinery for two fields is over-engineering. Validate the two
  fields INLINE in `applicability.py` (allowed values + required reason),
  mirroring how `tier-floor.ts` validates its policy shape inline. Document the
  grammar in the CI gate contract instead.
  → Rejected a frontmatter schema: introduces new validation machinery for a
  two-field rule; disproportionate.

## Migration / Rollback
Additive and backward-compatible: contracts with no `applicability` field behave
exactly as today, so no adopter is forced to migrate and no re-init is required.
The kit's own `contracts/{api,css,business}` gain the marker in the same change
(data edit) so `cdd-kit gate` on the kit goes green; the filled `ci`/`env`
contracts are untouched. Not-applicable contracts KEEP their full frontmatter
(`contract`, `schema-version`), so presence and `validate_contract_versions.py`
checks still pass. Rollback is a pure revert: delete `applicability.py`, restore
the validator branches, and strip the marker lines from the three contracts — no
data migration, no sidecar state.

## Open Risks
- **Second TS-side enforcement point (must verify).** `gate-contracts.ts` /
  `gate.ts` are outside the spec-architect read packet. If either performs its
  own TS-side contract presence/empty check independent of the Python validators,
  it is a second authority that could FAIL a surface Python skips (AC-6
  divergence). Planner/backend-engineer must confirm gate delegates the stub
  decision to the Python layer (preferred) or applies the same
  `applicability`-reader rule. Flagged for maintainer awareness.
- **Data-shape contract status (confirm).** `validate_contracts.py` REQUIRED list
  includes `contracts/data/data-shape-contract.md`. The change-request names only
  api/css/business as empty. If the kit's data contract is also an empty stub it
  must be marked too for AC-5 (fully-green kit gate); if it is filled or absent,
  no action. Maintainer to confirm which.
- **ADR written:** `docs/adr/0011-not-applicable-contract-marker.md` — this gate
  semantics + single-authority decision must not be silently reversed.
