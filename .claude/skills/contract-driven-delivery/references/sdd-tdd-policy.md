# SDD + TDD Policy

## SDD policy

Specifications are the source of intent. Code serves the specification, not the other way around.

A good spec must include:

- user/business intent
- in-scope and out-of-scope boundaries
- acceptance criteria
- edge cases
- non-functional requirements
- compatibility constraints
- observable success signals

For existing systems, never write a future spec without documenting current behavior when the change modifies existing behavior.

## TDD policy

Tests define expected behavior before or alongside implementation.

Preferred order:

1. write or update spec
2. write or update contracts
3. write test plan
4. write failing tests when feasible
5. implement minimal production code
6. run the bounded test ladder (`cdd-kit test run`) and the local gate
7. run CI/CD gate
8. archive learning

## Test-first exceptions

Test-first can be softened for exploratory spikes, but spikes must not be merged as production work until tests, contracts, and CI gates exist.

## Production-reality TDD

For dashboards, reports, long-running jobs, auto-refresh, and data-heavy views, TDD includes:

- malformed input
- wrong columns and wrong types
- empty data
- large data
- partial data
- slow network
- aborted requests
- double submit
- repeated clicks
- back/forward navigation
- cache stale/miss behavior
- long-run memory and pool stability

## Bounded test execution ladder

Run tests through the bounded ladder, not broad runner calls. `cdd-kit test
select` and `cdd-kit test run` choose bounded commands, apply safe defaults, cap
assistant-visible output (full logs stay on disk), write durable artifacts under
`specs/changes/<change-id>/test-runs/<run-id>/`, and record results in
`specs/changes/<change-id>/test-evidence.yml`.

| phase | required | what it proves | command source |
|---|---|---|---|
| collect | always | selected tests are discoverable | `cdd-kit test select` |
| targeted | always | acceptance criteria pass with the narrowest mapped tests | `cdd-kit test select` |
| changed-area | always | tests near changed source paths pass | `cdd-kit test select` |
| contract | if contracts/API/data/env/CI affected | contract validators pass | `cdd-kit validate` |
| quality | if configured | lint/typecheck/build pass | `ci-gates.md` |
| full | final/CI | bounded full-suite smoke passes | `cdd-kit test run --phase full` |

`collect`, `targeted`, and `changed-area` are the always-required floor for an
implementation change. `contract`, `quality`, and `full` are required only when
their trigger applies.

### Shared execution rule (all implementation agents)

Do not start with a broad test command such as `pytest`, `npm test`, or a full
suite. Run the bounded ladder so the work is recorded as evidence:

1. `cdd-kit test select <change-id> --json` returns a bounded command for each
   phase. It lists `contract`/`quality` only when their trigger is present, but
   it always lists a `full` smoke -- presence in the output does not make `full`
   required (see step 3).
2. Run each phase, passing the command `select` returned. `cdd-kit test run`
   currently requires `--command` (selection is not auto-piped into the runner
   yet). If `select` returns more than one entry for a phase, combine them into a
   single command (e.g. pass every node id / file to one pytest call): the runner
   stores one run per phase and a later run replaces the earlier one, so running
   them separately drops coverage or overwrites a failure.

   ```bash
   cdd-kit test run <change-id> --phase collect --command "<collect command>" \
     --required-phases collect,targeted,changed-area[,contract][,quality]
   cdd-kit test run <change-id> --phase targeted --command "<targeted command>"
   cdd-kit test run <change-id> --phase changed-area --command "<changed-area command>"
   # contract / quality only when select lists them, each with its --command
   ```

3. Run `full` only as a final bounded smoke or CI gate when this change's policy
   calls for it -- not just because `select` lists it (it always does). Declare
   `full` in `--required-phases` only when it is a genuine required gate for the
   change; otherwise an unrelated full-suite failure would block on a phase the
   change never needed.

`--required-phases` only takes effect on the first run -- the one that creates
`test-evidence.yml`. The always-required floor (`collect`, `targeted`,
`changed-area`) is merged in automatically; list any conditional phase that must
block this change (`contract`, `quality`, and `full` only when it is a required
gate) there too, or the gate will not require it. If a phase fails, inspect only
the first failure. Fix it if it belongs to this change; otherwise block the gate.
Do not broaden before the failing phase is green.

### No known-failure waivers

A required test failure blocks the gate. It cannot be recorded as known,
pre-existing, waived, allowed, or ignored in `test-evidence.yml`, `tasks.yml`, or
any other artifact. The evidence schema rejects `known-failures`,
`pre-existing-failures`, `allowed-failures`, `waived-failures`, and
`ignored-failures`. To clear a failure: fix it, expand this change's scope to
cover the fix, or open a separate tracked change.

### Evidence and the gate

`test-evidence.yml` is generated by `cdd-kit test run`, never hand-authored. The
gate validates that evidence -- required phases passed, no waiver fields, and
each run references its own `summary.json` under this change's `test-runs/` --
not the assistant's claims. A change with no testable code surface may opt out by
setting `test-evidence-not-applicable: "<reason>"` in `tasks.yml` frontmatter;
the reason is recorded as an audit warning, not silently skipped.
