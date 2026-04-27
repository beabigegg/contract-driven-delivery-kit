# Contract-Driven Delivery Kit

A reusable Claude Code development kit for brownfield full-stack systems that need specification-driven development, test-driven development, strict contracts, CI/CD gates, visual review, E2E, resilience, fuzz/monkey, stress, and soak testing.

This kit is designed for internal production systems such as dashboards, reporting systems, workflow tools, and data-heavy web apps. It is repo-informed but repo-agnostic: install it once, deploy it into any repository, and apply the same delivery discipline without repeating instructions every time.

## Install via npm

```bash
npm install -g contract-driven-delivery
```

Requires Node.js 18+ and Python 3.8+.

## CLI Usage

### `cdd-kit init`

Installs Claude Code agents and the `contract-driven-delivery` skill into `~/.claude`, and scaffolds project files (`contracts/`, `specs/templates/`, `tests/templates/`, `ci/`, `CLAUDE.md`, `AGENTS.md`) into the current repository.

```bash
cdd-kit init                  # global + local (recommended for first-time setup)
cdd-kit init --global-only    # only install agents/skill into ~/.claude
cdd-kit init --local-only     # only scaffold project files in current repo
cdd-kit init --force          # overwrite existing project files (CLAUDE.md is never overwritten)
```

### `cdd-kit update`

Updates the agents and skill in `~/.claude` to the latest installed version. Does not touch project-level files like `contracts/` or `CLAUDE.md`.

```bash
cdd-kit update
```

### `cdd-kit new <name>`

Creates a new change scaffold under `specs/changes/<name>/` with the required template files.

```bash
cdd-kit new add-user-auth             # required templates only
cdd-kit new add-user-auth --all       # include all optional templates
cdd-kit new add-user-auth --force     # re-scaffold even if directory already exists
```

Required templates: `change-request.md`, `change-classification.md`, `test-plan.md`, `ci-gates.md`, `tasks.md`

Optional templates (with `--all`): `current-behavior.md`, `proposal.md`, `spec.md`, `design.md`, `contracts.md`, `qa-report.md`, `regression-report.md`, `archive.md`

### `cdd-kit validate`

Runs contract validation scripts against the current repository.

```bash
cdd-kit validate                # run all validators
cdd-kit validate --contracts    # validate API/data/CSS contracts + semantic validators
cdd-kit validate --env          # validate env contract
cdd-kit validate --ci           # validate CI gate policy
cdd-kit validate --spec         # validate spec traceability
```

`--contracts` also chains two semantic validators:
- **API semantic**: checks endpoint table for valid HTTP methods, paths starting with `/`, and valid auth values.
- **Env semantic**: checks variable table for secrets with default values (forbidden), and warns on required non-secret vars with no default.

### `cdd-kit detect-stack`

Detects the project tech stack from lockfiles and config files.

```bash
cdd-kit detect-stack
# Detected stack: conda
# Candidates (in order): conda, pnpm
# Polyglot: yes (config will be generated for conda)
```

## Supported stacks (stack detection)

| Language   | Tool    | Detection signal                             |
|------------|---------|----------------------------------------------|
| Python     | conda   | `environment.yml`, `conda-lock.yml`, `meta.yaml` |
| Python     | poetry  | `pyproject.toml` with `[tool.poetry]`        |
| Python     | uv      | `pyproject.toml` (no poetry section)         |
| Python     | pip     | `requirements.txt`                           |
| JavaScript | pnpm    | `package.json` + `pnpm-lock.yaml`            |
| JavaScript | bun     | `package.json` + `bun.lockb`                 |
| JavaScript | yarn    | `package.json` + `yarn.lock`                 |
| JavaScript | npm     | `package.json` (no lockfile match)           |
| Go         | go      | `go.mod`                                     |
| Rust       | rust    | `Cargo.toml`                                 |

When multiple language families are detected (polyglot project), `cdd-kit init` generates CI config for the first detected stack and prints a warning.

## First-time setup in a repository

```bash
# 1. Install the CLI globally
npm install -g contract-driven-delivery

# 2. Navigate to your repository
cd your-repo

# 3. Deploy the kit
cdd-kit init

# 4. Open Claude Code and run the workflow
# Ask Claude Code: "Use the contract-driven-delivery workflow.
# Scan this repo, create a project profile, identify missing contracts,
# and recommend the minimum standardization changes before feature work."
```

## What to expect after `cdd-kit init`

The first `cdd-kit validate` after `init` is expected to print contract placeholder warnings — six contract files are scaffolded but empty. Validation still exits 0; warnings are advisory.

```text
Warning: contracts present but appear empty: contracts/api/api-contract.md, ...
Fill them in before relying on the gate.
```

To turn warnings off, fill each contract with real content (typical user-filled contracts run 500+ characters of meaningful text, well above the placeholder threshold). Recommended filling order:

1. `contracts/env/env-contract.md` — list every env var your app reads, with `secret`, `default`, `validation` columns.
2. `contracts/api/api-contract.md` — inventory every endpoint with method, path, request/response shape, and error format.
3. `contracts/data/data-shape-contract.md` — required columns, types, nullability, and malformed-data behavior for each data surface.
4. `contracts/css/css-contract.md` — design tokens, component states, and forbidden raw values.
5. `contracts/business/business-rules.md` — current rules, decision tables, edge cases.
6. `contracts/ci/ci-gate-contract.md` — gate tiers, promotion policy, rollback policy.

`cdd-kit validate --contracts` re-runs only the contract check; use it incrementally as you fill each file.

## What this kit standardizes

- Change classification before implementation
- SDD artifacts for every meaningful change
- TDD and test-first handoff rules
- API, CSS/UI, environment, data-shape, business-rule, and CI/CD contracts
- Required CI/CD gate planning for every change
- E2E, resilience, data-boundary, monkey-operation, stress, and soak testing
- Visual and UI/UX review for frontend changes
- Spec drift audits across multiple iterations
- Archiving completed changes back into durable standards

## Core workflow

1. Classify the change.
2. Scan the repository context.
3. Decide the required artifact path.
4. Write or update specs, contracts, tests, and CI gate plan before implementation.
5. Implement through the right engineer agents.
6. Run local and CI gates.
7. Run visual, E2E, resilience, stress, soak, or monkey testing as required.
8. Archive stable learnings back into contracts and standards.

## Change folder structure

```text
specs/changes/<change-id>/
├── change-request.md        (required)
├── change-classification.md (required)
├── test-plan.md             (required)
├── ci-gates.md              (required)
├── tasks.md                 (required)
├── current-behavior.md
├── proposal.md
├── spec.md
├── design.md
├── contracts.md
├── qa-report.md
├── regression-report.md
└── archive.md
```

## Definition of done

A change is not done until:

- Required specs and contracts are updated.
- Required tests exist and are mapped to acceptance criteria.
- Required CI/CD gates are present and green or explicitly marked as informational with promotion policy.
- UI changes have visual evidence.
- Data/reporting changes have data-boundary and bad-shape coverage.
- High-load or long-running features have stress or soak evidence.
- The archive captures what should become durable project knowledge.

## Stress / Soak runner support

cdd-kit ships starter configs for three load runners. Pick one
when filling out `tests/<change-id>/stress-test-plan.md`:

| runner | best for | example |
|--------|----------|---------|
| k6 | JS-friendly, scriptable scenarios, native thresholds | tests/templates/stress/k6-example.js |
| locust | Python teams, complex stateful scenarios | tests/templates/stress/locust-example.py |
| artillery | declarative YAML, quick http flows | tests/templates/stress/artillery-example.yml |

Soak templates live under `tests/templates/soak/`.

## Updating the kit

```bash
npm update -g contract-driven-delivery
cdd-kit update
```

## License

MIT
