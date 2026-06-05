#!/bin/sh
# cdd-kit PreToolUse hook (opt-in): route agent contract edits through `contract set`.
#
# ADR 0004 §6 (Stage 2) — the write-side analog of pre-tool-use-graph-first.sh.
# The Claude Code agent harness lets an agent free-form Edit/Write the API
# contract: it can drop a column, write a row that does not validate, or silently
# touch a neighbouring row. `cdd-kit contract set` makes a contract change valid
# by construction and touches only the key it names — but prose telling the agent
# to "prefer contract set" loses to the model's built-in habit of reaching for
# Edit. This hook turns that preference into an actual chokepoint: when an agent
# is about to Edit/Write the API contract, it routes to
# `cdd-kit contract endpoint set` / `cdd-kit contract schema set`.
#
# SCOPE: only `contracts/api/api-contract.md`, the one contract `contract set`
# can currently mutate (ADR 0004 ships the API surface first; §7 extends `set` to
# the business-rules/data/env contracts later, and this hook's path match widens
# in step). Every other path — other contracts, source, docs — is allowed
# untouched, so the hook can never brick an edit that has no `contract set` form
# yet.
#
# Default mode is ADVISORY: it prints guidance to stderr and allows the edit. Set
# CDD_CONTRACT_WRITE_STRICT=1 to BLOCK the edit instead (exit 2), forcing the
# `contract set` path. The hook gates only the agent's Edit/Write/MultiEdit tools
# — a human editing the contract in their editor is unaffected.
#
# Wire into Claude Code (~/.claude/settings.json):
#
#   {
#     "hooks": {
#       "PreToolUse": [
#         { "matcher": "Write|Edit|MultiEdit", "command": "/path/to/hooks/pre-tool-use-contract-write.sh" }
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

# Only steer the one contract `contract set` can mutate. Match the exact relative
# path, or any absolute/nested path ending in it — never a lookalike such as
# `other-contracts/api/api-contract.md`. Everything else is allowed.
case "$path_value" in
  contracts/api/api-contract.md|*/contracts/api/api-contract.md) : ;;
  *) exit 0 ;;
esac

# A first-time scaffold has nothing to `set` into (`contract set` requires the
# file to exist), so only steer an edit to a contract that is already present.
[ -f "$path_value" ] || exit 0

msg="cdd-kit: prefer \`cdd-kit contract endpoint set --method <M> --path </path> ...\` (or \`cdd-kit contract schema set <Name> --field ...\`) over editing contracts/api/api-contract.md by hand — it validates the change, upserts by key, and touches only that row/section."

if [ "${CDD_CONTRACT_WRITE_STRICT:-0}" = "1" ]; then
  # Block and feed the reason back to the model.
  printf '%s\n' "$msg Set CDD_CONTRACT_WRITE_STRICT=0 to make this advisory only." 1>&2
  exit 2
fi

printf '%s\n' "$msg" 1>&2
exit 0
