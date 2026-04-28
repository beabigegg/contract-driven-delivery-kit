---
name: cdd-close
description: Close and archive a completed change. Confirms all tasks are done, promotes durable learnings, then runs cdd-kit archive. Args: <change-id>
---

# cdd-close — Close and Archive a Change

## Purpose

A change is "done" when:
1. Gate has passed (`cdd-kit gate <change-id>` exits 0)
2. PR is merged (or change is abandoned)
3. Durable learnings have been promoted to `contracts/` or `CLAUDE.md`

This skill drives steps 2–3 and physically moves the change to `specs/archive/`.

## Input

The skill argument is the change-id (e.g., `add-jwt-auth`).

If not provided, ask: "Which change-id do you want to close?"

---

## Step 1: Confirm gate status

Run: `cdd-kit gate <change-id>`

If gate fails: stop and report failures. Do NOT archive a change that hasn't passed gate.

Exception: if `tasks.md` contains `status: gate-blocked`, the change was abandoned. Ask the user: "This change was gate-blocked. Archive as abandoned? (yes/no)"

---

## Step 2: Review tasks.md section 7

Read `specs/changes/<change-id>/tasks.md`.

Check section 7:
- `7.1 Archive change` — will be ticked after Step 4
- `7.2 Promote durable learnings to contracts or CLAUDE.md` — must be done NOW

If `7.2` is `[ ]`, proceed to Step 3. If already `[x]` or `[-]`, skip Step 3.

---

## Step 3: Promote learnings (task 7.2)

Read `specs/changes/<change-id>/archive.md` if it exists.

Look at section "## Lessons Promoted to Standards" and "## Production Reality Findings".

For each non-trivial lesson:
- If it's a contract rule → add to the relevant `contracts/` file
- If it's a project-wide convention → add to `CLAUDE.md`
- If it's already documented → mark `[-]` (already covered)

After promoting, tick `7.2` in tasks.md: change `[ ]` to `[x]`.

---

## Step 4: Archive

Run: `cdd-kit archive <change-id>`

If successful, tick `7.1` in tasks.md (the file is now in specs/archive/, update it there):
`specs/archive/<year>/<change-id>/tasks.md` — change `7.1` from `[ ]` to `[x]`.

---

## Step 5: Report

```
## /cdd-close complete

Change ID: <change-id>
Archived to: specs/archive/<year>/<change-id>/
Learnings promoted: <list what was added to contracts/CLAUDE.md, or "none">

specs/changes/<change-id>/ has been removed from the active surface.
Token cost of future sessions reduced by ~<N> files.
```

---

## Rules

- NEVER archive before gate passes (unless user explicitly confirms abandoned)
- NEVER skip Step 3 — lessons rot if not promoted
- The archive command is irreversible without git — remind user to commit after archiving
