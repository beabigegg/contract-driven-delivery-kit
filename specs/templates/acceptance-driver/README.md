# Acceptance driver convention (ADR 0010)

This directory ships the two read-only loaders `cdd-kit gate` expects an
acceptance driver to import: `acceptance_loader.py` (pytest) and
`acceptance.loader.ts` (vitest). They parse a change's
`specs/changes/<id>/acceptance.yml` and expose `id -> {input, expect}` so a
driver reads the answer key from the artifact instead of hardcoding it.

## Where drivers live

`cdd-kit gate` scans acceptance drivers for AC-4 (mock-of-SUT +
hardcoded-expect) under two conventional directories, checked from the repo
root:

- `tests/acceptance/` -- pytest drivers (`*.py`)
- `test/acceptance/` -- vitest drivers (`*.ts`, `*.tsx`, `*.js`, `*.jsx`)

Copy the matching loader file into whichever directory your stack uses (both
if the change touches both stacks), next to your driver file(s).

## Writing a driver

1. Import the loader and read the case by id -- never hardcode `expect`.
2. Call the REAL system under test with `case["input"]` / `case.input` --
   never mock, patch, or spy the module(s) this change touches.
3. Assert the real result equals `case["expect"]` / `case.expect`.
4. Faking an external I/O boundary (network client, system clock) is fine --
   only the SUT itself is off-limits.
5. Record the run through the ADR 0005 evidence harness:
   `cdd-kit test run <change-id> --phase acceptance`.

## What the gate checks (AC-4)

- **Mock-of-SUT**: `cdd-kit gate` resolves the change's SUT files from its
  `implementation-plan.md` File-Level Plan table, cross-referenced against
  `.cdd/code-map.yml`, and fails if a driver mocks/patches/spies one of them
  (`unittest.mock.patch(...)`, `mocker.patch(...)`, `monkeypatch.setattr(...)`,
  `vi.mock(...)`, `vi.spyOn(...)`). An unresolved SUT never false-fails.
- **Hardcoded expect**: the gate scans each driver for a literal occurrence of
  any case's `expect` value and fails if found -- read it from the loader
  instead.

See `docs/adr/0010-acceptance-oracle.md` and `specs/changes/*/design.md` for
the full mechanism.
