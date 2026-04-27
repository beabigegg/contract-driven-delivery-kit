---
name: cdd-new
description: Start a new tracked change. Scaffolds all required artifacts, classifies the change by risk tier, commissions the right agents in order, and runs cdd-kit gate. Args: <change description in natural language>
---

# cdd-new — New Change Request

## Input

The skill argument is the user's change description in natural language (e.g., "add JWT authentication to the API" or "redesign the dashboard homepage").

If no description is provided, ask the user: "Please describe the change you want to make."

---

## Step 1: Generate change-id and scaffold

Derive a `change-id` from the description:
- kebab-case, max 5 words
- examples: `add-jwt-auth`, `redesign-dashboard-home`, `fix-order-export-timeout`

Check that `specs/changes/<change-id>/` does not already exist. If it does, append `-2` (or next available suffix).

Run the scaffold generator:

```
python .claude/skills/contract-driven-delivery/scripts/generate_change_scaffold.py <change-id>
```

If the script is unavailable, manually create `specs/changes/<change-id>/` and copy these template files:

| Source | Destination |
|--------|-------------|
| `.claude/skills/contract-driven-delivery/templates/change-request.md` | `specs/changes/<change-id>/change-request.md` |
| `.claude/skills/contract-driven-delivery/templates/change-classification.md` | `specs/changes/<change-id>/change-classification.md` |
| `.claude/skills/contract-driven-delivery/templates/test-plan.md` | `specs/changes/<change-id>/test-plan.md` |
| `.claude/skills/contract-driven-delivery/templates/ci-gates.md` | `specs/changes/<change-id>/ci-gates.md` |
| `.claude/skills/contract-driven-delivery/templates/tasks.md` | `specs/changes/<change-id>/tasks.md` |

Fill in `change-request.md`:
- `## Original Request` → the user's exact description
- `## Business / User Goal` → infer from context
- `## Requested Delivery Date / Priority` → "as soon as possible" if not specified

---

## Step 2: Classify the change

Invoke `change-classifier` agent with:
- The user's change description
- The project profile at `specs/project-profile.md` (if it exists)
- The existing contracts in `contracts/` (if any)

The classifier must write a complete `specs/changes/<change-id>/change-classification.md` including:
- Risk tier (Tier 0–5, or low / medium / high / critical)
- Affected surfaces (API, UI, env, data, CI)
- List of required agents

Wait for `change-classification.md` to be written before continuing.

---

## Step 3: Read the tier and commission agents

Read `change-classification.md` to determine the tier. Then invoke agents **in the exact order below**, waiting for each to complete its `specs/changes/<change-id>/agent-log/<agent-name>.md` before proceeding.

### Tier 4–5 (low risk: docs, prompts, config-only, no behavior change)

1. `contract-reviewer` — confirm no contracts are touched or all touched ones are already updated
2. `qa-reviewer` — confirm release readiness

### Tier 2–3 (normal: feature, enhancement, bug fix with behavior change)

1. `contract-reviewer` — update or create contracts in `contracts/` before any implementation starts
2. `test-strategist` — author `specs/changes/<change-id>/test-plan.md`
3. `spec-architect` — only if the classifier flagged an architectural boundary or cross-module impact
4. `backend-engineer` — if the change touches server, API, data, or business logic
5. `frontend-engineer` — if the change touches UI, components, or client-side behavior
6. `ui-ux-reviewer` — if any UI change (run alongside or after frontend-engineer)
7. `visual-reviewer` — if any UI change (run after ui-ux-reviewer)
8. `dependency-security-reviewer` — if the change touches lockfiles, package manifests, or DB migrations
9. `ci-cd-gatekeeper` — update `specs/changes/<change-id>/ci-gates.md`
10. `qa-reviewer` — release readiness decision

### Tier 0–1 (high risk: production data, concurrency, queues, large queries, auth, payments, exports)

All agents from Tier 2–3, plus insert these after `frontend-engineer` / `backend-engineer`:

- `e2e-resilience-engineer` — E2E, failure-injection, data-boundary tests
- `monkey-test-engineer` — adversarial input, fuzz, rapid-UI-action tests
- `stress-soak-engineer` — load, soak, and long-running stability tests

**Agent commission rules**:
- Skip an agent only if the classifier explicitly marks its surface as "not affected"
- If any agent sets `status: blocked` in its log, halt immediately and report the agent's `next-action` to the user — do not proceed to subsequent agents
- If the change is UI-only with no backend, skip `backend-engineer`; if backend-only with no UI, skip `frontend-engineer`, `ui-ux-reviewer`, `visual-reviewer`

---

## Step 4: Run the gate

After all required agents have completed:

```
cdd-kit gate <change-id>
```

**If gate passes**: proceed to Step 5.

**If gate fails**:
1. Read the gate error output carefully
2. Identify which artifact is missing, stub, or invalid
3. Re-invoke the specific agent responsible for that artifact with the exact fix required
4. Re-run `cdd-kit gate <change-id>`
5. Repeat until gate passes (max 3 iterations; if still failing after 3, report to user)

---

## Step 5: Report to user

Output a final summary:

```
## /cdd-new complete

Change ID: <change-id>
Risk tier: <tier>
Agents invoked: <list in order>
Gate: PASSED

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
- Every agent must write its `agent-log/<name>.md` — the gate will reject changes missing it
- `qa-reviewer` always runs last and makes the release-readiness decision
