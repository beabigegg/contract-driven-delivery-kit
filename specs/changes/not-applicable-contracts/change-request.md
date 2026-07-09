# Change Request

## Original Request

Let `cdd-kit validate` distinguish an **empty-because-unfilled** contract from an
**empty-because-the-surface-does-not-exist** one.

Add a way to mark a contract family (api, css, business, data, env, ci) as
**not-applicable** for a repo/project — via contract frontmatter (e.g.
`applicability: not-applicable` with a required reason) and/or a `.cdd/` config —
so the per-contract semantic validators SKIP a surface the project genuinely
does not have (e.g. a CLI has no HTTP API / CSS / business-domain), while still
HARD-FAILING a surface that exists but was left as an unfilled template stub.

This fixes the false positive surfaced by dogfooding the acceptance-oracle
change: the kit's own repo-level `cdd-kit gate` is red because its
`contracts/{api,css,business}` are empty template stubs for surfaces a CLI does
not have.

## Business / User Goal

Make `cdd-kit gate` trustworthy for CLI/backend-only/library projects (not just
full-stack web apps). Today an adopter with no HTTP API / no CSS / no
business-domain layer cannot get a green gate without either inventing fake
contract content (dishonest) or disabling validation wholesale (unsafe). A
declared, reasoned `not-applicable` is the honest middle: the surface is
explicitly absent, recorded, and skipped — while a genuinely unfilled contract
still fails loudly.

## Non-goals

- Do NOT weaken the unfilled-stub detection: an empty/placeholder contract that
  is NOT marked not-applicable must still hard-fail (this is the whole point).
- Not a per-endpoint/per-row applicability system — applicability is per contract
  FAMILY (file), not per clause.
- No change to the acceptance-oracle mechanism (ADR 0010) shipped in 3.8.0.

## Constraints

- Marking a surface not-applicable MUST require a non-empty reason (mirrors the
  tier-floor-override discipline: a bare skip with no justification is not
  allowed; the reason is the audit trail).
- Keep the existing behavior for filled contracts unchanged.
- Cross-platform (PowerShell + POSIX); the Python semantic validators
  (`skills/contract-driven-delivery/scripts/validate_*.py`) and the TS
  `validate.ts` orchestrator must agree on how applicability is read.
- Prefer contract frontmatter as the source of truth (co-located with the
  contract, versioned, human-editable) over a separate `.cdd/` file, unless
  there is a strong reason otherwise (a design decision to confirm).

## Known Context

- Surfaced by the acceptance-oracle dogfood (commit e55dc40); recorded in
  qa-report.md / regression-report.md of that change.
- Validators: `src/commands/validate.ts` orchestrates the Python semantic
  validators under `.claude/skills/contract-driven-delivery/scripts/`
  (`validate_api_semantic.py`, `validate_css*.py`, business-rules, etc.).
- Contract frontmatter already carries `contract:`, `schema-version:`,
  `last-changed:`, `breaking-change-policy:` — `applicability:` would be a new
  optional field there.
- The kit's own `contracts/{api,css,business}` are the first consumers to mark.

## Open Questions

- Source of truth: contract frontmatter (`applicability: not-applicable` +
  `applicability-reason:`) vs a `.cdd/contract-applicability.json` config vs both.
- Should `doctor` list not-applicable surfaces as informational, and should it
  warn if a not-applicable contract later gains real content (drift)?
- Interaction with `contract set` / version bump policy for a not-applicable file.

## Requested Delivery Date / Priority

Medium. Follow-up to the 3.8.0 acceptance-oracle release; unblocks a fully-green
repo-level `cdd-kit gate` on the kit itself and on CLI/backend-only adopters.
