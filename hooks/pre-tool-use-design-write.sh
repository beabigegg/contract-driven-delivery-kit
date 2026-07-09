#!/bin/sh
# cdd-kit PreToolUse hook (opt-in): block agent writes to the human-confirmed
# interaction design.
#
# ADR 0012 §5 (write-block) -- modeled exactly on
# pre-tool-use-acceptance-write.sh (ADR 0010 §3.2). interaction-design.md's
# `## Confirmed` section is authored by the human (or dictated to the main
# agent, which transcribes but does not invent answers, ADR 0012 §4); an
# implementation/design agent must never write its own confirmed answers.
# Unlike the contract-write hook, there is no agent-facing "set" command to
# route to here -- the only legitimate agent action on this artifact is
# READING it, or (for interaction-designer) filling the proposal chain +
# `## Open Decisions` (never `## Confirmed`). So this hook advises/blocks
# EVERY agent Edit/Write/MultiEdit of the design artifact or its hash-lock
# baseline, with no first-scaffold exemption (the kit's own new/migrate/
# refresh commands write the placeholder scaffold directly on disk, not
# through an agent tool call, so they are never subject to this hook).
#
# SCOPE: `specs/changes/<id>/interaction-design.md` (any change id) and the
# baseline sidecar `.cdd/design-lock.json` (ADR 0012 §5; HARD forbidden
# context path from day one -- this hook is the harness-side companion to
# that policy). Every other path is allowed untouched.
#
# Default mode is ADVISORY: it prints guidance to stderr and allows the edit.
# Set CDD_DESIGN_WRITE_STRICT=1 to BLOCK the edit instead (exit 2). The hook
# gates only the agent's Edit/Write/MultiEdit tools -- a human editing the
# file in their editor is unaffected.
#
# Wire into Claude Code (.claude/settings.json) -- `cdd-kit install-agent-hooks
# --design-write` writes this for you. Anchor to $CLAUDE_PROJECT_DIR:
# Claude Code does not guarantee the hook's cwd is the project root.
#
#   {
#     "hooks": {
#       "PreToolUse": [
#         { "matcher": "Write|Edit|MultiEdit", "hooks": [
#           { "type": "command",
#             "command": "cd \"${CLAUDE_PROJECT_DIR:-.}\" && ./.claude/hooks/pre-tool-use-design-write.sh" }
#         ] }
#       ]
#     }
#   }
#
# The hook receives the tool-call payload as JSON on stdin.

set -eu

payload="$(cat || true)"
[ -z "$payload" ] && exit 0

# Extract the Edit/Write target path.
path_value=""
if command -v jq >/dev/null 2>&1; then
  path_value="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
fi
if [ -z "$path_value" ]; then
  path_value="$(printf '%s' "$payload" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi
[ -z "$path_value" ] && exit 0

# Only steer edits to the interaction design or its hash-lock baseline. Match
# the change-scoped design (any change id) and the single lock sidecar; every
# other path is allowed untouched.
case "$path_value" in
  specs/changes/*/interaction-design.md|*/specs/changes/*/interaction-design.md) : ;;
  .cdd/design-lock.json|*/.cdd/design-lock.json) : ;;
  *) exit 0 ;;
esac

msg="cdd-kit: interaction-design.md's ## Confirmed section is a human-owned answer key (ADR 0012) -- an implementation agent must not write it or its .cdd/design-lock.json baseline. Read it to build the frontend, or ask the human to answer/confirm it."

if [ "${CDD_DESIGN_WRITE_STRICT:-0}" = "1" ]; then
  # Block and feed the reason back to the model.
  printf '%s\n' "$msg Set CDD_DESIGN_WRITE_STRICT=0 to make this advisory only." 1>&2
  exit 2
fi

printf '%s\n' "$msg" 1>&2
exit 0
