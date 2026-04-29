# Agent Log Protocol

All cdd-kit agents share the same machine-verifiable agent-log format. This file
is the single source of truth — agent prompts reference it instead of inlining
the format. `cdd-kit gate` parses these files; drift here equals silent gate
skips, so do not re-document this in agent prompts.

## Output target

Each agent writes (or has main Claude write) one file per run:

```
specs/changes/<change-id>/agent-log/<agent-name>.md
```

If the same agent runs more than once for a change (e.g., after fix-back),
overwrite the file — only the latest run is gate-relevant.

## Required structure

```
# <Agent Display Name> Log
- change-id: <id>
- timestamp: <ISO 8601, e.g. 2026-04-27T14:30:00Z>
- status: complete | needs-review | blocked
- files-read:
  - <repo-relative path>
  - <repo-relative path>
- artifacts:
  - <evidence-type>: <concrete pointer>
  - <evidence-type>: <concrete pointer>
- next-action: <one line, or "none">
```

### Field rules

- `change-id` — must match the directory name. Mismatch is a contract violation.
- `timestamp` — ISO 8601 UTC. Used by spec-drift-auditor for ordering.
- `status` — exactly one of `complete | needs-review | blocked`. Anything
  else (e.g. `done`, `OK`, `pending`) fails gate.
- `files-read` — required for context-governed changes (`tasks.md` frontmatter
  has `context-governance: v1`). Each entry must be a repo-relative path.
  Absolute paths and `..` traversal are rejected. If you legitimately read
  nothing beyond your own change directory, write:
  ```
  - files-read:
    - specs/changes/<change-id>/
  ```
- `artifacts` — concrete pointers only. Allowed forms:
  - `path/to/file.ts:10-45`
  - `tests/foo.test.ts::should reject empty body`
  - `cdd-kit gate <id>: 0 errors` (command + outcome)
  - `contracts/api/api-contract.md#endpoints` (file + anchor)
  - **Never** `verified`, `OK`, `done`, or unscoped prose.
- `next-action` — when `status: blocked`, this must be ≥ 10 chars and
  not `none`. When `status: complete`, `none` is acceptable.

## Per-agent additional artifact requirements

Each agent prompt lists its own `### Required artifacts for this agent`. The
gate does not enforce those today; they are a discipline contract enforced by
`qa-reviewer` and `contract-reviewer`. If you add a required artifact in an
agent prompt, also update the qa-reviewer checklist.

## Self-validation before submitting your response

**Every agent MUST self-validate its draft Agent Log block before finishing.**
A malformed log block forces `cdd-kit gate` to fail, which forces the skill
to re-invoke you, which costs the user another full agent round. Self-lint is
~5 seconds; a re-run is minutes and dollars.

Before sending your final response, re-read your `## Agent Log` block and
verify each item:

- [ ] **All four required keys exist**: `status`, `files-read`, `artifacts`,
      `next-action`. (Plus `change-id`, `timestamp` at the top.)
- [ ] **`status` is one of**: `complete`, `needs-review`, `blocked` — not
      `done`, `OK`, `pending`, `wip`, or anything else.
- [ ] **Every `artifacts:` line has a concrete pointer**:
      - GOOD: `tests-added: tests/foo.test.ts::should reject empty body`
      - GOOD: `files-changed: src/api/users.ts:45-67`
      - GOOD: `test-output: 5 passed (last 10 lines: …)`
      - BAD: `tests-added: verified`
      - BAD: `files-changed: yes`
      - BAD: `contract: OK`
      Reject any line whose value would not let a reviewer click through.
- [ ] **If `status: blocked`, `next-action`** is ≥ 10 chars, is NOT `none`,
      `investigate further`, `tbd`, or `n/a`, and names the actual next step
      a human can act on.
- [ ] **Every `files-read:` entry**: repo-relative path, no leading `/`,
      no `..`, no `~`. If you read your own change directory only, write
      `- specs/changes/<change-id>/`.

If any check fails, **fix the block before sending your response**. Do not
ship a known-bad log and rely on the gate to catch it.

## Gate enforcement summary

`cdd-kit gate` rejects an agent log when any of these are true:

1. The file is missing for a tier-required agent (see CONTRACTS for tier matrix).
2. `status:` line is missing or has an unknown value.
3. `status: blocked` without a concrete `next-action`.
4. `files-read` is missing for a context-governed change, or contains an
   absolute path / `..` segment / forbidden path.
5. With `--strict`: any `- artifacts:` entry whose value looks like a path but
   does not exist on disk.

## Why this lives in references/

The historical mistake was duplicating the protocol inside every agent prompt.
Sixteen agents × ~30 lines = ~480 lines of identical text loaded on every
spawn. Moving it here:

- Cuts per-agent prompt size by 25–35%.
- Makes drift between agents impossible (one file to change).
- Lets gate.ts behavior, tests, and prompts stay in sync via this single doc.
