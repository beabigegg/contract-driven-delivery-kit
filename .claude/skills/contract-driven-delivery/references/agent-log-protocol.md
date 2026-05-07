# Agent Log Protocol (Optional YAML)

Agent logs are optional trace artifacts for debugging, resume summaries, and
handoff notes. They are not required for `cdd-kit gate`, and agents should not
spend useful development time reconstructing every file they read.

## Output Target

If an agent emits a log, write one YAML file per run:

```text
specs/changes/<change-id>/agent-log/<agent-name>.yml
```

If the same agent runs more than once for a change, overwrite the file. The
latest run is the only useful trace.

## Minimal Structure

```yaml
change-id: <id>
agent: <agent-name>
timestamp: "<ISO 8601 date-time, e.g. 2026-04-27T14:30:00Z>"
status: complete
artifacts:
  - { type: <evidence-type>, pointer: <concrete pointer> }
next-action: none
notes: <optional free-form>
```

Optional fields:

```yaml
files-read:
  - <repo-relative path>
indexes-used:
  - .cdd/code-map.yml
index-queries:
  - cdd-kit index query "AuthService"
```

Use optional fields only when they are cheap and accurate. Do not add noisy
paperwork just to satisfy a gate; the gate does not inspect these logs.

## Field Rules

| field | required | rule |
|---|---|---|
| `change-id` | yes | should equal the parent change directory name |
| `agent` | yes | canonical agent name, matching the agent filename |
| `timestamp` | yes | ISO 8601 date-time string; quote it to avoid YAML timestamp coercion |
| `status` | yes | `complete` \| `needs-review` \| `blocked` |
| `artifacts` | yes | concise array of `{type, pointer}` objects |
| `next-action` | yes | when `status: blocked`, name the concrete next step |
| `files-read` | no | optional repo-relative read trace |
| `indexes-used` | no | optional repo-relative index artifact paths used to plan reads |
| `index-queries` | no | optional command/query strings used for project intelligence |
| `notes` | no | optional |

## artifacts

Concrete pointers only. Allowed forms:

- `path/to/file.ts:10-45`
- `tests/foo.test.ts::should reject empty body`
- `cdd-kit gate <id>: 0 errors`
- `contracts/api/api-contract.md#endpoints`

Pointer style still matters because humans and future tools may parse these
values. When the text before the first `:` contains `/`, treat it as one
repo-relative file path:

- One pointer names one file only. Use separate `artifacts` items for multiple
  files.
- Do not attach parenthetical notes to a file path, e.g. use
  `src/api/users.ts:45-67`, not `src/api/users.ts (updated):45-67`.
- Do not start a pointer with slash-containing prose labels such as `I/O:` or
  `WARNING/OVERDUE:`. Write those labels in `notes` or after a non-path
  command/result pointer.
- `n/a (<reason>)` is allowed for genuinely inapplicable artifact types.

Never use `verified`, `OK`, `done`, or unscoped prose as evidence pointers.

## next-action

When `status: blocked`, this must be concrete and must not be `none`, `tbd`,
`investigate further`, `unknown`, `todo`, or `n/a`. When `status: complete`,
`none` is acceptable.

## Self-Validation

If you choose to emit an agent log, self-validate it before finishing:

- Required keys exist: `change-id`, `agent`, `timestamp`, `status`,
  `artifacts`, `next-action`.
- `timestamp` is quoted and uses ISO 8601 date-time form.
- `status` is one of `complete`, `needs-review`, `blocked`.
- Every `artifacts` item is a `{type, pointer}` mapping with a concrete pointer.
- If `status: blocked`, `next-action` names the actual next step.
- Optional `files-read` entries are repo-relative, with no leading `/`, no
  `..`, and no `~`.
- YAML is parseable with consistent two-space indentation.

## Why This Lives In References

The historical mistake was duplicating the protocol inside every agent prompt.
Moving it here cuts prompt size and keeps optional traces consistent without
turning them into required process paperwork.
