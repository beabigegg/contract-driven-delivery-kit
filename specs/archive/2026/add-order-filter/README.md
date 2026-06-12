# Worked example: `add-order-filter` (dogfooding reference)

This is a **complete, archived change** kept as a reference for what a finished
contract-driven change looks like end to end — so a human or an agent resuming
the workflow has a concrete "this is what success looks like" template, not just
empty scaffolds.

It is **illustrative**, not a real shipped change: the `src/` / `tests/` paths it
mentions (a Python orders API) describe an imaginary host project, the same one
the kit's templates and tests use as their running example. Nothing here was
executed in this repo; the run summaries and timestamps are representative of
what `cdd-kit test run` records.

## The change in one line

Add an optional `status` query-parameter filter to `GET /api/orders` so callers
can list orders by lifecycle state — a **tier 2** change (a new API request field
and a data-shape addition, no auth/payments/migration surface).

## What to look at, and why

| File | What it demonstrates |
|---|---|
| `change-request.md` | The user's own words — the ground truth the tier floor and the classifier read. |
| `change-classification.md` | A filled classification: change types, **Tier 2**, required agents, and 5 acceptance criteria (`AC-1`…`AC-5`) that drive the test plan. |
| `context-manifest.md` | A real, narrowly-scoped **Allowed Paths** list (not `src/`-wide) plus per-agent work packets. |
| `implementation-plan.md` | TDD-ordered steps: contract first, failing tests, then implementation. |
| `test-plan.md` | The **Acceptance Criteria → Test** mapping the test-strategist produces. |
| `ci-gates.md` | Which gates run where (local / required / informational). |
| `tasks.yml` | The finished task list: `status: completed`, every task `done` or `skipped` with a reason, `archive-tasks` for the two archive steps. |
| `test-evidence.yml` | The machine-readable proof the required phases (collect, targeted, changed-area, contract) ran and **passed** — what `cdd-kit gate` validates, not assistant claims. |
| `test-runs/*/summary.json` | The durable per-run summaries `test-evidence.yml` points at. |
| `agent-log/*.yml` | One record per agent that touched the change (classifier, backend, test-strategist, contract-reviewer, qa-reviewer) — the routine review evidence the kit prefers over report markdown. |
| `archive.md` | The closing record: final behavior, contracts touched, and the **lessons promoted to standards**. |

## How a finished change differs from a scaffold

- `tasks.yml` is `status: completed`; no task is left `pending` (each is `done`
  or `skipped` with a `note`).
- `test-evidence.yml` exists with `final-status: passed` and real run pointers.
- Every required agent has an `agent-log/*.yml` entry with `status: approved`
  (or `complete`) and the artifacts it produced.
- `archive.md` captures durable learnings so the next similar change is cheaper.

To start your own change, run `cdd-kit new <id>` (or `/cdd-new "<describe it>"`)
and fill the same artifacts; `cdd-kit gate <id>` checks them.
