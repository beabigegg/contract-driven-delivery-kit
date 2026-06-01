#!/bin/sh
# cdd-kit PreToolUse hook (opt-in): steer agents to graph-first exploration.
#
# Prose in agent prompts ("run cdd-kit index query before reading") is a soft
# preference that loses to the model's built-in habit of reaching for Read.
# This hook turns that preference into an actual chokepoint: when an agent is
# about to Read a *source* file and a code-map exists, it reminds the agent to
# use `cdd-kit index query "<symbol>" --with-source` (which returns the code
# inline, so the Read is usually unnecessary).
#
# Default mode is ADVISORY: it prints guidance to stderr and allows the Read.
# Set CDD_GRAPH_FIRST_STRICT=1 to BLOCK the Read instead (exit 2), forcing the
# graph-first path. Contract/spec/markdown/Read of .cdd/code-map.yml itself are
# always allowed.
#
# Wire into Claude Code (~/.claude/settings.json):
#
#   {
#     "hooks": {
#       "PreToolUse": [
#         { "matcher": "Read", "command": "/path/to/hooks/pre-tool-use-graph-first.sh" }
#       ]
#     }
#   }
#
# The hook receives the tool-call payload as JSON on stdin.

set -eu

# No code-map → nothing to steer toward; allow.
[ -f ".cdd/code-map.yml" ] || exit 0

payload="$(cat || true)"
[ -z "$payload" ] && exit 0

# Extract the Read target path.
path_value=""
if command -v jq >/dev/null 2>&1; then
  path_value="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
fi
if [ -z "$path_value" ]; then
  path_value="$(printf '%s' "$payload" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi
[ -z "$path_value" ] && exit 0

# Only steer for source files; never interfere with docs/specs/contracts/config.
case "$path_value" in
  *.py|*.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.vue|*.svelte|*.go|*.java|*.rb|*.php) : ;;
  *) exit 0 ;;
esac
# Allow reading the map itself.
case "$path_value" in
  *.cdd/code-map.yml) exit 0 ;;
esac

msg="cdd-kit: prefer \`cdd-kit index query \"<symbol-or-file>\" --with-source\` (or \`cdd-kit graph query ... --with-source\`) before Read — it returns the code inline and keeps token use low. Read directly only for ranges the query did not return."

if [ "${CDD_GRAPH_FIRST_STRICT:-0}" = "1" ]; then
  # Block and feed the reason back to the model.
  printf '%s\n' "$msg Set CDD_GRAPH_FIRST_STRICT=0 to make this advisory only." 1>&2
  exit 2
fi

printf '%s\n' "$msg" 1>&2
exit 0
