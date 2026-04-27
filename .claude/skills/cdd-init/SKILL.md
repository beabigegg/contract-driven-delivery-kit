---
name: cdd-init
description: Initialize contract-driven delivery for a project. Handles both brand-new projects (no specs/ directory) and brownfield adoption (existing codebase). Run once per project before using /cdd-new.
---

# cdd-init — Project Initialization

## Overview

This skill sets up the contract-driven delivery system for a project. It auto-detects whether this is a new project or brownfield adoption and follows the appropriate path.

**File creation rule**: Scanning agents (repo-context-scanner, spec-drift-auditor) only READ and REPORT — they have no write tools. After receiving their report, YOU (main Claude) create all files using Edit/Write.

---

## Step 1: Detect project type

Run from the repository root:

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
cdd-kit install-hooks
```

### A2. Scan project baseline

Invoke `repo-context-scanner` agent. Ask it to report (NOT write):
- Tech stack and build commands
- Existing API endpoints (routes, controllers)
- Existing env variables in use
- Existing data models or report shapes

The agent returns its findings as text. YOU then write `specs/project-profile.md` from its output.

### A3. Create stub contracts (YOU write these)

Based on the scanner's findings, create stub files in `contracts/`:

| Surface found | File to create |
|---------------|---------------|
| API endpoints | `contracts/api.md` |
| Env variables | `contracts/env.md` |
| Data/report shapes | `contracts/data.md` (skip if none) |

Each file must have frontmatter:
```
---
schema-version: 0.1.0
status: draft
last-changed: <today's date>
---
```

Use column formats from `.claude/skills/contract-driven-delivery/references/api-contract-standard.md` and `env-contract-standard.md`.

**0.x contracts are informational only — `cdd-kit gate` does not enforce them until bumped to 1.0.0.**

### A4. Report to user

```
## cdd-init complete (new project)

Stack detected: <stack>
Files created:
- specs/project-profile.md
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
cdd-kit install-hooks
```

`cdd-kit init` will not overwrite existing files.

### B2. Scan existing project

Invoke `repo-context-scanner` agent. Ask it to report (NOT write):
- Tech stack and commands
- All existing API endpoints with method + path
- All existing env variables (name, where used, whether secret)
- Existing data models or shared data shapes
- Existing tests and CI/CD setup
- Gaps vs cdd-kit expectations

The agent returns findings as text. YOU write `specs/project-profile.md` from its output.

### B3. Reverse-engineer draft contracts (YOU write these)

Based on the scanner's findings, create or update draft contracts:

**`contracts/api.md`** — list all discovered endpoints:
```
---
schema-version: 0.1.0
status: draft
last-changed: <today>
---
| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| ...    | ...  | ...  | ...     | ...      |
```

**`contracts/env.md`** — list all discovered env variables:
```
---
schema-version: 0.1.0
status: draft
last-changed: <today>
---
| Name | Required | Default | Secret |
|------|----------|---------|--------|
| ...  | ...      | ...     | ...    |
```

**`contracts/data.md`** — only if significant data shapes exist.

Rules:
- Document what EXISTS — do not prescribe what should exist
- Mark uncertain fields with `<!-- verify -->`
- Do NOT bump above 0.x during init
- Do NOT delete or overwrite existing `contracts/` files — append sections

### B4. Run gap analysis

Invoke `spec-drift-auditor` agent. Ask it to report (NOT write):
1. What is already in place (contracts, tests, CI gates)
2. What is missing and at what priority
3. Recommended first tracked change to close the highest-risk gap

### B5. Report to user

```
## cdd-init complete (brownfield adoption)

Stack detected: <stack>
Contracts reverse-engineered (all at v0.1.0 draft):
- contracts/api.md — <N> endpoints documented
- contracts/env.md — <N> variables documented
Hook installed: .git/hooks/pre-commit

Gap report:
### Existing (found)
- ...

### Missing (needs work)
- ...

### Recommended first tracked change
- ...

Next step: /cdd-new <describe the gap or feature to address first>
```

---

## Rules

- Never delete existing files
- Never bump any contract version above 0.x during init
- Gate enforcement starts only after contracts reach 1.0.0
- Scanning agents only report — YOU (main Claude) write all files
- If `cdd-kit init` fails: `npm install -g contract-driven-delivery@latest`
