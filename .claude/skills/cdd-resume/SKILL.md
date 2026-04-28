---
name: cdd-resume
description: Resume an in-progress change across sessions. Reads tasks.md and agent-log/ to determine where to continue. Args: <change-id>
---

# cdd-resume — Resume a Change

## Purpose

Use when returning to a change after a session break, or when `/cdd-new` was interrupted.

## Input

Provide the `change-id`. If unsure, run `cdd-kit list` to see active changes.

---

## Step 1: Read current state

Read `specs/changes/<change-id>/tasks.md`:
- Identify all `[x]` (done) items
- Identify all `[-]` (N/A) items  
- Identify all `[ ]` (pending) items

Read `specs/changes/<change-id>/agent-log/` to list which agents have already run.

Read `specs/changes/<change-id>/change-classification.md` to recall the tier and required agents.

---

## Step 2: Report state and ask to continue

Output a resume summary:

```
## Resume: <change-id>

Tier: <tier>
Status: <in-progress | gate-blocked>

Completed agents: <list from agent-log/>
Pending tasks: <list of [ ] items>

Next agent to run: <agent-name> (based on tier flow and what's missing)
```

Ask the user: "Continue from <next-agent>? (yes/no)"

---

## Step 3: Continue the flow

If user confirms, resume from the next agent in the Tier sequence (refer to `/cdd-new` Step 3 for the agent order). 

**Critical**: Inject `CURRENT_CHANGE_ID: <change-id>` at the start of every agent prompt. Do NOT re-run agents that already have a `status: complete` agent-log.

Continue until all required agents are done, then run `cdd-kit gate <change-id>`.

---

## Rules

- Never re-run an agent that already has `status: complete` in its agent-log
- Never start from Step 1 of `/cdd-new` — only resume from the next pending agent
- If tasks.md has `status: abandoned`, report to user and stop
- If tasks.md has `status: gate-blocked`, go directly to gate retry (max 3)
