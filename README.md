# Contract-Driven Delivery Kit

**cdd-kit** is a contract-driven delivery kit for AI coding agents. It started with Claude Code skills and now keeps the core workflow provider-neutral: contracts-first, test-first, spec-first. Every change goes through classification, contract review, TDD, implementation, and gate verification, with deterministic context indexes and manifest-backed read-scope auditing to keep long agent runs reviewable.

Designed for solo developers and small teams building brownfield production systems (dashboards, APIs, workflow tools, data apps), especially when non-engineers or product owners want AI to do the implementation while they stay in the spec-author and reviewer seat.

**Context Governance v1** adds a manifest-driven audit layer for AI agents. New changes include `context-manifest.md`, `agent-log` entries are expected to report `files-read`, and `cdd-kit gate` audits those reads against allowed and forbidden paths. This is governance and review support, not a sandbox.

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
6. Agents run in order: contracts → test plan → spec/architecture review (if needed) → backend engineer → frontend engineer → CI/CD gates → QA
7. Each agent produces machine-verifiable evidence (agent-log files)
8. `cdd-kit gate <change-id>` runs automatically to confirm all artifacts are complete
9. Claude reports a summary and the suggested git commit

**You stay in control by:**
- Reviewing the `change-classification.md` before implementation starts
- Checking the `test-plan.md` to confirm the right test families are planned
- Reading the final `agent-log/qa-reviewer.yml` for the release-readiness verdict

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

The change-classifier will detect that these are architectural or contract-level changes, assign a higher risk tier (0–2), and automatically require:
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
1. Claude reads `tasks.yml` and `agent-log/` to determine what was completed
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
3. Invokes `contract-reviewer` to propose any durable learnings back into `contracts/`
4. Runs `cdd-kit archive add-jwt-auth` — moves the change from `specs/changes/` to `specs/archive/2026/`
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

These are shell commands — not Claude Code skills. Run them directly in the terminal, or Claude Code will run them on your behalf.

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

### `cdd-kit gate <change-id>`

The single quality gate for a change. Blocks merge if anything is missing or incomplete.

```bash
cdd-kit gate add-jwt-auth
cdd-kit gate add-jwt-auth --strict
cdd-kit gate add-jwt-auth --lax
```

Checks:
- All required artifacts exist (`change-request.md`, `change-classification.md`, `test-plan.md`, `ci-gates.md`, `tasks.yml`; new context-governed changes also require `context-manifest.md`)
- Each artifact has sufficient content (not a stub): change-classification ≥ 200 chars, test-plan ≥ 200, ci-gates ≥ 150, others ≥ 100
- `change-classification.md` contains a tier or risk marker
- `agent-log/*.yml` files all have `status: complete` (not blocked)
- For context-governed changes, `agent-log/*.yml` files include a structured `files-read:` list and those repo-relative paths are audited against `context-manifest.md` and `.cdd/context-policy.json`
- Atomic `depends-on` upstream changes are completed or archived before dependent work gates
- Tier 0–1 changes have `e2e-resilience-engineer`, `monkey-test-engineer`, and `stress-soak-engineer` logs
- Tier 0–3 changes have `contract-reviewer` and `qa-reviewer` logs
- All contract validators pass

`--strict` additionally:
- Treats any task with `status: pending` (except IDs listed in `archive-tasks`) as an error
- Treats runtime-vs-declared `files-read` drift as errors
- Treats legacy changes missing `context-manifest.md` or `files-read` audit data as errors

Default mode also validates that artifact file pointers listed in `agent-log` evidence exist on disk. Use `--lax` only when cleaning up legacy repos with stale historical logs.

Pre-commit hook uses `--strict` by default (installed via `cdd-kit install-hooks`).

```
✓  gate passed for change: add-jwt-auth

✗  gate failed for change: feat-001
✗    change-classification.md: appears to be a stub (< 200 meaningful chars)
✗    Tier 1 change requires agent-log/e2e-resilience-engineer.yml
✗    1 task(s) still pending (mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped)
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
# ✓  Archived: specs/changes/add-jwt-auth → specs/archive/2026/add-jwt-auth
# ✓  Index updated: specs/archive/INDEX.md
```

Warns (but does not block) if `tasks.yml` has pending items or `status: gate-blocked`. Use after `/cdd-close` — the skill runs this automatically at the end.

---

### `cdd-kit abandon <change-id>`

Marks a change as abandoned. Updates `tasks.yml` status to `abandoned`, records the reason in `specs/archive/INDEX.md`. The directory stays on disk for git history.

```bash
cdd-kit abandon add-jwt-auth --reason "using Auth0 instead"
# ✓  Change add-jwt-auth marked as abandoned.
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
- `context-manifest.md`: adds a legacy manifest scaffold by default so old changes can continue with warning-only context audit behavior
- `--enable-context-governance`: explicitly adds `context-governance: v1` and a context-governed manifest scaffold, making missing manifest or malformed `files-read` data hard gate failures

`agent-log/*.yml` must use this `files-read` format for context-governed changes:

```yaml
files-read:
  - contracts/api/api-contract.md
  - src/server/routes/users.ts
```

Paths must be repo-relative. Absolute paths and `..` parent traversal are rejected.

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

### `cdd-kit context approve <change-id> <request-id>`

Approves a pending Context Expansion Request in `context-manifest.md` and adds its `requested_paths` to `## Approved Expansions`.

```bash
cdd-kit context approve add-jwt-auth CER-001
cdd-kit context approve add-jwt-auth --all-pending   # bulk approve every pending request
```

This keeps expansion history explicit while avoiding manual manifest editing. Agents still have to report `files-read` in `agent-log/*.yml`; `cdd-kit gate` audits those paths against the manifest.

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
cdd-kit validate --contracts    # API, CSS, data-shape (+ semantic checks)
cdd-kit validate --env          # env contract
cdd-kit validate --ci           # CI gate policy
cdd-kit validate --spec         # spec traceability
cdd-kit validate --versions     # contract frontmatter schema versions
```

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

---

## Migrating an Older Production Repo

```bash
npm update -g contract-driven-delivery
cdd-kit upgrade --yes
cdd-kit context-scan
cdd-kit doctor --strict
```

### Old completed specs

If a change is already finished, merged, or only kept for audit/history:

```bash
cdd-kit migrate --all
git add specs/changes/
git commit -m "chore: migrate changes to current cdd-kit format"
```

This gives those legacy specs a new `tasks.yml`, tier markers, and a warning-mode `context-manifest.md` without forcing strict context governance on closed work.

### Old in-progress specs

If a change is still being actively developed:

```bash
cdd-kit upgrade --yes --migrate-changes
cdd-kit context-scan
cdd-kit doctor --strict
```

Then choose one path per active change:

- Conservative path: keep the migrated legacy manifest, resume work, and let `gate` warn on missing `files-read` data while the team transitions.
- Strict path: run `cdd-kit migrate <change-id> --enable-context-governance`, review `context-manifest.md`, narrow `Allowed Paths`, and require agents to report `- files-read:` before continuing implementation.

### Recommended rollout for production repos already burned by token overuse

1. Run `cdd-kit upgrade --yes` once per repo after updating the npm package.
2. Run `cdd-kit context-scan` so classifiers can read `specs/context/project-map.md` and `specs/context/contracts-index.md` instead of broad repo searches.
3. Run `cdd-kit doctor --strict` in CI.
4. Migrate old completed specs with plain `cdd-kit migrate`.
5. Migrate active specs with `cdd-kit migrate --enable-context-governance` only after reviewing the generated manifest.
6. Teach agents to use `cdd-kit context request/approve/reject/list` instead of silently widening context.

---

## Directory structure after `cdd-kit init`

```
your-repo/
├── contracts/
│   ├── api/api-contract.md          ← what endpoints exist and how they behave
│   ├── css/css-contract.md          ← design tokens, component states
│   ├── data/data-shape-contract.md  ← schemas, types, nullability
│   ├── env/env-contract.md          ← every env var, secret flags, defaults
│   ├── business/business-rules.md   ← rules, edge cases, decision tables
│   └── ci/ci-gate-contract.md       ← gate tiers, promotion, rollback
├── specs/
│   ├── project-profile.md           ← overall system description
│   ├── changes/                     ← active in-progress changes
│   │   └── <change-id>/
│   │       ├── change-request.md    (required)
│   │       ├── change-classification.md (required)
│   │       ├── test-plan.md         (required)
│   │       ├── ci-gates.md          (required)
│   │       ├── tasks.yml            (required)
│   │       └── agent-log/           ← machine-verifiable evidence per agent
│   ├── archive/                     ← completed and abandoned changes
│   │   ├── INDEX.md
│   │   └── 2026/<change-id>/
│   └── templates/
├── tests/
├── CLAUDE.md                        ← Claude's project guide (edit this)
├── AGENTS.md                        ← agent roster (auto-managed)
└── CODEX.md                         ← Codex project guide when initialized for Codex
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
