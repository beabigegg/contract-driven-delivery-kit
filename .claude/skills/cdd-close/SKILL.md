---
name: cdd-close
description: Close and archive a completed change. Confirms all tasks are done, promotes durable learnings, then runs cdd-kit archive. Args: <change-id>
---

# cdd-close — Close and Archive a Change

## Purpose

A change is "done" when:
1. Gate has passed (`cdd-kit gate <change-id>` exits 0)
2. PR is merged (or change is abandoned)
3. Durable learnings have been promoted to hot sources: `contracts/` or project guidance (`CLAUDE.md`/`CODEX.md`)

This skill drives steps 2–3 and physically moves the change to `specs/archive/`.

## Hot / Warm / Cold Data Rules

- Hot data: `contracts/`, source files, tests, CI config, `CLAUDE.md`, `CODEX.md`.
- Warm data: the active `specs/changes/<change-id>/` directory while the change is open.
- Cold data: `specs/archive/` after close.

Cold data is historical evidence, not current requirements. Do not promote claims from old specs or archive prose unless they are backed by agent-log evidence, QA evidence, changed contracts, changed tests, or passing gates from this change.

## Input

The skill argument is the change-id (e.g., `add-jwt-auth`).

If not provided, ask: "Which change-id do you want to close?"

---

## Abandon path

If the user wants to **abandon** this change (not close as complete):

```
cdd-kit abandon <change-id> --reason "<reason>"
```

This marks `tasks.yml` as `status: abandoned` and records it in `specs/archive/INDEX.md`. The directory is preserved for git history. Do NOT run the rest of this skill after abandoning.

---

## Step 1: Confirm gate status

Run: `cdd-kit gate <change-id>`

If gate fails: stop and report failures. Do NOT archive a change that hasn't passed gate.

Exception: if `tasks.yml` contains `status: gate-blocked`, ask the user: "This change was gate-blocked. Abandon it? (yes/no)". If yes, run `cdd-kit abandon <change-id> --reason "gate-blocked after 3 attempts"` and stop.

---

## Step 2: Review tasks.yml section 7

Read `specs/changes/<change-id>/tasks.yml`.

Check section 7:
- `7.1 Archive change` — will be ticked after Step 4
- `7.2 Promote durable learnings to contracts or project guidance` — must be done NOW

If `7.2` is `[ ]`, proceed to Step 2.5. If already `[x]` or `[-]`, skip Steps 2.5 and 3.

---

## Step 2.5: Create archive.md

Read only active evidence for this change:
- `specs/changes/<change-id>/agent-log/` (all log files)
- `specs/changes/<change-id>/qa-report.md` (if exists)
- `specs/changes/<change-id>/ci-gates.md`
- `specs/changes/<change-id>/context-manifest.md`
- `specs/changes/<change-id>/tasks.yml`

Do not read `specs/archive/` while closing a change. Historical archives are cold data and must not be used as current requirements.

Synthesize a `specs/changes/<change-id>/archive.md` file with:
- **Change Summary**: 1 paragraph what was changed and why
- **Final Behavior**: what the system now does differently
- **Final Contracts Updated**: list from agent-log evidence
- **Final Tests Added / Updated**: list from agent-log evidence
- **Final CI/CD Gates**: list from ci-gates.md
- **Production Reality Findings**: any surprises or deviations from the plan (from qa-reviewer agent-log)
- **Lessons Promoted to Standards**: (leave blank — to be filled in Step 3)
- **Follow-up Work**: any known issues deferred
- **Cold Data Warning**: "This archive is historical evidence. Current requirements live in contracts/ and active project guidance."

This file records the close-out evidence, but Step 3 promotion must still be evidence-gated. Archive prose alone is not enough to change hot data.

---

## Step 3: Promote learnings (task 7.2)

General agents do not perform durable learning promotion during `/cdd-new`; they
only record evidence and findings in artifacts and `agent-log/*.yml`. Durable
learning promotion happens here, during `/cdd-close` Step 3, and main Claude
owns the final writes.

Read `specs/changes/<change-id>/archive.md` section `## Lessons Promoted to Standards` and cross-check every proposed lesson against agent-log, QA report, contract/test changes, or gate evidence from this change.

Classify each candidate:
- **promote-to-contract**: stable product/system behavior, API/data/env/business/CI rule, compatibility rule, or testable invariant.
- **promote-to-guidance**: durable *agent workflow* guidance that would change how an agent behaves on a future **unrelated** change — provider/project operating rules only, never product behavior (that is promote-to-contract). This is the rare exception; default to promote-to-contract. Target the `cdd-kit:learnings` managed region of `CLAUDE.md` and/or `CODEX.md` as **one line: rule + pointer to detail**, never an inline playbook. `CLAUDE.md` is loaded into every session, so each line here is a recurring token cost.
- **do-not-promote**: one-off implementation detail, abandoned approach, temporary workaround, historical rationale, or anything contradicted by current contracts.

If there are lessons to promote, invoke `contract-reviewer` with:
- The archive.md lessons section
- Supporting evidence from agent-log / QA / changed contracts / changed tests
- Instruction: "Review these lessons and propose specific additions only for evidence-backed durable rules. For each lesson, output: classification, target file, target section, proposed text (contracts: ≤ 5 lines; CLAUDE.md/CODEX.md guidance: exactly one line = rule + pointer to the contracts/ or docs/ file holding the detail), evidence path, schema-version bump required (yes/no). Reject any cold-data-only or one-off lesson. Prefer promote-to-contract; treat CLAUDE.md/CODEX.md guidance as the rare exception."

After contract-reviewer responds:
1. Apply each approved contract addition to the contract file (YOU write)
2. Apply each approved guidance addition **inside the `cdd-kit:learnings:start` / `cdd-kit:learnings:end` markers** of `CLAUDE.md` and/or `CODEX.md` (provider/project workflow guidance only, never product behavior). If the markers are absent, create them once under a `### Promoted Learnings` heading at the end of the file, then operate within them. Follow this consolidation discipline every time — **net growth should be ≈ 0**:
   - Operate **only between the markers**. Never edit, move, or delete anything outside them — those are the human's own sections, and must be left untouched.
   - Before adding: read the existing in-region entries. If the new lesson generalizes, supersedes, or duplicates one, **edit/replace that entry in place** instead of appending.
   - Remove any in-region entry now contradicted by current `contracts/`.
   - Each entry is **one line: the rule + a pointer** (`see contracts/…` or `see docs/…`). Put the actual detail in `contracts/` (preferred — queried on demand) or a `docs/…` file; do **not** inline a playbook in `CLAUDE.md`.
   - Appending a brand-new entry is the exception — only for a genuinely new cross-change rule with no existing entry to fold into.
3. Run `cdd-kit validate --contracts` to confirm contract format is preserved
4. Run `cdd-kit context-scan` so future classifiers see updated hot context indexes
5. Fill in `## Lessons Promoted to Standards` in archive.md with what was promoted, where, and evidence path
6. Set task `7.2` to `status: done` in tasks.yml

If there are no lessons to promote, mark `7.2` as `status: skipped` with rationale.

---

## Step 4: Archive

Run: `cdd-kit archive <change-id>`

If successful, set task `7.1` to `status: done` in tasks.yml (the file is now in specs/archive/, update it there):
`specs/archive/<year>/<change-id>/tasks.yml` — change `7.1` from `status: pending` to `status: done`.

---

## Step 5: Report

```
## /cdd-close complete

Change ID: <change-id>
Archived to: specs/archive/<year>/<change-id>/
Learnings promoted: <list what was added to contracts/ or project guidance (CLAUDE.md/CODEX.md), or "none">

specs/changes/<change-id>/ has been removed from the active surface.
Token cost of future sessions reduced by ~<N> files.
```

---

## Rules

- NEVER archive before gate passes (unless user explicitly confirms abandoned)
- NEVER skip Step 3 — lessons rot if not promoted
- NEVER treat `specs/archive/` as hot requirements
- NEVER promote a lesson without an evidence path from this change
- Product behavior belongs in `contracts/`; agent workflow guidance belongs in `CLAUDE.md` and/or `CODEX.md`
- Default to promote-to-contract; `CLAUDE.md`/`CODEX.md` guidance is the rare exception (it costs tokens every session)
- NEVER append to `CLAUDE.md`/`CODEX.md` without first folding into an existing entry — net growth ≈ 0; consolidate, don't accumulate
- NEVER touch content outside the `cdd-kit:learnings` markers — that is the human's own data
- Each promoted guidance line = rule + pointer; the detail lives in `contracts/` or `docs/`, not inline
- The archive command is irreversible without git — remind user to commit after archiving
