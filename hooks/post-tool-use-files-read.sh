#!/bin/sh
# cdd-kit PostToolUse hook (B3): append actual Read/Grep/Glob targets to a
# runtime audit log so `cdd-kit gate` can reconcile them against the agent-log
# self-report. This turns Context Governance from a trust contract into a
# verified contract.
#
# Wire into Claude Code (~/.claude/settings.json):
#
#   {
#     "hooks": {
#       "PostToolUse": [
#         { "matcher": "Read|Grep|Glob", "command": "/path/to/hooks/post-tool-use-files-read.sh" }
#       ]
#     }
#   }
#
# The hook receives the tool-call payload as JSON on stdin. We extract the
# best-effort path candidate and append `<change-id>\t<path>` to a JSONL audit
# file. CURRENT_CHANGE_ID is read from environment (cdd-new sets it on every
# agent invocation as of v1.10.0+).

set -eu

CDD_RUNTIME_DIR="${CDD_RUNTIME_DIR:-./.cdd/runtime}"
CHANGE_ID="${CURRENT_CHANGE_ID:-unknown}"

mkdir -p "$CDD_RUNTIME_DIR"
LOG_FILE="$CDD_RUNTIME_DIR/${CHANGE_ID}-files-read.jsonl"

# Read JSON payload from stdin without choking if jq is missing.
payload="$(cat || true)"
[ -z "$payload" ] && exit 0

# Try to extract the path field. Common Claude Code tool inputs:
#   Read    → tool_input.file_path
#   Grep    → tool_input.path / glob / pattern
#   Glob    → tool_input.path / pattern
# We grep first then fall back to jq when available.
path_value=""
if command -v jq >/dev/null 2>&1; then
  path_value="$(printf '%s' "$payload" | jq -r '
    .tool_input.file_path
    // .tool_input.path
    // .tool_input.pattern
    // empty
  ' 2>/dev/null || true)"
fi
if [ -z "$path_value" ]; then
  path_value="$(printf '%s' "$payload" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi

[ -z "$path_value" ] && exit 0

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"ts":"%s","change":"%s","path":"%s"}\n' "$timestamp" "$CHANGE_ID" "$path_value" >> "$LOG_FILE"
