---
name: cdd-new
description: Start a new tracked change. Scaffolds all required artifacts, classifies the change by risk tier, commissions the right agents in order, and runs cdd-kit gate. Args: <change description in natural language>
---

# cdd-new — New Change Request

## Mental model

- `contracts/` = the single source of truth (live — always reflects current system behaviour)
- `tests/` = proof the contracts hold (live)
- `specs/changes/<id>/` = why we decided this back then (passive archive — read only when investigating history, never as input to planning)
- `CLAUDE.md` = what this project is and how to start work

## Spec depth rules

Every artifact under `specs/changes/<id>/` answers **WHAT** and **WHY**, not HOW.

Soft caps (guidance, not gate-enforced):
- `spec.md` ≤ 200 lines
- `design.md` ≤ 150 lines
- `test-plan.md` ≤ 100 lines
- `ci-gates.md` ≤ 80 lines

**Forbidden in spec artifacts** (these belong in code/tests, not specs):
- SQL DDL or migration code → put in migrations/, reference the path
- ORM model code (SQLAlchemy, Prisma, etc.) → put in source, reference the module
- Full test function bodies, mock setup, fixture data, expected JSON payloads → put in tests/
- Runnable code blocks > 10 lines belong in source files, not specs. Pseudocode and mapping tables are fine at any length.
- Per-test input/output tables with more than 15 rows (data-boundary tests with up to 15 boundary cases are acceptable)

**test-plan.md should contain:**
- Acceptance criteria → test family mapping (table)
- Test file paths and test names (one line per test, no implementation detail)
- Tier assignment per family
- Out-of-scope list

**design.md should contain:**
- Architecture summary (1 paragraph)
- Affected components (table: component | file path | nature of change)
- Key decisions and rejected alternatives (prose)
- Migration/rollback strategy (prose, not SQL)

## Input

The skill argument is the user's change description in natural language (e.g., "add JWT authentication to the API" or "redesign the dashboard homepage").

If no description is provided, ask the user: "Please describe the change you want to make."

---

## Write Responsibilities

**This distinction is critical — follow it for every step:**

| Agent type | Who writes artifact files | Who writes agent-log | Who ticks tasks.md |
|------------|--------------------------|----------------------|--------------------|
| Read-only agents (no Edit tool): `change-classifier`, `contract-reviewer`, `qa-reviewer`, `visual-reviewer`, `dependency-security-reviewer`, `ui-ux-reviewer` | YOU (main Claude) | YOU (main Claude) | YOU (main Claude) |
| Write-capable agents (have Edit): `backend-engineer`, `frontend-engineer`, `e2e-resilience-engineer`, `monkey-test-engineer`, `stress-soak-engineer`, `ci-cd-gatekeeper`, `test-strategist`, `spec-architect` | The agent itself | The agent itself | YOU (main Claude) |

**Rule**: After EVERY agent completes (whether it writes itself or you write for it), YOU must update the relevant `tasks.md` checkbox(es) from `[ ]` to `[x]`.

---

## Artifact opt-in policy

Only create optional artifacts (`current-behavior.md`, `proposal.md`, `spec.md`, `design.md`, `qa-report.md`, `regression-report.md`) when the classifier's `change-classification.md` explicitly marks them as `yes`.

Note: `archive.md` is created during `/cdd-close`, not during `/cdd-new` — it is not part of the classifier's opt-in surface.

If the classifier marks an artifact as `no` or leaves it blank, **do not create the file** — even if a review agent could contribute to it.

The 5 always-required artifacts are: `change-request.md`, `change-classification.md`, `test-plan.md`, `ci-gates.md`, `tasks.md`.

## Step 1: Generate change-id and scaffold

Derive a `change-id` from the description:
- kebab-case, max 5 words
- examples: `add-jwt-auth`, `redesign-dashboard-home`, `fix-order-export-timeout`

Check that `specs/changes/<change-id>/` does not already exist. If it does, append `-2` (or next available suffix).

**Create all scaffold files using Write (do NOT run a Python script; do NOT use Edit on pre-existing files):**

Create `specs/changes/<change-id>/change-request.md` with the user's description filled in:
```
# Change Request: <change-id>

## Original Request
<user's exact description, verbatim>

## Business / User Goal
<infer from the description>

## Non-goals

## Constraints

## Known Context

## Open Questions

## Requested Delivery Date / Priority
as soon as possible
```

Create `specs/changes/<change-id>/change-classification.md` with blank template:
```
# Change Classification

## Change Types
- primary:
- secondary:

## Risk Level
- low / medium / high / critical

## Impact Radius
- isolated / module-level / cross-module / system-wide

## Tier
- 0 / 1 / 2 / 3 / 4 / 5

## Architecture Review Required
- yes / no
- reason: (fill only if yes)

## Required Artifacts
Always required: change-request.md, change-classification.md, test-plan.md, ci-gates.md, tasks.md

## Optional Artifacts (default: no — set yes only with explicit reason)
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | |
| proposal.md | no | |
| spec.md | no | |
| design.md | no | |
| qa-report.md | no | |
| regression-report.md | no | |

## Required Contracts
- API:
- CSS/UI:
- Env:
- Data shape:
- Business logic:
- CI/CD:

## Required Test Families
- unit:
- contract:
- integration:
- E2E:
- visual:
- data-boundary:
- resilience:
- fuzz/monkey:
- stress:
- soak:

## Required Agents

## Assumptions / Clarifications
```

Create `specs/changes/<change-id>/test-plan.md` with blank template:
```
# Test Plan: <change-id>

## Acceptance Criteria → Test Mapping
| criterion id | test family | test file path | tier |
|---|---|---|---|

## Test Families Required
| family | tier | notes |
|---|---|---|
| (unit / contract / integration / e2e / data-boundary / resilience / monkey / stress / soak) | | |

## Out of Scope

## Notes
(Keep under 10 lines. Implementation detail belongs in the test files themselves.)
```

Create `specs/changes/<change-id>/ci-gates.md` with blank template:
```
# CI Gates: <change-id>

## Required Gates (block merge if failing)

## Informational Gates (report only)

## Nightly / Weekly / Manual Gates

## Promotion Policy
```

Create `specs/changes/<change-id>/tasks.md` with ALL checkboxes unchecked:
```
---
change-id: <change-id>
status: in-progress
---

<!-- [x]=done [-]=N/A [ ]=pending -->

# Tasks: <change-id>

## 1. Preparation
- [ ] 1.1 Confirm classification and required artifacts
- [ ] 1.2 Confirm contracts to update
- [ ] 1.3 Confirm CI/CD gate plan

## 2. Contract Updates
- [ ] 2.1 API contract
- [ ] 2.2 CSS/UI contract
- [ ] 2.3 Env contract
- [ ] 2.4 Data shape contract
- [ ] 2.5 Business logic contract
- [ ] 2.6 CI/CD contract

## 3. Tests First
- [ ] 3.1 Unit/contract tests
- [ ] 3.2 Integration tests
- [ ] 3.3 E2E/resilience tests
- [ ] 3.4 Data-boundary/monkey tests
- [ ] 3.5 Stress/soak tests if required

## 4. Implementation
- [ ] 4.1 Backend
- [ ] 4.2 Frontend
- [ ] 4.3 Env/deploy
- [ ] 4.4 CI/CD workflows

## 5. Review
- [ ] 5.1 UI/UX review
- [ ] 5.2 Visual review
- [ ] 5.3 Contract review
- [ ] 5.4 QA review

## 6. Verification
- [ ] 6.1 Local gates
- [ ] 6.2 PR required gates
- [ ] 6.3 Informational gates
- [ ] 6.4 Nightly/weekly/manual gates if required

## 7. Archive
- [ ] 7.1 Archive change
- [ ] 7.2 Promote durable learnings to contracts or CLAUDE.md
```

---

## Step 2: Classify the change

Invoke `change-classifier` agent with:
- The user's change description
- The project profile at `specs/project-profile.md` (if it exists)
- The existing contracts in `contracts/` (if any)

**change-classifier is read-only** — it will return its output as text. After it responds:

1. **YOU write** `specs/changes/<change-id>/change-classification.md` — replace the blank template with the classifier's classification output.
2. **YOU write** `specs/changes/<change-id>/agent-log/change-classifier.md` — copy the Agent Log block from the classifier's response.
3. **YOU tick** `tasks.md` item `1.1`.

Wait until these three writes are done before continuing.

---

## Step 3: Read the tier and commission agents

Read `change-classification.md` to determine the tier. Then invoke agents **in the exact order below**.

**For each read-only agent**: wait for its text response → YOU write its artifact file(s) → YOU write its agent-log → YOU tick relevant tasks.md item(s).

**For each write-capable agent**: wait for it to confirm completion → YOU tick relevant tasks.md item(s).

If any agent sets `status: blocked` in its log, halt immediately and report the agent's `next-action` to the user — do not proceed to subsequent agents.

---

### Tier 4–5 (low risk: docs, prompts, config-only, no behavior change)

1. **`contract-reviewer`** (read-only) — confirm no contracts are touched or all touched ones are already updated.
   - YOU write: `agent-log/contract-reviewer.md`
   - YOU tick: `1.2`, applicable items in section 2

2. **`qa-reviewer`** (read-only) — confirm release readiness.
   - YOU write: `agent-log/qa-reviewer.md`
   - YOU tick: `5.4`

---

### Tier 2–3 (normal: feature, enhancement, bug fix with behavior change)

1. **`contract-reviewer`** (read-only) — update or create contracts in `contracts/` before any implementation starts.
   - YOU write: `agent-log/contract-reviewer.md`
   - YOU tick: `1.2`, applicable items in section 2

2. **`test-strategist`** (write-capable) — writes `specs/changes/<change-id>/test-plan.md` directly.
   - YOU tick: applicable items in section 3 based on what test families were planned

3. **`spec-architect`** (write-capable) — only if `change-classification.md` contains `Architecture Review Required: yes`.
   - YOU tick: `1.3` (if it produced a gate plan)

4. **`backend-engineer`** (write-capable) — if the change touches server, API, data, or business logic. Writes implementation and its own agent-log.
   - YOU tick: `4.1` and/or `4.3` based on scope
   - Note: `tasks.md` items 3.1–3.2 (unit/contract/integration tests) are written by `backend-engineer` and/or `frontend-engineer` in TDD fashion — failing tests first, implementation second. Items 3.3–3.5 are written by dedicated test engineers (Tier 0–1 only or when classifier explicitly requires them).

5. **`frontend-engineer`** (write-capable) — if the change touches UI, components, or client-side behavior. Writes implementation and its own agent-log.
   - YOU tick: `4.2`

6. **`dependency-security-reviewer`** (read-only) — if the change touches lockfiles, package manifests, or DB migrations.
   - **Only invoke if** `change-classification.md` lists lockfiles, package manifests, or DB migrations as affected.
   - YOU write: `agent-log/dependency-security-reviewer.md`
   - YOU tick: applicable security-related items

7. **`ui-ux-reviewer`** (read-only) — if any UI change (run alongside or after frontend-engineer).
   - **Only invoke if** classifier marks UI/CSS as affected.
   - YOU write: `agent-log/ui-ux-reviewer.md`
   - YOU tick: `5.1`

8. **`visual-reviewer`** (read-only) — if any UI change (run after ui-ux-reviewer).
   - **Only invoke if** classifier marks UI/CSS as affected.
   - YOU write: `agent-log/visual-reviewer.md`
   - YOU tick: `5.2`

9. **`ci-cd-gatekeeper`** (write-capable) — writes `specs/changes/<change-id>/ci-gates.md` directly.
   - YOU tick: `1.3`, `4.4`, applicable items in section 6

10. **`qa-reviewer`** (read-only) — release readiness decision (always last).
    - YOU write: `agent-log/qa-reviewer.md`
    - YOU tick: `5.4`

---

### Tier 0–1 (high risk: production data, concurrency, queues, large queries, auth, payments, exports)

All agents from Tier 2–3, plus insert these after `frontend-engineer` / `backend-engineer` and before `dependency-security-reviewer`:

- **`e2e-resilience-engineer`** (write-capable) — E2E, failure-injection, data-boundary tests. Writes its own agent-log.
  - YOU tick: `3.3`

- **`monkey-test-engineer`** (write-capable) — adversarial input, fuzz, rapid-UI-action tests. Writes its own agent-log.
  - YOU tick: `3.4`

- **`stress-soak-engineer`** (write-capable) — load, soak, and long-running stability tests. Writes its own agent-log.
  - YOU tick: `3.5`

---

**Agent commission rules:**
- Skip an agent only if the classifier explicitly marks its surface as "not affected"
- If backend-only with no UI: skip `frontend-engineer`, `ui-ux-reviewer`, `visual-reviewer`
- If UI-only with no backend: skip `backend-engineer`

**Resuming from blocked**: After the user resolves the blocking issue, re-invoke the blocked agent (do not restart from Step 1). Continue with the remaining agents in their original order.

---

## Step 4: Run the gate

After all required agents have completed and all tasks.md items for their sections are ticked:

```
cdd-kit gate <change-id>
```

**If gate passes**:
- YOU tick: `tasks.md` item `6.1`
- Proceed to Step 5.

**If gate fails**:
1. Read the gate error output carefully
2. Identify which artifact is missing, stub, or invalid
3. Re-invoke the specific agent responsible for that artifact with the exact fix required
4. Re-run `cdd-kit gate <change-id>`
5. Repeat until gate passes (max 3 iterations; if still failing after 3, report to user)

**Terminal state after 3 failures**: Add a line at the top of `tasks.md` reading `status: gate-blocked` and report all blocking items to the user. The change is paused — do not proceed to Step 5.

---

## Step 5: Report to user

Output a final summary:

```
## /cdd-new complete

Change ID: <change-id>
Risk tier: <tier>
Agents invoked: <list in order>
Gate: PASSED

Tasks completed:
- [x] all applicable items checked in specs/changes/<change-id>/tasks.md

All artifacts written to: specs/changes/<change-id>/

Next step:
  git add specs/changes/<change-id>/
  git add <any implementation files changed>
  git commit -m "feat(<change-id>): <one-line description>"
```

If gate did not pass after 3 iterations:

```
## /cdd-new — gate blocked

Change ID: <change-id>
Gate failed after 3 attempts.

Blocking items:
- <item 1>
- <item 2>

Please review the above items and re-run: cdd-kit gate <change-id>
```

---

## Rules

- Never start implementation (backend/frontend-engineer) before `contract-reviewer` has completed for Tier 0–3 changes
- Never skip `test-plan.md` for Tier 0–3 changes
- Never skip `ci-gates.md` for any implementation change
- Every agent must have its `agent-log/<name>.md` written — YOU write it for read-only agents after receiving their response; write-capable agents write their own
- Tick the relevant `tasks.md` checkbox immediately after each agent completes — do not batch
- `qa-reviewer` always runs last and makes the release-readiness decision

---

## After Completion

The `/cdd-new` workflow is now complete. **Return to normal assistant mode immediately.** Answer any question the user asks — including questions unrelated to this change, new feature discussions, debugging help, or general conversation — without requiring them to use a specific command. The git commit shown in the report is a suggestion, not a required next step; do not wait for it before resuming normal behavior.

When the change is merged and ready to close, run `/cdd-close <change-id>` to promote learnings and archive the change directory.
