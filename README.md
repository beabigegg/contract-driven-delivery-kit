# Contract-Driven Delivery Kit

**cdd-kit** is a contract-driven delivery kit for AI coding agents. It started with Claude Code skills and now keeps the core workflow provider-neutral: contracts-first, test-first, spec-first. Every change goes through classification, contract review, TDD, implementation, and gate verification, with deterministic context indexes to keep agent work targeted.

Designed for solo developers and small teams building brownfield production systems (dashboards, APIs, workflow tools, data apps), especially when non-engineers or product owners want AI to do the implementation while they stay in the spec-author and reviewer seat.

**Context Governance v1** adds a manifest-driven planning layer for AI agents. New changes include `context-manifest.md`; agents should use `cdd-kit index query` and `cdd-kit index impact` before broad source reads. `cdd-kit gate` focuses on delivery quality, not post-run read paperwork.

---

## Install

```bash
npm install -g contract-driven-delivery
```

Requires **Node.js 18+** and **Python 3.8+** (for contract validators).

---

## Quick Start

```bash
# 1. Install globally
npm install -g contract-driven-delivery

# 2. Go to your repo
cd your-repo

# 3. Deploy the kit
cdd-kit init

# 4. Open Claude Code in your repo and tell Claude:
# "Use /cdd-new to set up the project. My system is a <brief description>."
```

---

## How to Direct Claude Code

> All workflows are started by typing a **natural language instruction** to Claude Code in your IDE or terminal. The `/cdd-*` prefixed commands are Claude Code skills ??not shell commands.

### Starting a new project (first time)

After `cdd-kit init`, open Claude Code and say:

```
Scan this repo and create a project profile. Tell me what contracts are
missing and what the minimum setup should be before we start any feature work.
```

Claude will:
1. Run `cdd-kit detect-stack` to detect the tech stack
2. Read your existing code structure
3. Create `specs/project-profile.md`
4. Identify gaps in `contracts/` and recommend filling order

Then fill your contracts in this order (Claude can help draft them):

| Contract | File | What it captures |
|---|---|---|
| Env | `contracts/env/env-contract.md` | Every env var, secret flag, default, validation |
| API | `contracts/api/api-contract.md` | Every endpoint: method, path, auth, schemas, errors |
| Data | `contracts/data/data-shape-contract.md` | Schemas, types, nullability, bad-data behavior |
| CSS/UI | `contracts/css/css-contract.md` | Design tokens, component states, forbidden raw values |
| Business | `contracts/business/business-rules.md` | Rules, edge cases, decision tables |
| CI/CD | `contracts/ci/ci-gate-contract.md` | Gate tiers, promotion policy, rollback policy |

---

### Starting a new task / feature / bug fix

Type this in Claude Code:

```
/cdd-new add JWT authentication to the API
```

or

```
/cdd-new redesign the user dashboard to show real-time metrics
```

or

```
/cdd-new fix the order export timeout when result set exceeds 10 000 rows
```

**What happens:**
1. Claude generates a `change-id` (e.g. `add-jwt-auth`) and scaffolds `specs/changes/add-jwt-auth/`
2. If the request is ambiguous, Claude asks back for affected surface, desired behavior, and success criterion before spending a classifier round-trip
3. The `change-classifier` agent (Opus) reads the request, classifies risk and tier, decides which agents are needed
4. If the request is too broad, the classifier can return an atomic split proposal instead of forcing one Tier 0/1 monolith
5. For Tier 0-1 work, Claude's narration uses stage badges so users can tell whether the flow is deciding, implementing, testing, or reviewing
6. Agents run in order: contracts ??test plan ??`spec-architect` writes `design.md` if required ??CI/CD gates ??implementation plan ??backend engineer ??frontend engineer ??QA
7. `implementation-planner` reads the confirmed artifacts and writes `implementation-plan.md`, the concise execution packet implementation agents follow. It does not create `design.md`; missing required design routes back to `spec-architect`.
8. Implementation agents write code/tests from that plan and optional concise handoff notes
9. `cdd-kit gate <change-id>` runs automatically to confirm all artifacts are complete
10. Claude reports a summary and the suggested git commit

### Workflow Lanes: Avoiding Ceremony for Small Fixes

CDD is a governance workflow, not a rule that every edit must become a full proposal. Use the tracked `/cdd-new` flow when a change can affect product behavior, contracts, data shape, API behavior, env/deploy rules, CI/CD, security, permissions, cross-module architecture, or release risk.

Use a lightweight maintenance lane for small corrections where the intent is already obvious:

| Lane | Examples | Required record |
|---|---|---|
| maintenance / micro-change | typo fixes, comment updates, README cleanup, formatting, lint-only fixes, tiny local test repair | normal commit message and test output if applicable |
| tracked CDD change | behavior changes, contract updates, API/data/env/security/CI changes, cross-module refactors, high-risk bug fixes | `specs/changes/<id>/`, `implementation-plan.md`, `tasks.yml`, `context-manifest.md`, and `cdd-kit gate` |

Do not add hard pre-commit rules that block every `src/`, `tests/`, or `contracts/` edit unless your team explicitly wants that policy. The default kit favors low-friction traceability: make risky changes reviewable, but let obvious maintenance edits stay small.

Machine-readable metadata such as future `change.yml` / `trace.yml` should follow the same rule: generated from existing artifacts to reduce token use and markdown parsing, not introduced as extra forms. See `docs/machine-readable-change-design.md` for the proposed shape.

### Agent Ownership Model

CDD uses two agent classes on purpose:

- `change-classifier`, `contract-reviewer`, `qa-reviewer`, `visual-reviewer`, `dependency-security-reviewer`, `ui-ux-reviewer`, `repo-context-scanner`, and `spec-drift-auditor` are read-only. They return analysis, verdicts, or optional handoff notes; main Claude writes the corresponding files.
- `bug-fix-engineer` is an implementation agent for symptom-driven defects. It converts user-visible reports into graph/index-guided hypotheses, reproduces the issue where feasible, applies the smallest fix, and adds regression evidence.
- `implementation-planner`, `backend-engineer`, `frontend-engineer`, `e2e-resilience-engineer`, `monkey-test-engineer`, `stress-soak-engineer`, `ci-cd-gatekeeper`, `test-strategist`, and `spec-architect` are write-capable. They write their own owned artifacts directly: for example, `spec-architect` owns `design.md`, while `implementation-planner` owns `implementation-plan.md`.

This split is deliberate:

- Review and audit agents stay read-only so they do not silently change the thing they are supposed to assess.
- Implementation and planning agents write directly so large artifacts and code edits do not have to be relayed back through the main orchestrator, which reduces token waste and preserves clearer ownership.
- `tasks.yml` remains owned by main Claude so task state changes stay centralized even when multiple agents contribute files.

### Artifact Minimization

CDD keeps the authoritative artifact set small. Routine reviewer findings should
not become new markdown files.

| artifact class | files | rule |
|---|---|---|
| Core decision and planning | `change-classification.md`, `context-manifest.md`, `test-plan.md`, `ci-gates.md`, `implementation-plan.md`, `tasks.yml` | required for implementation changes |
| Conditional design | `design.md` | only when `spec-architect` is required |
| Durable evidence reports | `qa-report.md`, `visual-review-report.md`, `regression-report.md`, `monkey-test-report.md`, `stress-soak-report.md` | only for blocking findings, approved-with-risk, excluded pre-existing failures, visual evidence bundles, or high-risk load/soak results |
| Lightweight traces | `agent-log/*.yml` | optional concise pointers for routine evidence and resume/debugging |

Later artifacts should reference earlier artifacts by path, section, acceptance
criterion, decision id, or gate name. They should not copy full test strategy,
CI policy, design rationale, or contract prose. This keeps token use bounded
and prevents multiple markdown files from becoming conflicting sources of
truth.

**You stay in control by:**
- Reviewing the `change-classification.md` before implementation starts
- Checking the `test-plan.md` to confirm the right test families are planned
- Checking `implementation-plan.md` when you want to review the exact execution packet before code changes
- Reading the final QA summary for the release-readiness verdict

---

### Updating architecture or contracts

```
/cdd-new update the API contract to add pagination to all list endpoints
```

```
/cdd-new migrate the database from MySQL to PostgreSQL
```

```
/cdd-new add Redis caching layer to the reporting queries
```

The change-classifier will detect that these are architectural or contract-level changes, assign a higher risk tier (0??), and automatically require:
- Architecture review (`spec-architect` agent)
- E2E, resilience, stress, and monkey tests
- Updated contracts before any implementation begins

---

### Resuming an interrupted task

If a session was cut off or you need to return to an in-progress change:

```
/cdd-resume add-jwt-auth
```

or, if you're unsure of the change-id:

```
What changes are currently in progress? (cdd-kit list)
```

**What happens:**
1. Claude reads `tasks.yml` and existing change artifacts to determine what was completed
2. Reports the current state (which agents ran, which tasks are pending)
3. Asks if you want to continue from the next pending agent
4. Resumes the full agent flow from where it stopped, with no duplication

> If you're upgrading from an older version and your change was created before v2.0.0, Claude will automatically run `cdd-kit migrate <change-id>` to upgrade the format before resuming.

---

### Closing a completed change

After the PR is merged:

```
/cdd-close add-jwt-auth
```

**What happens:**
1. Runs `cdd-kit gate` to confirm the change still passes
2. Synthesizes `archive.md` ??a permanent record of what changed, what tests were added, and what lessons were found
3. Promotes only evidence-backed durable learnings to `contracts/` or project guidance (`CLAUDE.md`/`CODEX.md`). General agents record evidence and findings only; durable learning promotion happens during `/cdd-close` Step 3.
4. Runs `cdd-kit archive add-jwt-auth` ??moves the change from `specs/changes/` to `specs/archive/2026/`
5. Reduces the active context that future Claude sessions need to load

---

### Abandoning a change

If you decide not to proceed with a change:

```
/cdd-close add-jwt-auth
```

Then when Claude asks for confirmation, say "abandon it." Claude will run:

```bash
cdd-kit abandon add-jwt-auth --reason "decided to use a third-party auth service instead"
```

The directory stays on disk for git history, but `cdd-kit list` will show it as `abandoned`.

---

### Checking the status of all active changes

Type to Claude:

```
What changes are currently in progress?
```

Claude will run `cdd-kit list`, which shows:

```
Active changes:
  add-jwt-auth       [in-progress]  (3 pending)
  fix-export-timeout [gate-blocked]
  redesign-dashboard [in-progress]  (12 pending)
```

---

## CLI Reference

These are shell commands ??not Claude Code skills. Run them directly in the terminal, or Claude Code will run them on your behalf.

### `cdd-kit init`

Installs agents and skill into `~/.claude` and scaffolds project files.

```bash
cdd-kit init                  # global + local (recommended)
cdd-kit init --global-only    # only install into ~/.claude
cdd-kit init --local-only     # only scaffold project files
cdd-kit init --provider codex # scaffold Codex-oriented project guidance
cdd-kit init --provider both  # scaffold Claude Code + Codex guidance
cdd-kit init --force          # overwrite existing project files
```

Creates: `contracts/`, `specs/templates/`, provider guidance files (`CLAUDE.md`, `AGENTS.md`, and/or `CODEX.md`), `hooks/`

`.cdd/model-policy.json` stores role-to-model **classes** (`opus`, `sonnet`, `haiku`) instead of provider release IDs such as `claude-opus-4-7`. This keeps the policy stable across Claude and Codex adapters; provider-specific tooling can map the class to the concrete model available in that environment.

Recommended: register the cdd-kit MCP server with Claude Code after init:

```bash
claude mcp add --scope user cdd-kit -- cdd-kit mcp
claude mcp list
```

This writes the server to `~/.claude.json` and exposes graph/code-map tools
directly to the agent (`cdd_graph_context`, `cdd_graph_query`,
`cdd_graph_impact`, `cdd_index_query`, `cdd_index_impact`). Do not rely on
manually adding `mcpServers` to `~/.claude/settings.json`; that file is a Claude
Code UI settings format and is not the MCP registry read by the CLI.

---

### `cdd-kit update`

Updates provider assets to the latest installed version. By default, `update` reads `.cdd/model-policy.json` and updates only the matching provider adapter. It does not overwrite project guidance files such as `CLAUDE.md`, `AGENTS.md`, or `CODEX.md`.

```bash
cdd-kit update
cdd-kit update --yes          # apply without confirmation
cdd-kit update --provider codex
cdd-kit update --provider both
```

Codex currently has no global assets to update, so Codex-only projects report that they are already up to date. Run `cdd-kit init --local-only --provider codex` if a project is missing `CODEX.md`.

---

### After Updating the npm Package

Updating npm only replaces the `cdd-kit` CLI package. Existing repos and
global Claude Code assets keep their previously copied agents, skills,
templates, hooks, and `.cdd/model-policy.json` until you sync them.

Recommended one-command sync after `npm update -g contract-driven-delivery`:

```bash
cdd-kit refresh          # dry-run preview
cdd-kit refresh --yes    # apply agents, skills, templates, model policy, hook, code-map
cdd-kit migrate --all    # add new per-change scaffolds such as implementation-plan.md
cdd-kit doctor --strict
```

After syncing, register MCP-capable agents with
`claude mcp add --scope user cdd-kit -- cdd-kit mcp`. This is the recommended
way for agents to use the regenerated code graph and code-map; shell commands
remain the fallback.

What gets updated:

| command | updates | preserves |
|---|---|---|
| `cdd-kit update --yes` | `~/.claude/agents/` and `~/.claude/skills/` for Claude provider projects | project files |
| `cdd-kit upgrade --yes` | missing repo files only: contracts, templates, `.cdd/`, guidance, workflows | existing files and project guidance |
| `cdd-kit refresh --yes` | global agents/skills, missing project files, kit-shipped templates with backup, model policy roles, hooks, `.cdd/code-map.yml` | user source, contracts content, active change content |
| `cdd-kit migrate --all` | existing `specs/changes/*` metadata and new required scaffolds | implementation code and completed archive history |

For releases 2.0.18 and newer, run `cdd-kit refresh --yes` so the
`implementation-planner` agent, updated `/cdd-new` and `/cdd-resume` skills,
fresh `specs/templates/`, and `.cdd/model-policy.json` role binding are all in
place. Then run `cdd-kit migrate --all` so existing active change directories
receive `implementation-plan.md`; fill required `design.md` with
`spec-architect` before resuming the planner or implementation agents.

If you do not want template overwrites, run the narrower path:

```bash
cdd-kit update --yes
cdd-kit upgrade --yes
cdd-kit migrate --all
cdd-kit doctor --strict
```

---

### `cdd-kit doctor`

Inspects repo-level cdd-kit health. Default mode is read-only; `--fix` applies only the safe auto-remediations.

```bash
cdd-kit doctor
cdd-kit doctor --strict
cdd-kit doctor --fix
cdd-kit doctor --json
cdd-kit doctor --provider codex
```

Checks for missing `.cdd/` policy files, provider guidance (`CLAUDE.md`, `AGENTS.md`, `CODEX.md`), context indexes, stale `specs/context/*` outputs, and contract summary metadata gaps. `--strict` treats warnings as errors. `--json` emits a machine-readable report for CI or wrapper scripts. `--fix` currently auto-runs `context-scan` for stale or missing indexes and backfills empty `.cdd/model-policy.json` role bindings, but deliberately does not run invasive repo upgrades for you.

---

### `cdd-kit upgrade`

Adds missing repo-level cdd-kit files after upgrading the npm package. It preserves existing contracts and guidance files; default mode is a dry run.

```bash
cdd-kit upgrade
cdd-kit upgrade --yes
cdd-kit upgrade --yes --migrate-changes
cdd-kit upgrade --yes --migrate-changes --enable-context-governance
cdd-kit upgrade --provider codex --yes
cdd-kit upgrade --provider both --yes
```

Use this for old repos that already have `contracts/` or `specs/` but are missing new assets such as `.cdd/context-policy.json`, `.cdd/model-policy.json`, `CODEX.md`, or newer templates. Add `--migrate-changes` if you also want to upgrade existing `specs/changes/<change-id>/` directories in the same run.

---

### `cdd-kit refresh`

Complete sync after upgrading the npm package. Default mode is a dry run.

```bash
cdd-kit refresh
cdd-kit refresh --yes
cdd-kit refresh --yes --provider both
cdd-kit refresh --yes --no-templates
```

`refresh --yes` runs the practical upgrade sequence:

1. `cdd-kit update --yes` for global Claude agents and skills.
2. `cdd-kit upgrade --yes` for missing project files.
3. Force-refreshes kit-shipped `specs/templates/`, `tests/templates/`,
   `ci-templates/`, and `.github/workflows/` with backup under
   `.cdd/.refresh-backup/`.
4. Re-installs the code-map hook if the project marker exists.
5. Resyncs `.cdd/model-policy.json` roles from installed agent frontmatter.
6. Regenerates `.cdd/code-map.yml`.

After `refresh --yes`, register the MCP server:

```bash
claude mcp add --scope user cdd-kit -- cdd-kit mcp
```

The MCP tools are the recommended graph/code-map exploration interface for AI
agents. Claude Code CLI stores user-scope MCP servers in `~/.claude.json`; a
manual `mcpServers` entry in `~/.claude/settings.json` is not sufficient.
`cdd-kit graph ...` and `cdd-kit index ...` remain the fallback when MCP is not
available.

Run `cdd-kit migrate --all` separately when you need existing
`specs/changes/*` directories to gain new required artifacts.

---

### `cdd-kit gate <change-id>`

The single quality gate for a change. Blocks merge if anything is missing or incomplete.

```bash
cdd-kit gate add-jwt-auth
cdd-kit gate add-jwt-auth --strict
```

Checks:
- All required artifacts exist (`change-request.md`, `change-classification.md`, `implementation-plan.md`, `test-plan.md`, `ci-gates.md`, `tasks.yml`; new context-governed changes also require `context-manifest.md`)
- Each artifact has sufficient content and is not a stub.
- `change-classification.md` contains a tier or risk marker.
- Atomic `depends-on` upstream changes are completed or archived before dependent work gates.
- All contract validators pass.

`--strict` additionally:
- Treats any task with `status: pending` (except IDs listed in `archive-tasks`) as an error
- Treats legacy changes missing `context-manifest.md` as errors

Pre-commit hook uses `--strict` by default (installed via `cdd-kit install-hooks`).

```
?? gate passed for change: add-jwt-auth

?? gate failed for change: feat-001
??   change-classification.md: appears to be a stub (< 200 meaningful chars)
??   1 task(s) still pending (mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped)
```

---

### `cdd-kit list`

Lists all active changes in `specs/changes/` with status and pending task count.

```bash
cdd-kit list
```

```
Active changes:
  add-jwt-auth       [in-progress]  (3 pending)
  fix-export-timeout [gate-blocked]
  old-experiment     [abandoned]
```

---

### `cdd-kit archive <change-id>`

Physically moves a completed change from `specs/changes/` to `specs/archive/<year>/`.

```bash
cdd-kit archive add-jwt-auth
# ?? Archived: specs/changes/add-jwt-auth ??specs/archive/2026/add-jwt-auth
# ?? Index updated: specs/archive/INDEX.md
```

Warns (but does not block) if `tasks.yml` has pending items or `status: gate-blocked`. Use after `/cdd-close` ??the skill runs this automatically at the end.

---

### `cdd-kit abandon <change-id>`

Marks a change as abandoned. Updates `tasks.yml` status to `abandoned`, records the reason in `specs/archive/INDEX.md`. The directory stays on disk for git history.

```bash
cdd-kit abandon add-jwt-auth --reason "using Auth0 instead"
# ?? Change add-jwt-auth marked as abandoned.
```

---

### `cdd-kit migrate <change-id> | --all`

Upgrades pre-v2.0.0 change directories to the current format.

```bash
cdd-kit migrate add-jwt-auth        # migrate one change
cdd-kit migrate --all               # migrate all changes in specs/changes/
cdd-kit migrate --all --dry-run     # preview without writing
cdd-kit migrate --all --enable-context-governance
```

What it upgrades:
- `tasks.yml`: converts legacy `tasks.md` checklist/frontmatter into structured YAML task records
- `change-classification.md`: detects old `**Tier:** Tier N` format and appends the new `## Tier\n- N` section so tier-based gate checks activate
- `implementation-plan.md`: adds the execution-plan scaffold required before backend/frontend/test implementation agents continue
- `context-manifest.md`: adds a legacy manifest scaffold by default so old changes can use the same pre-read planning layer
- `--enable-context-governance`: explicitly adds `context-governance: v1` and a context-governed manifest scaffold for pre-read planning

If you choose to emit `agent-log/*.yml`, keep `files-read` optional and concise:

```yaml
files-read:
  - contracts/api/api-contract.md
  - src/server/routes/users.ts
```

Paths should be repo-relative. Do not reconstruct this list after the fact;
use `cdd-kit context check` before invoking agents when read scope matters.

Run this after upgrading from v1.10 or earlier if you have mid-flight changes.

```bash
cdd-kit migrate --all
git add specs/changes/
git commit -m "chore: migrate changes to current cdd-kit format"
```

---

### `cdd-kit context request <change-id> <request-id>`

Records a pending Context Expansion Request in `context-manifest.md`.

```bash
cdd-kit context request add-jwt-auth CER-001 --path src/server/users.ts tests/users.test.ts --reason "paired implementation and regression coverage"
```

Use this when an agent needs more context than its current work packet allows.

---

### `cdd-kit context check <change-id>`

Preflight-checks repo-relative read paths against `context-manifest.md` before
you invoke an agent.

```bash
cdd-kit context check add-todos-ui --path src/components/Sidebar.vue src/stores/todos.js src/views/DashboardView.vue
cdd-kit context check add-ci-gate --path contracts/ci/ci-gate-contract.md .github/workflows/contract-driven-gates.yml
```

The check uses `## Allowed Paths`, `## Approved Expansions`, repo-relative path
rules, and the forbidden baseline in `.cdd/context-policy.json`. If the command
fails and the read is legitimate, update the manifest or record/approve a
Context Expansion Request before the agent reads the file.

---

### `cdd-kit context approve <change-id> <request-id>`

Approves a pending Context Expansion Request in `context-manifest.md` and adds its `requested_paths` to `## Approved Expansions`.

```bash
cdd-kit context approve add-jwt-auth CER-001
cdd-kit context approve add-jwt-auth --all-pending   # bulk approve every pending request
```

This keeps expansion history explicit while avoiding manual manifest editing.

---

### `cdd-kit context reject <change-id> <request-id>`

Rejects a pending Context Expansion Request and records `status: rejected` in the manifest.

```bash
cdd-kit context reject add-jwt-auth CER-001
cdd-kit context reject add-jwt-auth --all-pending   # bulk reject every pending request
```

---

### `cdd-kit context list <change-id>`

Lists all Context Expansion Requests for a change.

```bash
cdd-kit context list add-jwt-auth
cdd-kit context list add-jwt-auth --json
```

---

### `cdd-kit validate`

Runs contract validation scripts.

```bash
cdd-kit validate                # all validators
cdd-kit validate --contracts    # API, CSS, data-shape (+ semantic + conformance checks)
cdd-kit validate --env          # env contract
cdd-kit validate --ci           # CI gate policy
cdd-kit validate --spec         # spec traceability
cdd-kit validate --versions     # contract frontmatter schema versions
```

`--contracts` includes **API conformance**: a code-vs-contract check that parses
real backend routes and frontend call sites and fails on drift from
`contracts/api/api-contract.md` (e.g. the frontend calling an endpoint the
contract never declares). It is off until you enable it in `.cdd/conformance.json`
(`"enabled": true`); `cdd-kit init` scaffolds a disabled config. See
[docs/api-conformance.md](docs/api-conformance.md). This is the mechanical net
for frontend/backend API drift in a workflow where no human reviews the contract
by hand.

---

### `cdd-kit new <name>`

Scaffolds an empty change directory. Normally you use `/cdd-new` (the Claude Code skill) instead, which runs this and then orchestrates all agents. Use `cdd-kit new` only if you want an empty scaffold without agent orchestration.

```bash
cdd-kit new add-user-auth
cdd-kit new add-user-auth --all     # include optional templates too
cdd-kit new add-user-auth --force   # overwrite existing directory
cdd-kit new add-user-api --depends-on add-user-db
cdd-kit new add-user-auth --skip-scan
```

Prefer the default scaffold. `--all` is mainly for template inspection or
manual workflows; `/cdd-new` should create optional markdown only when
classification requires it or review evidence needs durable prose.

By default, `cdd-kit new` auto-runs `cdd-kit context-scan` when `specs/context/` indexes are missing or stale. Use `--skip-scan` only if you intentionally want a bare scaffold without refreshing classifier indexes first.

For larger requests, split the work into atomic changes on the same feature branch and use `--depends-on` to record upstream order. `cdd-kit gate` blocks a dependent change until each upstream change is either archived or has `status: completed` in its `tasks.yml`.

---

### `cdd-kit install-hooks`

Installs a pre-commit Git hook that auto-runs `cdd-kit gate --strict` on any staged change directory.

```bash
cdd-kit install-hooks
# ?? pre-commit hook installed at .git/hooks/pre-commit
```

Idempotent. Preserves existing hook content. Bypass with `--no-verify` is possible but defeats enforcement.

---

### `cdd-kit detect-stack`

Detects the project tech stack from lockfiles and config files.

```bash
cdd-kit detect-stack
# Detected stack: conda
# Polyglot: yes (config will be generated for conda)
```

| Language | Tool | Detection signal |
|---|---|---|
| Python | conda | `environment.yml`, `conda-lock.yml` |
| Python | poetry | `pyproject.toml` with `[tool.poetry]` |
| Python | uv | `pyproject.toml` (no poetry section) |
| Python | pip | `requirements.txt` |
| JS/TS | pnpm | `pnpm-lock.yaml` |
| JS/TS | bun | `bun.lockb` |
| JS/TS | yarn | `yarn.lock` |
| JS/TS | npm | `package.json` (fallback) |
| Go | go | `go.mod` |
| Rust | rust | `Cargo.toml` |

---

### `cdd-kit context-scan`

Builds deterministic, low-token context indexes for classifiers and orchestrators.

```bash
cdd-kit context-scan
cdd-kit context-scan --surface src/server   # scope project-map to a sub-tree (large monorepos)
```

Outputs:
- `specs/context/project-map.md`: ASCII directory tree with schema metadata, visible file/dir counts, and excluded paths from `.cdd/context-policy.json`
- `specs/context/contracts-index.md`: contract inventory table plus deterministic details from YAML frontmatter or `<!-- cdd: ... -->` metadata

Recommended contract metadata:

```yaml
---
contract: api
summary: User API endpoint rules and compatibility policy.
owner: backend-team
surface: user-management
---
```

The classifier should read these two files before proposing `context-manifest.md` allowed paths.

### `cdd-kit code-map`

Scans source files into a deterministic structural index so agents read symbols
and line ranges instead of whole files.

```bash
cdd-kit code-map                          # whole repo -> .cdd/code-map.yml
cdd-kit code-map --check                  # exit 1 if regenerating would change the map
cdd-kit code-map --surface packages/web   # monorepo: scope + auto-name the map
cdd-kit code-map --workers                # parallelize JS/TS/Vue scanning (default off)
```

`--workers [n]` (default off; `n` defaults to CPU count − 1, capped at 16)
parallelizes the synchronous JS/TS/Vue parsing across child processes for large
repos. Output is byte-identical to a single-process run, and any worker failure
falls back to in-process scanning, so it can never make a run worse. Python is
already scanned in its own subprocess.

A JSON sidecar (`.cdd/code-map.<...>.index.json`) is written next to each map and
gitignored automatically; `cdd-kit index` reads it to skip re-parsing the YAML on
large maps, and falls back to the YAML whenever the sidecar is absent or stale.

### `cdd-kit graph`

`cdd-kit graph` is the graph-first query layer. `cdd-kit code-map` also writes
`.cdd/code-graph.index.json`, a native cdd-kit graph of files, symbols, imports,
exports, calls, inheritance, and unresolved references. Graph queries use this
native graph by default. You can still delegate to external CodeGraph explicitly
with `--engine codegraph`.

```bash
cdd-kit graph status
cdd-kit graph query OrderService
cdd-kit graph query OrderService --with-source   # include code inline; no follow-up Read needed
cdd-kit graph context "filter options are empty"
cdd-kit graph impact src/services/orders.ts --depth 2
```

`--with-source` (also on `cdd-kit index query`, and `withSource: true` via MCP)
returns the matched symbol's code inline so the query *replaces* a `Read` rather
than preceding it — making the kit tool strictly cheaper than the built-in
`Read`. `--source-budget <n>` caps total lines returned; truncated ranges are
flagged so you can `Read` only those.

To make graph-first exploration a real chokepoint instead of a prompt
preference, wire the shipped `hooks/pre-tool-use-graph-first.sh` as a
`PreToolUse` hook on `Read` (advisory by default; `CDD_GRAPH_FIRST_STRICT=1`
hard-blocks source `Read`s when a code-map exists).

Use `--engine native` for the built-in graph, `--engine codemap` for the older
code-map-only fallback, `--engine codegraph` to require external CodeGraph, or
`CDD_CODEGRAPH_BIN=/path/to/codegraph` to point at a custom binary.

### `cdd-kit mcp`

`cdd-kit mcp` runs a stdio MCP server so agents can call the graph/index layer
as tools instead of shelling out manually. Register it with Claude Code:

```bash
claude mcp add --scope user cdd-kit -- cdd-kit mcp
claude mcp list
```

Use the CLI command above so Claude Code writes the server to `~/.claude.json`.
Do not rely on manually editing `~/.claude/settings.json`; that file is not the
MCP registry read by the CLI.

Exposed tools:

- `cdd_graph_status`
- `cdd_graph_context`
- `cdd_graph_query`
- `cdd_graph_impact`
- `cdd_index_query`
- `cdd_index_impact`

Large Python repos are scanned in chunks (`CDD_CODE_MAP_BATCH_SIZE`, default 400)
so one slow batch cannot drop the whole language. Raise
`CDD_CODE_MAP_TIMEOUT_MS` (default 30000) if a single batch still times out.

#### Monorepos: per-surface maps

`--surface <subpath>` scopes the scan to one package and names the map after it
(`packages/web` → `.cdd/code-map.packages-web.yml`). Paths inside that map are
relative to the surface root. Query a specific surface map with `--map`:

```bash
cdd-kit code-map --surface packages/web
cdd-kit code-map --surface packages/api
cdd-kit index query OrderService --map .cdd/code-map.packages-api.yml
cdd-kit context-scan --surface packages/web   # scope the project-map tree too
```

This keeps each package's index small and token-cheap instead of indexing the
entire monorepo into one giant map.

---

## Migrating an Older Production Repo

```bash
npm update -g contract-driven-delivery
cdd-kit refresh --yes
cdd-kit migrate --all
cdd-kit doctor --strict
```

Recommended agent setup after the refresh: enable the `cdd-kit` MCP server with
args `["mcp"]` so agents use graph/code-map tools before opening source files.

### Old completed specs

If a change is already finished, merged, or only kept for audit/history:

```bash
cdd-kit migrate --all
git add specs/changes/
git commit -m "chore: migrate changes to current cdd-kit format"
```

This gives those legacy specs a new `tasks.yml`, tier markers,
`implementation-plan.md`, and a warning-mode `context-manifest.md` without
forcing strict context governance on closed work.

### Old in-progress specs

If a change is still being actively developed:

```bash
cdd-kit upgrade --yes --migrate-changes
cdd-kit context-scan
cdd-kit doctor --strict
```

Then choose one path per active change:

- Conservative path: keep the migrated legacy manifest and resume work; use `context check` before invoking agents.
- Tight context path: run `cdd-kit migrate <change-id> --enable-context-governance`, review `context-manifest.md`, narrow `Allowed Paths`, fill `implementation-plan.md`, and use `cdd-kit context check` before invoking agents.

### Recommended rollout for production repos already burned by token overuse

1. Run `cdd-kit refresh --yes` once per repo after updating the npm package.
2. Register MCP-capable agents with `claude mcp add --scope user cdd-kit -- cdd-kit mcp`.
3. Run `cdd-kit migrate --all` so existing active changes receive the current required artifact set.
4. Review and fill `implementation-plan.md` before resuming implementation agents on active changes.
5. Run `cdd-kit doctor --strict` in CI.
6. Migrate active specs with `cdd-kit migrate --enable-context-governance` only after reviewing the generated manifest.
7. Teach agents to use `cdd-kit context request/approve/reject/list` instead of silently widening context.

---

## Directory structure after `cdd-kit init`

```
your-repo/
??? contracts/
??  ??? api/api-contract.md          ??what endpoints exist and how they behave
??  ??? css/css-contract.md          ??design tokens, component states
??  ??? data/data-shape-contract.md  ??schemas, types, nullability
??  ??? env/env-contract.md          ??every env var, secret flags, defaults
??  ??? business/business-rules.md   ??rules, edge cases, decision tables
??  ??? ci/ci-gate-contract.md       ??gate tiers, promotion, rollback
??? specs/
??  ??? project-profile.md           ??overall system description
??  ??? changes/                     ??active in-progress changes
??  ??  ??? <change-id>/
??  ??      ??? change-request.md    (required)
??  ??      ??? change-classification.md (required)
??  ??      ??? test-plan.md         (required)
??  ??      ??? ci-gates.md          (required)
??  ??      ??? tasks.yml            (required)
??  ??      ??? agent-log/           optional handoff notes
??  ??? archive/                     ??completed and abandoned changes
??  ??  ??? INDEX.md
??  ??  ??? 2026/<change-id>/
??  ??? templates/
??? tests/
??? CLAUDE.md                        ??Claude's project guide (edit this)
??? AGENTS.md                        ??agent roster (auto-managed)
??? CODEX.md                         ??Codex project guide when initialized for Codex
```

---

## Risk tiers and what each triggers

| Tier | Risk level | Example changes | Extra agents |
|---|---|---|---|
| 0?? | High / critical | Auth, payments, migrations, concurrency | E2E + monkey + stress/soak |
| 2?? | Medium | Feature with API change, bug fix with behavior change | Contract review + QA |
| 4?? | Low | Docs, prompts, config only, no behavior change | Contract review + QA |

---

## Task notation in `tasks.yml`

```yaml
tasks:
  - id: "1.1"
    title: Confirm classification
    status: done
  - id: "2.2"
    title: CSS/UI contract
    status: skipped
  - id: "4.1"
    title: Backend implementation
    status: pending
```

`cdd-kit gate --strict` treats any task with `status: pending` (except IDs listed in `archive-tasks`, which default to `7.1` and `7.2`) as an error. Use `status: skipped` for tasks that are genuinely not applicable to a given change.

---

## License

MIT
