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
timestamp: "<ISO 8601 date-time, e.g. 2026-04-27T14:30:00Z>"
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
| `timestamp` | yes | ISO 8601 date-time string; quote it to avoid YAML timestamp coercion in non-cdd tools. UTC `Z` is preferred; numeric offsets such as `+08:00` are accepted. |
| `status` | yes | canonical values are `complete` \| `needs-review` \| `blocked`; `done` and `approved` are accepted by gate as compatibility aliases for `complete` |
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

If `cdd-kit gate` reports `read unauthorized path`, do not delete that
`files-read` entry to silence the gate. If the read was legitimate work scope,
add the repo-relative path to `context-manifest.md` under `## Allowed Paths` or
approve a Context Expansion Request. `files-read` is the audit trail; the
manifest is the authorization boundary.

#### `artifacts`

Concrete pointers only. Allowed forms:

- `path/to/file.ts:10-45`
- `tests/foo.test.ts::should reject empty body`
- `cdd-kit gate <id>: 0 errors`
- `contracts/api/api-contract.md#endpoints`

Gate path-existence rule: unless gate is run with `--lax`, any pointer whose
text before the first `:` contains `/` is treated as a repo-relative file path
and that file must exist. This makes path-like pointers useful, but it also
means:

- One pointer names one file only. Use separate `artifacts` items for multiple
  files.
- Do not attach parenthetical notes to a file path, e.g. use
  `src/api/users.ts:45-67`, not `src/api/users.ts (updated):45-67`.
- Do not start a pointer with slash-containing prose labels such as `I/O:` or
  `WARNING/OVERDUE:`; gate will try to validate `I/O` or `WARNING/OVERDUE` as a
  path. Write those labels in `notes` or after a non-path command/result
  pointer.
- `n/a (<reason>)` is exempt from path validation and is allowed for genuinely
  inapplicable required artifact types.

Never `verified`, `OK`, `done`, or unscoped prose.

#### `next-action`

When `status: blocked`, this must be ≥ 10 chars, must not be `none`, `tbd`,
`investigate further`, or `n/a`, and must name the actual next step a human
can act on. When `status: complete`, `none` is acceptable.

#### `status`

Use `status: complete` for a finished agent-log. `tasks.yml` task entries use
`status: done`, and review language may say "approved", but agent-log
completion is canonically `complete`. `cdd-kit gate` accepts `done` and
`approved` as compatibility aliases so these common mix-ups do not block
delivery.

## Per-agent additional artifact requirements

Each agent prompt lists its own `### Required artifacts for this agent`. The
gate enforces the declared artifact `type` values when the corresponding agent
prompt file is installed in `.claude/agents/` or `~/.claude/agents/`. This keeps
agent prompts, evidence logs, and gate behavior aligned without duplicating the
full protocol in every prompt.

If you add a required artifact type in an agent prompt, also update tests that
exercise `cdd-kit gate` for that agent. Agents may emit
`pointer: "n/a (<reason>)"` when a declared type is genuinely inapplicable; the
type must still be present so reviewers can tell that the omission was
intentional.

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
- [ ] **`timestamp` is quoted** and uses ISO 8601 date-time form. Prefer
      UTC `Z`, e.g. `timestamp: "2026-04-27T14:30:00Z"`. Numeric offsets
      such as `timestamp: "2026-05-05T00:00:00+08:00"` are valid.
- [ ] **`status` is one of**: `complete`, `needs-review`, `blocked`.
      Prefer `complete` for finished logs; `done` and `approved` are accepted
      only as compatibility aliases. Do not use `OK`, `pending`, `wip`, or
      anything else.
- [ ] **Every `artifacts` item is a `{type, pointer}` mapping** with a
      concrete pointer:
      - GOOD: `{ type: tests-added, pointer: "tests/foo.test.ts::should reject empty body" }`
      - GOOD: `{ type: files-changed, pointer: "src/api/users.ts:45-67" }`
      - GOOD: `{ type: test-output, pointer: "5 passed (last 10 lines: …)" }`
      - BAD: `{ type: tests-added, pointer: verified }`
      - BAD: `{ type: files-changed, pointer: yes }`
      - BAD: `{ type: contract, pointer: OK }`
      - BAD: `{ type: files-changed, pointer: "src/api/users.ts (updated):45-67" }`
      - BAD: `{ type: test-output, pointer: "I/O: warning reproduced" }`
      - BAD: `{ type: test-output, pointer: "WARNING/OVERDUE: manual follow-up" }`
      Reject any line whose pointer would not let a reviewer click through.
      If the text before the first `:` contains `/`, confirm it is exactly one
      existing repo-relative file path with no parenthetical note.
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
   absolute path / `..` segment / forbidden path / path outside manifest
   `Allowed Paths` and `Approved Expansions`.
6. Any `artifacts` item is missing `type` or `pointer`, or the array is empty.
7. A required per-agent artifact `type` declared in the agent prompt is missing.
8. Unless gate is run with `--lax`: any `artifacts` pointer whose text before
   the first `:` contains `/` but does not exist on disk; or any
   runtime-logged read not declared in `files-read`.

## Why this lives in references/

The historical mistake was duplicating the protocol inside every agent prompt.
Sixteen agents × ~30 lines = ~480 lines of identical text loaded on every
spawn. Moving it here:

- Cuts per-agent prompt size by 25–35%.
- Makes drift between agents impossible (one file to change).
- Lets gate.ts behavior, schemas, tests, and prompts stay in sync via this
  single doc.
