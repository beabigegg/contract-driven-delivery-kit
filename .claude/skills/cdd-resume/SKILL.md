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

## Step 0: Detect format version

Before reading state, check if `specs/changes/<change-id>/tasks.md` starts with `---` (YAML frontmatter).

If it does NOT start with `---`, this change was created with a pre-v1.11 version of cdd-kit. Run:

```
cdd-kit migrate <change-id>
```

Then commit the migration:
```
git add specs/changes/<change-id>/tasks.md specs/changes/<change-id>/change-classification.md
git commit -m "chore: migrate <change-id> to v1.11 format"
```

If there are many mid-flight changes, suggest `cdd-kit migrate --all` instead.

---

## Step 1: Read current state

Read only these state files first:
- `specs/changes/<change-id>/tasks.md`
- `specs/changes/<change-id>/context-manifest.md` if present
- `specs/changes/<change-id>/agent-log/*.md`
- `specs/changes/<change-id>/change-classification.md`

Do not run broad repository search during resume. Do not read `src/`, `tests/`, or `contracts/` unless the current `context-manifest.md` authorizes that path or an approved expansion lists it.

From `tasks.md`:
- Identify all `[x]` (done) items
- Identify all `[-]` (N/A) items  
- Identify all `[ ]` (pending) items

Read `specs/changes/<change-id>/agent-log/` to list which agents have already run.

Read `specs/changes/<change-id>/change-classification.md` to recall the tier and required agents.

Read `specs/changes/<change-id>/context-manifest.md`:
- Identify allowed paths and approved expansions.
- Identify pending Context Expansion Requests.
- If any request has `status: pending`, stop before invoking agents. Report the request id, requested paths, and reason; ask the user to approve, reject, or narrow it.
- If `context-manifest.md` is missing on a legacy change, run `cdd-kit migrate <change-id>` before continuing. For context-governed changes, missing manifest is blocking.

---

## Step 2: Report state and ask to continue

Output a resume summary:

```
## Resume: <change-id>

Tier: <tier>
Status: <in-progress | gate-blocked>

Completed agents: <list from agent-log/>
Pending tasks: <list of [ ] items>
Pending context expansions: <none | list request ids and paths>
Allowed context: <short summary from context-manifest.md>

Next agent to run: <agent-name> (based on tier flow and what's missing)
```

Ask the user: "Continue from <next-agent>? (yes/no)"

---

## Step 3: Continue the flow

If user confirms, resume from the next agent in the Tier sequence (refer to `/cdd-new` Step 3 for the agent order). 

**Critical**: Inject this block at the start of every agent prompt:

```
CURRENT_CHANGE_ID: <change-id>
Change directory: specs/changes/<change-id>/
Context manifest: specs/changes/<change-id>/context-manifest.md
Read only paths allowed by the context manifest and approved expansions.
If more context is needed, stop and output a Context Expansion Request instead of reading outside the manifest.
```

Do NOT re-run agents that already have a `status: complete` agent-log.

Continue until all required agents are done, then run `cdd-kit gate <change-id>`.

---

## Rules

- Never re-run an agent that already has `status: complete` in its agent-log
- Never start from Step 1 of `/cdd-new` — only resume from the next pending agent
- Never use broad search to reconstruct state; resume from `tasks.md`, `context-manifest.md`, and `agent-log/`
- Never continue past pending Context Expansion Requests
- If tasks.md has `status: abandoned`, report to user and stop
- If tasks.md has `status: gate-blocked`, go directly to gate retry (max 3)
