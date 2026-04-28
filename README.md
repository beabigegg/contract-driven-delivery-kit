# Contract-Driven Delivery Kit

**cdd-kit** is a Claude Code development kit that turns AI agents into a disciplined engineering team: contracts-first, test-first, spec-first. Every change goes through classification, contract review, TDD, implementation, and gate verification — automatically orchestrated by Claude Code skills.

Designed for solo developers and small teams building brownfield production systems (dashboards, APIs, workflow tools, data apps) who want AI to do all the implementation while they stay in the spec-author and reviewer seat.

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
2. The `change-classifier` agent (Opus) reads the request, classifies risk and tier, decides which agents are needed
3. Agents run in order: contracts → test plan → spec/architecture review (if needed) → backend engineer → frontend engineer → CI/CD gates → QA
4. Each agent produces machine-verifiable evidence (agent-log files)
5. `cdd-kit gate <change-id>` runs automatically to confirm all artifacts are complete
6. Claude reports a summary and the suggested git commit

**You stay in control by:**
- Reviewing the `change-classification.md` before implementation starts
- Checking the `test-plan.md` to confirm the right test families are planned
- Reading the final `agent-log/qa-reviewer.md` for the release-readiness verdict

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
1. Claude reads `tasks.md` and `agent-log/` to determine what was completed
2. Reports the current state (which agents ran, which tasks are pending)
3. Asks if you want to continue from the next pending agent
4. Resumes the full agent flow from where it stopped, with no duplication

> If you're upgrading from an older version and your change was created before v1.11.0, Claude will automatically run `cdd-kit migrate <change-id>` to upgrade the format before resuming.

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
cdd-kit init --force          # overwrite existing project files
```

Creates: `contracts/`, `specs/templates/`, `CLAUDE.md`, `AGENTS.md`, `hooks/`

---

### `cdd-kit update`

Updates agents and skill in `~/.claude` to the latest installed version. Does not touch `contracts/` or `CLAUDE.md`.

```bash
cdd-kit update
cdd-kit update --yes          # apply without confirmation
```

---

### `cdd-kit gate <change-id>`

The single quality gate for a change. Blocks merge if anything is missing or incomplete.

```bash
cdd-kit gate add-jwt-auth
cdd-kit gate add-jwt-auth --strict
```

Checks:
- All 5 required artifacts exist (`change-request.md`, `change-classification.md`, `test-plan.md`, `ci-gates.md`, `tasks.md`)
- Each artifact has sufficient content (not a stub): change-classification ≥ 200 chars, test-plan ≥ 200, ci-gates ≥ 150, others ≥ 100
- `change-classification.md` contains a tier or risk marker
- `agent-log/*.md` files all have `status: complete` (not blocked)
- Tier 0–1 changes have `e2e-resilience-engineer`, `monkey-test-engineer`, and `stress-soak-engineer` logs
- Tier 0–3 changes have `contract-reviewer` and `qa-reviewer` logs
- All contract validators pass

`--strict` additionally:
- Treats any pending `[ ]` tasks (except section 7 archive items) as errors
- Validates that every file path listed in `agent-log` artifact pointers actually exists on disk

Pre-commit hook uses `--strict` by default (installed via `cdd-kit install-hooks`).

```
✓  gate passed for change: add-jwt-auth

✗  gate failed for change: feat-001
✗    change-classification.md: appears to be a stub (< 200 meaningful chars)
✗    Tier 1 change requires agent-log/e2e-resilience-engineer.md
✗    1 task(s) still pending (use [-] for N/A items, [x] for done)
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

Warns (but does not block) if `tasks.md` has pending items or `status: gate-blocked`. Use after `/cdd-close` — the skill runs this automatically at the end.

---

### `cdd-kit abandon <change-id>`

Marks a change as abandoned. Updates `tasks.md` status to `abandoned`, records the reason in `specs/archive/INDEX.md`. The directory stays on disk for git history.

```bash
cdd-kit abandon add-jwt-auth --reason "using Auth0 instead"
# ✓  Change add-jwt-auth marked as abandoned.
```

---

### `cdd-kit migrate <change-id> | --all`

Upgrades pre-v1.11.0 change directories to the current format.

```bash
cdd-kit migrate add-jwt-auth        # migrate one change
cdd-kit migrate --all               # migrate all changes in specs/changes/
cdd-kit migrate --all --dry-run     # preview without writing
```

What it upgrades:
- `tasks.md`: adds YAML frontmatter (`change-id`, `status: in-progress`) and `[x]/[-]/[ ]` legend if missing
- `change-classification.md`: detects old `**Tier:** Tier N` format and appends the new `## Tier\n- N` section so tier-based gate checks activate

Run this after upgrading from v1.10 or earlier if you have mid-flight changes.

```bash
cdd-kit migrate --all
git add specs/changes/
git commit -m "chore: migrate changes to v1.11.0 format"
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
```

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

## Upgrading from v1.10 or earlier

```bash
npm update -g contract-driven-delivery
cdd-kit update

# If you have mid-flight changes:
cdd-kit migrate --all
git add specs/changes/
git commit -m "chore: migrate changes to v1.11.0 format"
```

**What changed in v1.11.0:**
- `gate --strict` and pre-commit enforcement
- Tier-based agent-log requirements (Tier 0–1 must have E2E/monkey/stress logs)
- `cdd-kit abandon`, `cdd-kit archive`, `cdd-kit list`, `cdd-kit migrate` commands
- `/cdd-resume` and `/cdd-close` Claude Code skills
- `change-classifier` outputs Acceptance Criteria + Tasks Not Applicable
- All agents require `CURRENT_CHANGE_ID` injection (handled automatically by skills)

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
│   │       ├── tasks.md             (required)
│   │       └── agent-log/           ← machine-verifiable evidence per agent
│   ├── archive/                     ← completed and abandoned changes
│   │   ├── INDEX.md
│   │   └── 2026/<change-id>/
│   └── templates/
├── tests/
├── CLAUDE.md                        ← Claude's project guide (edit this)
└── AGENTS.md                        ← agent roster (auto-managed)
```

---

## Risk tiers and what each triggers

| Tier | Risk level | Example changes | Extra agents |
|---|---|---|---|
| 0–1 | High / critical | Auth, payments, migrations, concurrency | E2E + monkey + stress/soak |
| 2–3 | Medium | Feature with API change, bug fix with behavior change | Contract review + QA |
| 4–5 | Low | Docs, prompts, config only, no behavior change | Contract review + QA |

---

## Task notation in `tasks.md`

```markdown
- [x] 1.1 Confirm classification       ← done
- [-] 2.2 CSS/UI contract              ← N/A (not applicable to this change)
- [ ] 4.1 Backend implementation       ← pending
```

`cdd-kit gate --strict` treats any `[ ]` (except section 7 archive tasks) as an error. Use `[-]` for items that are genuinely not applicable to a given change.

---

## License

MIT
