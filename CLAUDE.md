# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`cdd-kit` (published to npm as `contract-driven-delivery`) is a CLI + MCP toolkit
that constrains AI coding agents to a contracts-first, gated delivery workflow —
for solo devs and teams who delegate implementation to agents but need contracts,
tests, CI gates, and human-confirmation enforced mechanically rather than trusted.
This repository is the tool itself and dogfoods its own workflow.

## Dev commands

- Install: `npm ci`
- Build: `npm run build` (esbuild bundle → `dist/`; also regenerates `assets/` from
  `.claude/` — never hand-edit `assets/`, edit `.claude/` then rebuild)
- Test: `npm test` (vitest; `pretest` builds first) · watch: `npm run test:watch`
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Guards: `npm run check:mojibake`, `npm run check:lockfile` (no `lint` script exists)
- Publish gate: `prepublishOnly` = lockfile + mojibake + build + typecheck + vitest
- **Run the CLI from THIS build, not the global binary:** `node dist/cli/index.js <cmd>`.
  The global `cdd-kit` on PATH can lag the source and false-fail (gate against your own
  build — the same reason CI and the pre-commit hook use `node dist/cli/index.js`).
- Windows note: hook/acceptance tests need `sh` (Git Bash provides it on PATH); the
  Bash tool takes POSIX syntax, the PowerShell tool takes PowerShell syntax.

## Architecture

- **Entry:** `bin/cdd.js` → `dist/cli/index.js`, built from `src/cli/` by `build.js` (esbuild).
- `src/commands/` — 54 CLI subcommands (`gate`, `validate`, `design`, `accept`, `archive`,
  `context`, `graph`, `index`, `migrate`, `doctor`, `install-agent-hooks`, `test run`, …).
- `src/code-map/` + `src/code-graph/` — the AST-based project-exploration layer (Babel +
  Python `ast`), surfaced as `.cdd/code-map.yml` / `.cdd/code-graph.index.json`.
- `src/mcp/` — the MCP server (`cdd-kit mcp`) exposing graph/index/context tools.
- `src/utils/` — shared logic (`markdown-section`, `design-hash`, `design-provenance`,
  `mock-of-sut-scan`, …); `src/schemas/` — JSON schemas; `src/contracts/` — contract
  validators (some delegate to Python readers, e.g. `applicability.py`).
- `hooks/` — PreToolUse write-block scripts guarding the design/acceptance hash-locks.
- `contracts/` — the kit's OWN contracts (dogfooding); `docs/adr/` — ADRs. The npm package
  ships only `dist`, `bin`, `assets`, `docs`, `CHANGELOG.md` (see `package.json` `files`).

---

This repository follows the Contract-Driven Delivery workflow.

- `contracts/` is the single source of truth for what the system should do.
- `tests/` proves the contracts hold.
- `specs/changes/<id>/` records why decisions were made (passive archive — read only when investigating history).
- To start any non-trivial change, use `/cdd-new <description>` in Claude Code.

## CDD Kit Commands

| command | when to use |
|---|---|
| `/cdd-new <description>` | start a new tracked change (scaffolds all artifacts, runs full agent flow) |
| `/cdd-resume <id>` | continue an in-progress change after a session break |
| `/cdd-close <id>` | close a completed change: promote learnings, archive |
| `cdd-kit list` | show all active changes and their status |
| `cdd-kit gate <id>` | verify a change is gate-ready (run before PR) |
| `cdd-kit gate <id> --strict` | full gate with pending-task enforcement (pre-commit default) |
| `cdd-kit context check <id> --path <paths...>` | preflight expected agent reads against `context-manifest.md` before invoking the agent |
| `cdd-kit archive <id>` | physically move a completed change to `specs/archive/<year>/` |
| `cdd-kit abandon <id> --reason <text>` | mark a change as abandoned (`--reason` mandatory, non-empty); writes `status: abandoned` + reason into `tasks.yml`, creating it if absent; `validate` then skips that directory's required-artifact check. Preserves the directory for git history |
| `cdd-kit migrate <id> \| --all` | upgrade pre-v1.11 change directories to new format (frontmatter + tier format) |
| `cdd-kit validate` | run all contract validators |
| `cdd-kit detect-stack` | detect the project tech stack |

Run `cdd-kit detect-stack` to verify the detected tech stack.

## Recommended MCP Tools

Configure MCP-capable agents to use the cdd-kit server:

```bash
claude mcp add --scope user cdd-kit -- cdd-kit mcp
claude mcp list
```

For Claude Code, use `claude mcp add` so the server is written to
`~/.claude.json`. Do not rely on manually adding `mcpServers` to
`~/.claude/settings.json`; that is a Claude Code UI settings format and is not
the MCP registry read by the CLI.

Prefer these MCP tools before reading source files: `cdd_graph_context`,
`cdd_graph_query`, `cdd_graph_impact`, `cdd_index_query`, and
`cdd_index_impact`. They use `.cdd/code-map.yml` and
`.cdd/code-graph.index.json` as the project exploration layer. If MCP is not
available, use the equivalent CLI commands: `cdd-kit graph ...` and
`cdd-kit index ...`.

Pass `withSource: true` (MCP) or `--with-source` (CLI) on `query` to get the
matched symbol's code inline. The query then replaces a follow-up `Read` instead
of preceding it — use a plain `Read` only for ranges the query did not return
(e.g. a range flagged as source-budget truncated).

## API Conformance

If `.cdd/conformance.json` has `"enabled": true`, `cdd-kit validate --contracts`
(and `cdd-kit gate`) mechanically check real backend routes and frontend call
sites against `contracts/api/api-contract.md`. Do not add, rename, or call an
endpoint without updating the contract in the same change, or the gate will fail
on the drift. See `docs/api-conformance.md`.

## Context Governance

For context-governed changes, read `specs/changes/<change-id>/context-manifest.md` before using file-reading or broad search tools.

- Read only paths allowed by the manifest or approved expansions.
- Before invoking an agent with known concrete reads, run
  `cdd-kit context check <change-id> --path <paths...>`. If it fails and the
  reads are legitimate, expand `Allowed Paths` or approve a Context Expansion
  Request before the agent reads the files.
- If more context is needed, stop and write a Context Expansion Request in the manifest (`cdd-kit context request`).
- Optional agent-log notes are defined in
  `~/.claude/skills/contract-driven-delivery/references/agent-log-protocol.md`.
  Read that once; do not paraphrase it elsewhere.

## Solution Minimalism (reuse-first)

Before writing implementation code, stop at the first rung that applies — reuse
over rewrite: (1) does this need to exist? (2) already in this codebase? (3) does
the stdlib / framework / a native platform feature do it? (4) does an installed
dependency do it? (5) one line? (6) only then, the minimum that works. Don't add a
dependency when stdlib or a native feature covers it; don't add an abstraction for
a single caller. **Scope: implementation/solution code only** — never minimize
tests, contracts, validation, error handling, security, or accessibility; those
stay complete. Lazy about the solution, never about reading or safety.

## CDD Operational Notes

- After each agent returns, tick the related `tasks.yml` items immediately,
  and only then move to the next agent.
- Do not start backend/frontend/test implementation agents until
  `implementation-plan.md` is ready; implementation agents should follow that
  plan and report `blocked` instead of inferring missing scope from chat
  history.
- Pre-existing test failures may be excluded from the current gate only when
  `qa-report.md` records the failing test, baseline evidence, why it is outside
  scope, owner, and follow-up.

### Promoted Learnings

This file is loaded into every session, so size here is a recurring token cost.
`/cdd-close` consolidates promoted lessons **inside the markers below only**.
Each entry is **one terse line: a rule + a pointer to where the detail lives**
(`contracts/…` for product/behavior, `docs/…` for workflow detail) — never an
inline playbook. New lessons **merge into or replace** an existing entry instead
of appending; obsolete or contract-superseded entries are removed. Anything you
write **outside** the markers is yours and is never edited or evicted.

<!-- cdd-kit:learnings:start -->
- MySQL ENUM contraction / any `ALGORITHM=COPY` DDL = high risk on large tables (row-count + online-migration/maintenance-window + rollback required) — see `contracts/data/` migration rules.
- Acceptance-oracle `expect` leaves must trace only to human `## Confirmed` decisions or a contract, never to observed implementation behavior (a copied-from-code oracle only asserts the code does what the code does) — round-3 external review caught 3 implementation-derived leaves self-review missed — see `docs/adr/0010-acceptance-oracle.md`, `contracts/ci/ci-gate-contract.md` AC-2.
- A green gate/oracle test proves nothing until a mutation turns it red (self-review can rubber-stamp a wrong mutation as a pass); in gate tests assert the stream (`log.warn`→stdout, `log.error`→stderr), not the exit code — see `contracts/ci/ci-gate-contract.md` "Pass/fail shape".
<!-- cdd-kit:learnings:end -->
