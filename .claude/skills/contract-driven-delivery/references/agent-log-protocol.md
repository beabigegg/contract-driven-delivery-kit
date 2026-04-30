# Agent Log Protocol (YAML)

All cdd-kit agents share the same machine-verifiable agent-log format. This
file is the single source of truth — agent prompts reference it instead of
inlining the format. `cdd-kit gate` validates these files against
`src/schemas/agent-log.schema.ts` (JSON Schema, draft-07). Drift here equals
silent gate skips, so do not re-document this in agent prompts.

## Output target

Each agent writes (or has main Claude write) one file per run:

```
specs/changes/<change-id>/agent-log/<agent-name>.yml
```

If the same agent runs more than once for a change (e.g., after fix-back),
overwrite the file — only the latest run is gate-relevant.

## Required structure

The file is pure YAML (no markdown wrapping, no checklist).

```yaml
change-id: <id>
agent: <agent-name>
timestamp: <ISO 8601 UTC, e.g. 2026-04-27T14:30:00Z>
status: complete            # complete | needs-review | blocked
files-read:
  - <repo-relative path>
  - <repo-relative path>
artifacts:
  - { type: <evidence-type>, pointer: <concrete pointer> }
  - { type: <evidence-type>, pointer: <concrete pointer> }
next-action: <one line, or "none">
notes: <optional free-form>
```

### Field rules

| field | required | rule |
|---|---|---|
| `change-id` | yes | must equal the parent change directory name |
| `agent` | yes | canonical agent name (matches the agent's filename) |
| `timestamp` | yes | ISO 8601 UTC; used by spec-drift-auditor for ordering |
| `status` | yes | exactly one of `complete` \| `needs-review` \| `blocked` |
| `files-read` | conditional | required for context-governed changes (see below) |
| `artifacts` | yes | array of `{type, pointer}` objects, ≥ 1 item |
| `next-action` | yes | when `status: blocked`, ≥ 10 chars and not `none` |
| `notes` | no | optional |

#### `files-read`

Required when `tasks.yml` has `context-governance: v1`. Each entry is a
repo-relative path. Absolute paths and `..` traversal are rejected. If you
legitimately read nothing beyond your own change directory, write:

```yaml
files-read:
  - specs/changes/<change-id>/
```

#### `artifacts`

Concrete pointers only. Allowed forms:

- `path/to/file.ts:10-45`
- `tests/foo.test.ts::should reject empty body`
- `cdd-kit gate <id>: 0 errors`
- `contracts/api/api-contract.md#endpoints`

Never `verified`, `OK`, `done`, or unscoped prose.

#### `next-action`

When `status: blocked`, this must be ≥ 10 chars, must not be `none`, `tbd`,
`investigate further`, or `n/a`, and must name the actual next step a human
can act on. When `status: complete`, `none` is acceptable.

## Per-agent additional artifact requirements

Each agent prompt lists its own `### Required artifacts for this agent`. The
gate does not enforce those today; they are a discipline contract enforced by
`qa-reviewer` and `contract-reviewer`. If you add a required artifact in an
agent prompt, also update the qa-reviewer checklist.

## Self-validation before submitting your response

**Every agent MUST self-validate its draft agent-log YAML before finishing.**
A malformed log forces `cdd-kit gate` to fail, which forces the skill to
re-invoke you, which costs the user another full agent round. Self-lint is
~5 seconds; a re-run is minutes and dollars.

Before sending your final response, re-read the YAML you intend to write and
verify each item:

- [ ] **All required keys exist**: `change-id`, `agent`, `timestamp`,
      `status`, `artifacts`, `next-action` (plus `files-read` for
      context-governed changes).
- [ ] **`status` is one of**: `complete`, `needs-review`, `blocked` — not
      `done`, `OK`, `pending`, `wip`, or anything else.
- [ ] **Every `artifacts` item is a `{type, pointer}` mapping** with a
      concrete pointer:
      - GOOD: `{ type: tests-added, pointer: "tests/foo.test.ts::should reject empty body" }`
      - GOOD: `{ type: files-changed, pointer: "src/api/users.ts:45-67" }`
      - GOOD: `{ type: test-output, pointer: "5 passed (last 10 lines: …)" }`
      - BAD: `{ type: tests-added, pointer: verified }`
      - BAD: `{ type: files-changed, pointer: yes }`
      - BAD: `{ type: contract, pointer: OK }`
      Reject any line whose pointer would not let a reviewer click through.
- [ ] **If `status: blocked`**, `next-action` is ≥ 10 chars, is NOT `none`,
      `investigate further`, `tbd`, or `n/a`, and names the actual next step
      a human can act on.
- [ ] **Every `files-read` entry**: repo-relative path, no leading `/`, no
      `..`, no `~`. If you read your own change directory only, write
      `- specs/changes/<change-id>/`.
- [ ] **YAML is parseable**: indentation is consistent (2 spaces), strings
      with special characters (`:`, `#`, leading numbers like `001`) are
      quoted.

If any check fails, **fix the YAML before sending your response**. Do not
ship a known-bad log and rely on the gate to catch it.

## Gate enforcement summary

`cdd-kit gate` rejects an agent log when any of these are true:

1. The file is missing for a tier-required agent (see CONTRACTS for tier matrix).
2. YAML fails to parse, or top-level is not a mapping.
3. `status` is missing or has an unknown value.
4. `status: blocked` without a concrete `next-action`.
5. `files-read` is missing for a context-governed change, or contains an
   absolute path / `..` segment / forbidden path.
6. Any `artifacts` item is missing `type` or `pointer`, or the array is empty.
7. With `--strict`: any `artifacts` pointer that looks like a path but does
   not exist on disk; or any runtime-logged read not declared in `files-read`.

## Why this lives in references/

The historical mistake was duplicating the protocol inside every agent prompt.
Sixteen agents × ~30 lines = ~480 lines of identical text loaded on every
spawn. Moving it here:

- Cuts per-agent prompt size by 25–35%.
- Makes drift between agents impossible (one file to change).
- Lets gate.ts behavior, schemas, tests, and prompts stay in sync via this
  single doc.
