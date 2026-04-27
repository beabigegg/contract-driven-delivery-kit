---
name: cdd-init
description: Initialize contract-driven delivery for a project. Handles both brand-new projects (no specs/ directory) and brownfield adoption (existing codebase). Run once per project before using /cdd-new.
---

# cdd-init — Project Initialization

## Overview

This skill sets up the contract-driven delivery system for a project. It auto-detects whether this is a new project or brownfield adoption and follows the appropriate path.

---

## Step 1: Detect project type

Run these commands from the repository root:

```
cdd-kit detect-stack
```

Then check whether `specs/` directory already exists in the repo root.

- `specs/` does **NOT** exist → **New Project** → follow Section A
- `specs/` **already exists** → **Brownfield Adoption** → follow Section B

---

## Section A: New Project

### A1. Initialize scaffold

```
cdd-kit init
```

Creates: `specs/`, `contracts/` (if not present), CI template for detected stack.

### A2. Install pre-commit hook

```
cdd-kit install-hooks
```

### A3. Scan project baseline

Invoke `repo-context-scanner` agent to scan the repository and emit an initial project profile. Write output to `specs/project-profile.md`.

### A4. Create stub contracts

For each surface the scanner found, create stub files in `contracts/` using frontmatter `version: 0.1.0` and `status: draft`:

| Surface | File |
|---------|------|
| API endpoints found | `contracts/api.md` |
| Env variables found | `contracts/env.md` |
| Data/report shapes found | `contracts/data.md` (skip if none) |

Use the standard table format from `.claude/skills/contract-driven-delivery/references/api-contract-standard.md` and `env-contract-standard.md` as the column schema.

**Note**: 0.x contracts are informational only — `cdd-kit gate` does not enforce them until bumped to 1.0.0.

### A5. Report to user

Output a summary:
```
## cdd-init complete (new project)

Stack detected: <stack>
Files created:
- specs/ (scaffold)
- contracts/api.md (draft, v0.1.0)
- contracts/env.md (draft, v0.1.0)
Hook installed: .git/hooks/pre-commit

Next step: /cdd-new <describe your first feature or change>
```

---

## Section B: Brownfield Adoption

### B1. Initialize scaffold (non-destructive)

```
cdd-kit init
```

Will not overwrite existing files. Creates missing scaffold directories only.

### B2. Install pre-commit hook

```
cdd-kit install-hooks
```

Idempotent — safe to run even if hook already exists.

### B3. Scan existing project

Invoke `repo-context-scanner` agent with full scope:
- Tech stack and commands
- Existing contracts (if any)
- Existing tests and CI/CD
- Standardization gaps vs cdd-kit expectations

Write output to `specs/project-profile.md`.

### B4. Reverse-engineer draft contracts

For each existing surface discovered by the scanner, create or update draft contracts:

- **API**: Read existing route definitions → list endpoints in `contracts/api.md` using the standard table format (method, path, auth, request shape, response shape). Set `version: 0.1.0`, `status: draft`.
- **Env**: Read existing `.env.example`, config loaders, or runtime env reads → list variables in `contracts/env.md` (name, required, default, secret). Set `version: 0.1.0`, `status: draft`.
- **Data**: If report shapes, DB schemas, or shared data types exist and are significant → list in `contracts/data.md`. Set `version: 0.1.0`, `status: draft`.

**Rules for brownfield reverse-engineering**:
- Document what exists — do NOT prescribe what should exist
- Mark all fields you are unsure about with `<!-- verify -->`
- Do NOT bump any contract above 0.x during init
- Do NOT delete or overwrite any existing `contracts/` files — append sections if a file exists

### B5. Run gap analysis

Invoke `spec-drift-auditor` to compare the current state against cdd-kit expectations. Ask it to produce:
1. What is already in place (contracts, tests, CI gates)
2. What is missing and at what priority
3. Recommended first tracked change to close the highest-risk gap

### B6. Report to user

Output a summary:
```
## cdd-init complete (brownfield adoption)

Stack detected: <stack>
Contracts reverse-engineered (all at v0.1.0 draft):
- contracts/api.md — <N> endpoints documented
- contracts/env.md — <N> variables documented
Hook installed: .git/hooks/pre-commit

Gap report:
## Existing (found)
- ...

## Missing (needs work)
- ...

## Recommended first tracked change
- ...

Next step: /cdd-new <describe the gap or feature to address first>
```

---

## Rules

- Never delete existing files
- Never bump any contract version above 0.x during init
- Gate enforcement (cdd-kit gate) is only required once contracts reach 1.0.0 — during init, draft contracts are informational
- If `cdd-kit init` fails because the tool is not installed, instruct the user: `npm install -g contract-driven-delivery@latest`
