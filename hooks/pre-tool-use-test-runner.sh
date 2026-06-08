#!/bin/sh
# cdd-kit PreToolUse hook (opt-in): steer agents off broad whole-suite test runs.
#
# ADR 0005 §10 — the runtime analog of the bounded test ladder. The ladder
# (`cdd-kit test select` -> `cdd-kit test run --phase ...`) exists so an agent
# proves a change with the narrowest mapped tests first and writes durable,
# gate-checkable evidence, instead of typing a bare `pytest` / `npm test`,
# drowning in multi-failure output, and losing the signal. Prose telling the
# agent to "use the ladder" loses to the model's habit of reaching for the whole
# suite. This hook turns that preference into an actual chokepoint on the Bash
# tool: when an agent is about to run a broad whole-suite test command it reminds
# the agent to select a bounded phase first (advisory) or blocks it (strict).
#
# SCOPE: fires only inside a CDD repo (a `.cdd/` directory exists) and only on a
# *broad* whole-suite invocation of a recognized test runner (issued as the
# command, or as the final `&&`/`;` step). Detection is deliberately conservative
# — a bounded target (a node id / file / directory), `cdd-kit test run ...`, and
# every non-test command (lint, typecheck, build, `cdd-kit validate`, ...) are
# allowed untouched. False negatives are preferred over blocking a legitimate
# command; this is advice, not a security boundary. The runner is strongest for
# pytest (ADR 0005); other stacks match only their unambiguous whole-suite forms.
#
# Default mode is ADVISORY: it prints guidance to stderr and ALLOWS the command.
# Set CDD_TEST_RUNNER_STRICT=1 to BLOCK the command instead (exit 2). The hook
# gates only the agent's Bash tool — a human running tests in a terminal is
# unaffected.
#
# Wire into Claude Code (~/.claude/settings.json):
#
#   {
#     "hooks": {
#       "PreToolUse": [
#         { "matcher": "Bash", "command": "/path/to/hooks/pre-tool-use-test-runner.sh" }
#       ]
#     }
#   }
#
# The hook receives the tool-call payload as JSON on stdin.

set -euf

# Outside a CDD repo there is no bounded ladder to steer toward; allow.
[ -d ".cdd" ] || exit 0

payload="$(cat || true)"
[ -z "$payload" ] && exit 0

# Extract the Bash command string (jq when present; a best-effort grep fallback
# otherwise, mirroring the kit's other PreToolUse hooks).
cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi
if [ -z "$cmd" ]; then
  cmd="$(printf '%s' "$payload" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi
[ -z "$cmd" ] && exit 0

# The sanctioned bounded path is always allowed — `cdd-kit test run` spawns the
# real test process itself, so the inner runner never reaches this hook.
case "$cmd" in
  *cdd-kit\ test\ run*|*cdd-kit\ test\ select*) exit 0 ;;
esac

# True (0) when $1 holds a token that is not an option flag — i.e. a positional
# target (path / node id). Word-splitting is intended; `set -f` (above) disables
# globbing so a target such as tests/*.py is inspected, not expanded.
has_positional() {
  for tok in $1; do
    case "$tok" in
      -*) ;;          # option flag — keep scanning
      *) return 0 ;;  # positional target present
    esac
  done
  return 1
}

# True (0) when $1 is a broad, whole-suite test invocation the ladder replaces.
# Conservative: a recognized runner WITH a bounded target, or any unrecognized
# command, is not broad (returns 1 -> allowed).
is_broad_test() {
  c=${1#"${1%%[![:space:]]*}"}   # strip leading whitespace
  case "$c" in
    # pytest family — broad unless a path/node id follows the runner.
    pytest|pytest\ *|py.test|py.test\ *)
      if has_positional "$(printf '%s' "$c" | sed -E 's/^(py\.test|pytest)//')"; then return 1; fi
      return 0 ;;
    *python\ -m\ pytest*|*python3\ -m\ pytest*)
      if has_positional "$(printf '%s' "$c" | sed -E 's/^.*-m[[:space:]]+pytest//')"; then return 1; fi
      return 0 ;;
    # npm/yarn/pnpm whole-suite test scripts — bounded only via `-- <target>`.
    npm\ test|npm\ test\ -*|npm\ t|npm\ run\ test|npm\ run\ test\ -*|yarn\ test|yarn\ test\ -*|pnpm\ test|pnpm\ test\ -*|pnpm\ run\ test|pnpm\ run\ test\ -*)
      case "$c" in *\ --\ ?*) return 1 ;; esac
      return 0 ;;
    # Bare vitest / jest (alone or flags-only); a positional path -> bounded.
    vitest|vitest\ -*|jest|jest\ -*)
      return 0 ;;
    # Whole-module go test.
    go\ test\ ./...|go\ test\ ./...\ *)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

broad=1
if is_broad_test "$cmd"; then broad=0; fi
if [ "$broad" = 1 ]; then
  # A leading `cd <dir> &&` / `setup;` must not mask the test run: re-check the
  # final &&/; segment. Conservative single-level split (pipes/|| are ignored).
  tail_seg=${cmd##*&&}
  tail_seg=${tail_seg##*;}
  if is_broad_test "$tail_seg"; then broad=0; fi
fi
[ "$broad" = 0 ] || exit 0

msg="cdd-kit: this looks like a broad, whole-suite test run. During a tracked change, prefer the bounded ladder -- \`cdd-kit test select <change-id> --json\`, then \`cdd-kit test run <change-id> --phase <phase> --command \"<selected command>\"\` (collect, targeted, changed-area first; full suite only as a final bounded smoke). It records gate-checkable evidence and stops at the first failure. See the bounded test ladder in references/sdd-tdd-policy.md."

if [ "${CDD_TEST_RUNNER_STRICT:-0}" = "1" ]; then
  # Block and feed the reason back to the model.
  printf '%s\n' "$msg Set CDD_TEST_RUNNER_STRICT=0 to make this advisory only." 1>&2
  exit 2
fi

printf '%s\n' "$msg" 1>&2
exit 0
