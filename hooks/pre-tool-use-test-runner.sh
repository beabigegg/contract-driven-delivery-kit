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
# *broad* whole-suite invocation of a recognized test runner. The command is
# split into `&&`/`;`-separated segments and each is judged on its own, so a
# leading `cd x &&` / `setup;` does not mask the test run and a trailing broad
# run after a ladder command (`cdd-kit test select ... && pytest`) is still
# caught. Detection is deliberately conservative — a bounded target (a path /
# node id / test file), `cdd-kit test run ...`, and every non-test command (lint,
# typecheck, build, `cdd-kit validate`, ...) are allowed untouched. A target is
# recognized structurally (it looks like a path/file/node id), so an option VALUE
# (the `1` in `--maxfail 1`) is not mistaken for one. False negatives are
# preferred over blocking a legitimate command; this is advice, not a security
# boundary. The runner is strongest for pytest (ADR 0005); other stacks match
# only their unambiguous whole-suite forms.
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

# True (0) when $1 holds any non-flag token. Used only for an npm `-- <target>`
# passthrough, where an explicit token the user appended after `--` is trusted as
# a deliberate narrowing (so `npm test -- --runInBand`, flags only, stays broad).
# Word-splitting is intended; `set -f` (above) disables globbing.
has_positional() {
  for tok in $1; do
    case "$tok" in
      -*) ;;          # option flag — keep scanning
      *) return 0 ;;  # explicit non-flag token present
    esac
  done
  return 1
}

# True (0) when $1 names an explicit test TARGET: a path (contains `/`), a pytest
# node id (contains `::`), `.`, or a test source file (*.py/*.ts/*.js/...). Option
# flags AND bare option VALUES (the `1` in `--maxfail 1`, the `short` in `--tb
# short`) are NOT targets, so a flags-only broad run is not mistaken for a bounded
# one and a runner subcommand like `vitest run` (no target) stays broad. Word-
# splitting is intended; `set -f` keeps a glob like tests/*.py from expanding.
has_test_target() {
  for tok in $1; do
    case "$tok" in
      -*) ;;                                              # option flag — skip
      .|*/*|*::*) return 0 ;;                             # cwd / path / node id
      *.py|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) return 0 ;; # a test source file
      *) ;;                                               # bare word / opt value
    esac
  done
  return 1
}

# True (0) when $1 is a broad, whole-suite test invocation the ladder replaces.
# Conservative: a recognized runner WITH an explicit target, or any unrecognized
# command, is not broad (returns 1 -> allowed).
is_broad_test() {
  c=${1#"${1%%[![:space:]]*}"}   # strip leading whitespace
  case "$c" in
    # pytest family — broad unless a path / node id / test file follows.
    pytest|pytest\ *|py.test|py.test\ *)
      if has_test_target "$(printf '%s' "$c" | sed -E 's/^(py\.test|pytest)//')"; then return 1; fi
      return 0 ;;
    *python\ -m\ pytest*|*python3\ -m\ pytest*)
      if has_test_target "$(printf '%s' "$c" | sed -E 's/^.*-m[[:space:]]+pytest//')"; then return 1; fi
      return 0 ;;
    # npm/yarn/pnpm whole-suite scripts — bounded only when the `-- <target>`
    # passthrough carries a real (non-flag) token, not just runner flags.
    npm\ test|npm\ test\ -*|npm\ t|npm\ run\ test|npm\ run\ test\ -*|yarn\ test|yarn\ test\ -*|pnpm\ test|pnpm\ test\ -*|pnpm\ run\ test|pnpm\ run\ test\ -*)
      case "$c" in
        *\ --\ *) if has_positional "${c#*" -- "}"; then return 1; fi ;;
      esac
      return 0 ;;
    # jest / vitest (incl. the `vitest run` subcommand) — broad unless an explicit
    # test target follows, even when runner flags (`--config x`, `--runInBand`)
    # precede it.
    jest|vitest)
      return 0 ;;
    jest\ *|vitest\ *)
      if has_test_target "${c#* }"; then return 1; fi
      return 0 ;;
    # Whole-module go test.
    go\ test\ ./...|go\ test\ ./...\ *)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# Judge each &&/;-separated segment on its own. The sanctioned ladder commands
# (`cdd-kit test run` / `cdd-kit test select`) are skipped per-segment, so they
# are always allowed AND a broad run chained after one (`cdd-kit test select x &&
# pytest`) is still caught. `cdd-kit test run` spawns the real test process
# itself, so the inner runner never reaches this hook. Splitting via `tr` (& and
# ; -> newline; portable, unlike sed's \n) also sees through `cd x && pytest` and
# a trailing `pytest &`. Pipes / || are left intact (conservative). The trailing
# `\n` from printf terminates the last segment so `read` does not drop it; `IFS=
# read` keeps the default field-splitting for the per-token scans in is_broad_test.
broad=1
if printf '%s\n' "$cmd" | tr '&;' '\n\n' | {
  while IFS= read -r seg; do
    case "$seg" in
      *cdd-kit\ test\ run*|*cdd-kit\ test\ select*) continue ;;
    esac
    if is_broad_test "$seg"; then exit 0; fi
  done
  exit 1
}; then
  broad=0
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
