# ADR 0011: Not-applicable contract marker

## Status
proposed

## Context
`cdd-kit validate`/`gate` cannot tell an EMPTY-because-unfilled contract from an
EMPTY-because-the-surface-does-not-exist one. `validate_contracts.py` hard-fails
any required contract whose `meaningful_chars` fall below the placeholder
threshold, and `validate_api_semantic.py` hard-fails an api contract with no
endpoint table. A CLI / backend-only / library project therefore cannot get a
green gate without either inventing fake contract content (dishonest) or
disabling validation wholesale (unsafe). This is a real false positive: the
kit's own `contracts/{api,css,business}` are empty stubs for surfaces a CLI does
not have, so the kit's own repo-level gate is red. The fix must not weaken
unfilled-stub detection — an UNMARKED empty contract must still fail loudly.

## Decision
Introduce a per-contract-family `applicability: not-applicable` frontmatter
marker with a REQUIRED non-empty `applicability-reason`.

1. **Frontmatter is the single source of truth** — co-located, versioned,
   human-editable; both the TS parser and the Python validators already read
   frontmatter. No `.cdd/` config, no dual source.
2. **The Python validators are the single pass/fail authority.** A shared
   `applicability.py` reader classifies each contract as
   `applicable` / `not-applicable(+reason)` / `invalid`; every validator imports
   it and self-skips its own family when not-applicable. `validate.ts` makes no
   applicability pass/fail decision; the TS side reads the marker only to DISPLAY
   (doctor). One rule, one authority — no place for TS and Python to disagree.
3. **Fail-closed rules:** no field / `applicable` → validated as today (stub
   still fails); `not-applicable` + reason → skip that family + info note;
   `not-applicable` without a reason → hard error; unknown value → hard error.
4. Validation is INLINE in `applicability.py` (allowed values + required reason);
   no frontmatter JSON-schema is added.
5. Drift (a not-applicable contract that later looks filled) is an advisory
   WARNING this change, keyed on the existing stub threshold; hard-error
   escalation deferred.

## Consequences
- The gate becomes trustworthy for non-full-stack projects: a declared, reasoned
  absence is the honest middle between faking content and disabling checks.
- A marker is never a silent bypass: it requires a reason (audit trail) and only
  ever suppresses the check for its own family; an unmarked stub still hard-fails.
- The reason string is a durable, reviewable record of WHY a surface is absent.
- Reversal risk this ADR guards against: moving the applicability decision into
  `validate.ts`, or adding a second `.cdd/` source, would recreate the TS↔Python
  divergence (a surface one layer skips and the other fails) the single-authority
  design exists to prevent.
- Follow-up: `gate-contracts.ts` must delegate the stub decision to the Python
  layer or apply the same reader; drift may later escalate from WARNING to error.
