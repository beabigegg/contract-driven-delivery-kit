# Contract-Driven Delivery Kit

**cdd-kit** is a contract-driven delivery runtime for Claude Code and Codex. Its
default agent-native flow selects a risk profile, a small capability/Doctrine
set, executable checks, independent review, and approvals. Contracts and
deterministic evidence remain authoritative; routine work no longer requires a
fixed agent procession or seven hand-authored change artifacts.

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

# 3. Deploy the kit (one command: scaffold + arm chokepoints + MCP + indexes)
cdd-kit setup

# 4. Start agent-native work from Claude Code or Codex:
cdd-kit work add-jwt-auth "Add JWT authentication to the API"
```

> `cdd-kit setup` is the one-command path: it scaffolds the project, arms the
> enforcement chokepoints, registers the MCP server (best-effort), and builds the
> context indexes, then prints what to do next. It is idempotent — re-run it any
> time, including after `npm update`, and it upgrades in place. Prefer the
> fine-grained commands (`init`, `refresh`, `install-hooks`, …) only when you
> need to control a single step.

---

## Agent-native workflow (default)

```bash
cdd-kit work add-jwt-auth "Add JWT authentication to the API" --provider claude
cdd-kit runtime agent prompt <run-id>
# implement inside capsule scope
cdd-kit runtime agent complete <run-id> --status passed --actor claude --summary "Implemented scoped JWT behavior"
cdd-kit runtime check run <run-id> --all
# Controlled only: independent reviewer + named approvals
cdd-kit runtime approval import signed-approval.json <run-id>
cdd-kit runtime verify <run-id>
cdd-kit gate add-jwt-auth
```

Use `--provider codex` for Codex. Lightweight, balanced, and controlled profiles
store concise state/evidence under `.cdd/runtime/`; `specs/changes/<id>` and the
legacy seven artifacts are not required. Controlled work cannot pass without a
digest-bound independent review. High-risk approval identity is verified using
trusted public keys in `.cdd/approval-policy.yml`; free-form `--actor` text
cannot approve work, and configured approvals cannot be skipped.
The human-authored acceptance oracle is retained: strict always requires it;
controlled requires it when policy/capsule risk activates it or the user passes
`--require-acceptance`. The runtime never invents or silently relocks an oracle.

`cdd-kit runtime agent prompt` loads only Doctrine selected by the capsule.
Checks, implementation records, review, and approvals become stale after source
or policy changes. `cdd-kit guidance audit` measures recurring guidance cost;
`cdd-kit runtime parity` compares a completed runtime with the strict lane.

## Strict compatibility workflow

The following `/cdd-new` documentation describes the preserved strict workflow
for existing projects and explicit maximum-ceremony changes. It is no longer the
default for balanced/controlled work.

### How to Direct Claude Code in strict mode

> All workflows are started by typing a **natural language instruction** to Claude Code in your IDE or terminal. The `/cdd-*` prefixed commands are Claude Code skills — not shell commands.

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

### Starting a strict legacy task / feature / bug fix

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
6. Agents run in order: contracts → test plan → `spec-architect` writes `design.md` if required → CI/CD gates → implementation plan → backend engineer → frontend engineer → QA
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

- `change-classifier`, `contract-reviewer`, `qa-reviewer`, `visual-reviewer`, `dependency-security-reviewer`, `ui-ux-reviewer`, `repo-context-scanner`, and `spec-drift-auditor` are **non-writing** agents: none has `Edit`, `Write`, or `MultiEdit`, so they cannot author artifacts — they return analysis, verdicts, or optional handoff notes and main Claude writes the corresponding files. Note that `qa-reviewer`, `visual-reviewer`, `dependency-security-reviewer`, `repo-context-scanner`, and `spec-drift-auditor` also carry `Bash` — they need it to run gates, `npm audit`, screenshot capture, and drift scans. `Bash` is not a hard read-only boundary (a shell can write files), so their read-only behaviour is a prompt convention on top of the enforced no-`Edit`/`Write` tool set, not a tool-level guarantee.
- `bug-fix-engineer` is an implementation agent for symptom-driven defects. It converts user-visible reports into graph/index-guided hypotheses, reproduces the issue where feasible, applies the smallest fix, and adds regression evidence.
- `implementation-planner`, `backend-engineer`, `frontend-engineer`, `e2e-resilience-engineer`, `monkey-test-engineer`, `stress-soak-engineer`, `ci-cd-gatekeeper`, `test-strategist`, and `spec-architect` are write-capable. They write their own owned artifacts directly: for example, `spec-architect` owns `design.md`, while `implementation-planner` owns `implementation-plan.md`.

This split is deliberate:

- Review and audit agents carry no `Edit`/`Write`/`MultiEdit` tool so they cannot silently author or overwrite the thing they are supposed to assess.
- Implementation and planning agents write directly so large artifacts and code edits do not have to be relayed back through the main orchestrator, which reduces token waste and preserves clearer ownership.
- `tasks.yml` remains owned by main Claude so task state changes stay centralized even when multiple agents contribute files.

### Artifact Minimization

CDD keeps the authoritative artifact set small. Routine reviewer findings should
not become new markdown files.

| artifact class | files | rule |
|---|---|---|
| Core decision and planning | `change-classification.md`, `context-manifest.md`, `test-plan.md`, `ci-gates.md`, `implementation-plan.md`, `tasks.yml` | required for implementation changes |
| Conditional design | `design.md` | only when `spec-architect` is required |
| Durable evidence reports | `qa-report.md`, `visual-review-report.md`, `regression-report.md`, `monkey-test-report.md`, `stress-soak-report.md` | only for blocking findings, approved-with-risk, visual evidence bundles, or high-risk load/soak results |
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

The change-classifier will detect that these are architectural or contract-level changes, assign a higher risk tier (0–1), and automatically require:
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
2. Synthesizes `archive.md` — a permanent record of what changed, what tests were added, and what lessons were found
3. Promotes only evidence-backed durable learnings to `contracts/` or project guidance (`CLAUDE.md`/`CODEX.md`). General agents record evidence and findings only; durable learning promotion happens during `/cdd-close` Step 3.
4. Runs `cdd-kit archive add-jwt-auth` — moves the change from `specs/changes/` to `specs/archive/2026/`
5. Reduces the active context that future Claude sessions need to load

> **Keeping `CLAUDE.md` small.** `CLAUDE.md` is loaded into every session, so each
> promoted line is a recurring token cost. `/cdd-close` therefore promotes the bulk
> of learnings to `contracts/` (queried on demand, not auto-loaded) and keeps
> `CLAUDE.md` to a delimited `cdd-kit:learnings` region of **one-line rule +
> pointer** entries that it consolidates (merge/replace) rather than appends —
> content you write outside the markers is never touched. If a project already
> grew a bloated `CLAUDE.md` before this discipline existed, run
> **`/cdd-consolidate-guidance`** once to migrate and shrink it in place.

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

## Bounded test execution and evidence

Implementation changes prove themselves through a bounded **test ladder**, not
broad `pytest` / `npm test` runs. Each phase runs the narrowest useful tests,
stops at the first failure, and records a durable, machine-readable result that
the gate checks.

| phase | required | proves |
|---|---|---|
| collect | always | selected tests are discoverable |
| targeted | always | acceptance criteria pass (narrowest mapped tests) |
| changed-area | always | tests near changed source paths pass |
| contract | if contracts/API/data/env/CI affected | contract validators pass |
| quality | if configured | lint/typecheck/build pass |
| full | final/CI | bounded full-suite smoke passes |

`collect`, `targeted`, and `changed-area` are the always-required floor.
`cdd-kit test run` writes artifacts under `specs/changes/<id>/test-runs/<run-id>/`
and records each phase in `specs/changes/<id>/test-evidence.yml`.

The gate validates that evidence, not the assistant's claims: required phases
must have passed, no failure may be waived (`known-failures`,
`pre-existing-failures`, `allowed-failures`, `waived-failures`, and
`ignored-failures` are rejected by the schema), and each run must reference its
own `summary.json` under this change's `test-runs/`. A required failure is
cleared only by fixing it, expanding the change's scope to cover the fix, or
opening a separate tracked change. A change with no testable code surface opts
out with `test-evidence-not-applicable: "<reason>"` in `tasks.yml` frontmatter.
See the `cdd-kit test` reference below and `references/sdd-tdd-policy.md`.

---

## Bug-fix lane (ADR 0006)

Bug fixing starts from a *symptom* ("the filter is empty", "pytest fails", "the
API returns the wrong shape"), not from a desired behavior. When the
`change-classifier` detects a symptom-driven request it sets `## Lane\n- bug-fix`
and a `## Bug Symptom Type` in `change-classification.md`. That activates the
bug-fix lane: `bug-fix-engineer` must diagnose before editing
(`cdd-kit bug suspects` → hypotheses → reproduce), and `cdd-kit gate` then
requires a structured, machine-readable repair record at
`specs/changes/<id>/agent-log/bug-fix-engineer.yml` — the standard agent-log
envelope with a nested `bug-fix:` evidence block.

A behavior-changing fix must carry: `symptom` / `expected_behavior` /
`actual_behavior`, exactly one `reproduction.status`
(`reproduced` / `test-reproduced` / `visual-reproduced` for a behavior fix), at
least one `confirmed` hypothesis once reproduced, a `root_cause.pointer`, a `fix`,
a `regression` with `status: passed`, `residual_risk`, **and** a passing
`test-evidence.yml` (the bounded ladder above). Referenced reproduction/regression
summaries must be this change's own real `cdd-kit test run` artifacts under its
`test-runs/`. No failure may be waived.

A complete, gate-passing record:
[`docs/examples/bug-fix/bug-fix-engineer.sample.yml`](docs/examples/bug-fix/bug-fix-engineer.sample.yml).
A real gate rejection of an incomplete one:
[`docs/examples/bug-fix/gate-failure.txt`](docs/examples/bug-fix/gate-failure.txt).

### Worked examples

Each example shows the classifier markers and the salient `bug-fix:` block fields
for that symptom class (including the ADR 0006 PR-5 typed evidence pointer it
attaches). Full envelope omitted for brevity — see the sample above.

**1. UI / visual bug** (a panel renders empty). Reproduce with a screenshot/browser
capture; a `visual-reproduced` reproduction **requires** `visual_evidence.before`
(a durable, repo-relative pre-fix artifact — the gate rejects an absolute or
missing path).

```md
## Lane
- bug-fix
## Bug Symptom Type
- visual
```
```yaml
bug-fix:
  reproduction: { status: visual-reproduced }
  visual_evidence:
    before: "specs/changes/<id>/evidence/before.png"   # required for visual-reproduced
    after:  "specs/changes/<id>/evidence/after.png"      # optional
  root_cause: { pointer: "src/pages/Orders.tsx:42-68" }
  regression: { status: passed, command: "npm test -- orders-filter", summary: "specs/changes/<id>/test-runs/<reg>/summary.json" }
```

**2. pytest failure repair** (a test reproduces the defect). Use
`test-reproduced` with `failing_before_fix: true`: the `reproduction.summary` must
point at a run that **failed (or timed out) before the fix**, with its
`reproduction.command`; the `regression` then references the post-fix **passing**
run. Both summaries are real `cdd-kit test run` artifacts.

```md
## Lane
- bug-fix
## Bug Symptom Type
- test-failure
```
```yaml
bug-fix:
  reproduction:
    status: test-reproduced
    command: "pytest tests/orders/test_filter.py"
    failing_before_fix: true
    summary: "specs/changes/<id>/test-runs/<repro>/summary.json"   # a FAILED pre-fix run
  hypotheses:
    - { id: H1, candidate: "src/pages/Orders.tsx::buildFilterOptions", reason: "graph match", result: confirmed }
  root_cause: { pointer: "src/pages/Orders.tsx:42-68" }
  regression:
    status: passed
    command: "pytest tests/orders/test_filter.py"
    summary: "specs/changes/<id>/test-runs/<reg>/summary.json"     # the PASSING post-fix run
```

**3. API response-shape bug** (the endpoint returns the wrong shape). Record
`data_evidence` — a `kind` plus a request/response or contract `pointer` (a
durable, repo-relative artifact).

```md
## Lane
- bug-fix
## Bug Symptom Type
- api
```
```yaml
bug-fix:
  reproduction: { status: test-reproduced, command: "pytest tests/api/test_orders.py", failing_before_fix: true, summary: "specs/changes/<id>/test-runs/<repro>/summary.json" }
  data_evidence:
    kind: request-response
    pointer: "specs/changes/<id>/evidence/orders-response.json"
    summary: "GET /api/orders omitted the canonical status field"
  root_cause: { pointer: "src/api/orders.ts:88-104" }
  regression: { status: passed, command: "pytest tests/api/test_orders.py", summary: "specs/changes/<id>/test-runs/<reg>/summary.json" }
```

**4. Intermittent, diagnostic-only change** (add instrumentation; do not claim a
fix yet). Mark it diagnostic-only in **both** places — the classifier's
`## Diagnostic Only\n- yes` and `bug-fix.diagnostic_only: true` (the gate requires
the classifier's explicit `yes`, not silence). A diagnostic-only record uses a
diagnostic reproduction status (`intermittent` / `environment-blocked` /
`not-reproduced`) and is **exempt** from `root_cause` / `fix` / `regression` — in
fact it must NOT carry them, nor a successful reproduction status. It still cannot
pass with required test failures: either record a passing `test-evidence.yml` for
the instrumentation, or, when no code path is exercised, set an auditable
`test-evidence-not-applicable: "<reason>"` in `tasks.yml` (one of the two is
required — it cannot pass with neither). Open a follow-up change for the real fix.

```md
## Lane
- bug-fix
## Bug Symptom Type
- ci-failure
## Diagnostic Only
- yes
```
```yaml
bug-fix:
  diagnostic_only: true
  reproduction: { status: intermittent }
  hypotheses:
    - { id: H1, candidate: "src/export/worker.ts::run", reason: "CI-only path", result: unconfirmed }
  # no root_cause / fix / regression — this change does not fix the symptom yet
```

---

## CLI Reference

These are shell commands — not Claude Code skills. Run them directly in the terminal, or Claude Code will run them on your behalf.

### `cdd-kit setup`

The one-command onboarding path. Takes a repo from zero to a fully wired,
enforcement-armed cdd-kit project — and brings an existing project up to date —
in a single idempotent run. This is the recommended way to start; the
fine-grained commands below remain available for step-by-step control.

```bash
cdd-kit setup                 # fresh install or in-place upgrade (auto-detected)
cdd-kit setup --provider both # scaffold Claude Code + Codex guidance
cdd-kit setup --force         # fresh install: overwrite existing project files
cdd-kit setup --no-arm        # skip arming the pre-commit gate and agent hooks
cdd-kit setup --no-mcp        # skip the best-effort MCP registration
```

What it does, in order, with a per-step success/failure summary at the end:

1. **Scaffold** — runs `init` on a fresh repo (no `.cdd/`) or `refresh --yes` on
   an existing one, so you never have to choose between update/upgrade/refresh.
2. **Detect stack** — reports the detected tech stack.
3. **Arm chokepoints** — installs the pre-commit gate and the agent PreToolUse
   hooks (graph-first + test-runner, both advisory). Skipped by `--no-arm`.
4. **Register MCP** — best-effort `claude mcp add --scope user cdd-kit -- cdd-kit
   mcp`. If the `claude` CLI is absent or the call fails, it prints the manual
   command and continues — agents fall back to the slower CLI path. Skipped by
   `--no-mcp`.
5. **Context scan** — builds `specs/context/project-map.md`.
6. **Code map** — builds `.cdd/code-map.yml`.

Every step is best-effort: a missing git repo or `claude` CLI becomes a warning,
never a failed run, so you always get a complete report. The run ends by telling
you the one thing to do next — open Claude Code and run `/cdd-new <describe your
change>`.

---

### `cdd-kit init`

Installs Claude assets into `~/.claude`, Codex skills into
`$HOME/.agents/skills`, and scaffolds project files.

```bash
cdd-kit init                  # global + local (recommended)
cdd-kit init --global-only    # only install into ~/.claude
cdd-kit init --local-only     # only scaffold project files
cdd-kit init --provider codex # install Codex skill + scaffold AGENTS.md guidance
cdd-kit init --provider both  # scaffold Claude Code + Codex guidance
cdd-kit init --force          # overwrite existing project files
cdd-kit init --no-arm         # scaffold without arming enforcement chokepoints
cdd-kit init --no-test-runner # arm graph-first but leave the test-runner hook dormant
```

By default `init` **arms** the enforcement chokepoints so a fresh repo enforces
the workflow instead of carrying it dormant: the graph-first and test-runner
PreToolUse hooks (Claude provider, both advisory) and the pre-commit gate hook
are wired in place. This matters most in a fully automated, no-human-reviewer
workflow — dormant enforcement means the contracts only *look* like they prevent
drift, and a non-engineer would never run `install-agent-hooks --test-runner`
themselves. Arming is best-effort (a missing `.git` becomes a warning, never a
failed init); pass `--no-arm` to skip all of it or `--no-test-runner` to keep
graph-first but leave the test-runner hook dormant, and `cdd-kit doctor` reports
the live/dormant status of each chokepoint.

Creates: `contracts/`, `specs/templates/`, provider guidance files (`CLAUDE.md`, `AGENTS.md`, and/or `CODEX.md`), `hooks/`

`.cdd/model-policy.json` stores role-to-model **classes** (`opus`, `sonnet`, `haiku`) instead of provider release IDs such as `claude-opus-4-7`. This keeps the policy stable across Claude and Codex adapters; provider-specific tooling can map the class to the concrete model available in that environment.

Recommended: register the cdd-kit MCP server with the selected provider after
init:

```bash
claude mcp add --scope user cdd-kit -- cdd-kit mcp
claude mcp list

codex mcp add cdd-kit -- cdd-kit mcp
codex mcp list
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

Codex updates the provider-neutral `cdd-work` skill under
`$HOME/.agents/skills`. Codex project guidance is `AGENTS.md`; `CODEX.md`
remains as a compatibility pointer for older cdd-kit installations.

User-level assets are tracked in `~/.cdd-kit/install-manifest.json`. Interactive
updates show a dry-run and back up provider assets under
`~/.cdd-kit/backups/<timestamp>/`. npm `postinstall` updates only assets that
were previously owned by cdd-kit and remain unmodified; user-edited files are
left untouched until an explicit `cdd-kit update --yes`.

---

### After Updating the npm Package

Updating npm only replaces the `cdd-kit` CLI package. Existing repos and
global Claude Code/Codex assets keep their previously copied agents, skills,
templates, hooks, and `.cdd/model-policy.json` until you sync them.

Simplest path — one idempotent command that detects the upgrade and re-wires
everything (scaffold, chokepoints, MCP, indexes):

```bash
cdd-kit setup            # auto-detects the existing project and upgrades in place
```

Or drive the steps yourself after `npm update -g contract-driven-delivery`:

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
| `cdd-kit setup` | everything below in one idempotent run, plus chokepoint arming, MCP registration, and context indexes | user source, contracts content, active change content |
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

#### Upgrading to 2.2.0

2.2.0 **arms enforcement chokepoints by default on a fresh `cdd-kit init`**, adds
the mechanical **tier floor**, `cdd-kit classify-check`, and `cdd-kit code-map
--watch`. A repo first set up with an older version keeps its chokepoints
*dormant* after a plain `npm`/`refresh` update — `cdd-kit doctor` will show them
as such. To bring an existing repo up to the 2.2.0 enforcement posture:

```bash
npm install -g contract-driven-delivery   # get 2.2.0
cdd-kit refresh --yes                      # sync agents/skills/templates/hooks/code-map
cdd-kit install-hooks                      # arm the pre-commit gate
cdd-kit install-agent-hooks --graph-first advisory   # arm the graph-first hook (or: strict)
cdd-kit install-agent-hooks --test-runner advisory   # opt-in: steer broad test runs to the bounded ladder (ADR 0005 §10)
cdd-kit doctor                             # confirm both chokepoints report "live"
```

The tier floor needs **no policy file** — built-in defaults apply when
`.cdd/tier-policy.json` is absent, so existing repos are protected without a
re-init. To customize or disable it, scaffold the policy with `cdd-kit upgrade
--yes` (writes an editable `.cdd/tier-policy.json`) and set rules or
`"enabled": false`. Bypass a single change with `tier-floor-override:
"<reason>"` in its `tasks.yml` frontmatter (recorded as an audit warning).

A malformed `.cdd/tier-policy.json` (invalid JSON, `rules` not an array, or a
rule with a bad `maxTier`/`patterns`) no longer fails silently: each problem is
warned with the offending field and the note that *your custom tier rules are
NOT in effect* (the built-in defaults take over), so a typo can't leave you
believing a custom policy is active when it is being ignored.

If you do not want template overwrites, run the narrower path:

```bash
cdd-kit update --yes
cdd-kit upgrade --yes
cdd-kit migrate --all
cdd-kit doctor --strict
```

---

### Agent-native runtime and Boundary Guard

The agent-native runtime is the default for lightweight, balanced, and
controlled profiles; the existing strict workflow remains
available while parity is measured.

```bash
cdd-kit boundary init
cdd-kit boundary check --base origin/main
cdd-kit boundary check --base origin/main --verify-captures --verify-generated
cdd-kit work <change-id> "<objective>"
cdd-kit work <change-id> "<human-sensitive objective>" --require-acceptance
cdd-kit runtime status
cdd-kit runtime resume
cdd-kit runtime agent prompt
cdd-kit runtime check run --all
cdd-kit runtime review --verdict passed --actor reviewer --summary "Independent review passed"
cdd-kit runtime approval import signed-approval.json <run-id>
cdd-kit runtime verify
cdd-kit runtime parity
cdd-kit runtime parity <run-id> --mutations mutation-results.json
cdd-kit guidance audit
cdd-kit runtime migrate --provider codex       # dry run
cdd-kit runtime migrate --provider codex --yes # reversible apply
```

See [Boundary Guard](docs/boundary-guard.md) and the
[runtime contracts](docs/rfc/agent-native-cdd-runtime-contracts.md).

Acceptance oracles are profile-aware. Existing projects and `--strict` retain
the human-authored oracle and hash-lock requirements. An explicit or
runtime-selected `balanced`/`lightweight` profile does not require
`acceptance.yml`; `controlled` requires it only when the capsule or caller adds
`acceptance-oracle`:

```bash
cdd-kit gate my-change --profile balanced
cdd-kit gate sensitive-change --profile controlled --require-acceptance
```

Without `--profile` and without a matching current runtime run, `gate` keeps its
legacy behavior. Profile adoption is therefore opt-in and rollback-safe.

---

### `cdd-kit doctor`

Inspects repo-level cdd-kit health. Default mode is read-only; `--fix` applies only the safe auto-remediations.

```bash
cdd-kit doctor
cdd-kit doctor --simple
cdd-kit doctor --strict
cdd-kit doctor --fix
cdd-kit doctor --json
cdd-kit doctor --provider codex
```

Checks for missing `.cdd/` policy files, provider guidance (`CLAUDE.md`, `AGENTS.md`, `CODEX.md`), context indexes, stale `specs/context/*` outputs, and contract summary metadata gaps. `--strict` treats warnings as errors. `--json` emits a machine-readable report for CI or wrapper scripts. `--fix` auto-runs `context-scan` for stale or missing indexes, backfills empty `.cdd/model-policy.json` role bindings, regenerates a stale code-map, and **enables API conformance** when an API contract and real source code are present (see below) — but deliberately does not run invasive repo upgrades for you.

**`--simple`** is the non-engineer view: instead of the full technical list it collapses every passing check into one line and leads with a one-word verdict plus a single "what to do next" (e.g. *run `cdd-kit doctor --fix`*, or *you're ready — run `/cdd-new`*). It honours `--strict` and the same exit codes, so it is safe in scripts too.

For Claude projects, `doctor` also reports whether the **cdd-kit MCP server is registered** with Claude Code (it runs `claude mcp list`). If it is not registered, agents never see the graph/index tools and silently fall back to `Read`. Severity is tiered on certainty: when `claude` is present and positively reports the server missing, that is a **warning** (it fails `--strict`) — agents are demonstrably degraded to the slow path, and doctor surfaces the exact `claude mcp add --scope user cdd-kit -- cdd-kit mcp` command to fix it. When the check *cannot verify* (no `claude` CLI on PATH, or `mcp list` errors — 3s timeout, best-effort) it stays **informational** so environments that don't use Claude Code are never penalised. The check is skipped entirely for non-Claude projects. Point `CDD_CLAUDE_BIN` at an alternate Claude CLI if needed.

`doctor` finally prints a **chokepoint dashboard**: for each enforcement mechanism — the graph-first hook, the contract-write hook, the pre-commit gate, and the OpenAPI sync gate — it reports `live` (armed) or `dormant`, with the one command to arm it. The kit's mechanisms are opt-in and dormant until installed, so a repo can carry all the machinery yet enforce none of it; this makes that state observable. A dormant chokepoint is reported as a **warning**, so it **fails `--strict`** — under strict mode you are asserting that enforcement is actually armed, and a repo that carries the machinery but enforces none of it should not pass. Plain `doctor` (non-strict) still exits 0 and simply lists what is dormant.

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
cdd-kit gate add-jwt-auth --explain   # plain-language reasons + a sentence to say to Claude
```

Checks:
- All required artifacts exist (`change-request.md`, `change-classification.md`, `implementation-plan.md`, `test-plan.md`, `ci-gates.md`, `tasks.yml`; new context-governed changes also require `context-manifest.md`)
- Each artifact has sufficient content and is not a stub.
- `change-classification.md` contains a tier or risk marker.
- **Mechanical risk-tier floor.** `change-request.md` is scanned for sensitive surfaces (auth, payments, migrations, concurrency, secrets, …) — and the change's git paths are scanned against the critical (tier-0) rules only, so a generic request whose work lives under `auth/` or `payments/` is still caught. The gate scans the **staged** change (so an unrelated unstaged edit can't trip it; rename-aware on both sides; the path signal is dropped when a commit stages multiple change dirs), while `classify-check` scans the whole worktree. The gate fails when the declared tier is weaker than the matched floor — the deterministic safety net under the AI classifier. Bypass one change with `tier-floor-override: "<reason>"` in `tasks.yml` frontmatter: the reason must be **at least 20 characters** (a one-word "fix" does not bypass), it downgrades the violation to a warning, and every bypass is appended — with a timestamp, the matched floor, and the reason — to `agent-log/audit.yml` so the weakening is never invisible. Tune or disable in `.cdd/tier-policy.json`.
- Atomic `depends-on` upstream changes are completed or archived before dependent work gates.
- All contract validators pass.
- **Test evidence.** For implementation changes, `test-evidence.yml` must exist with its required phases passed (collect, targeted, changed-area, plus any declared contract/quality/full), no waiver fields, and each run pointing at this change's `test-runs/`. Generated by `cdd-kit test run`; opt out when a change has no testable surface via `test-evidence-not-applicable: "<reason>"` in `tasks.yml` frontmatter. After a migration window this is enforced — a warning for legacy changes, an error for context-governed changes or under `--strict`.

**Advisory — required-agent evidence (ADR 0008).** The gate also *warns* (never
errors, even under `--strict`) when an agent the classifier listed in
`change-classification.md` `## Required Agents` left no non-stub
`agent-log/<agent>.yml` — a signal, for a no-human-review workflow, that a
required review (especially a judgment-only one like UI/UX or visual) left no
trace it ran. It is deliberately *not* a hard gate: an agent-log is post-hoc,
self-reported audit, and the harms that are mechanically checkable are already
caught by the validators / conformance / test-evidence layer regardless of
whether a reviewer agent ran. `agent-log/*.yml` stays optional. (The bug-fix
lane's `bug-fix-engineer.yml` requirement remains a hard error.)

`--strict` additionally:
- Treats any task with `status: pending` (except IDs listed in `archive-tasks`) as an error
- Treats legacy changes missing `context-manifest.md` as errors

`--explain` (non-engineer mode) annotates each failure with a plain-language **Why** and a ready-to-paste **Say this to Claude** sentence, so a non-engineer never has to decode jargon like "tier floor" or "frontmatter" to know the next step. Without `--explain`, a failing run ends with a one-line pointer: `Need help? Run: cdd-kit gate <id> --explain`.

Pre-commit hook uses `--strict` by default (installed via `cdd-kit install-hooks`).

```
✓  gate passed for change: add-jwt-auth

✗  gate failed for change: feat-001
✗    change-classification.md: appears to be a stub (< 200 meaningful chars)
✗    1 task(s) still pending (mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped)

Need help? Run: cdd-kit gate feat-001 --explain for a plain-language explanation of each failure.
```

With `--explain`:

```
✗  gate failed for change: feat-001
✗    tier floor violation: Authentication surface detected (matched: auth) requires tier 0 or stricter, but classification declared tier 3. …
       Why: This change touches a sensitive area (for example login, payments, or security), so the system requires a stricter review level than the one it was filed under. "Tier" is just the risk level — a lower tier number means stricter checks.
       Say this to Claude: "This change was flagged as higher risk than its current tier. Please re-classify it to the required stricter tier and bring the tests and evidence up to that level."
```

---

### `cdd-kit metadata <change-id>`

Generates two compact, machine-readable indexes for a tracked change, **derived
from its existing artifacts** — so agents and MCP tools can read structured state
instead of re-parsing long markdown:

- **`change.yml`** — status, tier, lane, change types, required agents, required
  vs present optional artifacts, the context manifest's allowed-paths count, and
  dependencies.
- **`trace.yml`** — acceptance criteria → tests → required gates, plus the
  agent-log evidence pointers.

```bash
cdd-kit metadata add-jwt-auth           # write change.yml + trace.yml
cdd-kit metadata add-jwt-auth --check   # exit 1 if regenerating would change them (no write)
cdd-kit metadata --all                  # regenerate for every active (in-progress) change
cdd-kit metadata add-jwt-auth --json    # machine-readable result
```

These files are **generated, never hand-authored**, and are a **derived index
only**: the gate still treats the source artifacts as the source of truth, so a
missing or stale `change.yml`/`trace.yml` never affects the gate's pass/fail.
Each carries a `generated-from` map of per-source `sha256` digests; when a source
drifts, `cdd-kit gate` prints a warn-only refresh nudge (only if the index was
already generated), and `cdd-kit doctor` reports it as a warning that
`cdd-kit doctor --fix` regenerates.

---

### `cdd-kit contract`

Query and mutate the API contract by **key** instead of reading or hand-editing
the whole file (ADR 0004 — see `docs/adr/0004-queryable-and-writable-contracts.md`).
Subcommands:

```bash
cdd-kit contract query [term]                    # read: matching endpoint/schema slice
cdd-kit contract locate <symbol>                 # read: contract slices related to a code symbol
cdd-kit contract endpoint set ...                # write: upsert one endpoint row
cdd-kit contract schema set <name> --field ...   # write: upsert one schema section
```

#### `cdd-kit contract query [term]`

Returns only the matching slice of the API contract — an endpoint, a schema, or
a path/column filter — so an agent reads the relevant row instead of the whole
contract file. With no term it lists the contract's keys.

#### `cdd-kit contract locate <symbol>`

Given a code symbol or file, returns the API-contract slices (schemas +
endpoints) related to it — the contract analog of `cdd-kit test impact`. It saves
the usual graph-query → read-file → guess-schema-name → contract-query round-trip
an agent would otherwise do by hand.

```bash
cdd-kit contract locate src/orders/service.ts   # schemas/endpoints related to this file
cdd-kit contract locate CreateOrder --json      # or a single symbol/schema name
```

The bridge from code to contract is **name overlap** (a `CreateOrder` interface ↔
a `CreateOrder` schema) — the same honest, bounded heuristic the kit uses
elsewhere, never inference. The symbol is resolved in the code-map (best effort)
to harvest the file's declared type/class/function names as extra search terms,
and each located slice records `matched_via` (which term surfaced it). It still
works with no code-map, since the literal symbol is always one of the terms.
Exposed over MCP as `cdd_contract_locate`. Options: `--contract`, `--inventory`,
`--map`, `--limit` (default 20), `--no-refresh`, `--json`.

#### `cdd-kit contract endpoint set` / `cdd-kit contract schema set <name>`

Keyed, **valid-by-construction** writes: `endpoint set` upserts a single endpoint
row by `(method, path)` and `schema set` upserts a single `### Name` schema
section from `--field` specs — each touches only that row/section instead of a
free-form edit of the contract file. This is the mutation the contract-write
`PreToolUse` hook routes an agent's contract edits through.

---

### `cdd-kit index`

Query the machine-readable project index (`.cdd/code-map.yml`) before opening
source files — the token-cheap "find the thing" layer. (`cdd-kit graph` is the
richer relationship layer; see below.)

```bash
cdd-kit index query <term>                # files, symbols, imports, line ranges for a term
cdd-kit index query "order export"        # multi-word: tokenized, ranked by coverage
cdd-kit index query <term> --with-source  # include the source slice for each hit
cdd-kit index impact <path-or-symbol>     # indexed local imports and dependents of a file
```

**Multi-word queries are tokenized.** A query is split into tokens
(whitespace/comma separated, stopwords and 1-char tokens dropped) and scored by
how many tokens a symbol matches, so a natural-language task (`"filter options
are empty"`) or a two-word query (`"order export"` → `exportOrders`) resolves in
one call instead of forcing the agent to retry one exact identifier at a time. A
single-word or exact query behaves exactly as before (byte-identical ranking), so
the gate's deterministic `--check` is unaffected.

**Truncation is always visible:** `index query` reports `total_matches` /
`returned` / `truncated` (and per-file `match_count` / `matches_truncated`) so a
result capped by `--limit` is never mistaken for the whole picture (P1-7). Exposed
over MCP as `cdd_index_query`.

---

### `cdd-kit test`

Bounded test execution and structured evidence (ADR 0005). Runs narrow test
phases instead of broad suites, caps assistant-visible output, writes durable
artifacts, and records results in `test-evidence.yml` for the gate to validate.

```bash
cdd-kit test select <change-id>            # choose bounded commands per ladder phase from test-plan.md
cdd-kit test select <change-id> --json     # machine-readable selection (or needs-test-plan-update)

cdd-kit test impact src/auth/token.ts      # which tests are affected by changing this file?
cdd-kit test impact src/auth/token.ts --depth 3 --json

# Run each phase with the command select returned (--command is required today);
# declare any conditional phases on the first run so the gate requires them:
cdd-kit test run <change-id> --phase collect --command "<collect cmd>" --required-phases collect,targeted,changed-area
cdd-kit test run <change-id> --phase targeted --command "<targeted cmd>"
cdd-kit test run <change-id> --phase changed-area --command "<changed-area cmd>"
cdd-kit test run <change-id> --phase full --command "<full cmd>"   # final/CI smoke — run when the change needs a full gate, not every time
```

`test run` options: `--phase <phase>` (required), `--command <cmd>` (the command
from `cdd-kit test select`, currently required on every run; pytest commands get
bounded defaults `-q --maxfail=1 --tb=short -ra` plus JUnit XML), `--run-id
<id>`, `--timeout <ms>` (default 300000), `--cwd <dir>`, `--required-phases
<csv>` (recorded only when first creating evidence; the floor
`collect,targeted,changed-area` is always merged, so list any conditional phase
that must block the gate), and `--json`.

Each run writes `specs/changes/<change-id>/test-runs/<run-id>/` (`command.txt`,
`summary.json`, `stdout.log`, `stderr.log`, and `junit.xml` when supported) and
updates `test-evidence.yml`. The ladder phases and the no-waiver policy live in
`references/sdd-tdd-policy.md` and each change's `test-plan.md`.

`cdd-kit test impact <file>` answers "if I change this file, which tests are
affected?" by walking the code-map's import graph: it reports test files that
transitively import the target (up to `--depth`, default 2) plus mirror-path test
files (`src/foo.ts` ↔ `tests/foo.test.ts`, `foo_test.py`). Every result carries a
`reason` (`is-target` / `imports-target` / `transitive` / `mirror`), so it never
guesses — it's a composition of facts the code-map already records, exposed over
MCP as `cdd_test_impact` to replace a manual grep. Options: `--depth <n>`,
`--limit <n>` (default 50), `--map <path>`, `--no-refresh`, `--json`.

---

### `cdd-kit classify-check`

Advisory probe that prints the **mechanical risk-tier floor** for a change
*before* classification, so the classifier can be steered up front instead of
only being caught later by `cdd-kit gate`. The blocking enforcement lives in the
gate; this command never fails (exit 0).

```bash
cdd-kit classify-check add-jwt-auth                 # scan the change's change-request.md
cdd-kit classify-check --text "add stripe checkout" # scan inline intent
cdd-kit classify-check add-jwt-auth --json          # machine-readable
```

It reads the same ground-truth source the gate enforces against
(`change-request.md`), reports the strictest matched tier and the matched
patterns, and points at `.cdd/tier-policy.json` for tuning.

---

### `cdd-kit manifest`

Auto-generates a minimal `context-manifest.md` for a **low-risk tier 4-5
micro-change**, so a trivial edit does not need a hand-written manifest. The
generated **Allowed Paths** is the change's own directory plus the files the
change currently touches (from `git status`), on top of the three standard
defaults (`specs/changes/<id>/`, `project-map.md`, `contracts-index.md`).

```bash
cdd-kit manifest tweak-copy            # generate (errors if a manifest already exists)
cdd-kit manifest tweak-copy --force    # regenerate from the current touched files
cdd-kit manifest tweak-copy --json     # machine-readable result
```

It is deliberately scoped to tiers 4-5: a stricter (tier 0-3) change is refused,
because a critical/behavioral change should get a deliberately authored manifest
with per-agent work packets, not a rubber-stamped "whatever it touched is
allowed" boundary. An existing manifest is never overwritten without `--force`,
and the change must already have a tier set (`tier: <0-5>` in `tasks.yml`).

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

`--json` prints `{ "changes": [{ "id", "status", "pendingTasks" }] }` for wrapper scripts.

---

### `cdd-kit archive <change-id>`

Physically moves a completed change from `specs/changes/` to `specs/archive/<year>/`.

```bash
cdd-kit archive add-jwt-auth
# ✓  Archived: specs/changes/add-jwt-auth → specs/archive/2026/add-jwt-auth
# ✓  Index updated: specs/archive/INDEX.md
```

Warns (but does not block) if `tasks.yml` has pending items or `status: gate-blocked`. Use after `/cdd-close` — the skill runs this automatically at the end.

`--json` prints `{ "changeId", "archivedTo", "year", "date", "warnings": [] }` on success, `{ "changeId", "error" }` with exit code 1 on failure.

---

### `cdd-kit abandon <change-id>`

Marks a change as abandoned. Updates `tasks.yml` status to `abandoned`, records the reason in `specs/archive/INDEX.md`. The directory stays on disk for git history.

```bash
cdd-kit abandon add-jwt-auth --reason "using Auth0 instead"
# ✓  Change add-jwt-auth marked as abandoned.
```

`--json` prints `{ "changeId", "status": "abandoned", "reason", "date" }` on success, `{ "changeId", "error" }` with exit code 1 on failure.

---

### Machine-readable output (`--json`) and exit codes

Every lifecycle and query command supports `--json` for wrapper scripts and CI:
`doctor`, `list`, `gate`-adjacent checks (`classify-check`, `validate` on errors),
`archive`, `abandon`, `index query`/`impact`, `graph query`/`impact`/`status`/`sync`/`context`,
`contract query`/`locate`, `test run`/`select`/`impact`, `metadata`, `bug suspects`, `detect-stack`, and
`context request`/`approve`/`reject`/`list`/`check`.

Conventions, uniform across commands:

- **stdout** carries exactly one JSON object (pretty-printed); human chatter is
  suppressed in JSON mode. Failures that have a payload print `{ ..., "error" }`.
- **Exit code 0** — the command did what was asked (including legitimately empty
  results, e.g. zero changes / zero suspects).
- **Exit code 1** — the command could not do what was asked: validation failed,
  the gate failed, a referenced change/file does not exist, or inputs were
  invalid. No other exit codes are used.

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

### `cdd-kit context`

Manage Context Expansion Requests (CERs) against a change's
`context-manifest.md` — how an agent asks for, and a human/policy grants, read
access beyond its work packet. Subcommands:

| subcommand | purpose |
|---|---|
| `context request <id> <cer-id>` | record a pending CER (or auto-approve a safe one) |
| `context check <id>` | preflight read paths against the manifest |
| `context approve <id> <cer-id>` | approve a pending CER (`--all-pending` for bulk) |
| `context auto-approve <id>` | resolve pending CERs against the auto-safe policy |
| `context approve-interactive <id>` | adjudicate each pending CER with a y/n/q prompt |
| `context reject <id> <cer-id>` | reject a pending CER (`--all-pending` for bulk) |
| `context list <id>` | list all CERs for a change (`--json`) |

#### `cdd-kit context request <change-id> <request-id>`

Records a pending Context Expansion Request in `context-manifest.md`.

```bash
cdd-kit context request add-jwt-auth CER-001 --path src/server/users.ts tests/users.test.ts --reason "paired implementation and regression coverage"
```

Use this when an agent needs more context than its current work packet allows.

**Auto-safe approval.** When `.cdd/context-policy.json` sets
`contextExpansion.mode: "auto-safe"`, paths that fall inside its
`autoApprovePatterns` (e.g. `src/**`, `tests/**`, `contracts/**`,
`specs/changes/<current-change-id>/**`) and are not forbidden are approved
immediately instead of being parked as pending — so a request that is entirely
inside the safe zones never stalls the session. Only the leftover (out-of-zone)
paths are recorded as a pending CER for human review. The forbidden baseline
always wins, and a repo with no policy file (or `mode` other than `auto-safe`)
keeps the manual pending-CER behavior.

#### `cdd-kit context check <change-id>`

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

#### `cdd-kit context approve <change-id> <request-id>`

Approves a pending Context Expansion Request in `context-manifest.md` and adds its `requested_paths` to `## Approved Expansions`.

```bash
cdd-kit context approve add-jwt-auth CER-001
cdd-kit context approve add-jwt-auth --all-pending   # bulk approve every pending request
```

This keeps expansion history explicit while avoiding manual manifest editing.

#### `cdd-kit context auto-approve <change-id>`

Resolves *already-pending* CERs against the auto-safe policy: paths inside the
safe zones move to `## Approved Expansions`, a request whose every path is safe
is marked `approved`, and a mixed request stays pending trimmed to just the
paths that still need a human. This is the unblock `/cdd-resume` runs before it
would otherwise stop on a pending CER. No-op unless the policy mode is
`auto-safe`.

```bash
cdd-kit context auto-approve add-jwt-auth
```

#### `cdd-kit context approve-interactive <change-id>`

Walks each pending CER one at a time with a plain-language tag per path (inside
an auto-safe zone / outside the usual safe zones / blocked by policy) and a
`[y]es / [n]o-skip / [q]uit` prompt — so a non-engineer can adjudicate without
hand-editing the manifest. Reads answers from stdin and stops cleanly on EOF
(it never hangs a non-interactive session).

```bash
cdd-kit context approve-interactive add-jwt-auth
```

#### `cdd-kit context reject <change-id> <request-id>`

Rejects a pending Context Expansion Request and records `status: rejected` in the manifest.

```bash
cdd-kit context reject add-jwt-auth CER-001
cdd-kit context reject add-jwt-auth --all-pending   # bulk reject every pending request
```

#### `cdd-kit context list <change-id>`

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
(`"enabled": true`); `cdd-kit init` scaffolds a disabled config. You don't have to
edit JSON by hand: when an API contract and real source code are both present,
`cdd-kit doctor` flags that drift detection is off and `cdd-kit doctor --fix` turns
it on for you (and `cdd-kit setup` prints the same recommendation). See
[docs/api-conformance.md](docs/api-conformance.md). This is the mechanical net
for frontend/backend API drift in a workflow where no human reviews the contract
by hand.

---

### `cdd-kit openapi export`

Projects `contracts/api/api-contract.md` into a minimal **OpenAPI 3.1** skeleton for tooling (e.g. feeding `openapi-typescript` to generate a typed frontend client). The markdown contract stays the source of truth; the OpenAPI document is a one-way, regenerable projection.

```bash
cdd-kit openapi export                          # JSON to stdout
cdd-kit openapi export --yaml --out openapi.yaml # YAML to a file
cdd-kit openapi export --check --out openapi.json # sync gate: fail on drift
```

It derives paths (normalizing `:id`/`{id}`), path parameters, auth → bearer security, and success/error status codes. Free-form request/response schemas in the contract are marked `x-cdd-unresolved` rather than fabricated. Generating an actual client is left to your stack's generator in your own CI — this is the **preventive** complement to the **detective** conformance check above. See [docs/openapi-export.md](docs/openapi-export.md) and [docs/adr/0001-contract-to-openapi-export.md](docs/adr/0001-contract-to-openapi-export.md).

`--check` is the **sync gate**: it does not write, it verifies the committed artifact at `--out` still matches the contract and exits non-zero on drift, so CI fails when a contract edit forgets to regenerate the export (and the typed client downstream). To wire the consumer half, `cdd-kit init` scaffolds editable `contract:client` and `contract:client:check` npm scripts when a `package.json` is present — the generic contract→OpenAPI step is the kit's, the stack-specific codegen stays an editable script in your repo.

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
# ✓  pre-commit hook installed at .git/hooks/pre-commit
```

Idempotent. Preserves existing hook content. Bypass with `--no-verify` is possible but defeats enforcement.

---

### `cdd-kit install-agent-hooks`

Installs Claude Code **agent hooks** into the project's `.claude/settings.json`, turning a hook from a documented file you wire by hand into an enforced harness chokepoint. Three hooks are available and armed independently:

- the **graph-first** `PreToolUse` hook, which steers agents to `cdd-kit index query --with-source` before reading source files;
- the **contract-write** `PreToolUse` hook (ADR 0004 §6), which routes the agent's `Edit`/`Write` of `contracts/api/api-contract.md` to `cdd-kit contract set` — a keyed, valid-by-construction mutation instead of a free-form edit.
- the **test-runner** `PreToolUse` hook (ADR 0005 §10), which steers a broad whole-suite test command (a bare `pytest`, `npm test`, `jest`, `go test ./...`, …) to the bounded ladder `cdd-kit test run --phase …` so the run produces gate-checkable evidence instead of noisy multi-failure output.

```bash
cdd-kit install-agent-hooks                                                # graph-first advisory (default)
cdd-kit install-agent-hooks --graph-first strict                           # hard-block source Reads when a code-map exists
cdd-kit install-agent-hooks --contract-write strict                        # hard-block agent edits of the API contract
cdd-kit install-agent-hooks --test-runner advisory                         # warn on broad whole-suite test runs (ship this first)
cdd-kit install-agent-hooks --test-runner strict                           # hard-block broad whole-suite test runs
cdd-kit install-agent-hooks --graph-first advisory --contract-write strict # arm several at once
```

- **advisory**: reminds the agent to use the kit command first; does not block the tool call.
- **strict**: writes the hook's `CDD_*_STRICT=1` flag so the hook blocks the tool call (`exit 2`) — graph-first blocks source `Read` when `.cdd/code-map.yml` exists; contract-write blocks `Edit`/`Write` of the API contract (a first-time scaffold, when the file does not exist yet, is always allowed); test-runner blocks a broad whole-suite test `Bash` command (a bounded target, `cdd-kit test run`, and every non-test command are always allowed). Per ADR 0005 §10, ship the test-runner hook **advisory first** and only move to strict after it has settled in.

Naming one flag arms only that hook and leaves the others untouched, so they can be armed in separate runs; a bare `install-agent-hooks` arms graph-first advisory (unchanged). All three gate only the *agent's* tools — a human editing or running tests in their own terminal is unaffected. Writes the hook script(s) to `.claude/hooks/` and `PreToolUse` entries to `.claude/settings.json` (project-scoped, so they travel with the repo). Idempotent: re-running replaces only the cdd-kit entry for the named hook and switches its mode cleanly, preserving every other setting and hook. `cdd-kit init` (and `cdd-kit setup`) arm the **graph-first and test-runner** hooks advisory by default — `init --no-test-runner` keeps graph-first but leaves test-runner dormant. The **contract-write** hook remains opt-in (ADR 0004 §6) and is never auto-armed.

---

### `cdd-kit lint-agents`

Lints `.claude/agents/*.md` for the required-artifacts format and read-scope
hygiene the kit's agent prompts depend on — e.g. a well-formed
`## Required Artifacts` block and a graph-first / agent-log protocol pointer.

```bash
cdd-kit lint-agents            # report format/hygiene issues (advisory)
cdd-kit lint-agents --strict   # fail (exit 1) on warnings too, e.g. a missing protocol pointer
```

Use it in CI (or before committing edits to the agent prompts) to keep the
shipped agents consistent. Advisory by default; `--strict` turns warnings into a
non-zero exit.

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
cdd-kit code-map --watch                  # background: keep the map fresh as files change
cdd-kit code-map --watch --debounce 800   # coalesce change bursts within 800ms
```

Indexing is **trigger-based by default** — the map regenerates when a command
needs it (gate, `index query --refresh`, `doctor --fix`, the pre-commit code-map
hook). That is the right default for ephemeral CI containers and one-shot agent
runs. `--watch` is the opt-in **background** mode for long-lived co-editing
sessions: a debounced recursive watcher keeps the map fresh so queries stay cheap
and current, with a freshness-polling fallback where recursive `fs.watch` is
unavailable. See
[docs/adr/0003-code-intelligence-indexing-strategy.md](docs/adr/0003-code-intelligence-indexing-strategy.md)
for why the kit keeps native AST scanners instead of an LSP daemon, and the
incremental-rebuild roadmap.

`--workers [n]` (default off; `n` defaults to CPU count − 1, capped at 16)
parallelizes the synchronous JS/TS/Vue parsing across child processes for large
repos. Output is byte-identical to a single-process run, and any worker failure
falls back to in-process scanning, so it can never make a run worse. Python is
already scanned in its own subprocess.

A JSON sidecar (`.cdd/code-map.<...>.index.json`) is written next to each map and
gitignored automatically; `cdd-kit index` reads it to skip re-parsing the YAML on
large maps, and falls back to the YAML whenever the sidecar is absent or stale.

After a `git clone` or checkout every source file gets a fresh mtime, so a map
that is actually current looks stale by mtime and each query pays a full-tree
content-digest recompute to prove otherwise. Once a refreshing query confirms
freshness that way, it bumps the map's mtime forward, so the *next* query passes
the cheap mtime check and skips the recompute. This only happens on the query
path (`cdd-kit index`/`graph` with refresh on, the default); `--no-refresh`,
`cdd-kit doctor`, and `cdd-kit gate` never write to the map.

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
cdd-kit graph context "filter options are empty"  # multi-word task → ranked entry points
cdd-kit graph context "order export" --with-source # entry points + their code in one call
cdd-kit graph impact src/services/orders.ts --depth 2
cdd-kit graph unresolved src/services/orders.ts   # external/dynamic/DI calls this file makes
```

`cdd-kit graph unresolved [path-or-symbol]` (also `cdd_graph_unresolved` over MCP)
lists the `calls`/`extends`/`implements` references the graph builder could not
link to a target node — DI-container lookups, external service calls, dynamic
dispatch, and ambiguous names. These are exactly the edges that `graph impact`
cannot follow, so `graph impact` now also reports the unresolved references
originating from its impact set: the blast radius is no longer silently
undercounted. Each item carries same-name candidate nodes (present = *ambiguous*;
absent = *truly external*). Options: `--kind <calls|extends|implements|references|imports>`,
`--limit <n>` (default 50), `--map`, `--no-refresh`, `--json`. An empty result is
a successful, healthy one (exit 0): every reference resolved.

`--with-source` (also on `cdd-kit index query`, and `withSource: true` via MCP)
returns the matched symbol's code inline so the query *replaces* a `Read` rather
than preceding it — making the kit tool strictly cheaper than the built-in
`Read`. `--source-budget <n>` caps total lines returned; truncated ranges are
flagged so you can `Read` only those.

**Truncation is always visible.** Both `cdd-kit index query` and
`cdd-kit graph query` (and the MCP tools that wrap them) report `total_matches`,
`returned`, and `truncated` in their JSON, and print `results: N (of M; raise
--limit …)` in text — so an agent knows the `--limit` hid matches instead of
assuming it saw everything. `index query` additionally flags per-file
truncation: when one file has more matches than the per-file cap, its result
carries `match_count` and `matches_truncated: true` (narrow the query to surface
the rest).

To make graph-first exploration a real chokepoint instead of a prompt
preference, wire the shipped `hooks/pre-tool-use-graph-first.sh` as a
`PreToolUse` hook on `Read` (advisory by default; `CDD_GRAPH_FIRST_STRICT=1`
hard-blocks source `Read`s when a code-map exists). The hook has a **staleness
guard**: if the file about to be read is newer than `.cdd/code-map.yml`, the
index cannot describe it yet, so the hook skips the graph-first advisory, prints
a one-line `cdd-kit code-map` refresh nudge instead, and always allows the read
— even under strict mode — rather than steering the agent to a stale index.

Use `--engine native` for the built-in graph, `--engine codemap` for the older
code-map-only fallback, `--engine codegraph` to require external CodeGraph, or
`CDD_CODEGRAPH_BIN=/path/to/codegraph` to point at a custom binary.

### `cdd-kit bug suspects`

The bug-fix lane's symptom-to-suspects mapper (ADR 0006). It packages the
graph/index layer above into a single symptom-driven query: given a defect
description, it returns candidate source files with matched symbols, line ranges,
a reason, and caller/dependent impact — the smallest useful read scope before you
open any file. It is read-only and does not edit code.

```bash
cdd-kit bug suspects <change-id> --symptom "<text>"   # change-scoped
cdd-kit bug suspects --text "<text>"                  # change-less (no tracked change yet)
```

Two invocation forms:

- **change-scoped** — pass a tracked `<change-id>` plus `--symptom "<text>"`. The
  query also folds in that change's `context-manifest.md` allowed paths (ranked
  first; candidates outside the manifest are flagged), `test-plan.md` tests, and
  staged files.
- **change-less** — pass `--text "<text>"` with no change id, to explore before a
  change exists.

Flags:

- `--json` — print the machine-readable payload (shown below) instead of the
  human-readable list.
- `--limit <n>` — cap the number of candidates (default `20`).
- `--map <path>` — code-map to query (default `.cdd/code-map.yml`); the native
  `.cdd/code-graph.index.json` beside it is preferred, with the code-map as the
  fallback.
- `--refresh` — regenerate a stale code-map before querying (off by default, so a
  routine query never mutates the committed index).

Exit codes: `0` on success — **including a zero-candidate result** (an empty
`candidates` list is a valid answer, not an error); `2` for a usage/setup problem
— no symptom text given, an unknown `<change-id>`, or no code intel
(`.cdd/code-graph.index.json` / `.cdd/code-map.yml`) to query (run `cdd-kit
code-map` first).

`--json` payload (real output, abbreviated to two candidates):

```json
{
  "change_id": null,
  "symptom": "gate fails to validate bug-fix evidence",
  "candidates": [
    {
      "path": "src/commands/gate.ts",
      "symbols": ["gate", "GateOptions", "EvidenceRun", "TestEvidenceFile"],
      "reason": "gate, gate.ts, GateOptions matched graph index",
      "read_ranges": ["1288-1413", "116-118", "563-569", "571-578"],
      "impact": { "callers": [], "dependents": [] }
    },
    {
      "path": "src/commands/validate.ts",
      "symbols": ["validate"],
      "reason": "validate matched graph index",
      "read_ranges": ["49-119"],
      "impact": { "callers": ["src/commands/gate.ts"], "dependents": [] }
    }
  ],
  "next_commands": ["cdd-kit graph query gate --with-source"]
}
```

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
- `cdd_test_impact` — tests affected by changing a file (transitive importing tests + mirror-path tests)
- `cdd_graph_unresolved` — references the graph could not resolve (external/dynamic/DI calls, ambiguous names); the blast radius `cdd_graph_impact` would otherwise omit
- `cdd_contract_query` — the matching slice of the API contract by key (endpoint/schema/path/column/term)
- `cdd_contract_locate` — contract slices related to a code symbol/file by name overlap

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

## Parallel changes (multiple worktrees)

When several tracked changes are developed at once — one git worktree per change,
because multiple proposals are ready or were scaffolded together — they collide
at merge time on shared governance surfaces: a contract's single `schema-version`
line, the shared `contracts/CHANGELOG.md`, and the regenerated `.cdd/*` indexes.
None of these are logical conflicts, yet they force hand-merging or babysitting.

cdd-kit pre-empts the textual conflicts and escalates only genuine semantic
overlap (two changes editing the same contract surface). See
`docs/adr/0009-parallel-change-integration.md` and the `/cdd-parallel` skill.

```bash
# Fan-out, on the base branch BEFORE branching — reserve a distinct version lane
# per (change, contract) so no two branches bump the same contract to the same version:
cdd-kit reserve add-export   --contract api --bump minor --surface endpoints/export --branch feat/export
cdd-kit reserve refactor-auth --contract api --bump minor --surface endpoints/login  --branch feat/auth
cdd-kit parallel arm          # register the merge.ours git driver (once per clone)

# Each worktree writes its changelog entry as a fragment, never the shared file:
#   contracts/changelog.d/<change-id>.md

# Fan-in — contention matrix + deterministic, monotonic merge order:
cdd-kit integrate             # exit 0 = automatable; exit 3 = surface collision needs a human
cdd-kit changelog build       # assemble fragments into the ## Unreleased section
```

`.gitattributes` marks the regenerated `.cdd/*` indexes `merge=ours` (rebuild
with `cdd-kit refresh` after merging) and `contracts/CHANGELOG.md` `merge=union`.

## Development disciplines

Beyond the delivery pipeline, the skill ships process-discipline standards
(adapted from the [superpowers](https://github.com/obra/superpowers) methodology)
that the agents follow, in
`.claude/skills/contract-driven-delivery/references/`:

| Reference | Applies when |
|---|---|
| `requirement-discovery.md` | a request is vague/oversized — refine intent before classifying |
| `systematic-debugging.md` | bug-fix lane — no fix without root cause; three-strike architecture rule |
| `verification-before-completion.md` | before claiming done — exercise the flow, don't report from intent |
| `parallel-worktree-standard.md` | developing several changes concurrently (above) |
| `skill-authoring-standard.md` | adding/editing a skill, agent, or reference (TDD-for-process-docs) |

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
├── contracts/
│   ├── api/api-contract.md          → what endpoints exist and how they behave
│   ├── css/css-contract.md          → design tokens, component states
│   ├── data/data-shape-contract.md  → schemas, types, nullability
│   ├── env/env-contract.md          → every env var, secret flags, defaults
│   ├── business/business-rules.md   → rules, edge cases, decision tables
│   └── ci/ci-gate-contract.md       → gate tiers, promotion, rollback
├── specs/
│   ├── project-profile.md           → overall system description
│   ├── changes/                     → active in-progress changes
│   │   └── <change-id>/
│   │       ├── change-request.md    (required)
│   │       ├── change-classification.md (required)
│   │       ├── test-plan.md         (required)
│   │       ├── ci-gates.md          (required)
│   │       ├── tasks.yml            (required)
│   │       └── agent-log/           optional handoff notes
│   ├── archive/                     → completed and abandoned changes
│   │   ├── INDEX.md
│   │   └── 2026/<change-id>/
│   └── templates/
├── tests/
├── CLAUDE.md                        → Claude's project guide (edit this)
├── AGENTS.md                        → agent roster (auto-managed)
└── CODEX.md                         → Codex project guide when initialized for Codex
```

---

## Risk tiers and what each triggers

| Tier | Risk level | Example changes | Extra agents |
|---|---|---|---|
| 0–1 | High / critical | Auth, payments, migrations, concurrency | E2E + monkey + stress/soak |
| 2–3 | Medium | Feature with API change, bug fix with behavior change | Contract review + QA |
| 4–5 | Low | Docs, prompts, config only, no behavior change | Contract review + QA |

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
