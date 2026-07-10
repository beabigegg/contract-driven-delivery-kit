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
# caught. The runner is matched only at COMMAND POSITION (after leading
# `VAR=value` env assignments and a path prefix, mirroring isPytestCommand in
# src/commands/test-run.ts), so a wrapped `.venv/bin/pytest` is caught while a
# mere mention (`echo python -m pytest`) is left untouched. Detection is otherwise
# deliberately conservative — a bounded target (a path, a `::` node id, or a test
# file), `cdd-kit test run ...`, and every non-test command (lint, typecheck, build,
# `cdd-kit validate`, ...) are allowed untouched. A target is recognized ONLY
# structurally — a path, a `::` node id, or a test file — so a bare word is never
# one: not an option VALUE (the `1` in `--maxfail 1`, the `no:warnings` in
# `-p no:warnings`), not a config/report path (`--config x.config.ts`,
# `--junitxml junit.xml`), not a bare directory, and not a shell operator (the `|`
# in `pytest | tee log`). Add a trailing slash (`pytest tests/`) to bound a bare
# directory. False negatives are preferred over blocking a legitimate command; this
# is advice, not a security boundary. The runner is strongest for pytest (ADR
# 0005); other stacks match only their unambiguous whole-suite forms.
#
# Default mode is ADVISORY: it prints guidance to stderr and ALLOWS the command.
# Set CDD_TEST_RUNNER_STRICT=1 to BLOCK the command instead (exit 2). The hook
# gates only the agent's Bash tool — a human running tests in a terminal is
# unaffected.
#
# Wire into Claude Code (.claude/settings.json) — `cdd-kit install-agent-hooks
# --test-runner` writes this for you. Anchor to $CLAUDE_PROJECT_DIR: Claude Code
# does not guarantee the hook's cwd is the project root, and this hook's relative
# `[ -d ".cdd" ]` probe needs it — otherwise the hook silently allows everything.
#
#   {
#     "hooks": {
#       "PreToolUse": [
#         { "matcher": "Bash", "hooks": [
#           { "type": "command",
#             "command": "cd \"${CLAUDE_PROJECT_DIR:-.}\" && ./.claude/hooks/pre-tool-use-test-runner.sh" }
#         ] }
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

# True (0) when $1 names an explicit test TARGET, recognized ONLY structurally: a
# pytest node id (`::`), a path (`/`), or a test source file (*.py/*.ts/*.js/...).
# A bare word is NEVER a target — not a bare directory, not an option VALUE (the `1`
# in `--maxfail 1`, the `no:warnings` in `-p no:warnings`), not a subcommand keyword
# (`vitest run`), not a shell operator (`pytest | tee log`) — because a bare word is
# structurally ambiguous and telling these apart would need each runner's unbounded
# option grammar. Config/report artifacts handed to an option (`--config x.config.ts`,
# `--junitxml junit.xml`) are excluded too. So no flags-only / config-only / piped
# run is mistaken for bounded. This is the single target predicate for every runner;
# to bound a bare-directory run, give it a path (`pytest tests/`, not `pytest tests`).
# Word-splitting is intended; `set -f` keeps a glob like tests/*.py from expanding.
has_test_target() {
  for tok in $1; do
    case "$tok" in
      -*) ;;                                                       # option flag — skip
      *.config.*|*.cfg|*.ini|*.toml|*.xml|*.json|*.lcov|*.html) ;; # config/report artifact, not a target
      *::*|*/*|*.py|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) return 0 ;; # node id / path / test file
      *) ;;                                                        # bare word / option value
    esac
  done
  return 1
}

# True (0) when $1 is a broad, whole-suite test invocation the ladder replaces.
# Conservative: a recognized runner WITH an explicit target, or any unrecognized
# command, is not broad (returns 1 -> allowed).
is_broad_test() {
  c=${1#"${1%%[![:space:]]*}"}   # strip leading whitespace

  # Normalize to COMMAND POSITION (mirrors isPytestCommand in src/commands/
  # test-run.ts): (a) drop leading `VAR=value ` env assignments, (b) reduce a
  # leading path on the runner token to its basename. So `PYTHONPATH=.
  # .venv/bin/pytest` is recognized as `pytest`, while a runner only MENTIONED
  # later (`echo python -m pytest`) keeps `echo` as its head and is left untouched.
  while :; do
    first=${c%%[[:space:]]*}
    case "$first" in
      [A-Za-z_]*=*)
        # Mirror isPytestCommand's /^[A-Za-z_][A-Za-z0-9_]*=/: only the KEY must be a
        # bare identifier; the VALUE may contain slashes (`VIRTUAL_ENV=/tmp/venv`).
        case "${first%%=*}" in *[!A-Za-z0-9_]*) break ;; esac
        rest=${c#"$first"}
        c=${rest#"${rest%%[![:space:]]*}"}
        ;;
      *) break ;;
    esac
  done
  first=${c%%[[:space:]]*}
  case "$first" in
    */*) rest=${c#"$first"}; c=${first##*/}$rest ;;   # strip the runner's dir path
  esac

  # `python[3.x]`/`py` may carry interpreter options before the module flag
  # (`python -u -m pytest`; python --help: `[option] ... [-m mod]`). Drop a leading
  # run of `-*` options so `-m pytest` lands where the case below expects it. A
  # non-option token (a real script, `python foo.py`) stops the skip, so only an
  # actual `-m pytest` is reduced; `echo python -m pytest` (head `echo`) is untouched.
  case "$c" in
    python\ -*|python[0-9]*\ -*|py\ -*)
      head=${c%%[[:space:]]*}
      args=${c#"$head"}; args=${args#"${args%%[![:space:]]*}"}
      while :; do
        case "$args" in
          -m|-m\ *) break ;;
          -*) opt=${args%%[[:space:]]*}; args=${args#"$opt"}; args=${args#"${args%%[![:space:]]*}"} ;;
          *) break ;;
        esac
      done
      c="$head $args"
      ;;
  esac

  case "$c" in
    # pytest family — broad unless a path / node id / test file follows.
    pytest|pytest\ *|py.test|py.test\ *)
      if has_test_target "$(printf '%s' "$c" | sed -E 's/^(py\.test|pytest)//')"; then return 1; fi
      return 0 ;;
    # `python[3.x]`/`py -m pytest` ONLY at command position (so a mention like
    # `echo python -m pytest`, now headed by `echo`, is not matched).
    python\ -m\ pytest|python\ -m\ pytest\ *|python[0-9]*\ -m\ pytest|python[0-9]*\ -m\ pytest\ *|py\ -m\ pytest|py\ -m\ pytest\ *)
      if has_test_target "$(printf '%s' "$c" | sed -E 's/^.*-m[[:space:]]+pytest//')"; then return 1; fi
      return 0 ;;
    # npm/yarn/pnpm whole-suite scripts — bounded only when the `-- <target>`
    # passthrough carries a real test target, not just runner flags or a
    # config/report path (npm forwards `-- --config x.config.js` to the runner,
    # which still runs the whole suite). Same structural check as the runners above.
    npm\ test|npm\ test\ -*|npm\ t|npm\ run\ test|npm\ run\ test\ -*|yarn\ test|yarn\ test\ -*|pnpm\ test|pnpm\ test\ -*|pnpm\ run\ test|pnpm\ run\ test\ -*)
      case "$c" in
        *\ --\ *) if has_test_target "${c#*" -- "}"; then return 1; fi ;;
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
    # go test across the whole module (`./...`), with or without leading flags — but
    # a test-selection filter (`-run`/`-bench`/`-fuzz`, space or `=` form) narrows it
    # to specific tests (go help testflag), so that is bounded, not whole-suite.
    go\ test|go\ test\ *)
      case "$c" in
        *\ ./...|*\ ./...\ *)
          case " $c " in
            *\ -run\ *|*\ -run=*|*\ -bench\ *|*\ -bench=*|*\ -fuzz\ *|*\ -fuzz=*) return 1 ;;
            *) return 0 ;;
          esac ;;
      esac
      return 1 ;;
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
# Shell quoting hides a `;`/`&&` inside an argument from starting a new command.
# The sanctioned ladder passes a possibly shell-composed run verbatim through
# `cdd-kit test run ... --command "<...>"` (src/commands/test-run.ts runs it as-is),
# so blank that quoted value before splitting — otherwise an inner `;`/`&&` would be
# mis-split and the inner runner mis-flagged, blocking a ladder command the kit
# explicitly allows. Commander accepts both the space (`--command "<...>"`) and the
# equals (`--command="<...>"`) forms, single- or double-quoted, so blank all four.
# A broad run chained OUTSIDE the quotes (`cdd-kit test select ... && pytest`) is
# untouched and still caught.
sq=\'
scan=$(printf '%s' "$cmd" | sed -E \
  -e 's/--command[[:space:]]+"[^"]*"//g' \
  -e "s/--command[[:space:]]+${sq}[^${sq}]*${sq}//g" \
  -e 's/--command="[^"]*"//g' \
  -e "s/--command=${sq}[^${sq}]*${sq}//g")

broad=1
if printf '%s\n' "$scan" | tr '&;' '\n\n' | {
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
