#!/bin/sh
# cdd-kit PreToolUse hook: refuse an agent Write/Edit/MultiEdit of the
# interaction-design hash-lock baseline.
#
# ADR 0012 §5 (write-block) -- modeled exactly on
# pre-tool-use-acceptance-write.sh (ADR 0010 §3.2). The confirmation baseline
# `.cdd/design-lock.json` is recorded ONLY by `cdd-kit design confirm`, run by
# the human; it is a HARD forbidden context path. This hook keys off the write
# TARGET PATH (Decision 1, axis (a) -- see `contracts/ci/ci-gate-contract.md`
# `### Write-block hook discrimination axis`):
#
#   - `.cdd/design-lock.json`  -> BLOCKED unconditionally (exit 2, stderr).
#   - `interaction-design.md`  -> ALLOWED (exit 0). Main Claude performs the
#     sanctioned first write and transcribes the human's answers into
#     `## Confirmed` through this same tool path, so the body must stay writable.
#   - every other path         -> ALLOWED (exit 0), untouched.
#
# This hook gates the agent's Edit/Write/MultiEdit tools only. It does not, and
# does not claim to, stop a shell-capable agent from writing the lock by other
# means; that is out of scope (see the same contract section).
#
# The retired `CDD_DESIGN_WRITE_STRICT` toggle carried no agent identity, so it
# could only block everyone -- including the sanctioned transcription -- or
# block nobody. The path axis replaces it; the variable is no longer consulted
# (`contracts/env/env-contract.md`, `## Deprecated: the *_WRITE_STRICT toggle`).
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
#             "command": "cd \"${CLAUDE_PROJECT_DIR:-.}\" && ./hooks/pre-tool-use-design-write.sh" }
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

# Canonicalize before comparing. A raw string compare is not a path compare, and
# every one of these reached exit 0 against the previous version of this hook,
# measured:
#
#   .cdd/./design-lock.json            (a no-op `.` segment)
#   .cdd//design-lock.json             (a doubled separator)
#   D:\repo\.cdd\design-lock.json      (Windows separators -- the form Claude Code
#                                       actually passes on Windows, so the block
#                                       was a no-op on the very machine that
#                                       announced it was armed)
#   .CDD/design-lock.json              (case-insensitive filesystem)
#
# Steps, in order: unescape JSON backslash pairs, fold every backslash to `/`,
# collapse runs of `/`, delete `/./` segments (repeatedly), drop a leading `./`,
# and lowercase. Lowercasing over-blocks a path that differs only in case on a
# case-sensitive filesystem; that is deliberate -- refusing to write a file named
# `.CDD/design-lock.json` costs nothing, and guessing which filesystem we are on
# costs correctness.
norm_path="$(printf '%s' "$path_value" | sed -e 's|\\\\|/|g' -e 's|\\|/|g' -e ':a' -e 's|//|/|g' -e 'ta' -e ':b' -e 's|/\./|/|g' -e 'tb' -e 's|^\./||' | tr 'A-Z' 'a-z')"

# Discriminate on the write TARGET PATH. The lock sidecar is blocked
# unconditionally; the artifact body and every other path are allowed.
case "$norm_path" in
  .cdd/design-lock.json|*/.cdd/design-lock.json)
    printf '%s\n' "cdd-kit: .cdd/design-lock.json is the human-owned confirmation baseline (ADR 0012) -- an agent must not write it through Write/Edit/MultiEdit. Only \`cdd-kit design confirm\`, run by the human, records a baseline. Read interaction-design.md to build the frontend, or ask the human to confirm it." 1>&2
    exit 2
    ;;
  *)
    exit 0
    ;;
esac
