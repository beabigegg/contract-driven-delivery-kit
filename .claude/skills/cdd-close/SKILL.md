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

## Abandon path

If the user wants to **abandon** this change (not close as complete):

```
cdd-kit abandon <change-id> --reason "<reason>"
```

This marks `tasks.md` as `status: abandoned` and records it in `specs/archive/INDEX.md`. The directory is preserved for git history. Do NOT run the rest of this skill after abandoning.

---

## Step 1: Confirm gate status

Run: `cdd-kit gate <change-id>`

If gate fails: stop and report failures. Do NOT archive a change that hasn't passed gate.

Exception: if `tasks.md` contains `status: gate-blocked`, ask the user: "This change was gate-blocked. Abandon it? (yes/no)". If yes, run `cdd-kit abandon <change-id> --reason "gate-blocked after 3 attempts"` and stop.

---

## Step 2: Review tasks.md section 7

Read `specs/changes/<change-id>/tasks.md`.

Check section 7:
- `7.1 Archive change` — will be ticked after Step 4
- `7.2 Promote durable learnings to contracts or CLAUDE.md` — must be done NOW

If `7.2` is `[ ]`, proceed to Step 2.5. If already `[x]` or `[-]`, skip Steps 2.5 and 3.

---

## Step 2.5: Create archive.md

Read `specs/changes/<change-id>/agent-log/` (all log files) and `specs/changes/<change-id>/qa-report.md` (if exists).

Synthesize a `specs/changes/<change-id>/archive.md` file with:
- **Change Summary**: 1 paragraph what was changed and why
- **Final Behavior**: what the system now does differently
- **Final Contracts Updated**: list from agent-log evidence
- **Final Tests Added / Updated**: list from agent-log evidence
- **Final CI/CD Gates**: list from ci-gates.md
- **Production Reality Findings**: any surprises or deviations from the plan (from qa-reviewer agent-log)
- **Lessons Promoted to Standards**: (leave blank — to be filled in Step 3)
- **Follow-up Work**: any known issues deferred

This file is the source for Step 3's learning promotion.

---

## Step 3: Promote learnings (task 7.2)

Read `specs/changes/<change-id>/archive.md` section `## Lessons Promoted to Standards`.

If there are lessons to promote, invoke `contract-reviewer` with:
- The archive.md lessons section
- Instruction: "Review these lessons and propose specific additions to the relevant contract files. For each lesson, output: target file, target section, proposed text (≤ 5 lines), schema-version bump required (yes/no)."

After contract-reviewer responds:
1. Apply each proposed addition to the contract file (YOU write)
2. Run `cdd-kit validate --contracts` to confirm format is preserved
3. Fill in `## Lessons Promoted to Standards` in archive.md with what was promoted
4. Tick `7.2` in tasks.md

If there are no lessons to promote, mark `[-]` for 7.2 with rationale.

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
