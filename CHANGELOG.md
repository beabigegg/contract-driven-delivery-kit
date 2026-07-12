# Changelog

## [Unreleased]

## [3.13.0] - 2026-07-11

### Added

- Versioned policy, boundary-manifest, execution-capsule, runtime-state and
  runtime-evidence contracts.
- Independent Boundary Guard with changed-operation discovery, non-vacuous
  variant/capture coverage and captured-body JSON Schema validation.
- Deterministic runtime planning, risk profiles, resumable digest-bound state,
  evidence verification and CLI/MCP entry points.
- First-class Codex support through `AGENTS.md`, `$HOME/.agents/skills` and Codex
  MCP registration, alongside the existing Claude Code adapter.
- Provider-neutral engineering doctrine modules with a traceability ledger.
- Dry-run-first project migration and ownership-aware global asset manifests,
  backups and customized-file preservation.
- Profile-aware acceptance provenance: strict preserves ADR 0010, balanced and
  lightweight avoid universal oracle ceremony, and controlled activates it
  through capsule evidence or `--require-acceptance`.

### Changed

- Boundary findings participate in the existing gate but remain informational
  under the default shadow policy; strict stays authoritative until parity is
  independently demonstrated and approved.
- User-level postinstall and explicit update distinguish package-owned assets
  from user-owned modifications instead of overwriting by path alone.
- `cdd-kit gate` consumes an explicit agent-native profile or a matching runtime
  capsule; without either it preserves legacy behavior.

## [3.12.0] - 2026-07-11

Completes the human-confirmation guarantee that 3.11.0 only made half-real. Change:
`enforce-human-confirmation`.

### Added

- **`enforceConfirmationHookInstallation` gate check.** Verifies the two write-block
  PreToolUse hooks are actually armed in a project's git-tracked `.claude/settings.json`,
  rather than merely shipped as scripts nobody registered. Six DISTINCT causes each carry
  their own message (settings absent / untracked / hook unregistered / registered in the
  dormant shape Claude Code never executes / script path untracked / git declined to
  answer) — collapsing any two is the defect this check exists to catch. `ci-or-strict`:
  a hard error on stderr in CI or under `--strict`, an advisory warning in a default local
  run. A non-Claude provider (per `.cdd/model-policy.json`) gets one advisory line instead
  of a failure, since the hooks are a Claude Code mechanism.
- **`enforceInteractionDesign` AC-1** — a confirmed interaction design whose
  `## Presented Information` or `## States` table has zero rows now fails, so a
  confirmed-but-vacuous derivation chain can no longer pass silently.

### Changed

- **The write-block hooks are now actually a chokepoint, not a decoration.** They are
  git-tracked, invoked through `sh` (so a Windows-committed mode `100644` script still
  runs in POSIX CI), and compare the **canonical** target path — unescaping JSON
  backslashes, folding separators, collapsing `//` and `/./`, dropping `./`, lowercasing —
  so `.cdd/./design-lock.json`, `.cdd//design-lock.json`, a Windows absolute path (what
  Claude Code actually sends), and a case-variant no longer slip through. A permitting hook
  emits nothing; a refusal names the blocked file.
- **A no-op `design confirm` / `accept relock` preserves provenance.** A re-run whose hash
  is unchanged now writes nothing and says so, instead of overwriting `locked-at`,
  `timestamp`, `tty`, and `git-author` — the audit clue of the original confirmation
  survives.
- `contracts/ci` → 0.9.0, `contracts/env` → 0.4.0 (`CDD_*_WRITE_STRICT` retired; `CI`
  documented as a consumed input).

### Fixed

- **The hash-lock gate tests were vacuous.** Both hash-lock checks had a test that merged
  stdout+stderr and never asserted `status`, so they were green whether the check warned or
  hard-failed — the enforcement gap survived a whole release under a green test. Fixed to
  assert the stream (`log.warn`→stdout, `log.error`→stderr). Two hook test suites also
  skipped on win32 (hardcoded `/bin/sh`); switched to `sh` on PATH, which un-skipped 26
  tests and immediately surfaced one real failure.
- **Oracle independence (round-3 external review).** Three acceptance-oracle `expect` leaves
  had been read off the running system rather than derived from a source; the properties
  were promoted into `contracts/ci/ci-gate-contract.md` so the oracle asserts them from a
  real source. The `given`/`when`/`then` narrative is deliberately left outside the
  hash-locked region (documented tradeoff).

## [3.11.0] - 2026-07-09

External review of 3.10.0 (codex) filed four findings; two further defects were found
while verifying them. Change: the review-fix pass.

### Fixed

- **The hash-lock gates treated a MISSING baseline as a warning.** `enforceInteractionDesign`
  and `enforceAcceptanceOracle` let any Edit-capable agent author its own `## Confirmed`
  section or `acceptance.yml`, never run confirm/relock, and pass the gate — the
  human-confirmation guarantee at the centre of ADR 0010/0012 did not exist in the default
  configuration. A missing baseline is now an ERROR under `isNewChange || strict`. (The
  write-block enforcement, hook arming, and path canonicalization were still incomplete
  here — 3.12.0 finishes them.)

### Changed

- Hardened the CI changed-spec-directory detection step and related gate wiring.

## [3.10.0] - 2026-07-09

### Added

- **Interaction-design loop (ADR 0012)** — the design-side counterpart to the ADR 0010
  acceptance oracle. A read-only `interaction-designer` agent (Read/Grep/Glob only, so it
  cannot author the design it proposes) emits a derivation chain: presented information +
  why → user intents by frequency → every control citing exactly one intent → state
  reversibility → a meaning⇄form bijection → Open Decisions.
  `specs/changes/<id>/interaction-design.md` carries it; `## Confirmed` is human-only,
  `cdd-kit design confirm` is the sole writer of `.cdd/design-lock.json`, and
  `pre-tool-use-design-write.sh` blocks agent writes. A semantic edit after confirmation
  fails with "interaction design modified after confirmation — human must re-confirm".
  Every information item and UI state must cite a supplier in the API or data-shape
  contract, and two meaning-distinct states must cite DISTINCT discriminators.
  `enforceInteractionDesign` is a required check behind the `isNewChange || strict`
  migration window.

## [3.9.0] - 2026-07-09

### Added

- **Not-applicable contract surfaces (ADR 0011).** Contract frontmatter may
  declare `applicability: not-applicable` with a required, non-empty
  `applicability-reason` when a project genuinely lacks a surface (e.g. a CLI has
  no HTTP API / CSS / business-domain / data-shape). The semantic validators then
  SKIP that family with an informational note, while an UNMARKED empty/placeholder
  stub still HARD-FAILS exactly as before — closing the false positive where a
  CLI/backend-only repo could not get a green `cdd-kit gate` without inventing
  fake contract content. Fail-closed by design: a marker without a reason (or with
  an unrecognized value) is a hard error; a marker only ever suppresses its own
  family's check; a marked contract that later gains real content surfaces as an
  advisory drift WARNING. The Python `applicability.py` reader is the single
  pass/fail authority; `validate.ts`/`doctor` read the marker for display only.
  `build.js` strips the marker from generated `assets/contracts` so `cdd-kit init`
  still ships neutral stubs that fail until filled. The kit's own
  `contracts/{api,css,business,data}` are marked, so `cdd-kit gate`/`validate` on
  the kit itself is now green on those surfaces. `contracts/ci` → 0.3.0.

### Fixed

- **Acceptance-oracle hardcoded-expect scanner (surfaced by dogfooding).** The
  ADR 0010 scanner (`src/utils/mock-of-sut-scan.ts`) had two false-positive bugs:
  it scanned sibling changes' acceptance drivers (cross-change contamination), and
  it matched a case's `expect` leaf value as a substring of a larger token (e.g.
  `reason` inside `applicability-reason`). Fixed by scoping the scan to the
  current change's own driver(s) and requiring whole-token (word-boundary)
  matches; a genuinely hardcoded answer literal is still caught.

## [3.8.0] - 2026-07-09

### Added

- **Acceptance Oracle (ADR 0010) — human-supplied ground truth as a
  tamper-evident gate.** A new human-owned `acceptance.yml` artifact per change
  pairs business-language `input → expect` cases (plus never-break invariant
  `rules`) with the behavior, and a new required `enforceAcceptanceOracle` gate
  check makes the implementation prove it against the real system — closing the
  intent gap that no purely-syntactic check can (the oracle problem). The
  author's answer key is locked against agent tampering by four mechanisms:
  - **Hash-lock** — the gate reconciles the oracle's locked region
    (`cases[].{id,input,expect}`, `rules[].{id,statement}`) against an
    author-time baseline in `.cdd/acceptance-lock.json` (canonical
    parsed-projection sha256, cross-platform); a post-authoring edit fails with
    "acceptance oracle modified after authoring — human must re-confirm."
    `cdd-kit accept relock <id>` is the only sanctioned way to re-baseline.
  - **Agent-write block** — `pre-tool-use-acceptance-write.sh` PreToolUse hook
    (armed via `cdd-kit install-agent-hooks --acceptance-write`;
    `CDD_ACCEPTANCE_WRITE_STRICT=1` hard-blocks) stops an agent editing
    `acceptance.yml`; `.cdd/acceptance-lock.json` is a hard agent-forbidden path.
  - **Mock-of-SUT + hardcoded-answer scan** — the gate rejects an acceptance
    driver that mocks the change's own system-under-test (resolved from the
    code-map) or hardcodes an `expect` value instead of reading it from the
    emitted loader. Covers pytest and vitest.
  - **Executed evidence** — a case passes only via a recorded, bounded
    `acceptance`-phase run in `test-evidence.yml` (ADR 0005 harness); `cdd-kit
    test run <id> --phase acceptance` runs the drivers under `tests/acceptance/`
    / `test/acceptance/`.
- **`acceptance.yml` template + backfill.** `cdd-kit new` scaffolds it; `migrate`
  backfills existing in-flight change dirs; a placeholder oracle fails the gate
  until real cases are supplied (never silently skipped).
- **Asset version + content-digest stamping.** `refresh`/`upgrade`/
  `install-agent-hooks` record `{version, digest}` per installed asset in
  `.cdd/asset-manifest.json`, and `doctor` reports drift (installed vs manifest,
  and installed vs packaged) — proves a complete, current re-scaffold and
  detects a stale global install.
- **`CDD_ACCEPTANCE_WRITE_STRICT`** env variable (advisory `0` / hard-block `1`).

### Changed

- `ci-gate-contract.md` → 0.2.0 (new required `enforceAcceptanceOracle` check);
  `env-contract.md` → 0.2.0 (`CDD_ACCEPTANCE_WRITE_STRICT`). The new gate check
  degrades gracefully for legacy/non-strict changes (`isNewChange || strict`
  migration window) so existing change dirs are not failed on upgrade.

## [3.7.1] - 2026-07-08

### Fixed

- **`cdd-kit setup` no longer reports the pre-commit gate as active when it was
  soft-skipped.** In a not-yet-`git init`ed project, `installHooks({ fromInit:
  true })` returns without writing a hook, but `setup` still printed
  `Pre-commit gate: ok`, giving false confidence that local enforcement was
  armed. `installHooks` now returns an explicit `{ status: 'installed' | 'skipped'
  }` result, and `setup` reports a soft-skip as a **warning** with the reason.
- **`cdd-kit gate <change-id>` now validates the change id before path use.**
  `gate` joined the raw id straight into `specs/changes/<id>`, unlike `new` and
  `test run`, which already reject path-escape ids. A value such as `../../etc`
  is now rejected with `invalid change id` (parity with those commands; ADR
  0005 §4). The `SAFE_CHANGE_ID` pattern is consolidated into
  `src/utils/change-id.ts` so `gate`, `test run`, and `test select` share one
  definition instead of three copies.

### Docs

- **Clarified the read-only agent classification in README.** The reviewer/auditor
  agents are precisely *non-writing* (no `Edit`/`Write`/`MultiEdit`); several
  (`qa-reviewer`, `visual-reviewer`, `dependency-security-reviewer`,
  `repo-context-scanner`, `spec-drift-auditor`) carry `Bash` to run gates,
  `npm audit`, screenshots, and drift scans, so their read-only behaviour is a
  prompt convention layered on the enforced no-`Edit`/`Write` tool set — not a
  tool-level guarantee.
- **Fixed the chokepoint-dashboard `--strict` description.** README claimed the
  dashboard never fails `--strict`; the implementation reports a dormant
  chokepoint as a warning, which *does* fail `--strict`. README now documents
  the actual (intended) behaviour: under strict mode a repo carrying dormant
  enforcement machinery does not pass.

## [3.7.0] - 2026-07-08

### Added

- **Parallel-change fan-out/fan-in core (ADR 0009).** Infrastructure for
  developing multiple tracked changes concurrently in separate git worktrees
  without colliding at merge time on shared governance surfaces (contract
  `schema-version` lines, `contracts/CHANGELOG.md`, regenerated `.cdd/*`
  indexes). None of these are *logical* conflicts — the only conflict a human
  should adjudicate is two changes editing the same contract clause — so the kit
  now splits **prevention** (make textual conflicts impossible) from
  **escalation** (surface only genuine semantic overlap):
  - **`cdd-kit reserve <change-id> --contract <key> --bump <kind>`** — pre-allocate
    a distinct contract version lane per (change, contract) on the base commit
    before branching. Allocates the next free ascending target (bumping from the
    max of the on-disk version and every already-reserved lane); idempotent per
    change. Records named `surfaces` and a changelog-fragment path in the
    `.cdd/reservations.yml` ledger (schema-validated before write).
  - **`cdd-kit integrate`** — read the ledger, compute a contention matrix, and
    print a deterministic monotonic merge order (lowest reserved version first).
    Exit 3 on genuine surface overlap that needs a human, exit 0 when the merge
    is automatable.
  - **`cdd-kit changelog build [--check]`** — assemble per-change
    `contracts/changelog.d/*.md` fragments into the `## Unreleased` section
    (news-fragment / towncrier pattern), so concurrent changes touch disjoint
    files instead of conflicting on one shared changelog. `--check` is a CI drift
    gate.
  - **`cdd-kit parallel arm`** — register the local `merge.ours` git driver the
    parallel `.gitattributes` policy needs (idempotent, once per clone).
  - **`.gitattributes`** — `merge=ours` for regenerated `.cdd/*` indexes (rebuild
    with `cdd-kit refresh` after merge), `merge=union` for the changelog append
    surface.

  Pure semver/lane/contention logic lives in `src/commands/parallel-shared.ts`
  and is covered by unit + CLI tests (25 new tests). New `/cdd-parallel` skill
  and `references/parallel-worktree-standard.md`. Enforcement is by convention +
  `cdd-kit integrate`, not (yet) a hard gate — see ADR 0009 for the tradeoff.

## [3.6.0] - 2026-06-26

### Changed

- **Solution-minimalism (reuse-first) discipline for implementation agents.**
  Adapted from the "lazy senior developer" idea: before writing implementation
  code, agents now walk a reuse-first ladder (does this need to exist? already in
  the codebase? stdlib/framework/native feature? installed dependency? one line?
  only then the minimum that works) instead of reaching for new code, a new
  dependency, or premature abstraction. The discipline is placed where it
  reliably executes — the always-loaded `CLAUDE.md` body and the
  `backend-engineer` / `frontend-engineer` / `bug-fix-engineer` prompts (the
  agents that demonstrably run) — **not** in a review agent that may be ticked
  `done` without running, and **not** as a gate (over-engineering is a judgment
  call). It is scoped to implementation/solution code only, with an explicit
  carve-out: tests, contracts, validation, error handling, security, and
  accessibility are never minimized.

### Added

- **Required-agent evidence — advisory (ADR 0008).** `cdd-kit gate` now surfaces,
  as a **warning** (never an error, even under `--strict`), any agent listed in
  `change-classification.md` `## Required Agents` that left no non-stub
  `agent-log/<agent>.yml`. This addresses a real gap a forensic look at an adopted
  project exposed — a required review (UI/UX, visual, contract, QA) marked `done`
  in `tasks.yml` with zero trace it ran — without converting a prevention-first
  tool into post-run paperwork: an agent-log is post-hoc, self-reported, fakeable
  audit, and the harms that *are* mechanically checkable are already caught by the
  validators / API + data-shape conformance / test-evidence layer regardless of
  whether a reviewer agent ran. The warning gives a no-human-review operator a
  signal for the judgment-only reviews (UI/UX, visual) that have no mechanical net.
  `agent-log/*.yml` stays optional; the bug-fix lane's hard `bug-fix-engineer.yml`
  requirement is unchanged. The `ci-cd-gatekeeper` ↔ `ci-gatekeeper` alias is
  tolerated. New module `src/commands/gate-agents.ts`.

## [3.5.0] - 2026-06-25

### Changed

- **Multi-word query matching for `cdd-kit index query` and `cdd-kit graph
  query`/`context`.** The matcher previously treated the whole query as one
  atomic substring (`haystack.includes(query)`), so any multi-word query — a
  natural-language task ("filter options are empty") or even two words ("order
  export") — scored 0 against every symbol, because no single identifier
  contains the whole phrase. Agents then had to decompose the query into one
  exact identifier per call and retry, which was the observed "many round-trips,
  never finds it" failure mode of graph-first exploration. Queries are now
  tokenized (whitespace/comma split, stopwords and 1-char tokens dropped) and
  scored by token coverage: a symbol matching more of the query ranks higher, so
  `exportOrders` is found by "order export" in a single call. **Single-word and
  exact-match queries are byte-identical to before** — only multi-word queries
  take the new path — so the gate's `--check` determinism and existing indexes
  are untouched. New shared module `src/code-map/query-score.ts`
  (`tokenizeQuery`, `scoreQuery`).

### Added

- **`cdd-kit graph context --with-source`.** The natural-language context entry
  (`graph context "<task>"`, and `cdd_graph_context` over MCP) now accepts
  `--with-source` (with `--source-budget`, native engine), inlining each entry
  point's code in the same call. Previously `graph context` returned only symbol
  names and line ranges, forcing a second `graph query --with-source`/`Read` per
  entry point; the source is now returned up front, removing that mandated extra
  round-trip.

## [3.4.0] - 2026-06-20

### Added

- **tsconfig/jsconfig path-alias resolution in the code graph.** Non-relative
  imports resolved through `compilerOptions.paths` aliases (`@/x`, `~/x`) or a
  `baseUrl` root are now linked to real `imports` edges instead of being dropped
  as third-party — previously the dominant source of missing edges (and the
  downstream unresolved call/extends refs they carry) in alias-heavy Vue/React
  projects. Each candidate is gated by membership in the scanned file set, so a
  stray guess at a real npm package is simply ignored. Projects that declare no
  alias config are unaffected: the resolver returns `null` and resolution is
  byte-for-byte identical to before. New module
  `src/code-graph/tsconfig-paths.ts` (tolerant JSONC parse, one level of
  `extends`, classic `baseUrl` resolution for bare specifiers).

- **Last-good retention when a source file fails to parse.** A file that threw a
  parse error during `cdd-kit code-map` previously vanished from the index,
  blinding agents to a file that was merely mid-edit and momentarily broken. Its
  previous entry is now carried over and flagged in the map header
  (`path:  # N lines  (STALE: parse failed last run; last-good symbols retained)`)
  so its symbols stay queryable until the syntax is valid again. Brand-new
  unparseable files — with nothing to retain — still drop, as before. This is
  the write-side complement to the agent-read-discipline change below.

### Changed

- **Index discipline: a direct `Read .cdd/code-map.yml` is now a last-resort
  fallback, not an equal first option.** Only the `cdd-kit graph/index` query
  path auto-refreshes the map (and the native graph) before answering; a raw
  file read returns a static snapshot that can lag edits made earlier in the
  same change. `backend-engineer` and `frontend-engineer` now reach for the
  refreshing query first and read the raw file only when shell access is
  unavailable, with an explicit staleness caveat. The `/cdd-new`,
  `/cdd-resume`, and `contract-driven-delivery` skills now run `cdd-kit code-map`
  before commissioning the no-shell planning agents (`spec-architect`,
  `implementation-planner`, `test-strategist`), which can only read the static
  file.

## [3.3.0] - 2026-06-16

### Added

- **Near-miss schema-reference detection — close the "looked green, checked
  zero" hole in the data-shape gate (ADR 0007).** A response/request cell that
  names a defined schema in a non-bare form (`→ AckResponse`, `see AckResponse`,
  `AckResponse (success)`) does not resolve to a `$ref`, so `openapi export`
  silently leaves the body unenforced and the gate passes while checking nothing.
  This was observed in a real consumer project: 178 endpoints written as
  `→ SchemaName`, a 177-entry sample manifest, and `validate --contracts`
  reporting `checked 0 sampled endpoint(s)` — exit 0, fully disarmed. cdd-kit now
  detects the near-miss on three surfaces, none of which existed before:
  - **`cdd-kit openapi export`** warns (on stderr, still exits 0) for every
    decorated cell that names a defined schema, naming the bare correction.
  - **`cdd-kit doctor`** adds a warning finding (trips `--strict`) listing the
    offending endpoints, separate from the aggregate "0 typed" coverage line.
  - **`validate_response_shape.py`** (the `validate --contracts` / gate chain)
    escalates a *sampled* near-miss from the generic prose warning to a hard
    **error**, turning a falsely-green build red. Detection is high-precision: it
    only fires when the named schema is actually defined, so genuine prose labels
    (`success_response`) are never flagged. The shared grammar
    (`parseSchemaCellRef` / `detectSchemaCellNearMiss`) lives in the contract
    parser so all three surfaces and the Python validator key off one definition.

## [3.2.0] - 2026-06-15

### Added

- **Data-shape conformance — the response-body gate (ADR 0007).** Route-level
  conformance only checks method + path; the response *body* shape — the thing
  that actually breaks frontend/backend integration — was unenforced. New
  `validate_response_shape.py` (in the `cdd-kit validate --contracts` chain and
  the gate) validates captured response samples against the contract's typed
  response schema. Stack-agnostic by construction: it reads only JSON + JSON
  Schema (the generated `contracts/api/openapi.json` projection), so it works the
  same for Flask, FastAPI, Express, or Go.
  - **Opt-in by adoption, error by default once adopted.** A
    `tests/contract/response-samples.json` manifest is the opt-in signal — no
    manifest, the check skips and exits 0 (existing projects are untouched on
    `npm update`). Once a manifest exists, a declared-schema mismatch is an error
    by default (configurable to `warning` via `.cdd/conformance.json`
    `responseShape`). Endpoints whose response cell is still prose are skipped —
    migration is incremental, never forced.
  - **Scaffold.** `cdd-kit init`/`refresh` lay down a `tests/contract/` harness
    (README with per-stack capture snippets, example manifest, `samples/`) so the
    gate is a ready-to-activate scaffold, not a doc. The active manifest name is
    never shipped, so a project's own samples are never clobbered.
  - **Backend codegen.** `suggest-codegen` now wires a `contract:models` npm
    script when FastAPI is detected (`datamodel-codegen`: `openapi.json` →
    Pydantic), so declaring the models as a route's `response_model` makes FastAPI
    enforce the contracted shape at runtime — the backend half of the OpenAPI seam
    ADR 0001 left open.
  - **Self-driving adoption.** `cdd-kit doctor` reports response-shape coverage
    (typed vs prose response cells, manifest presence) so the gap is a mechanical
    nudge. Agent guidance updated (contract-reviewer, spec-drift-auditor,
    qa-reviewer, backend/frontend-engineer) and the API contract standard gained a
    "Response-body shape & the data-shape gate" adoption recipe, so the workflow
    drives migration to typed schemas + re-running the gate.

## [3.1.1] - 2026-06-15

### Fixed

- **Agent PreToolUse hooks now resolve from the project root.** The installer
  wrote each hook command as a bare relative path (`./.claude/hooks/...`), but
  Claude Code does not guarantee the hook's cwd is the project root — so when the
  session cwd differed the harness reported `/bin/sh: ./.claude/hooks/...: not
  found` and the chokepoint never fired. Worse, even when the script resolved,
  each hook's internal relative probes (`.cdd/code-map.yml`, `.cdd/`,
  `contracts/api/api-contract.md`) silently no-op'd under the wrong cwd, turning
  graph-first / contract-write / test-runner into always-allow stubs. The
  installer now anchors every command with `cd "${CLAUDE_PROJECT_DIR:-.}" && ...`
  (the harness exports `CLAUDE_PROJECT_DIR`; the `:-.` fallback preserves prior
  behavior on an older harness). Re-running `cdd-kit install-agent-hooks` (or
  `cdd-kit init` / `cdd-kit setup`) upgrades existing buggy entries in place.

## [3.1.0] - 2026-06-13

Bound `CLAUDE.md` growth so repeated lesson promotion no longer inflates the
always-loaded session context.

### Added

- **`/cdd-consolidate-guidance` skill.** One-time cleanup for a project whose
  `CLAUDE.md`/`CODEX.md` bloated from repeated lesson promotion: it buckets
  content into human-authored / kit-boilerplate / promoted-learning, consolidates
  the promoted bucket into the `cdd-kit:learnings` managed region as one-line +
  pointer entries, externalizes detail to `contracts/` or `docs/`, proposes a
  full plan before writing, and never touches human-authored content (git is the
  undo path).

### Changed

- **`/cdd-close` Step 3 — bounded guidance promotion.** `CLAUDE.md` is loaded
  every session, so appended learnings are a recurring token cost. Close now
  defaults to promote-to-contract, treats `CLAUDE.md`/`CODEX.md` guidance as the
  rare exception, and writes guidance only inside a delimited `cdd-kit:learnings`
  managed region using a merge-or-replace discipline (net growth ≈ 0) with
  externalized detail — never a raw append. Content outside the markers is the
  human's and is never edited.
- **`CLAUDE.template.md`** ships the `cdd-kit:learnings` managed region under a
  `### Promoted Learnings` heading, documenting the one-line-plus-pointer
  convention inline.

### Fixed

- **Flaky `prepublishOnly` / CI gate.** A few filesystem-timing tests (fs
  watchers, mtime staleness, debounce) intermittently failed under full-suite
  parallel contention on Windows, randomly blocking `npm publish`. Vitest now
  retries a failed test up to twice — a timing flake recovers on retry while a
  genuinely broken test still fails every attempt.

## [3.0.0] - 2026-06-12

Major version: queryable/writable contracts (ADR 0004), bounded test execution
(ADR 0005), and the bug-fix lane (ADR 0006) land together with the contract/test
MCP tools (`cdd_contract_query`, `cdd_contract_locate`, `cdd_test_impact`,
`cdd_graph_unresolved`). **Breaking:** Go/Rust stack auto-detection was removed
(see Removed).

### Changed (doctor strictness, #56)

- **`doctor` now warns on dormant safety nets instead of staying silent.**
  Applicable-but-off API conformance and dormant chokepoints are reported at
  `warning` level rather than informational `ok`, so a repo that carries the
  safety-net machinery but enforces none of it no longer reads as a clean bill
  of health. Note: this can change `doctor --strict` exit codes for repos that
  have not armed their chokepoints.
- **Stack-aware `test select`.** Bare targets render through a stack-specific
  runner plan — Python stays pytest-first, JS/TS uses Vitest only when the repo
  clearly opts in, otherwise the selector asks for explicit test-plan commands
  instead of guessing a runner.
- **`code-map` excludes `**/assets/**`** (generated/package asset dirs) from
  driving graph freshness.

### Documentation

- **README CLI Reference reorganized + missing commands documented (P2-11).**
  Grouped the seven scattered `cdd-kit context …` sections under one nested
  `cdd-kit context` heading with a subcommand table; expanded the lone
  `contract locate` section into a `cdd-kit contract` group covering `query` /
  `locate` / `endpoint set` / `schema set`; added previously-undocumented
  `cdd-kit index` (query / impact) and `cdd-kit lint-agents` sections; and
  de-duplicated `install.md` against the README (it no longer re-lists the MCP
  tools, which had drifted stale — the README MCP section is now the single
  source of truth, and `install.md` points at `cdd-kit setup` as the
  recommended path).

### Tests

- **Direct unit coverage for the code-graph query engine (P2-10).** Added
  `test/code-graph/queries.test.ts`, exercising `searchGraph`, `findGraphNode`,
  `graphCallers` / `graphCallees` (previously zero references), `graphImpact`,
  `graphContext`, and `graphUnresolved` against a hand-built `CodeGraphIndex` —
  pinning directionality, depth/limit bounds, name resolution, and
  unresolved-candidate enrichment in isolation rather than only end-to-end
  through the CLI. (The other P2-10 targets — `abandon`, `archive`,
  `install-agent-hooks` — already gained direct tests during earlier P0/P1 work,
  so the genuine remaining gap was the graph query layer.)

### Added

- **Dogfooding example — a complete archived change at
  `specs/archive/2026/add-order-filter/` (P2-9).** The kit shipped only empty
  scaffolds, so a human or agent had no concrete "this is what a finished change
  looks like" reference. This adds a full, self-consistent worked example (the
  `add-order-filter` API change used throughout the kit's docs and tests): all
  seven required artifacts filled in, a narrowly-scoped `context-manifest.md`,
  a completed `tasks.yml` (every task `done`/`skipped` with a reason), passing
  `test-evidence.yml` with `test-runs/` summaries, one `agent-log/*.yml` per
  required agent, an `archive.md` with promoted lessons, and a `README.md` guide
  to what each file demonstrates. Illustrative (no real code is executed); the
  archive `INDEX.md` lists it.

- **`cdd-kit manifest <change-id>` — auto-generated minimal manifest for
  low-risk micro-changes (P2-6).** For a tier 4-5 change the command generates a
  minimal `context-manifest.md` whose **Allowed Paths** is the change's own
  directory plus the files it currently touches (from `git status`), on top of
  the three standard defaults — so a trivial edit no longer needs a hand-authored
  manifest. Deliberately restricted to tiers 4-5: a stricter (tier 0-3) change is
  refused, because a critical/behavioral change should get a deliberately scoped
  manifest with per-agent work packets, not a rubber-stamped boundary. Never
  overwrites an existing manifest without `--force`; requires a tier to be set.
  Flags: `--force`, `--json`.

- **`cdd-kit graph unresolved [path-or-symbol]` + `cdd_graph_unresolved` MCP
  tool, and unresolved references on `graph impact` (P2-4).** The native graph
  builder already recorded the `calls`/`extends`/`implements` references it could
  not link to a target node (DI-container lookups, external service calls,
  dynamic dispatch, ambiguous names) in the index `unresolved` array, but the
  only surface was a bare count in `graph status` — so impact analysis silently
  dropped exactly the blast radius it could not follow. `graph unresolved` now
  lists them (optionally scoped to a file or symbol, filterable by `--kind`), and
  `graph impact` carries the subset originating from its impact set in both text
  and `--json` output. Each item is enriched at query time (the on-disk index is
  never mutated) with same-name candidate nodes, distinguishing an **ambiguous**
  target (candidates present — the target exists but could not be linked
  deterministically) from a **truly external/dynamic** one (no candidate in the
  graph at all). An empty result is a successful, healthy one (exit 0). Exposed
  over MCP as `cdd_graph_unresolved`; CLI flags `--kind`, `--limit` (default 50),
  `--map`, `--no-refresh`, `--json`. Native engine only (that is where the
  unresolved data lives).

- **`cdd-kit contract locate <symbol>` + `cdd_contract_locate` MCP tool (P2-3,
  second of two).** Given a code symbol or file, returns the API-contract slices
  (schemas + endpoints) related to it — the contract analog of `cdd_test_impact`,
  saving the graph-query → read-file → guess-schema-name → contract-query
  round-trip. The code-to-contract bridge is **name overlap** (a `CreateOrder`
  interface ↔ a `CreateOrder` schema), the same honest, bounded heuristic used
  elsewhere — never inference. The symbol is resolved in the code-map (best
  effort) to harvest the file's declared type/class/function names as extra
  search terms, and each located slice records `matched_via`; it still works with
  no code-map (the literal symbol is always a term). Exposed over MCP as
  `cdd_contract_locate` and as a CLI subcommand (`--contract`, `--inventory`,
  `--map`, `--limit`, `--no-refresh`, `--json`). Internally, `contract query`'s
  payload builder was extracted into a pure, reusable `runContractQuery` (the CLI
  behavior is unchanged). **With this, P2-3 is complete.**

- **`cdd-kit test impact <file>` + `cdd_test_impact` MCP tool (P2-3, first of
  two).** Answers "if I change this file, which tests are affected?" without a
  manual grep, by walking the code-map's import graph: it reports test files that
  transitively import the target (up to `--depth`, default 2) plus mirror-path
  test files (`src/foo.ts` ↔ `tests/foo.test.ts`, `foo_test.py`). Every result
  carries a `reason` (`is-target` / `imports-target` / `transitive` / `mirror`),
  so it is a composition of facts the code-map already records — never inference.
  Exposed over MCP as `cdd_test_impact` and as a CLI subcommand (`--depth`,
  `--limit`, `--map`, `--no-refresh`, `--json`); reuses the `index impact` target
  resolver. The companion `cdd_contract_locate` (code symbol → contract slices)
  lands in the next P2-3 PR.

- **Machine-readable change metadata: gate + doctor freshness wiring (P2-1,
  integration phase).** `cdd-kit gate` now emits a warn-only nudge when a
  change's generated `change.yml`/`trace.yml` has drifted from its source
  artifacts, and `cdd-kit doctor` reports the same as a warning that
  `cdd-kit doctor --fix` regenerates. Both surfaces act **only on an index that
  already exists** — a change that never ran `cdd-kit metadata` is never nagged —
  and the staleness signal is purely advisory: it never affects the gate's
  pass/fail, since the source artifacts remain the source of truth.
  `docs/machine-readable-change-design.md` is marked Implemented.

- **Machine-readable change metadata: `cdd-kit metadata` (P2-1, generator
  phase).** Adds `cdd-kit metadata <change-id>` (with `--check`, `--all`, and
  `--json`), which derives two compact YAML indexes per tracked change —
  `change.yml` (status, tier, lane, change types, required agents, required vs
  present optional artifacts, context allowed-paths count, dependencies) and
  `trace.yml` (acceptance criteria → tests → gates, plus agent-log evidence) —
  from the existing markdown/YAML artifacts (`docs/machine-readable-change-design.md`).
  This treats the root cause behind the brittle markdown-as-database parsing
  (P1-12, P1-15): the generator parses each source artifact **once**, centrally,
  reusing the existing parsers (`resolveTier`, `readLane`, `REQUIRED_FILES`,
  the shared markdown-section helper + a new bounded pipe-table reader), and
  emits a structured index that agents/MCP can read instead of repeatedly
  re-reading long markdown. Both files are **generated, never hand-authored**;
  each carries a `generated-from` map of per-source `sha256` digests so `--check`
  (and, in a later phase, `doctor`) can detect staleness. They are a **derived
  index only** — the gate still treats the source artifacts as the source of
  truth, so a missing or stale `change.yml`/`trace.yml` never affects any gate
  pass/fail. Ships with `change-metadata.schema.ts` + `trace.schema.ts` (the
  generator self-validates its output before writing). doctor/gate freshness
  wiring lands in the follow-up integration phase.

- **Bug-fix lane: symptom-driven classification and diagnosis-before-edit
  protocol (ADR 0006 — classification and prompts).** `change-classifier` now
  sets a `## Lane` (`feature` | `bug-fix`) and, for symptom-driven requests,
  records the bug symptom type (`ui` / `visual` / `api` / `data` /
  `performance` / `crash` / `test-failure` / `ci-failure` / `unknown`), a
  diagnostic-only flag, the required bug-evidence checklist, and routes
  symptom-type agents. `bug-fix-engineer` gains the no-edit-before-diagnosis
  gate, the reproduction-status vocabulary (`reproduced` / `test-reproduced` /
  `visual-reproduced` / `intermittent` / `environment-blocked` /
  `not-reproduced`), a hypothesis table, and a schema-valid
  `agent-log/bug-fix-engineer.yml` repair record (the standard agent-log envelope
  carrying symptom, reproduction, hypotheses, root-cause pointer, and regression
  evidence as typed `artifacts:`). `/cdd-new` routes the lane: `bug-fix-engineer`
  leads implementation,
  regression proof runs on the ADR 0005 bounded ladder, and diagnostic-only
  changes open a follow-up. Prompt / classification only — `cdd-kit bug suspects`
  lands in a later ADR 0006 PR.

- **Bug-fix evidence schema (ADR 0006 — schema phase).** Adds
  `src/schemas/bug-fix-evidence.schema.ts`: a first-class, machine-validated
  `bug-fix:` block (symptom, expected/actual behavior, observed surface,
  reproduction status, hypotheses, root cause, fix, regression, residual risk),
  with the reproduction-status enum (`reproduced` / `test-reproduced` /
  `visual-reproduced` / `intermittent` / `environment-blocked` /
  `not-reproduced`) as its single source of truth. `agent-log.schema.ts` gains an
  optional `bug-fix` property so the repair record nests inside the standard
  agent-log envelope (keeping `status:` visible to `/cdd-resume`) rather than a
  bare top-level document. A behavior-changing fix must carry the full repair
  shape (observed surface, root cause, a files-changed fix, a **passing**
  regression, residual risk) and a behavior-fix reproduction status (`reproduced`
  / `test-reproduced` / `visual-reproduced`); a `diagnostic_only` record is
  exempt. Schema and tests only — the gate-integration phase wires this schema
  into `cdd-kit gate`.

- **Bug-fix gate enforcement (ADR 0006 — gate integration).** `cdd-kit gate` now
  detects `lane: bug-fix` from `change-classification.md` (case-insensitively,
  failing on an invalid `## Lane` value rather than skipping) and requires the
  bug-fix-engineer's `agent-log/bug-fix-engineer.yml` to carry a
  schema-valid `bug-fix:` block (ADR 0006 §7). Beyond the schema's structural
  checks the gate adds the checks static schema cannot express: the log must be a
  completed handoff (`status: complete`/`done`/`approved`) authored by
  `bug-fix-engineer` and bound to this change's `change-id`; a reproduced symptom
  must name a `confirmed` hypothesis; referenced reproduction/regression summaries
  must be this change's own `cdd-kit test run` artifacts (under its `test-runs/`,
  an executed run — not collect-only — recording the matching `change_id`, status,
  and command, tolerating only the runner's appended pytest flags; and a
  test-reproduced/failing-before-fix reproduction must reference a failed-or-timeout
  pre-fix run with its command); a behavior-changing fix must
  carry a durable regression summary with its command plus a present
  `test-evidence.yml` (the `test-evidence-not-applicable` opt-out does not apply);
  the diagnostic-only exemption requires explicit classifier approval
  (`## Diagnostic Only` `- yes`), not silence, and may not itself claim a fix or a
  successful reproduction status; and
  the log may not carry prohibited failure-waiver fields at any level. Feature and
  legacy changes (no `## Lane: bug-fix`) are unaffected.

- **`cdd-kit bug suspects` (ADR 0006 — symptom-to-suspects mapping).** A
  bug-facing wrapper over the existing code-graph / code-map index:
  `cdd-kit bug suspects <change-id> --symptom "<text>"` (or `--text "<text>"` for
  a change-less query) maps a symptom to candidate source files, reusing the
  code-graph search/impact with the code-map index as a fallback. Each candidate
  carries matched symbols, read ranges, a reason, and caller/dependent impact; a
  change-scoped query also folds in `context-manifest.md` allowed paths (ranked
  first, with out-of-manifest candidates flagged), `test-plan.md` tests, and
  staged files, and suggests follow-up `next_commands`. Read-only by default
  (pass `--refresh` to regenerate a stale map first); `--json` for machine output.
  Adds `src/commands/bug-suspects.ts` and a `bug` CLI namespace.

- **Bug-fix typed evidence pointers (ADR 0006 — visual/data/performance
  extensions).** The `bug-fix:` block gains optional `visual_evidence` (`before`
  required, plus `after` / `diff`), `data_evidence` (a `kind` and a
  request/response or contract `pointer`), and `performance_evidence` (a bounded
  `pointer` with `baseline_ms` / `after_ms` / `bounded`). `cdd-kit gate` now
  requires `visual_evidence.before` when the reproduction is `visual-reproduced`
  (a durable pre-fix screenshot/browser artifact) and rejects any present evidence
  pointer that is absolute or missing on disk. `bug-fix-engineer.md` documents the
  fields and the escalation of high-risk production symptoms (timeouts, queues,
  caches, DB pools, long-running behavior) to the resilience / stress / soak agents.

- **Bug-fix lane documentation and examples (ADR 0006 — docs and examples).**
  Documents the now-shipped bug-fix lane in the README and adds examples under
  `docs/examples/bug-fix/`. The README gains a `cdd-kit bug suspects` CLI reference
  (both invocation forms, the `--json` / `--limit` / `--map` / `--refresh` flags,
  exit codes — `0` even with zero candidates, `2` for no symptom / unknown
  change-id / no code-intel — and a real `--json` payload) and a Bug-fix lane
  section with four worked examples: a UI/visual fix (`visual-reproduced` +
  `visual_evidence.before`), a pytest failure repair (`test-reproduced` with a
  failing-before-fix reproduction summary and a passing regression), an API
  response-shape bug (`data_evidence` request/response pointer), and an intermittent
  diagnostic-only change (`## Diagnostic Only: yes` + `bug-fix.diagnostic_only:
  true`, exempt from root-cause/regression but still requiring passing evidence or
  an auditable `test-evidence-not-applicable` opt-out).
  `docs/examples/bug-fix/bug-fix-engineer.sample.yml` is a complete, gate-passing
  repair record (the standard agent-log envelope with a nested `bug-fix:` block),
  and `docs/examples/bug-fix/gate-failure.txt` is real `cdd-kit gate` output
  rejecting an incomplete one. Docs only — no behavior change. Completes ADR 0006.

- **Stage-2 contract-write PreToolUse hook (`cdd-kit install-agent-hooks
  --contract-write <mode>`).** The write-side analog of the graph-first hook
  (ADR 0004 §6): an opt-in Claude Code hook that intercepts the agent's
  `Edit`/`Write`/`MultiEdit` of `contracts/api/api-contract.md` and routes it to
  `cdd-kit contract set`, which upserts by key and is valid by construction.
  Advisory by default (reminds, allows the edit); `--contract-write strict`
  writes `CDD_CONTRACT_WRITE_STRICT=1` so the hook hard-blocks the edit (exit 2),
  feeding the routing reason back to the agent. It gates only the *agent's* tools
  — a human editing the contract in their editor is unaffected, and `contract
  set` stays available to humans who want validated edits — and is scoped to the
  one contract `contract set` can mutate today, so it can never brick an edit
  with no `set` form yet (the API surface ships first; §7 extends both later). A
  first-time scaffold (the file does not exist yet) is always allowed.
  `install-agent-hooks` now arms graph-first and contract-write **independently**:
  naming one flag arms only that hook and leaves the other untouched, while a
  bare invocation still arms graph-first advisory (unchanged). `cdd-kit doctor`'s
  chokepoint dashboard reports the new hook as `live`/`dormant`. Not armed by
  `cdd-kit init` — opt-in per the ADR, shipped only now that query + set + gate
  are proven green.

- **Structured test evidence: `test-evidence.yml` template + schema (ADR 0005
  templates and schema).** Added `specs/templates/test-evidence.yml` (and its
  skill copy) as the canonical shape of the bounded, machine-readable test
  evidence that `cdd-kit test run` will generate, plus
  `src/schemas/test-evidence.schema.ts` to validate it. The schema rejects
  known-failure waiver fields by name (`known-failures`, `pre-existing-failures`,
  `allowed-failures`, `waived-failures`, `ignored-failures`) per ADR 0005
  section 7, and `additionalProperties: false` blocks any other stray key.
  Upgraded `test-plan.md` (and its skill copy) with the Test Execution Ladder,
  Test Update Contract, and Stop Rules sections, and registered the new evidence
  artifact in the `/cdd-new` flow. The schema also requires at least one recorded
  run and rejects a `passed` evidence file that contains a failed run, and
  `cdd-kit new --all` does not scaffold `test-evidence.yml` (it is produced by the
  runner, never copied as an example). The bounded runner (`cdd-kit test run`),
  selector (`cdd-kit test select`), and gate enforcement follow in later ADR 0005
  phases.

- **Bounded test runner: `cdd-kit test run <change-id> --phase <phase>` (ADR 0005
  §4-§6).** Runs one phase of the test ladder, captures durable artifacts under
  `specs/changes/<id>/test-runs/<run-id>/` (`command.txt`, `stdout.log`,
  `stderr.log`, `summary.json`, and `junit.xml` for pytest), and upserts the run
  into `test-evidence.yml` with a recomputed, schema-valid `final-status`. pytest
  commands get the bounded defaults (`-q --maxfail=1 --tb=short -ra`) plus JUnit
  output unless the selected command is already stricter by value (so `--maxfail=0`
  or `--tb=long` cannot loosen the run), and the run-dir JUnit report is always the
  one read back. Assistant-visible output is capped to the last 4000 chars (and the
  first failure message to 500) while the full logs stream to disk (only a bounded
  tail is held in memory); the first failure is classified (collection /
  import / fixture / assertion / contract-drift / timeout / runner-error /
  unknown) from JUnit XML, then text, then pytest exit codes. `--json` prints the
  machine-readable summary; `--command` supplies the command until `cdd-kit test
  select` lands. Execution is genuinely bounded: a timeout SIGKILLs the whole
  process tree (not just the shell), `change-id` and an explicit `--run-id` are
  validated against path traversal and reuse, and pytest is detected as the
  invoked program rather than as an argument (so `npm run pytest` is not
  rewritten). Only a simple pytest invocation is rewritten -- a shell-composed
  command (`pytest x && coverage`, pipes, redirects) runs verbatim; generated
  run-ids are reserved atomically, the JUnit path is shell-quoted, and log capture
  honours stream backpressure. Selection and gate enforcement follow in the next
  ADR 0005 phases.

- **Deterministic test selection: `cdd-kit test select <change-id>` (ADR 0005
  §3).** Plans the bounded command for each ladder phase from static inputs and
  never executes tests. It trusts explicit mappings in `test-plan.md`'s
  *Acceptance Criteria → Test Mapping* table (then `implementation-plan.md`'s
  *Test Execution Plan*). A mapping cell is used in one of two deterministic
  ways: a **bare target** (a `.py` file, `file::node`, or a directory) is accepted
  only when it **exists on disk** — so the scaffold's `tests/unit/test_xxx.py`
  placeholder is filtered by reality rather than by word-matching, and real
  packages named `todo`/`example` are not — and becomes the ADR-shaped `collect`
  (`pytest --collect-only -q <target>`) and `targeted`
  (`pytest <target> -q --maxfail=1 --tb=short -ra`) commands; or a **full pytest
  command** is trusted and emitted **verbatim** (same trust boundary as `cdd-kit
  test run`), so option flags, quoting, and multiple targets are the author's
  concern, not the selector's. `..` path-traversal targets are rejected and
  parametrized node ids are shell-quoted for the host platform. `changed-area` is
  derived from the change's touched files — a changed test file runs directly, a
  changed `conftest.py` runs its directory — falling back to the directory of the
  mapped targets when there is no git signal (code-map graph-impact is
  intentionally deferred per ADR 0005 "Revisit when"). A `contract` phase is added
  when contract files are touched or `implementation-plan.md` declares contract
  updates (free-form or labelled bullets), running `cdd-kit validate --contracts`
  plus `--env` / `--ci` for env / CI-contract families; a `quality` phase is
  emitted from the runnable lint/typecheck/build commands configured in the
  change's `ci-gates.md` (workflow-file references are ignored); and a bounded
  `full` smoke is always included. When
  no targeted or changed-area target can be selected safely it returns
  `needs-test-plan-update` (exit 1) instead of searching the repo indefinitely;
  `selected` exits 0 and a usage error (bad id, missing change dir) exits 2.
  `--json` prints the machine-readable plan. The local-import resolver shared with
  `cdd index impact` was extracted to `src/code-map/resolve.ts` so both commands
  resolve dependents identically. Gate enforcement of the recorded evidence
  follows in the next ADR 0005 phase.

- **Gate enforcement of `test-evidence.yml` (ADR 0005 §6/§7, PR-5).** `cdd-kit
  gate` now validates recorded test evidence, not assistant claims. When
  `specs/changes/<id>/test-evidence.yml` is present it is validated against
  `test-evidence.schema.ts` and three cross-field rules the static schema cannot
  express: every phase listed in `required-phases` must have at least one
  *passing* run, no recorded run may be `failed` (a required failure blocks and
  cannot be waived — the schema only catches this when `final-status` is
  `passed`, so a `failed` final-status that passes the schema is still blocked
  here), and `final-status` must be `passed`. Prohibited waiver fields
  (`known-failures`, `pre-existing-failures`, `allowed-failures`,
  `waived-failures`, `ignored-failures`) are rejected by name with an
  ADR-traceable message, and malformed YAML / schema violations fail with a
  precise reason. Missing evidence follows the same migration window as
  `context-manifest.md`: a context-governed (`v1`) change — or any change under
  `--strict` — errors, while a legacy change only warns, so existing changes are
  not broken by the rollout. A change that is genuinely not an implementation
  change opts out auditably with `test-evidence-not-applicable: "<reason>"` in
  `tasks.yml` frontmatter (a new optional field, mirroring `tier-floor-override`),
  which downgrades the error to a recorded warning. Present evidence is also bound
  to the change being gated and cannot be weakened by hand: its `change-id` must
  match (a copied or renamed evidence file is rejected); an otherwise-green file
  must reference real run artifacts under the change's own `test-runs/` directory
  (repo-root-relative only — absolute paths are rejected — plus existence and
  containment); each referenced `summary.json` must itself record the declared
  run's `change_id`, `phase`, `status`, and `command` (so one real artifact cannot
  be reused across phases, copied from another change, or back a run whose command
  was widened); and the always-required ladder floor (`collect`, `targeted`,
  `changed-area`) is merged into the file's own `required-phases` so it cannot be
  trimmed to pass on fewer runs. That floor is a single shared constant
  (`DEFAULT_REQUIRED_PHASES`) that `cdd-kit test run` also merges into any custom
  `--required-phases`, so kit-generated evidence always satisfies the gate floor
  and the two cannot drift. The opt-out is read from the `tasks.yml` the gate
  already parsed, so a `tasks.yml` that fails to parse surfaces that error instead
  of being silently treated as "no opt-out". The checks are deterministic and
  verbatim — they trust declared structured values and verify them (schema shape,
  `change-id` equality, artifact existence and content), with no free-form
  parsing, path guessing, or inference about whether a change is "implementation".
  Agent, skill, and README guidance for the evidence flow follows in the next ADR
  0005 phase.

- **Agent, skill, and README guidance for the evidence flow (ADR 0005 §9, PR-6).**
  Wired the bounded test ladder and `test-evidence.yml` into the workflow docs so
  agents run tests the way the gate enforces them. `references/sdd-tdd-policy.md`
  is now the single source of truth: the six-phase ladder (with `collect`,
  `targeted`, `changed-area` as the always-required floor), the shared execution
  rule (`cdd-kit test select` then `cdd-kit test run --phase ...`; full suite only
  as a final bounded smoke), the no-waiver policy, and the opt-out. `test-strategist`
  must emit bounded node IDs / file paths so `cdd-kit test select` stays
  deterministic; `implementation-planner` references the required phases instead of
  restating test strategy; `backend-engineer` and `frontend-engineer` gain a Test
  execution section that runs the ladder before any broad command and treats a
  required failure as blocking (never waived); `qa-reviewer` approves on
  `test-evidence.yml` (required phases passed, no waiver fields, runs under the
  change's `test-runs/`), not claims. `/cdd-new` shows where the ladder runs
  (Step 3) and that the gate validates the evidence (Step 4); `/cdd-resume` reads
  `test-evidence.yml` and surfaces its status so an interrupted change resumes by
  finishing the ladder. The README adds the ladder overview, a `cdd-kit test`
  reference, and the gate's test-evidence check. Docs only, no behavior change; the
  optional test-runner hook is the final ADR 0005 phase.

- **Optional test-runner PreToolUse hook (`cdd-kit install-agent-hooks
  --test-runner <mode>`) — the final ADR 0005 phase (§10).** The runtime analog of
  the bounded test ladder: an opt-in Claude Code hook that intercepts the agent's
  `Bash` tool and steers a broad whole-suite test command (a bare `pytest`,
  `npm test`, `jest`, `vitest`, `go test ./...`, …) to `cdd-kit test run --phase
  …` so the run produces gate-checkable evidence instead of noisy multi-failure
  output. Advisory by default (warns, allows the command); `--test-runner strict`
  writes `CDD_TEST_RUNNER_STRICT=1` so the hook hard-blocks the command (exit 2),
  feeding the routing reason back to the agent — ship advisory first, per the ADR.
  Detection is deliberately conservative: a bounded target (a node id / file /
  directory), the sanctioned `cdd-kit test run`, and every non-test command (lint,
  typecheck, build, `cdd-kit validate`, …) are always allowed; it fires only inside
  a CDD repo (a `.cdd/` directory exists) and prefers a missed nudge over blocking a
  legitimate command. It gates only the *agent's* Bash tool — a human running tests
  in their terminal is unaffected. `cdd-kit doctor`'s chokepoint dashboard reports
  the new hook as `live`/`dormant`. Not armed by `cdd-kit init` — opt-in, shipped
  only now that select + run + gate are proven green. Completes ADR 0005.

### Changed

- **`visual-reviewer` agent upgraded `haiku` → `sonnet` (P2-8).** Pixel-level
  visual / accessibility review needs comparative judgment that haiku tends to
  miss; sonnet matches the other reviewer agents. Updated the agent frontmatter,
  `.cdd/model-policy.json`, the `doctor --fix` default role map, and the
  `/cdd-new` model-badge note. (The rest of the model roster — 5 opus / 12
  sonnet / 1 haiku after this change — is unchanged.)

- **`tier-floor-override` now requires a substantive, audited justification
  (P2-7).** The override that bypasses the mechanical risk-tier floor previously
  accepted any non-empty free text (even "fix") and left no durable record. The
  reason must now be **at least 20 characters** — a too-short reason no longer
  bypasses, and the floor violation stands — and every accepted bypass is
  appended, with a timestamp, the matched floor, and the reason, to the change's
  `agent-log/audit.yml`. The audit write is idempotent (re-running the gate does
  not duplicate an entry) and best-effort (it never fails the gate).

- **No more known/pre-existing-failure waivers (ADR 0005 policy cleanup).** Any
  required test failure now blocks the gate with no `known` / `pre-existing` /
  `waived` / `allowed` / `ignored` exception. Removed the "Pre-existing Failures
  Excluded From This Gate" section from the QA report template (and its skill
  copy), the waiver bullet from `qa-reviewer`, the trigger references that told
  agents to create a report for excluded pre-existing failures, and the parallel
  exclude-pre-existing mechanisms in `monkey-test-engineer` and the `cdd-new`
  flow. The resolution path is now: fix the failure, expand this change's scope
  to cover the fix, or open a separate tracked change. A broad/full-suite run
  still records only the first unrelated failure and blocks (bounded triage).
  `approved-with-risk` for documented residual (non-test-failure) risk is
  unchanged.

### Removed

- **Go and Rust stack support.** `detectStack` no longer recognizes `go.mod`
  (Go) or `Cargo.toml` (Rust) — those projects now report `unknown`, and
  `cdd-kit init` leaves the CI fast-gate placeholder in place for them instead
  of patching in a stack fragment. The `ci-templates/go.yml` and
  `ci-templates/rust.yml` fragments were deleted, the `StackKind` union and the
  polyglot accounting dropped both languages, and the `detect-stack` table in
  the README was trimmed to the Python and JS/TS toolchains the kit actually
  targets. This also retires the planned P2 "Go/Rust scanners" roadmap item.
  Ecosystem-agnostic guards are unaffected: the test-runner `PreToolUse` hook
  still steers a broad `go test ./...` to the bounded ladder, and dependency
  reviewers still recognize `go.mod` / `go.sum` as lockfiles to inspect.

## [2.2.1] - 2026-06-03

Fix a class of false positives in the 2.2.0 API conformance validator that broke
CI on correct contracts (issue #15), and stop a heuristic blind spot from being
fatal by default.

### Fixed

- **Resolve Flask Blueprint `url_prefix` / FastAPI APIRouter `prefix` across
  files (`validate_api_conformance.py`).** A route declared as
  `@admin_bp.route("/api/logs")` on a `Blueprint(..., url_prefix="/admin")` (or a
  `register_blueprint(bp, url_prefix=...)` in another file) was recorded as
  `/api/logs`, so every prefixed route was flagged `backendRouteNotInContract`
  while the matching contract endpoint was flagged
  `contractEndpointNotImplemented` — two false errors per route against a contract
  that was actually correct. The validator now resolves constructor prefixes per
  file and registration prefixes across files (registration winning) and folds
  them into the route path. Constructor scoping is **per file**, so a bare
  `router` name reused across modules cannot collide; registration prefixes are
  matched across files with each framework's semantics — Flask
  `register_blueprint(url_prefix=...)` **overrides** the Blueprint's own prefix
  while FastAPI `include_router(prefix=...)` is **additive** with the
  `APIRouter(prefix=...)` (served as `<include>/<router>/<route>`). A name
  registered under conflicting prefixes across files is detected and dropped (the
  per-file constructor prefix decides) rather than guessed. The constructor regex
  tolerates a nested-paren kwarg (`APIRouter(dependencies=[Depends(x)],
  prefix=...)`), a module-qualified call (`flask.Blueprint(...)`,
  `fastapi.APIRouter(...)`), and a type-annotated assignment (`router: APIRouter =
  APIRouter(...)`); Flask 2.0 `@bp.get(...)` shorthand is covered too. An explicit
  empty registration prefix (`register_blueprint(bp, url_prefix="")`, a deliberate
  root mount) is preserved and overrides the constructor prefix rather than being
  discarded as falsy. (Issue #15; hardened over three rounds of Codex/Sourcery PR
  review.)

### Changed

- **`backendRouteNotInContract` now defaults to `warning`, not `error`.** Regex
  scanning cannot resolve every cross-file route prefix (aliased routers, the
  Express `app.use` mount form, module-qualified `include_router(pkg.router, …)`),
  so a scanner blind spot must not break CI on a contract that is correct. Raise it to
  `error` (or set `"strict": true`) to enforce once a project's routing shape is
  known to resolve cleanly. Updated in `DEFAULT_CONFIG`, the scaffolded
  `.cdd/conformance.json`, and `docs/api-conformance.md`.

## [2.2.0] - 2026-06-02

Make enforcement live by default, add a mechanical risk-tier safety net under the
AI classifier, and give code indexing an opt-in background mode — the three gaps
that matter most for a fully automated, no-human-reviewer workflow.

### Added

- **Arm enforcement chokepoints by default in `cdd-kit init`.** A fresh `init`
  now wires the graph-first PreToolUse hook (Claude provider, advisory) and the
  pre-commit gate hook, instead of shipping them dormant. In an automated
  workflow with no human reviewer, dormant enforcement means the contracts and
  docs only *look* like they prevent drift. Best-effort: a missing `.git` or
  unusual `settings.json` downgrades to a warning, never a failed init. Opt out
  with `cdd-kit init --no-arm`. `installHooks`/`installAgentHooks` gained a
  `fromInit` mode so arming is non-fatal.
- **Mechanical risk-tier floor (`src/utils/tier-floor.ts`).** A deterministic
  backstop under the (AI) classifier: `cdd-kit gate` scans `change-request.md`
  for sensitive surfaces (auth, payments, migrations, concurrency, secrets, …)
  and **fails** when the declared tier is weaker than the matched floor, so a
  single mis-classification can no longer silently drop the required agents and
  tests. Bypass per-change with `tier-floor-override: "<reason>"` in `tasks.yml`
  frontmatter (downgrades to an audit warning). Policy lives in
  `.cdd/tier-policy.json` (scaffolded, fully editable, `enabled:false` to
  disable); built-in defaults apply when the file is absent so existing repos are
  protected without a re-init.
- **`cdd-kit classify-check [change-id] | --text "<intent>"`** — advisory probe
  that prints the mechanical tier floor *before* classification, so the
  classifier can be steered up front rather than only caught by the gate.
  Supports `--json`.
- **`cdd-kit code-map --watch`** — opt-in background auto-indexing. A debounced
  (default 500 ms, `--debounce`) recursive watcher keeps the map fresh during
  long-lived co-editing sessions, with a freshness-polling fallback where
  recursive `fs.watch` is unavailable. Trigger-based indexing stays the default
  for ephemeral CI/agent runs.
- **ADR 0003** (`docs/adr/0003-code-intelligence-indexing-strategy.md`):
  evaluates LSP (Serena) vs tree-sitter incremental (CocoIndex) vs the kit's
  native AST scanners, and the trigger-vs-background refresh question. Decision:
  keep native AST (LSP does not translate to headless agents), keep trigger-based
  as default, add the opt-in `--watch` above, and sequence per-file incremental
  rebuild as the next step.

### Added (mechanical chokepoints — prior unreleased work)

- **API conformance validator** (`validate_api_conformance.py`): parses real
  backend route declarations and frontend HTTP call sites and diffs them against
  `contracts/api/api-contract.md`. Catches frontend/backend API drift that the
  markdown-only validators never could. Chained into `cdd-kit validate
  --contracts`, so `cdd-kit gate` blocks on drift. Off until enabled in
  `.cdd/conformance.json` (`"enabled": true`); a disabled config is scaffolded by
  `cdd-kit init`. See `docs/api-conformance.md`.
- **`--with-source` / `withSource`** on `cdd-kit index query`, `cdd-kit graph
  query`, and the `cdd_index_query` / `cdd_graph_query` MCP tools: returns the
  matched symbol's code inline so the query replaces a follow-up `Read` instead
  of preceding it. `--source-budget` caps total lines and flags truncated ranges.
- **`hooks/pre-tool-use-graph-first.sh`** (opt-in PreToolUse hook): steers agents
  to `cdd-kit index query --with-source` before reading source files. Advisory by
  default; `CDD_GRAPH_FIRST_STRICT=1` hard-blocks source reads when a code-map
  exists.
- `cdd-kit doctor` reports whether API conformance is enabled, disabled, or
  unconfigured (informational; never fails `--strict`).
- `cdd-kit doctor` reports whether the **cdd-kit MCP server is registered** with
  Claude Code (runs `claude mcp list`). If it is not registered, agents never see
  the graph/index tools and silently fall back to `Read`, so doctor surfaces the
  `claude mcp add --scope user cdd-kit -- cdd-kit mcp` command to fix it.
  Informational only (never fails `--strict`), best-effort with a 3s timeout
  (never blocks on a slow/missing `claude` CLI), skipped for non-Claude and
  non-cdd-kit projects. `CDD_CLAUDE_BIN` overrides the CLI path. Closes the gap
  left by `--with-source`: the incentive to use the kit tools only helps if the
  agent can see them.
- **`cdd-kit install-agent-hooks --graph-first advisory|strict`**: installs the
  graph-first `PreToolUse` hook into `.claude/settings.json` (project-scoped) and
  copies the script to `.claude/hooks/`, so steering agents to
  `cdd-kit index query --with-source` before `Read` becomes an installed harness
  chokepoint instead of manual settings wiring. Advisory by default; `strict`
  writes `CDD_GRAPH_FIRST_STRICT=1`. Idempotent and preserves unrelated settings.
- **`cdd-kit openapi export`**: projects `contracts/api/api-contract.md` into a
  minimal OpenAPI 3.1 skeleton (`--yaml`, `--out`) for tooling such as
  `openapi-typescript`. One-way projection — the markdown contract stays the
  source of truth. Derives paths/params/auth/status codes; marks free-form
  request/response bodies as `x-cdd-unresolved` rather than fabricating schemas.
  Per-stack client generation is intentionally left to the consumer repo; see
  `docs/adr/0001-contract-to-openapi-export.md` and `docs/openapi-export.md`.
- **`cdd-kit openapi export --check`**: the OpenAPI sync gate. Instead of
  writing, it verifies the committed artifact at `--out` still equals what the
  contract produces and exits non-zero on drift — so CI fails when the contract
  changes but the export was not regenerated. This is the kit-owned half of the
  preventive chain (the consumer's typed-client codegen runs from an artifact
  that can never be silently stale).
- **`cdd-kit init` now wires the consumer codegen seam**: when a `package.json`
  is present it adds editable `contract:client` and `contract:client:check` npm
  scripts (the latter is the `openapi export --check` gate), turning the
  consumer half of the OpenAPI seam from a doc into a chokepoint. Additive,
  idempotent, never clobbers existing scripts; `openapi-typescript` is an
  editable default, not a hard dependency.
- **`cdd-kit doctor` chokepoint dashboard**: reports each enforcement chokepoint
  (graph-first hook, pre-commit gate, OpenAPI sync gate) as `live` or `dormant`
  with the one command to arm it. The kit's mechanisms are opt-in and dormant
  until armed, so a repo could carry all the machinery yet enforce none of it —
  this makes that observable. Advisory only (never fails `--strict`).

### Changed

- `backend-engineer` and `frontend-engineer` prompts now prefer
  `--with-source` queries and warn that endpoint changes/calls require a contract
  update when conformance is enabled.

### Fixed

- **graph-first hook now installs in the shape Claude Code executes.**
  `install-agent-hooks` wrote the command directly on the `PreToolUse` matcher
  group; Claude Code requires it nested under an inner `hooks: [{ type:
  "command", … }]` array, so the chokepoint was silently dormant even though
  install/init reported it armed. Re-running upgrades a legacy entry in place and
  preserves unrelated handlers that share the matcher group.
- **tier floor scans the right path scope.** `cdd-kit gate` now scans the
  **staged** change (rename-aware, both sides) instead of the whole worktree, so
  an unrelated unstaged `auth/` edit can no longer trip the floor and reject a
  low-risk commit; when a single commit stages more than one change directory the
  path signal is dropped (source paths can't be attributed to one change) and
  only the request text sets the floor. `cdd-kit classify-check` keeps
  whole-worktree scope (its in-progress change is not yet committed).
- **tier-floor pattern accuracy.** Critical-surface patterns now match plural
  directories (`payments/`, `migrations/`); the `token` pattern is qualified to
  security contexts (`access`/`api`/`auth`/`session`/`bearer`/`refresh`/`csrf`/
  `id`/`reset`) so frontend "design tokens" / `theme/tokens.ts` no longer trip
  the secrets floor. The gate / `classify-check` `matched:` line now reports the
  actual matched text (e.g. `session token`) instead of the raw regex pattern.
- **`cdd-kit doctor` detects a gate armed under a custom `core.hooksPath`** (or a
  worktree/submodule), resolving the hooks dir via git instead of probing only
  `.git/hooks/pre-commit` — no more reporting a live gate as dormant.
- **`cdd-kit code-map --watch` skips churn under ignored trees** (`node_modules`,
  `dist`, `.git`, `.next`, coverage) before rebuilding, and adds an `error`
  listener so fs-watch runtime errors (ENOSPC, permissions) degrade to polling
  instead of crashing the watch. Edits to `.cdd/code-map-config.yml` still
  trigger a rebuild even though it lives under the ignored `.cdd/` tree.
- **`cdd-kit gate` no longer passes changes whose artifacts are still unfilled
  scaffolds.** The stub check counted "meaningful chars", but a template's own
  instructional prose (900+ chars) cleared the threshold while every field was
  still an `<id>` / `<date>` / `<change-id>` placeholder — so a change could pass
  `--strict` with raw templates and zero real content. Gate now fails and names
  the remaining placeholder tokens per artifact. The check is a closed allowlist
  (`<id>` / `<date>` / `<change-id>`) anchored to the colon-led, line-final value
  position the templates use (`change-id: <id>`, `# …: <change-id>`), so inline
  XML/markup examples (`<id>123</id>`) and hyphenated custom elements
  (`<my-element>`) are not false-flagged — and a file may carry both a real
  placeholder and an XML example without the placeholder slipping through.
  `context-manifest.md` is exempt (its `<...>` sub-sections are documented as
  illustrative; it is enforced via Allowed Paths, not template fill-ins).
- **`cdd-kit validate` / `gate` no longer crash with `UnicodeDecodeError` on
  non-UTF-8 Windows locales (e.g. cp950/zh-TW).** `validate_contract_versions.py`
  read `git show` output and the validators wrote stdout using the locale codec,
  spamming tracebacks and mojibaking em-dashes in contracts. The Python
  validators are now spawned with `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`, and
  the git subprocesses decode as UTF-8 explicitly.
- **`cdd-kit openapi export` fails fast on a mis-tagged schema fence** instead of
  silently dropping it: a `### Name` section under `## Schemas` that uses ` ```json `
  (or any non-`json-schema` fence) now errors with the fix — including when a field
  table is also present (the stray fence was previously ignored). A prose-only
  section with no fence stays a valid Tier C contract and is left unresolved.
- **`cdd-kit openapi export --out <absolute-path>`** no longer ENOENTs on an
  absolute path (it was concatenated onto cwd, e.g. `D:\repo\C:\Users\…`); paths
  are resolved with `path.resolve`.

### Added

- **`cdd-kit openapi export` typed schemas (ADR 0002)**: `## Schemas` sections
  compile field tables (Tier A) and `json-schema` fenced blocks (Tier B) into
  `components.schemas` with `$ref` resolution; the contract stub documents both
  tiers.

## [2.1.3] - 2026-05-29

Correct Claude Code MCP registration guidance.

### Changed

- Install and upgrade guidance now recommends
  `claude mcp add --scope user cdd-kit -- cdd-kit mcp`, which writes the server
  to `~/.claude.json`.
- Documentation now warns that adding `mcpServers` to
  `~/.claude/settings.json` alone is not sufficient for Claude Code CLI MCP
  discovery.

## [2.1.2] - 2026-05-29

Recommended MCP setup during install and upgrade.

### Changed

- `cdd-kit init` and `cdd-kit refresh` now explicitly recommend enabling the
  `cdd-kit mcp` server so AI agents use graph/code-map tools directly.
- `CLAUDE.md`, `CODEX.md`, README, and install guide now present MCP graph tools
  as the recommended project exploration path, with `cdd-kit graph/index` as
  fallback.

## [2.1.1] - 2026-05-29

MCP tool access for graph/code-map exploration.

### Added

- **`cdd-kit mcp`**: runs a stdio MCP server exposing graph and code-map tools
  (`cdd_graph_status`, `cdd_graph_context`, `cdd_graph_query`,
  `cdd_graph_impact`, `cdd_index_query`, `cdd_index_impact`) so AI agents can
  use project exploration as native tools instead of shell-only commands.

## [2.1.0] - 2026-05-27

Native code graph and symptom-driven bug-fix workflow.

### Added

- **Native cdd-kit code graph**: `cdd-kit code-map` now writes
  `.cdd/code-graph.index.json`, a derived local graph cache with files, symbol
  nodes, relationship edges, and unresolved references. It is gitignored,
  regenerated with the code-map, stripped from the published package, and safe
  to delete.
- **`cdd-kit graph`**: adds graph-first `status`, `query`, `impact`, `context`,
  and `sync` commands. The default engine is the native cdd-kit graph; use
  `--engine codemap` for the older code-map-only fallback or
  `--engine codegraph` to require an external CodeGraph adapter.
- **Call/import/inheritance graph extraction** for the existing code-map language
  surface: JS/TS/JSX/TSX/MJS/CJS, Vue script blocks, and Python.
- **`bug-fix-engineer` agent**: a write-capable implementation agent for
  non-engineer symptom reports. It turns user-visible defects into graph-guided
  hypotheses, reproduces when feasible, applies the smallest fix, and records
  regression evidence.

### Changed

- Agent and skill guidance now prefers `cdd-kit graph ...` before broad source
  reads while retaining `cdd-kit index ...` and `.cdd/code-map.yml` as fallback
  paths.
- `cdd-kit graph --engine codegraph` remains available as an explicit external
  adapter, but external CodeGraph is no longer required or auto-selected by
  default.

## [2.0.21] - 2026-05-25

Kit review fixes plus large-project capability improvements. All additions are
opt-in and non-breaking; normal runs are byte-for-byte unchanged.

### Added

- **`cdd-kit code-map --surface <subpath>`**: scopes the scan to a monorepo
  subtree and names the map `.cdd/code-map.<slug>.yml`, queryable with
  `cdd-kit index query <term> --map .cdd/code-map.<slug>.yml`, instead of forcing
  one giant whole-repo map. A missing surface path now errors instead of
  silently emitting an empty map.
- **`cdd-kit code-map --workers [n]`** (default off): parallelizes JS/TS/Vue
  scanning across child processes. Output is deterministic regardless of chunk
  distribution, and any worker failure falls back to in-process scanning, so
  enabling workers can never make a run fail that would otherwise succeed.
- **Model class in dispatch badges**: `/cdd-new` and `/cdd-resume` now render
  each agent badge as `[role · model]`, resolved at dispatch time from
  `.cdd/model-policy.json`. Narration only — runtime model selection is unchanged.

### Changed

- **JSON sidecar for `index query` / `index impact`**: `cdd-kit code-map` now
  writes a parsed `.cdd/code-map.index.json` next to the map so queries skip the
  slow `yaml.load` on large maps. The sidecar is a derived local cache —
  gitignored, digest-validated against the map header, regenerated on every map
  run, stripped from the published package, and never required (queries fall back
  to the authoritative `.cdd/code-map.yml` on any absence or mismatch).
- **`typecheck` script** (`tsc --noEmit`) added and wired into `prepublishOnly`
  so type errors cannot regress.
- Deduplicated `ensureGitignoreEntry` into `src/utils/gitignore.ts` as the single
  source of truth.

### Fixed

- **`cdd-kit doctor` no longer false-flags every agent**: doctor kept its own
  divergent agent-lint check hard-coded to the old `### Required artifacts`
  heading and flagged all agents after the heading was renamed to
  `### Suggested artifacts`, while `cdd-kit lint-agents` reported clean. Both now
  share `lintAgentContent` / `collectAgentViolations` so they cannot drift apart.
- **`cdd-kit doctor` now warns instead of silently passing** when `.claude/agents`
  exists but cannot be read (permission/IO error), rather than reporting a clean
  pass on an unscanned directory.
- **Python scanning is chunked** (`CDD_CODE_MAP_BATCH_SIZE`, default 400) so a
  single subprocess timeout or buffer overflow on a large Python repo no longer
  drops the structure of every `.py` file; completed chunks are preserved.
- Cleared pre-existing `tsc --noEmit` errors in `include-exclude.ts`,
  `scanners/javascript.ts`, and `refresh.ts`.

### Security

- The `--workers` / Python batch-list temp files are now created with
  `crypto.randomBytes` names and mode `0600` to avoid predictable-name
  symlink/race attacks in the shared tmp dir (CWE-377), and the scan worker spawn
  is constrained by a language allowlist with an explicit no-shell invocation.

## [2.0.20] - 2026-05-15

Patch release for UTF-8 BOM handling in Claude agent metadata files.

### Fixed

- Removed UTF-8 BOM bytes from packaged Claude agent and skill sources so YAML
  frontmatter starts at `---` and Claude Code can mount subagents reliably.
- `cdd-kit lint-agents` now rejects agent files that start with `U+FEFF`, since
  frontmatter parsers may otherwise treat the first key as invalid.
- Added package-source and generated-assets regression coverage to prevent BOM
  bytes from being shipped again.

## [2.0.19] - 2026-05-15

Design ownership patch for the implementation-planning flow.

### Changed

- **`design.md` now has an explicit owner and task**: `spec-architect` owns
  `specs/changes/<change-id>/design.md`; `tasks.yml` now tracks required
  design confirmation separately from CI gate planning and implementation
  planning.
- **Optional report artifacts are now minimized**: routine reviewer evidence
  should use concise `agent-log/*.yml` pointers; report markdown is reserved for
  blocking findings, approved-with-risk decisions, excluded pre-existing
  failures, visual evidence bundles, or high-risk stress/soak results.
- **Execution artifacts now reference instead of duplicate**:
  `implementation-plan.md`, `test-plan.md`, and `ci-gates.md` now instruct
  agents to reference source artifacts by path/section/id instead of copying
  full design, test, CI, or contract prose.
- **Planner no longer backfills design**: `implementation-planner` now blocks
  and routes back to `spec-architect` if classification requires design but
  `design.md` is missing or still scaffolded.
- **Classifier and resume routing are stricter**: classification now keeps
  `Architecture Review Required`, Optional Artifacts `design.md`, Required
  Agents, and task `1.3` consistent; `/cdd-resume` resumes from
  `spec-architect` before planning when required design is missing.

## [2.0.18] - 2026-05-15

Implementation planning handoff release. This adds a senior planning step so
implementation agents receive a concise execution packet instead of inferring
scope from chat history.

### Added

- **`implementation-planner` agent**: writes
  `specs/changes/<change-id>/implementation-plan.md` after classification,
  contracts, test plan, design, and CI gate plan are known.
- **Required `implementation-plan.md` template**: new changes scaffold it by
  default, `cdd-kit gate` validates it, and `cdd-kit migrate` adds a scaffold
  for existing active changes.
- **Upgrade documentation**: README now explains how to sync npm package
  updates into global agents/skills, repo templates, `.cdd/model-policy.json`,
  hooks, code-map, and existing change directories.

### Changed

- **Implementation agents now consume the plan**: backend, frontend, E2E,
  monkey, and stress/soak agents must read `implementation-plan.md` and report
  `blocked` instead of inferring missing scope.
- **`/cdd-new` ordering now plans before implementation**: contracts, test
  plan, design if needed, and CI gate plan come before `implementation-planner`;
  backend/frontend/test implementation agents start only after task `1.4`
  confirms the implementation plan.
- **Traceability helpers include implementation plan**:
  `generate_change_scaffold.py` copies the new template and
  `validate_spec_traceability.py` treats it as required.

## [2.0.17] - 2026-05-07

Focused index-assisted development release. Agents now get a smaller, more
precise pre-read path through the code-map, while `cdd-kit gate` returns to
delivery-quality validation instead of post-run harness paperwork.

### Added

- **`cdd-kit index query <term>`**: searches `.cdd/code-map.yml` for matching
  files, imports, symbols, and line ranges, auto-refreshing a missing or stale
  map before returning candidates.
- **`cdd-kit index impact <path-or-symbol>`**: reports indexed local imports and
  dependent files so agents can inspect the smallest useful modification scope
  before editing.

### Changed

- **Gate is now delivery-quality only**: `cdd-kit gate` validates required
  artifacts, tasks, tier consistency, dependencies, and contract validators,
  without requiring agent logs, files-read lists, or code-map freshness as
  merge blockers.
- **Agent prompts prefer index-first targeting**: implementation agents are
  instructed to use `index query` before broad source reads and `index impact`
  before editing chosen source files.
- **Agent logs are optional handoff notes**: prompt templates and protocols no
  longer require agents to create logs or reconstruct every file they read just
  to satisfy a gate.

## [2.0.16] - 2026-05-06

New-change scaffold hardening so freshly opened proposals use the installed
kit version even when an existing project has stale templates on disk.

### Changed

- **`cdd-kit new` stamps `tasks.yml` with the real change id**: new changes no
  longer start with the `<change-id>` placeholder in the machine-validated task
  metadata.

### Fixed

- **Fresh proposals ignore stale project templates**: regression coverage now
  locks `cdd-kit new` to bundled package templates, so old
  `specs/templates/*` files in a user repo cannot leak into a newly created
  change.
- **Postinstall sync coverage includes workflow skills**: regression coverage
  now verifies npm postinstall updates standalone skills such as `/cdd-new`,
  keeping agent-log instructions aligned with the installed gate.

## [2.0.15] - 2026-05-06

Prompt guidance patch for agent-log evidence and closeout learning ownership.

### Changed

- **Agent-log pointer guidance matches gate behavior**: `/cdd-new` and
  `agent-log-protocol.md` now spell out that a pointer whose text before the
  first `:` contains `/` is validated as a single repo-relative file path, so
  agents avoid parenthetical path notes and slash-containing labels such as
  `I/O:` or `WARNING/OVERDUE:`.
- **Durable learning ownership is explicit**: prompts now consistently say
  general agents record evidence and findings only, while durable learning
  promotion happens during `/cdd-close` Step 3 and targets `contracts/` or
  project guidance (`CLAUDE.md`/`CODEX.md`).

## [2.0.14] - 2026-05-06

Operational hardening for real multi-agent CDD runs.

### Added

- **Context read preflight**: `cdd-kit context check <change-id> --path ...`
  validates expected agent reads against `Allowed Paths`, approved expansions,
  repo-relative path rules, and the forbidden-path baseline before agent work.
- **Pre-existing failure tracking**: QA templates and reviewer prompts now
  require baseline evidence, scope rationale, owner, and follow-up when an
  existing failing test is excluded from the current gate.

### Changed

- **Agent-log YAML is more resilient**: gate keeps YAML timestamps as strings
  and accepts `done` / `approved` as completion aliases while still documenting
  `complete` as canonical.
- **Model policy is provider-neutral**: role bindings now use model classes
  (`opus`, `sonnet`, `haiku`) instead of provider release IDs.
- **Agent orchestration guidance is stricter**: `/cdd-new` now requires
  closeout after each agent, including agent-log verification and immediate
  `tasks.yml` updates before the next agent is invoked.
- **Migration review guidance is sharper**: MySQL ENUM contraction and
  `ALGORITHM=COPY` DDL are explicitly treated as high risk on large tables.

## [2.0.13] - 2026-05-05

Documentation and release-prep patch focused on keeping CDD low-friction.

### Changed

- **Clarified workflow lanes**: README now distinguishes full tracked CDD
  changes from maintenance / micro-change work, so typo fixes, formatting,
  lint-only changes, and tiny local repairs do not imply proposal-level
  ceremony.
- **Documented future machine-readable metadata direction**:
  `docs/machine-readable-change-design.md` defines `change.yml` and
  `trace.yml` as generated metadata for reducing markdown parsing and token
  use, not as new manually-authored forms.
- **Synced skill/protocol docs with implementation**: `/cdd-new` now reflects
  that `context-manifest.md` is required and that `cdd-kit new` auto-runs
  `context-scan` when indexes are missing or stale; the agent-log protocol now
  reflects that gate enforces per-agent artifact types when prompt files are
  installed.

## [2.0.12] - 2026-05-04

Tiny patch — closes the last line-ending hole.

### Fixed

- **`cdd-kit code-map --check` is now line-ending agnostic**: 2.0.11 fixed
  the digest paths (`# sources-digest:`) to be portable, but `--check`'s
  string-comparison fallback still saw CRLF (committed via
  `core.autocrlf=true`) vs LF (always emitted) as different and reported
  "would change". The pre-commit hook then regenerated the map on every
  commit on Windows even when content was bit-identical. Fixed by
  normalizing CRLF/CR → LF on both sides before comparison, matching the
  digest functions' approach.

After upgrading, the hook stops triggering noisy regenerations on
Windows. No re-scan needed; this is purely a comparison fix.

## [2.0.11] - 2026-05-04

Final portability fix in the digest series. After 2.0.10 made digests
repo-relative and content-keyed, a real consumer repo on Windows
(`core.autocrlf=true`) still produced different digests than the same
repo on Linux/Mac (`core.autocrlf=false`) — because the file BYTES
differ even when the file content is logically identical.

### Fixed

- **All hash inputs are now line-ending normalized**. `\r\n` and stand-alone
  `\r` are converted to `\n` before SHA-256 is computed. Applied uniformly
  across the four places that hash files for cdd-kit's digests:
  - `inputsDigest()` in `src/commands/context-scan.ts`
    (project-map / contracts-index)
  - `inputDigest()` in `src/commands/doctor.ts`
    (freshness check against committed indexes)
  - `inputsDigest()` in `src/commands/new-change.ts`
    (auto-rerun decision in /cdd-new flow)
  - `computeSourcesDigest()` in `src/commands/code-map.ts`
    (`# sources-digest:` header in code-map.yml)

  All four now share `src/utils/digest.ts → sha256OfFileNormalized()`,
  so the rule is in exactly one place.

### Migration

After upgrading, re-run **once**:

```bash
cdd-kit context-scan
cdd-kit code-map
git add specs/context/ .cdd/code-map.yml
git commit -m "chore: regenerate indexes & code-map (cdd-kit 2.0.11)"
```

From then on, fresh clones on any OS / autocrlf setting produce identical
digests, eliminating the last source of false-positive doctor warnings.

## [2.0.10] - 2026-05-04

Two more context-scan determinism bugs, both surfaced verifying the 2.0.9
fix on the same consumer repo.

### Fixed

- **`inputs-digest` is now portable across clones**: previously the digest
  was computed from `<absolute-path>:<content-sha>`, so the value depended
  on `cwd`. A user's local repo at `D:\TODO\` and a fresh CI clone at
  `/runner/work/TODO/` would always produce different digests for the
  same content, causing `cdd-kit doctor` to report "inputs changed"
  permanently after every fresh clone. Now uses repo-relative path —
  digest depends only on the file's logical location and content.
  Applied identically to `src/commands/context-scan.ts`,
  `src/commands/doctor.ts`, and `src/commands/new-change.ts`.
- **Nested build outputs (`dist/`, `build/`, `out/`) excluded at any depth**:
  `FORBIDDEN_DIRECTORY_NAMES` now lists these as basename matches, so
  `frontend/dist/`, `apps/web/build/`, `packages/lib/out/` get pruned
  from the project-map tree. Previously only top-level `dist/` and
  `build/` were caught.

- **Hash-based code-map freshness**: previously `cdd-kit gate` and
  `cdd-kit doctor` used file mtime to decide whether the code-map was
  fresh. mtime is unreliable across `git clone` (clone resets mtimes in
  unpredictable order), so any fresh clone reported `code-map stale: N
  files` even when content was bit-identical — and `cdd-kit gate` treats
  that as a hard error.

  Fix: code-map.yml now embeds `# sources-digest: <sha256>` in its header
  (covers all input file paths + content). Freshness check first does
  the fast mtime check; when mtime says stale, falls back to verifying
  the digest. Real content changes are still detected; mtime-only drift
  is silently overridden. Maps generated by cdd-kit < 2.0.10 lack the
  digest line; for those, the legacy mtime verdict is used.

### Migration

After upgrading, re-run `cdd-kit context-scan` once and commit the new
`specs/context/*.md`. Same for `cdd-kit code-map` — the new map will
include the `# sources-digest:` line that gate/doctor use for portable
freshness.

The new `inputs-digest` and `sources-digest` are in different formats
than 2.0.9 (repo-relative paths, content-keyed) so existing maps will
look stale until regenerated. This is one-time. From then on, fresh
clones and CI will produce stable digests that match the committed
values, eliminating false-positive doctor warnings.

## [2.0.9] - 2026-05-04

Bug-fix patch. Discovered when verifying a real consumer repo (TODOLIST)
after a successful 2.0.8 upgrade: the user's committed
`specs/context/project-map.md` listed local kit-generated backup directories
(`.cdd/.refresh-backup/...`, `.cdd/migrate-backup/...`), which then never
matched fresh-clone digests — `cdd-kit doctor` reported "inputs changed"
forever even when nothing was wrong.

### Fixed

- **`cdd-kit context-scan` excludes kit runtime artifacts AND common
  transient cache directories at any depth**:
  - `DEFAULT_FORBIDDEN` (path-prefix list) now includes
    `.cdd/.refresh-backup`, `.cdd/migrate-backup`, `.cdd/runtime`.
  - New `FORBIDDEN_DIRECTORY_NAMES` (basename-anywhere list) catches
    Python (`__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`,
    `.tox`), JS/TS framework caches (`.next`, `.nuxt`, `.svelte-kit`,
    `.parcel-cache`, `.turbo`, `.nyc_output`), generic build/coverage
    (`coverage`, `htmlcov`, `.cache`), virtualenvs (`venv`, `.venv`),
    nested `node_modules`, and IDE noise (`.idea`, `.vscode`, `.DS_Store`).
  - Mirrors `code-map`'s `BUILTIN_EXCLUDE` so the two indexes ignore the
    same noise. Previously context-scan only had 8 path-prefix entries
    (`.claude / .git / node_modules / dist / build / assets / specs/archive /
    specs/changes`), so locally-generated caches polluted the project-map
    tree section and broke `inputs-digest` determinism for fresh clones.

### Added

- **`cdd-kit refresh`** auto-appends `.cdd/.refresh-backup/` to `.gitignore`
  the first time it overwrites a template (idempotent — no duplicate
  entries on subsequent runs). Logs the action so users know what changed.
- **`cdd-kit migrate`** auto-appends `.cdd/migrate-backup/` to `.gitignore`
  with identical idempotent semantics.

### Migration

If you already committed a polluted `specs/context/project-map.md` (signs:
the tree section contains paths under `.cdd/.refresh-backup/` or
`.cdd/migrate-backup/`, doctor reports "inputs changed" after a successful
refresh), recover with:

```bash
echo ".cdd/.refresh-backup/" >> .gitignore
rm -rf .cdd/.refresh-backup
cdd-kit context-scan
git add .gitignore specs/context/
git commit -m "fix: exclude cdd-kit refresh-backup from context-scan"
```

Future refreshes will handle the gitignore entry automatically.

## [2.0.8] - 2026-05-04

Adds `cdd-kit refresh` — a one-shot complete upgrade command. The previous
upgrade flow (`update --yes` + `upgrade --yes`) only touched `~/.claude/`
and added missing project files; kit-shipped templates that the user already
had on disk were never refreshed, leaving them stale across releases.

### Added

- **`cdd-kit refresh [--yes]`**: composes `update` + `upgrade` and adds
  force-refresh for kit-owned templates with automatic timestamped backup.
  Six steps, each independently skippable:
  1. `~/.claude/agents` and `~/.claude/skills/contract-driven-delivery`
     (delegates to `cdd-kit update`)
  2. Add missing project files (delegates to `cdd-kit upgrade`)
  3. **Force-refresh kit templates** with backup to
     `.cdd/.refresh-backup/<timestamp>/`. Targets:
     `specs/templates/`, `tests/templates/`, `ci-templates/`,
     `.github/workflows/contract-driven-gates.yml`.
  4. Re-install pre-commit hook if `.cdd/.hooks-installed` marker exists.
  5. Resync `.cdd/model-policy.json` roles map from
     `~/.claude/agents/<name>.md` `model:` frontmatter (drift detector).
  6. Regenerate `.cdd/code-map.yml`.

  Flags to skip individual steps: `--no-templates`, `--no-hooks`,
  `--no-code-map`, `--no-update`, `--no-upgrade`. Default is dry-run; pass
  `--yes` to apply.

- **`.cdd/.hooks-installed` marker**: written by `cdd-kit init --hooks`.
  Travels in the repo. Lets `cdd-kit refresh` know whether to re-install
  the pre-commit hook on every refresh — so the hook stays in sync with
  the latest kit version automatically.

### Fixed

- **Pre-commit hook extension list**: `installCodeMapHook` now triggers
  on `.py / .js / .jsx / .mjs / .cjs / .ts / .tsx / .vue` (was: `.py / .js / .vue`).
  Mirrors `BUILTIN_INCLUDE` and the 2.0.7 qa-reviewer fix.

### Boundaries (locked)

`cdd-kit refresh` will **never** touch:
- `contracts/`, `specs/changes/`, `specs/archive/`
- `src/`, `tests/*` (except `tests/templates/`)
- `.cdd/code-map-config.yml`, `.cdd/context-policy.json`
- `CLAUDE.md`, `AGENTS.md`, `CODEX.md`
- `package.json`, `.git/` (except `.git/hooks/pre-commit` when marker exists),
  `node_modules/`, `dist/`, `build/`

### Migration

Existing 2.0.x projects: `npm install -g contract-driven-delivery@latest`
then `cdd-kit refresh --yes`. The first refresh will surface any drift
that accumulated across 2.0.3 → 2.0.7 — backups land in
`.cdd/.refresh-backup/<timestamp>/` so rolling back any specific change
is a single `cp` away.

To use the auto-refreshing pre-commit hook on every push:
1. `cdd-kit init --hooks` (writes the marker)
2. From now on, `cdd-kit refresh --yes` will re-install the hook every time.

## [2.0.7] - 2026-05-04

Comprehensive cross-consistency audit fixes. Targets the #1 root cause of
agent ↔ gate friction: prompts that teach a format the gate cannot recognize.
All 12 drifts surfaced by an opus-model audit are addressed; new gate
enforcement is added where prompts described policy that was previously
documented-only.

### Fixed (BLOCKING)

- **CER pending detection**: gate now correctly recognises Context Expansion
  Requests written by `cdd-kit context request`. Previously the regex
  required `-` immediately before `status:`, but the canonical writer puts
  `status:` on its own indented line — every real-world pending CER was
  silently bypassed. Replaced with a per-block parser mirroring
  `src/commands/context.ts`.
- **`pointer: "n/a (...)"` false rejection**: gate skips path-existence checks
  for pointers starting with `n/a` (case-insensitive). Previously, a natural
  reason text like `"n/a (no contracts/ files touched)"` was treated as a
  path because of the `/` and produced a spurious "artifact pointer not
  found" error.
- **Per-agent `model:` policy drift**: synced `.cdd/model-policy.json` with
  the actual `model:` frontmatter on three agent prompts (spec-drift-auditor,
  visual-reviewer, repo-context-scanner). `cdd-kit doctor` no longer emits
  drift warnings for these three. Same fix applied to the doctor `--fix`
  defaults so newly-initialized projects start in sync.
- **4 review agents had no `## Read scope`**: dependency-security-reviewer,
  spec-drift-auditor, ui-ux-reviewer, visual-reviewer now point at
  `context-manifest.md → ## Allowed Paths`, matching the 10 already-scoped
  agents. Each prompt also lists the agent's typical extra reads (lockfiles,
  screenshots, contracts) so users know what to add to the manifest up
  front.
- **qa-reviewer code-map discipline check**: now lists the full extension set
  `(.py, .js, .jsx, .mjs, .cjs, .ts, .tsx, .vue)` instead of the 2.0.5
  three-extension subset that effectively disabled the check on TS-heavy
  repos.

### Fixed (RISK)

- **`.cdd/code-map-config.yml` errors surface in gate / doctor**: a malformed
  config no longer silently degrades to "greenfield". `freshness.ts` returns
  a `config-error` status and gate emits a hard error; doctor reports it as
  a warning.
- **`next-action` validation tightened**: gate now rejects placeholder values
  the agent-log-protocol already disallowed (`tbd`, `n/a`, `investigate`,
  `unknown`, `todo`) — previously only `none` was rejected.
- **Allowed-Paths glob grammar upgraded to picomatch**: patterns like
  `src/**/*.ts`, `lib/{a,b}/**`, `?(...)` now match correctly. The previous
  hand-rolled matcher only supported trailing `/**` and `/*`. Special
  `specs/changes/*` exception preserved.
- **Engineer agent prompts (`backend-engineer`, `frontend-engineer`) now
  list `.mjs` and `.cjs`** in the code-map "READ FIRST" extension list,
  matching `BUILTIN_INCLUDE` and `references/code-map-protocol.md`.
- **`change-classification.md` template aligned with classifier output**:
  added the `## Inferred Acceptance Criteria` and `## Tasks Not Applicable`
  sections; renamed `## Required Test Families` → `## Required Tests` and
  `## Assumptions / Clarifications` → `## Clarifications or Assumptions`
  to match what `change-classifier` actually produces.
- **`.claude/worktrees/` added to all agent forbidden lists** to match
  `.cdd/context-policy.json` defaults (documentation drift only — runtime
  behaviour was already correct).

### Added

- **Per-agent required-artifact-types enforcement**: gate now reads each
  agent's prompt file (resolution: `<cwd>/.claude/agents/<name>.md` →
  `~/.claude/agents/<name>.md`) and extracts the "Minimum required `type`
  values" bullet list. Every listed type must appear at least once in the
  agent log's `artifacts:` array (a `pointer: "n/a (<reason>)"` item still
  counts as present — only type membership is checked). Missing types
  produce an actionable error naming the agent and the missing types. When
  no prompt file is found, the check is skipped (back-compat).

### Migration

- Existing 2.0.6 projects: `cdd-kit update --yes` to refresh the agent
  prompts and `references/code-map-protocol.md`. Then re-run `cdd-kit code-map`.
- Manifests using literal paths continue to work unchanged. Manifests using
  the new picomatch grammar (`src/**/*.ts`) start working correctly.
- The new per-agent required-types check may surface previously-silent
  gaps. Each error message is actionable and tells you which type to add.

## [2.0.6] - 2026-05-04

### Added

- TypeScript scanner for `cdd-kit code-map`: `.ts` and `.tsx` files are
  now indexed alongside `.py` / `.js` / `.vue`. `.jsx` / `.mjs` / `.cjs`
  also routed through the JS scanner. Real-world scan of a React 19 +
  TS 5.9 frontend (137 files / 20,119 src lines) compresses to 1,675
  map lines (12.0x) in ~140 ms.
- New code-map schema fields for TS files: `interfaces:`, `types:`,
  `enums:` — each entry carries `name`, `lines`, and an `# local`
  annotation when the symbol is not exported. Enum entries also list
  their members.
- User-overridable `.cdd/code-map-config.yml`: optional file with
  `include:` / `exclude:` glob lists. When set, each list REPLACES the
  matching built-in default (replacement semantics keep the mental
  model simple — copy the built-in list and edit it for partial
  overrides). CLI `--include` / `--exclude` flags continue to stack on
  top of whichever lists won. Schema errors produce a clear message
  and a non-zero exit.
- `lint-agents` Rule A is now stricter: parses the YAML inside each
  agent prompt's `artifacts:` fence and rejects stray top-level keys
  (e.g. a stray `pointer:` or `type:` sibling alongside `artifacts:`).
  This catches the residual format drift that the runtime gate
  already rejects but that previously slipped through prompt review.

### Changed

- `backend-engineer` and `frontend-engineer` agent prompts: the
  `## Code map (READ FIRST)` section now lists `.ts` / `.tsx` /
  `.jsx` as covered extensions and points agents at the new
  `interfaces:` / `types:` / `enums:` sections for TS files.
- `references/code-map-protocol.md` documents the TS schema additions
  and the `.cdd/code-map-config.yml` override format.
- Variable-declaration heuristic in the JS/TS scanner now treats an
  uppercase const initialised by a `CallExpression` (e.g.
  `const Button = forwardRef(...)`, `const X = memo(...)`) as a
  function entry, so React HOC-wrapped components show up in the map.
  Single-letter uppercase identifiers (`X`, `T`, `Y`) are no longer
  classified as ALL_CAPS constants — they fall through to the
  function-heuristic branch.

### Fixed

- `build.js` no longer ships `.cdd/code-map.yml` inside `assets/cdd/`.
  The map is a per-repo runtime artifact; shipping a pre-built copy
  caused fresh `cdd-kit init` repos to inherit a stale snapshot that
  fooled freshness checks.

### Migration

- Existing 2.0.5 projects: nothing to do. The TS scanner activates
  automatically on the next `cdd-kit code-map` run if `.ts` / `.tsx`
  files are present. Re-run `cdd-kit code-map` to pick them up.
- To customise scan scope: create `.cdd/code-map-config.yml`. Without
  it, all built-in defaults apply.
- `cdd-kit update --yes` to refresh agent prompts in `~/.claude/`.

## [2.0.5] - 2026-05-04

### Added

- `cdd-kit code-map` subcommand: scans `.py`, `.js`, `.vue` source files
  via per-language AST parsers and emits a deterministic structural index
  at `.cdd/code-map.yml`. The map is committed to git and refreshed on
  demand.
- `cdd-kit init --hooks` (opt-in): installs a pre-commit hook that
  regenerates `.cdd/code-map.yml` whenever staged changes touch source
  files, then re-stages the map. Coexists with `cdd-kit install-hooks`.
- `cdd-kit gate <change-id>` now hard-fails when any source file is
  newer than `.cdd/code-map.yml`, naming up to 5 stale files. Emits a
  warning (not error) when the map is missing but source files exist.
- `cdd-kit doctor` reports code-map status (missing / stale / compression
  ratio) and `doctor --fix` regenerates a stale map.
- New skill reference doc:
  `.claude/skills/contract-driven-delivery/references/code-map-protocol.md`
  documenting the map format and the read-first protocol.

### Changed

- `backend-engineer` and `frontend-engineer` agent prompts now require
  `Read .cdd/code-map.yml` BEFORE reading any source file. The 300-line
  rule directs agents to use `Read offset:N limit:M` for files larger
  than 300 lines, eliminating whole-file Reads of large modules.
- `qa-reviewer` now flags any agent log whose `files-read` lists a
  source file without listing `.cdd/code-map.yml` first.

### Migration

After upgrading existing projects:

1. Run `cdd-kit code-map` once to create `.cdd/code-map.yml`. Commit it.
2. (Optional but recommended) Run `cdd-kit init --hooks` to install the
   auto-regenerate pre-commit hook.
3. Run `cdd-kit update --yes` to refresh agent prompts in `~/.claude/`.

Greenfield projects with no `.py`/`.js`/`.vue` files yet are unaffected.

### Dependencies

Added: `@babel/parser ^7.25.0`, `@vue/compiler-sfc ^3.4.0`,
`picomatch ^4.0.2`. Python scanning shells out to the system `python3`
or `python` interpreter (Python 3.9+); if neither is on PATH, `.py`
files are skipped with a warning.

## [2.0.4] - 2026-05-04

### Fixed

- All 16 agent prompts now describe the `Required artifacts` block as a
  `{type, pointer}` YAML array (matching `src/schemas/agent-log.schema.ts`)
  instead of a flat key list. Previously agents copied the prompt verbatim
  and emitted top-level `files-changed:` / `tests-added:` keys, which
  `cdd-kit gate` correctly rejected as `missing required artifacts`.
- Removed duplicate `## Read scope` sections from 10 agents
  (backend-engineer, frontend-engineer, qa-reviewer, contract-reviewer,
  ci-cd-gatekeeper, spec-architect, test-strategist, e2e-resilience-engineer,
  monkey-test-engineer, stress-soak-engineer).
- Read scope in those 10 agents now points to
  `specs/changes/<change-id>/context-manifest.md → ## Allowed Paths` as the
  single source of truth (matching what `cdd-kit gate` already enforces),
  and instructs agents to file a Context Expansion Request rather than
  reading outside the manifest. Eliminates the most common
  `read unauthorized path` gate failure.

### Added

- `cdd-kit lint-agents` subcommand: validates every `.claude/agents/*.md`
  has the new artifacts shape, at most one `## Read scope`, a
  `context-manifest.md` reference where applicable, and a pointer to
  `references/agent-log-protocol.md`. Wired into `cdd-kit doctor`.
- Optional `note:` field on tasks in `tasks.yml` (schema and template) for
  recording per-task context without breaking the existing `pending |
  done | skipped` status enum.

### Migration

No project-side migration required — the fix is to the bundled agent
prompts. After upgrading run `cdd-kit update --yes` to refresh the agents
in `~/.claude/`.

## [2.0.3] - 2026-04-30

### Fixed

- `cdd-kit update` now syncs all installed skills (`cdd-new`, `cdd-close`,
  `cdd-resume`, `cdd-init`, `contract-driven-delivery`) instead of only
  `contract-driven-delivery`. Previously the four standalone skills were silently
  left stale after an npm upgrade.
- Backup path corrected from `.cdd-kit-backup/<ts>/skill/` to `.../skills/`
  to cover all skill directories.

## [2.0.2] - 2026-04-30

### Added

- `npm postinstall` hook: after `npm install -g` or `npm update -g`, skills and
  agents in `~/.claude/` are automatically synced to the newly installed version.
  The sync is a no-op when `cdd-kit init` has never been run (safe for CI and
  local dev installs of the package itself). A backup of any locally modified
  files is created in `~/.claude/.cdd-kit-backup/<timestamp>/` before overwriting,
  matching the existing `cdd-kit update --yes` behaviour.
- `cdd-kit update --postinstall` flag (internal): quiet mode that implies
  `--yes`, locks provider to `claude`, and silently exits when the skill
  directory is absent. Not intended for direct user invocation.

### Migration note

The first `npm update -g contract-driven-delivery` that brings in this version
will **not** auto-sync (the postinstall hook did not exist in the previously
installed version). Run `cdd-kit update --yes` once after this upgrade; all
subsequent upgrades will auto-sync.

## [2.0.1] - 2026-04-30

### Fixed

- Clarified the agent ownership model in the public docs so read-only reviewers
  and write-capable implementation agents have explicit, non-conflicting file
  ownership rules.
- Aligned bundled prompts so read-only agents emit an `Agent Log` YAML block
  for main Claude to persist, while write-capable agents continue writing their
  own artifacts and `agent-log/*.yml` files.
- Synchronized package version metadata for the post-`2.0.0` publish path.

## [2.0.0] - 2026-04-30

### BREAKING: structured YAML for tasks and agent-log

- `tasks.md` is replaced by `tasks.yml`. The previous markdown-frontmatter +
  checklist hybrid is gone. The new file is a single YAML document validated
  by `src/schemas/tasks.schema.ts` (JSON Schema, draft-07). Task items use
  `status: pending | done | skipped` instead of `[ ] / [x] / [-]` checkboxes.
- `agent-log/<agent>.md` is replaced by `agent-log/<agent>.yml`, validated by
  `src/schemas/agent-log.schema.ts`. The "field: value" prose convention is
  gone; agents now emit a structured YAML record with `change-id`, `agent`,
  `timestamp` (ISO 8601), `status`, `files-read`, `artifacts`, and
  `next-action`.
- `cdd-kit gate` parses both files with `js-yaml` and validates them with
  `ajv`. Errors and warnings now reference YAML paths rather than markdown
  line patterns.
- All bundled templates, skill prompts, agent prompts, and Python helper
  scripts have been updated to point at the new file names.

### Upgrading

Run `cdd-kit migrate <change-id>` (or `cdd-kit migrate --all`) to convert
existing changes:

- `tasks.md` is parsed (frontmatter + markdown checklist) and rewritten as
  `tasks.yml`. The legacy `tasks.md` is deleted.
- Every `agent-log/*.md` is parsed and rewritten as `agent-log/*.yml`. The
  legacy markdown logs are deleted.
- A backup of the change directory is written to
  `.cdd/migrate-backup/<stamp>/<change-id>/` before any rewrite.

### Notes

This is a breaking release; pin to `^1.16.0` if you still depend on the old
markdown formats.

## [1.16.0] - 2026-04-30

### Visual narration: per-agent stage badges

- `/cdd-new` skill now instructs main Claude to prefix every agent
  invocation announcement with a colored emoji badge tagging the role and
  stage. Non-engineer users can scan the chat stream and see "we're at
  review now, not implementation" without reading prompts.
- Six color buckets:
  - 🟣 decision (classifier, architect — opus-class)
  - 🔵 implementation (backend, frontend, ci-cd, sonnet-class)
  - 🟡 test planning (test-strategist)
  - 🟠 heavy testing (e2e, monkey, stress — Tier 0–1 only; orange = scope warning)
  - 🟢 review (read-only verdicts)
  - ⚫ audits & scans (background, read-only)
- `/cdd-resume` references the same badge table so resumed flows look
  consistent.

### Notes

This is the only PR in the v1.13 follow-up series that changes the visible
chat narration. Prompt-only; no code or test changes.

## [1.15.0] - 2026-04-30

### Workflow safety net (defaults that protect non-engineers)

- `cdd-kit new` auto-runs `context-scan` when `specs/context/*.md` indexes are
  missing or stale (B5 hash-based check). Avoids classifier wasting a round
  on outdated paths. New `--skip-scan` for advanced users.
- `cdd-kit gate` now lints `tasks.md` frontmatter:
  - Requires `change-id` and `status`.
  - Validates `status` against known set (`in-progress`, `completed`,
    `gate-blocked`, `abandoned`, `needs-review`, `complete`, `done`).
  - Warns on unknown keys with did-you-mean suggestions (e.g. `Tier:` →
    `did you mean tier?`). Catches the typo class that previously caused
    silent enforcement skips.
- `cdd-kit gate` now detects `depends-on` cycles via DFS and reports the
  full cycle path (e.g. `feat-a → feat-b → feat-c → feat-a`).
- `cdd-kit doctor --fix`: auto-resolves the safe subset of warnings
  - regenerates stale or missing `specs/context/*.md` indexes
  - populates empty `model-policy.json` roles with defaults
  - leaves invasive fixes (`.cdd/*` missing → suggests `cdd-kit upgrade`)
    for the user to confirm
- `cdd-kit gate`: artifact-pointer existence check now runs **by default**
  (previously `--strict`-only). Use `--lax` to skip for legacy repos with
  unfixed agent logs.

### Tests

- 11 new tests across `gate.test.ts` (frontmatter lint, DAG cycle, default
  pointer check), `new.test.ts` (auto-scan), `doctor.test.ts` (--fix).
- Updated `gate.test.ts` test 13b — its premise inverted by PR-3 #6.
- Updated `writeValidChangeArtifacts` helper to include required frontmatter.

## [1.14.0] - 2026-04-30

### Agent efficiency for non-engineer users

- `/cdd-new` Step 0: request-quality pre-lint. Refuses to run when the user's
  request is missing affected-surface, desired-behavior, or success-criterion.
  Avoids one full classifier round-trip on ambiguous requests.
- `change-classifier`: atomic-split detection. Mega-requests crossing 2+
  change-types or 3+ surfaces now return an `## Atomic Split Proposal` table
  with suggested `cdd-kit new --depends-on` commands instead of a single
  Tier 0/1 monolith. Estimated 40-60% token saving on multi-feature requests.
- `references/agent-log-protocol.md`: every agent must self-validate its log
  block before sending its response. Prevents the round-trip where gate
  catches a malformed log and forces a full agent re-run.
- `/cdd-new` Step 4 fix-back: structured error-to-agent routing table. Each
  gate error class now has a defined re-invocation owner and a templated
  prompt prefix that includes the verbatim gate error. No more "blind retry".

### Notes

This release is prompt-only (no code changes in `src/`). Improvements are
qualitative for the AI agent flow, not exposed as new CLI flags.

## [1.13.0] - 2026-04-29

### Token-budget reductions
- Shared `references/agent-log-protocol.md` — extracted the duplicated agent-log
  format block out of all 16 agent prompts. Total agent-prompt size dropped
  from 1675 → 1344 lines (≈20% smaller). One source of truth, no drift.
- `/cdd-new` skill no longer inlines the 5 change-template bodies; `cdd-kit
  new` writes them from disk. Skill went from 483 → ~340 lines (≈30%).
- Tier 5 fast-path for docs/prompts/config-only changes — classifier now
  short-circuits the full agent flow when no source/tests/contracts are
  touched; bounds doc-only token cost to 2 read-only reviews.
- `context-manifest.md` template no longer duplicates the forbidden-paths list
  that `.cdd/context-policy.json` already carries.
- `cdd-kit context-scan` now caps per-directory entries to 50 and supports
  `--surface <path>` to scope the project map to a sub-tree.

### Stability hardening
- Tier source moved to `tasks.md` frontmatter `tier: <0-5>`. The legacy
  `## Tier\n- N` and `**Tier:** Tier N` formats remain as fallback-only;
  bold-only legacy format produces a migration warning instead of silently
  skipping tier-specific agent enforcement.
- Section-7 archive exemption is no longer hard-coded `7\.[12]`; reads from
  `tasks.md` frontmatter `archive-tasks: ["7.1", "7.2"]` (default preserved).
- `cdd-kit migrate` is now atomic: per-session backup at
  `.cdd/migrate-backup/<timestamp>/`, two-phase tmp-write + rename, restore
  hint on failure. New `--no-backup` opt-out.
- `cdd-kit migrate` now backfills `tier:` and `archive-tasks:` into legacy
  `tasks.md` frontmatter automatically.
- `cdd-kit doctor` freshness check is now content-hash based, not mtime.
  `git clone` no longer triggers spurious staleness warnings.
- `cdd-kit context approve|reject --all-pending` resolves every pending
  Context Expansion Request in one command.
- `cdd-kit gate` now reconciles agent self-reported `files-read:` against the
  runtime hook log at `.cdd/runtime/<change-id>-files-read.jsonl`. Undeclared
  reads warn (or fail under `--strict`).
- `hooks/post-tool-use-files-read.sh` — Claude Code PostToolUse hook scaffold
  that records actual Read/Grep/Glob targets for the gate to verify.
- `cdd-kit gate` now invokes `validate` in-process instead of via
  `spawnSync(process.execPath, [process.argv[1], ...])`. No more `argv[1]`
  indirection or extra Node startup.
- `.cdd/model-policy.json` ships with real role-to-model defaults (no longer
  empty `{}`). `cdd-kit doctor` warns when an installed agent's `model:`
  frontmatter drifts from policy. `init`/`upgrade` preserve any custom
  `roles` overrides instead of clobbering them.

### Skill updates
- `/cdd-new` now lints classifier output before writing files (`## Tier`,
  `## Required Agents`, `## Inferred Acceptance Criteria` must be filled).
- `/cdd-new` writes the classifier's tier into `tasks.md` frontmatter as the
  authoritative source.

### Tests
- 19 new tests covering B1–B7 + A5 + B3. 39 gate tests, 15 migrate tests, 9
  context tests, 7 doctor tests all pass.

## [1.12.0] - 2026-04-29

### Added
- `cdd-kit doctor --json` for CI and machine-readable repository health checks.
- `cdd-kit upgrade --migrate-changes [--enable-context-governance]` to combine repo-level upgrade work with legacy change migration.
- `cdd-kit context request`, `cdd-kit context reject`, and `cdd-kit context list [--json]` for a fuller context expansion workflow.

### Changed
- Default contract templates now include deterministic `summary`, `owner`, and `surface` metadata so fresh repos do not start with avoidable `contracts-index` warnings.
- `cdd-kit context-scan` now excludes `contracts/CHANGELOG.md` from the contracts index.
- Shared provider inference is now reused by `update`, `doctor`, and `upgrade`.
- Migration messaging now refers to the current cdd-kit format instead of pinning docs to one release number.

### Docs
- README now includes production rollout guidance for old repos, with separate migration paths for completed specs and in-progress specs.
- Release checklist now covers `doctor --json`, `upgrade --migrate-changes`, and post-upgrade context governance decisions.

## [1.11.0] - 2026-04-28

### Added
- Context Governance v1 for new changes: `context-manifest.md`, `files-read` audit expectations, default forbidden paths, and legacy-vs-new gate behavior.
- Provider adapter scaffold for Claude Code and Codex: `init --provider claude|codex|both`, provider-aware `update`, and `.cdd/model-policy.json`.
- `cdd-kit context-scan`: deterministic `specs/context/project-map.md` and `specs/context/contracts-index.md` indexes for lower-token classification.
- `cdd-kit doctor`: repo health checks for missing config, provider guidance, stale context indexes, and contract summary gaps.
- `cdd-kit upgrade`: dry-run-first repo-level upgrade command that adds missing cdd-kit files without overwriting existing project guidance or contracts.
- `cdd-kit context approve <change-id> <request-id>`: approves pending expansion requests and records approved paths in the manifest.
- Atomic change dependencies with `cdd-kit new --depends-on` and gate blocking until upstream changes complete or archive.
- `/cdd-new`, `/cdd-resume`, and `/cdd-close` prompt hardening for manifest-scoped reads, hot/warm/cold data handling, and context index usage.

### Changed
- `cdd-kit migrate` can add legacy or context-governed manifests and opt old changes into `context-governance: v1`.
- README now describes provider-neutral usage, context governance, upgrade flow, and context expansion approval.

### Notes
- Context Governance audits and discourages unauthorized reads. It is not a runtime sandbox and still depends on agent-log evidence plus gate review.

## [1.10.0] - 2026-04-27

### Added
- `cdd-kit gate --strict`: pending `[ ]` tasks are errors in strict mode; pre-commit hook now uses `--strict` by default. Section-7 archive tasks (7.1, 7.2) are exempt.
- `cdd-kit gate`: artifact pointer validation in strict mode. Each path listed under `- artifacts:` in agent logs is verified to exist on disk.
- `cdd-kit gate`: tier-based agent-log requirements. Tier 0-1 changes must have `e2e-resilience-engineer`, `monkey-test-engineer`, and `stress-soak-engineer` logs; Tier 0-3 must have `contract-reviewer` and `qa-reviewer`.
- `cdd-kit gate`: differentiated minimum char counts per artifact (change-classification and test-plan >= 200, ci-gates >= 150, others >= 100).
- `cdd-kit gate`: scoped validate call to `--contracts --env --ci --versions`.
- `cdd-kit abandon <change-id> --reason <text>`: marks a change as abandoned in `tasks.md` and records it in `specs/archive/INDEX.md`.
- `cdd-kit archive <change-id>`: moves a completed change from `specs/changes/` to `specs/archive/<year>/`.
- `/cdd-close` skill synthesizes `archive.md` from `agent-log/` and `qa-report.md` before archiving, then invokes `contract-reviewer` for durable promotion diffs.
- `/cdd-resume` resumes an in-progress change across sessions by reading `tasks.md` and `agent-log/` to determine the next pending agent.
- `change-classifier` now outputs `## Inferred Acceptance Criteria` and `## Tasks Not Applicable`.
- All agents require `CURRENT_CHANGE_ID: <id>` in every prompt.
- `cdd-new` injects `CURRENT_CHANGE_ID` into every agent call, auto-marks N/A tasks with `[-]`, and passes acceptance criteria to `test-strategist`.
- `cdd-kit migrate <change-id> | --all [--dry-run]`: upgrades existing change directories from pre-v1.11 format. Adds YAML frontmatter plus `[x]/[-]/[ ]` legend to `tasks.md`; converts old `**Tier:** Tier N` to `## Tier\n- N`.

### Fixed
- Tier detection regex tightened to avoid matching unfilled classifier templates.
- Agent read-scope placeholder `<current-change-id>` replaced with runtime `CURRENT_CHANGE_ID` injection.
- `archive.md` removed from `/cdd-new` opt-in surface because it is synthesized at close time.

## [1.0.1] - 2026-04-20

### Fixed
- CLI binary renamed from `cdd` to `cdd-kit` for npm uniqueness.
- Corrected bin path format for npm 11.x compatibility.

## [1.0.0] - 2026-04-20

### Added
- Initial release of the contract-driven-delivery CLI (`cdd-kit`).
- Commands: `init`, `new`, `gate`, `validate`, `detect-stack`.
- Tier-based change classification, contract scaffolding, and agent-log validation.
