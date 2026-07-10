#!/bin/sh
# cdd-kit PreToolUse hook: refuse an agent Write/Edit/MultiEdit of the
# acceptance-oracle hash-lock baseline.
#
# ADR 0010 SS3.2 (write-block) -- modeled exactly on
# pre-tool-use-contract-write.sh. The baseline `.cdd/acceptance-lock.json` is
# recorded ONLY by `cdd-kit accept relock`, run by the human; it is a HARD
# forbidden context path. This hook keys off the write TARGET PATH (Decision 1,
# axis (a) -- see `contracts/ci/ci-gate-contract.md`
# `### Write-block hook discrimination axis`):
#
#   - `.cdd/acceptance-lock.json` -> BLOCKED unconditionally (exit 2, stderr).
#   - `acceptance.yml`            -> ALLOWED (exit 0). Main Claude performs the
#     sanctioned first write and transcribes the human's values through this
#     same tool path, so the body must stay writable.
#   - every other path            -> ALLOWED (exit 0), untouched.
#
# This hook gates the agent's Edit/Write/MultiEdit tools only. It does not, and
# does not claim to, stop a shell-capable agent from writing the lock by other
# means; that is out of scope (see the same contract section).
#
# The retired `CDD_ACCEPTANCE_WRITE_STRICT` toggle carried no agent identity, so
# it could only block everyone -- including the sanctioned transcription -- or
# block nobody. The path axis replaces it; the variable is deprecated
# (accepted-and-ignored) and no longer consulted
# (`contracts/env/env-contract.md`, `## Deprecated: the *_WRITE_STRICT toggle`).
#
# Wire into Claude Code (.claude/settings.json) -- `cdd-kit install-agent-hooks
# --acceptance-write` writes this for you. Anchor to $CLAUDE_PROJECT_DIR:
# Claude Code does not guarantee the hook's cwd is the project root.
#
#   {
#     "hooks": {
#       "PreToolUse": [
#         { "matcher": "Write|Edit|MultiEdit", "hooks": [
#           { "type": "command",
#             "command": "cd \"${CLAUDE_PROJECT_DIR:-.}\" && ./hooks/pre-tool-use-acceptance-write.sh" }
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

# Canonicalize before comparing -- see the identical block in
# pre-tool-use-design-write.sh for the four path forms that defeated the raw
# string compare, including the Windows absolute path Claude Code actually sends.
norm_path="$(printf '%s' "$path_value" | sed -e 's|\\\\|/|g' -e 's|\\|/|g' -e ':a' -e 's|//|/|g' -e 'ta' -e ':b' -e 's|/\./|/|g' -e 'tb' -e 's|^\./||' | tr 'A-Z' 'a-z')"

# Discriminate on the write TARGET PATH. The lock sidecar is blocked
# unconditionally; the artifact body and every other path are allowed.
case "$norm_path" in
  .cdd/acceptance-lock.json|*/.cdd/acceptance-lock.json)
    printf '%s\n' "cdd-kit: .cdd/acceptance-lock.json is the human-owned acceptance baseline (ADR 0010) -- an agent must not write it through Write/Edit/MultiEdit. Only \`cdd-kit accept relock\`, run by the human, records a baseline. Read acceptance.yml to build a driver, or ask the human to relock it." 1>&2
    exit 2
    ;;
  *)
    exit 0
    ;;
esac
