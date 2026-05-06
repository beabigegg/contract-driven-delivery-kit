# Changelog

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
