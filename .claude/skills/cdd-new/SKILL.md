---
name: cdd-new
description: Start a new tracked change. Scaffolds all required artifacts, classifies the change by risk tier, commissions the right agents in order, and runs cdd-kit gate. Args: <change description in natural language>
---

# cdd-new ??New Change Request

## Mental model

- `contracts/` = the single source of truth (live ??always reflects current system behaviour)
- `tests/` = proof the contracts hold (live)
- `specs/changes/<id>/` = why we decided this back then (passive archive ??read only when investigating history, never as input to planning)
- `CLAUDE.md` = what this project is and how to start work

## Artifact ownership and deduplication

Every artifact under `specs/changes/<id>/` must have one authoritative job.
Do not duplicate the same fact across multiple markdown files. Later artifacts
must reference earlier artifacts by path, section, criterion id, or decision id
instead of restating full content.

Core artifacts:

| artifact | authority |
|---|---|
| `change-classification.md` | risk, tier, required agents, required artifacts, acceptance criteria, context-manifest draft |
| `context-manifest.md` | read boundary and approved context |
| `test-plan.md` | acceptance criterion to test family/file mapping |
| `ci-gates.md` | required/informational/manual gates and promotion policy |
| `design.md` | architecture/design decisions, only when required |
| `implementation-plan.md` | concise execution packet that references the above artifacts |
| `tasks.yml` | centralized task status only |

Evidence and review notes default to short optional `agent-log/*.yml` pointers.
Create report markdown (`qa-report.md`, `visual-review-report.md`,
`regression-report.md`, `monkey-test-report.md`, `stress-soak-report.md`) only
when the classifier explicitly requires it, or when a reviewer finds blocking
findings or approved-with-risk evidence that needs durable review prose.

Every spec artifact answers **WHAT** and **WHY**, not HOW.

Soft caps (guidance, not gate-enforced):
- `spec.md` ??200 lines
- `design.md` ??150 lines
- `test-plan.md` ??100 lines
- `ci-gates.md` ??80 lines

**Forbidden in spec artifacts** (these belong in code/tests, not specs):
- SQL DDL or migration code ??put in migrations/, reference the path
- ORM model code (SQLAlchemy, Prisma, etc.) ??put in source, reference the module
- Full test function bodies, mock setup, fixture data, expected JSON payloads ??put in tests/
- Runnable code blocks > 10 lines belong in source files, not specs. Pseudocode and mapping tables are fine at any length.
- Per-test input/output tables with more than 15 rows (data-boundary tests with up to 15 boundary cases are acceptable)

**test-plan.md should contain:**
- Acceptance criteria ??test family mapping (table)
- Test file paths and test names (one line per test, no implementation detail)
- Tier assignment per family
- Out-of-scope list

**design.md should contain:**
- Architecture summary (1 paragraph)
- Affected components (table: component | file path | nature of change)
- Key decisions and rejected alternatives (prose)
- Migration/rollback strategy (prose, not SQL)

## Input

The skill argument is the user's change description in natural language (e.g., "add JWT authentication to the API" or "redesign the dashboard homepage").

If no description is provided, ask the user: "Please describe the change you want to make."

---

## Step 0: Request quality check (BEFORE classifier)

Non-engineers often submit ambiguous requests like "fix the slow report" or
"make it nicer". These cost a full classifier round-trip when the right move is
to ask back. Before scaffolding anything, verify the request contains all
three elements below. Rephrase the request internally in this shape:

| Element | Example | Required? |
|---|---|---|
| 1. Affected surface | "the order export page", "the JWT login flow" | always |
| 2. Desired behavior change | "complete in <10s", "support 2FA via TOTP" | always |
| 3. Observable success criterion | "1000-row export finishes without timeout", "user with 2FA can log in end-to-end" | always |

If any element is missing or ambiguous, **STOP. Do NOT call `cdd-kit new` or
the classifier.** Ask the user back in this exact shape:

```
Before I start a tracked change, I need to lock down three things:

  Affected surface:       <best guess from request, or empty>
  Desired behavior:       <best guess, or empty>
  Success criterion:      <empty ??please fill>

Could you confirm or fill in the missing pieces?
```

Only proceed to Step 1 once all three are answered or the user explicitly says
"proceed without success criterion". Record the user's clarifications verbatim
in `change-request.md` 禮 Original Request.

The cost of this step: 1 short message round-trip. The cost of skipping it:
one full classifier+contract-reviewer cycle, often 5-10? more tokens, plus an
inevitable re-classification when the agents discover the ambiguity.

---

## Write Responsibilities

**This distinction is critical ??follow it for every step:**

| Agent type | Who writes artifact files | Who writes optional handoff notes | Who updates tasks.yml |
|------------|--------------------------|----------------------------------|----------------------|
| Read-only agents (no Edit tool): `change-classifier`, `contract-reviewer`, `qa-reviewer`, `visual-reviewer`, `dependency-security-reviewer`, `ui-ux-reviewer` | YOU (main Claude) | YOU, only when useful | YOU (main Claude) |
| Write-capable agents (have Edit): `implementation-planner`, `backend-engineer`, `frontend-engineer`, `e2e-resilience-engineer`, `monkey-test-engineer`, `stress-soak-engineer`, `ci-cd-gatekeeper`, `test-strategist`, `spec-architect` | The agent itself | The agent itself, only when useful | YOU (main Claude) |

**Rule**: After EVERY agent completes (whether it writes itself or you write for it), YOU must update the relevant `tasks.yml` task `status:` from `pending` to `done`.

**Agent-log pointer rule**: When you or an agent writes `artifacts[].pointer`,
follow `references/agent-log-protocol.md`. If the text before the first `:` contains `/`, treat it as one repo-relative file path, and one pointer names one file only. File pointers must not
include parenthetical notes on the path, and slash-containing labels such as
`I/O:` or `WARNING/OVERDUE:` must not be used as pointer prefixes. Put extra
explanation in `notes` or a separate non-path artifact pointer instead.

**Durable learning rule**: During `/cdd-new`, agents record evidence and
findings in artifacts and optional handoff notes only. Do not promote durable lessons
while the change is still active. Durable learning promotion happens only during
`/cdd-close` Step 3, where main Claude cross-checks evidence and writes approved
rules to `contracts/` or project guidance (`CLAUDE.md`/`CODEX.md`).

---

## Artifact opt-in policy

Only create optional artifacts (`current-behavior.md`, `proposal.md`, `spec.md`,
`design.md`, `qa-report.md`, `regression-report.md`, `visual-review-report.md`,
`monkey-test-report.md`, `stress-soak-report.md`) when the classifier's
`change-classification.md` explicitly marks them as `yes`, or when a reviewer
finds blocking findings / approved-with-risk evidence that must be preserved as prose.

`design.md` is owned by `spec-architect`, not `implementation-planner`. If the
classifier marks `design.md` as `yes`, marks `Architecture Review Required:
yes`, or lists `spec-architect` in `## Required Agents`, invoke
`spec-architect` before `implementation-planner`. If none of those triggers is
present, mark task `1.3` as `skipped`.

Note: `archive.md` is created during `/cdd-close`, not during `/cdd-new` ??it is not part of the classifier's opt-in surface.

If the classifier marks an artifact as `no` or leaves it blank, **do not create
the file** just because an agent could contribute to it. Use an optional
`agent-log/*.yml` pointer instead.

The 7 always-required artifacts are: `change-request.md`, `change-classification.md`, `implementation-plan.md`, `test-plan.md`, `ci-gates.md`, `tasks.yml`, and `context-manifest.md`.

## Step 1: Generate change-id, scaffold, and scan context

Derive a `change-id` from the description:
- kebab-case, max 5 words
- examples: `add-jwt-auth`, `redesign-dashboard-home`, `fix-order-export-timeout`

Check that `specs/changes/<change-id>/` does not already exist. If it does, append `-2` (or next available suffix).

Create the scaffold with the CLI so every provider gets the same templates:

```bash
cdd-kit new <change-id>
```

`cdd-kit new` auto-runs `cdd-kit context-scan` when `specs/context/` indexes are missing or stale. Do not run a second scan unless the command warned that context-scan failed, or you intentionally used `--skip-scan`.

Verify these files exist:
- `specs/changes/<change-id>/context-manifest.md`
- `specs/context/project-map.md`
- `specs/context/contracts-index.md`

If either context index is still missing, run:

```bash
cdd-kit context-scan
```

Do not use broad search or ad hoc reads to classify the change before `context-scan` has completed.

The generated scaffold contains the artifacts listed in the table below. **All
templates are written from disk by `cdd-kit new` ??do not paste template bodies
into this prompt.** The on-disk source of truth lives in `specs/templates/` of
the kit and is bundled into every install.

| File | Source | Your job |
|---|---|---|
| `change-request.md` | `specs/templates/change-request.md` | Fill the `## Original Request` section with the user's exact description before invoking the classifier; leave the rest blank |
| `change-classification.md` | `specs/templates/change-classification.md` | Replace blank template with classifier output (Step 2) |
| `implementation-plan.md` | `specs/templates/implementation-plan.md` | `implementation-planner` writes this directly after contracts, tests, required design, and CI gate plan are known |
| `test-plan.md` | `specs/templates/test-plan.md` | `test-strategist` writes this directly |
| `ci-gates.md` | `specs/templates/ci-gates.md` | `ci-cd-gatekeeper` writes this directly |
| `tasks.yml` | `specs/templates/tasks.yml` | Tick checkboxes as agents complete; backfill `tier:` frontmatter from classifier (Step 2.4) |
| `context-manifest.md` | `specs/templates/context-manifest.md` | Replace from classifier `## Context Manifest Draft` (Step 2) |

If `cdd-kit new` reports a missing template, run `cdd-kit upgrade --yes`.

---

## Step 2: Classify the change

Invoke `change-classifier` agent with:
- The user's change description
- `specs/changes/<change-id>/change-request.md`
- `specs/changes/<change-id>/context-manifest.md`
- `specs/context/project-map.md`
- `specs/context/contracts-index.md`

Do not authorize the classifier to read `contracts/`, `src/`, `tests/`, or broad repository search during initial classification. It must use the context indexes to propose candidate paths.

The classifier must include a `## Context Manifest Draft` section with:
- affected surfaces
- allowed paths for each required agent work packet; this must be the union of
  every file/directory agents are expected to read, including component/store/view
  files for frontend work and CI contracts/workflows for CI work
- required contracts
- required tests
- any context expansion requests that must be approved before implementation

**change-classifier is read-only** ??it will return its output as text.

### If the classifier returns `## Atomic Split Proposal`

The classifier has decided this request is too big for a single change. Do
NOT proceed with the rest of `/cdd-new`. Instead:

1. Show the user the full `## Atomic Split Proposal` table verbatim.
2. Ask: "Run these as separate changes (recommended), or force a single
   monolithic change?"
3. If user picks "separate":
   - For each row in the proposal table, run `cdd-kit new <change-id>` with
     the listed `--depends-on`.
   - Then say: "I created N change directories. Want me to run `/cdd-new`
     against the first one now?" ??wait for confirmation; do not auto-loop.
4. If user picks "force monolithic":
   - Re-invoke change-classifier with `force-monolithic` appended to the
     change-request and proceed with whatever Tier the classifier returns.
5. Delete the partially-scaffolded change directory you created in Step 1
   if the user picked "separate" and the originally-derived change-id is
   not in the proposal ??it would otherwise sit empty and confuse `cdd-kit
   list`.

### Classifier output lint (B8): refuse stub responses

Before writing any files, verify the classifier response contains:

- `## Tier` followed by `- N` where N is a single digit 0-5 (NOT `0 / 1 / 2 / 3 / 4 / 5` ??that is the unfilled placeholder).
- `## Required Agents` with at least one agent name.
- `## Inferred Acceptance Criteria` with at least one filled `AC-1: ?圳 line.

If any of these are missing or still hold the literal placeholder text, STOP. Re-prompt the classifier with the missing pieces named explicitly. Do NOT write classification.md ??gate will reject it as a stub anyway and you will have wasted the round-trip.

### When the classifier output passes lint

1. **YOU write** `specs/changes/<change-id>/change-classification.md` ??replace the blank template with the classifier's classification output.
2. Optional: write `specs/changes/<change-id>/agent-log/change-classifier.yml` only if the classifier returned useful handoff evidence.
3. **YOU update** `specs/changes/<change-id>/context-manifest.md` from the classifier's `## Context Manifest Draft`.
4. **YOU update** `tasks.yml` frontmatter: set `tier: <N>` to the classifier's tier digit. This is now the authoritative source for quality-gate tier checks (the classification.md `## Tier` section is fallback only).
5. **YOU tick** `tasks.yml` item `1.1`.

Wait until these five writes are done before continuing.

**After writing change-classification.md**: read the classifier's `## Tasks Not Applicable` list. For each listed task ID (e.g., `2.2`, `4.2`), update `tasks.yml` to change that item's `status:` from `pending` to `skipped`. Do this before invoking any other agent.

---

## Step 3: Read the tier and commission agents

Read `change-classification.md` to determine the tier. Then invoke agents **in the exact order below**.

**For each read-only agent**: wait for its text response. YOU write a report
artifact only if the classifier required that report or the agent found
blocking findings / approved-with-risk evidence that needs durable prose. Otherwise
write at most a short optional handoff note, then tick relevant `tasks.yml`
item(s).

**For each write-capable agent**: wait for it to confirm completion ??YOU tick relevant tasks.yml item(s).

If any agent reports `blocked`, halt immediately and surface its concrete next action to the user ??do not proceed to subsequent agents.

**When invoking any agent, always begin the prompt with:**
```
CURRENT_CHANGE_ID: <change-id>
Change directory: specs/changes/<change-id>/
```
This ensures the agent's Read scope restriction points to the correct directory.

Before invoking an agent, preflight any concrete paths you already expect that
agent to read:

```bash
cdd-kit context check <change-id> --path <repo-relative path> [more paths...]
```

If the check fails and the paths are legitimate work scope, update
`context-manifest.md` `## Allowed Paths` or approve a Context Expansion Request
before the agent reads them. This keeps read scope explicit before broad source
access, especially for UI components/stores/views or CI workflow files.

After every agent returns, complete the closeout before starting the next
agent:
- confirm required artifacts exist; optional handoff notes are not gate inputs
- if the agent reports `blocked`, halt and surface its concrete next action
- tick the owned `tasks.yml` items immediately
- record incidental/pre-existing findings in `agent-log/*.yml`; escalate to
  `qa-report.md` or `regression-report.md` only when the finding blocks release,
  changes the QA decision, or needs durable follow-up ownership

### Agent stage badges (UI v1)

When you announce that you are about to invoke an agent, prefix the
announcement with the matching emoji + role tag from the table below. This
helps a non-engineer scanning the chat stream tell what stage they are in
without reading the full prompt. Use the badges only in your own narration to
the user; do not put them inside the prompt sent to the agent.

| Stage | Agent | Badge |
|---|---|---|
| Decision | `change-classifier` | ? `[classifier]` |
| Decision | `spec-architect` | ? `[architect]` |
| Decision | `implementation-planner` | ? `[plan]` |
| Implementation | `backend-engineer` | ? `[backend]` |
| Implementation | `frontend-engineer` | ? `[frontend]` |
| Implementation | `ci-cd-gatekeeper` | ? `[ci-cd]` |
| Implementation | `test-strategist` | ? `[test-plan]` |
| Heavy testing (Tier 0?? only) | `e2e-resilience-engineer` | ?? `[e2e]` |
| Heavy testing (Tier 0?? only) | `monkey-test-engineer` | ?? `[monkey]` |
| Heavy testing (Tier 0?? only) | `stress-soak-engineer` | ?? `[stress]` |
| Review | `contract-reviewer` | ? `[contracts]` |
| Review | `qa-reviewer` | ? `[qa]` |
| Review | `ui-ux-reviewer` | ? `[ui-ux]` |
| Review | `visual-reviewer` | ? `[visual]` |
| Review | `dependency-security-reviewer` | ? `[deps-sec]` |
| Audit | `spec-drift-auditor` | ??`[drift]` |
| Audit | `repo-context-scanner` | ??`[repo-scan]` |

Color semantics:
- ? purple: deciding what we will do (heavy model, `opus`)
- ? blue: writing code (`sonnet` implementation)
- ? yellow: planning tests (`sonnet`)
- ?? orange: heavy testing ??only appears for Tier 0??, signals high-risk scope
- ? green: reviewing what was done (no code writes; just verdicts)
- ??neutral: audits and scans (read-only background work)

Format: emoji is followed by a single space, then the bracket-tag, then the
human-readable narration.

Examples:

```
? [classifier] Reading the request and project map??? [contracts] Confirming the API contract is unchanged. (read-only)
? [backend] Implementing the JWT issuance endpoint and writing failing
            tests first per TDD policy.
?? [stress] Tier 1 high-risk change ??running soak test for 30 min.
```

These badges are pure narration. They MUST NOT be sent inside the agent's
prompt; the agent's behavior is defined by the agent prompt files in
`.claude/agents/<name>.md`, not by this badge.

---

### Tier 4?? (low risk: docs, prompts, config-only, no behavior change)

1. **`contract-reviewer`** (read-only) ??confirm no contracts are touched or all touched ones are already updated.
   - Optional handoff note: `agent-log/contract-reviewer.yml`
   - YOU tick: `1.2`, applicable items in section 2

2. **`qa-reviewer`** (read-only) ??confirm release readiness.
   - Optional handoff note: `agent-log/qa-reviewer.yml`
   - YOU tick: `5.4`

---

### Tier 2?? (normal: feature, enhancement, bug fix with behavior change)

1. **`contract-reviewer`** (read-only) ??update or create contracts in `contracts/` before any implementation starts.
   - Optional handoff note: `agent-log/contract-reviewer.yml`
   - YOU tick: `1.2`, applicable items in section 2

2. **`test-strategist`** (write-capable) ??writes `specs/changes/<change-id>/test-plan.md` directly.
   - YOU tick: applicable items in section 3 based on what test families were planned
   - Provide the classifier's `## Inferred Acceptance Criteria` list to test-strategist. These become the `criterion id` column in the Acceptance Criteria ??Test Mapping table.

3. **`spec-architect`** (write-capable) ??only if `change-classification.md` contains `Architecture Review Required: yes`, marks `design.md` as `yes`, or lists `spec-architect` in `## Required Agents`.
   - Writes `specs/changes/<change-id>/design.md` directly. This is the design/architecture decision record consumed by `implementation-planner`.
   - YOU tick: `1.3`
   - If the classifier did not require design, YOU mark `1.3` as `skipped` before continuing.

4. **`ci-cd-gatekeeper`** (write-capable) ??writes `specs/changes/<change-id>/ci-gates.md` directly before implementation planning.
   - YOU tick: `1.4`, `4.4`, applicable items in section 6

5. **`implementation-planner`** (write-capable) ??writes `specs/changes/<change-id>/implementation-plan.md` directly after classification, contracts, test plan, required design, and CI gate plan are available.
   - This is the handoff packet for implementation agents. It should contain execution scope, non-goals, required changes, file-level plan, contract updates, test execution plan, and constraints.
   - It must reference `test-plan.md`, `ci-gates.md`, contracts, and `design.md` by path/section/id instead of copying their full content.
   - It must not create or repair `design.md`. If required design is missing, route back to `spec-architect`.
   - If it reports `blocked`, halt and surface the missing decision/context to the user.
   - YOU tick: `1.5`

6. **`backend-engineer`** (write-capable) ??if the change touches server, API, data, or business logic. Writes implementation directly; may write an optional handoff note.
   - YOU tick: `4.1` and/or `4.3` based on scope
   - Note: `tasks.yml` items 3.1??.2 (unit/contract/integration tests) are written by `backend-engineer` and/or `frontend-engineer` in TDD fashion ??failing tests first, implementation second. Items 3.3??.5 are written by dedicated test engineers (Tier 0?? only or when classifier explicitly requires them).

7. **`frontend-engineer`** (write-capable) ??if the change touches UI, components, or client-side behavior. Writes implementation directly; may write an optional handoff note.
   - YOU tick: `4.2`

8. **`dependency-security-reviewer`** (read-only) ??if the change touches lockfiles, package manifests, or DB migrations.
   - **Only invoke if** `change-classification.md` lists lockfiles, package manifests, or DB migrations as affected.
   - Optional handoff note: `agent-log/dependency-security-reviewer.yml`
   - YOU tick: applicable security-related items

9. **`ui-ux-reviewer`** (read-only) ??if any UI change (run alongside or after frontend-engineer).
   - **Only invoke if** classifier marks UI/CSS as affected.
   - Optional handoff note: `agent-log/ui-ux-reviewer.yml`
   - YOU tick: `5.1`

10. **`visual-reviewer`** (read-only) ??if any UI change (run after ui-ux-reviewer).
   - **Only invoke if** classifier marks UI/CSS as affected.
   - Optional handoff note: `agent-log/visual-reviewer.yml`
   - YOU tick: `5.2`

11. **`qa-reviewer`** (read-only) ??release readiness decision (always last).
    - Optional handoff note: `agent-log/qa-reviewer.yml`
    - YOU tick: `5.4`

---

### Tier 0?? (high risk: production data, concurrency, queues, large queries, auth, payments, exports)

All agents from Tier 2??, plus insert these after `frontend-engineer` / `backend-engineer` and before `dependency-security-reviewer`:

- **`e2e-resilience-engineer`** (write-capable) ??E2E, failure-injection, data-boundary tests. May write an optional handoff note.
  - YOU tick: `3.3`

- **`monkey-test-engineer`** (write-capable) ??adversarial input, fuzz, rapid-UI-action tests. May write an optional handoff note.
  - YOU tick: `3.4`

- **`stress-soak-engineer`** (write-capable) ??load, soak, and long-running stability tests. May write an optional handoff note.
  - YOU tick: `3.5`

---

**Agent commission rules:**
- Skip an agent only if the classifier explicitly marks its surface as "not affected"
- If backend-only with no UI: skip `frontend-engineer`, `ui-ux-reviewer`, `visual-reviewer`
- If UI-only with no backend: skip `backend-engineer`
- If a required or informational test has pre-existing failures unrelated to
  this change, do not count them as this change's pass/fail result. Record the
  failing test id, baseline commit or prior evidence, owner, and follow-up in
  optional `agent-log/*.yml`; create `qa-report.md` only when the QA decision is
  `approved-with-risk` or `blocked`.
- If implementation uncovers unrelated old bugs, fix only those needed to meet
  this change's acceptance criteria or to avoid a new safety/security risk.
  Otherwise record them as follow-up with evidence and owner.

**Resuming from blocked**: After the user resolves the blocking issue, re-invoke the blocked agent (do not restart from Step 1). Continue with the remaining agents in their original order.

---

## Step 4: Run the gate

After all required agents have completed and all tasks.yml items for their sections are ticked:

```
cdd-kit gate <change-id>
```

**If gate passes**:
- YOU tick: `tasks.yml` item `6.1`
- Proceed to Step 5.

**If gate fails ??structured fix-back routing**:

Capture gate's full stderr verbatim. Parse error lines and route each to the
right owner. The patterns below are exhaustive ??every gate error message
matches one of them.

| Error pattern | Route to | Re-invocation prompt seed |
|---|---|---|
| `change-classification.md: ?圳 | `change-classifier` | "PREVIOUS CLASSIFICATION FAILED GATE: <error>. Re-emit only the failing section." |
| `context-manifest.md: ?圳 | `change-classifier` | "PREVIOUS MANIFEST FAILED GATE: <error>. Re-emit `## Context Manifest Draft`." |
| `tasks.yml: ?圳 (frontmatter / pending) | YOU (main Claude) ??direct edit | n/a ??fix `tasks.yml` yourself. Don't re-invoke an agent for a file you own. |
| `dependency <id>: upstream change is not completed` | n/a ??STOP | Tell user: "Upstream change `<id>` must complete before this change can gate. Run `/cdd-new <id>` first or run `cdd-kit archive <id>` if it's already done." |
| `validators returned non-zero` | `contract-reviewer` | "PREVIOUS CONTRACT VALIDATION FAILED: <last 10 lines of validator stderr>. Reconcile contracts." |

**Re-invocation prompt template** (always use this exact prefix when re-invoking an agent for fix-back):

```
CURRENT_CHANGE_ID: <change-id>
Change directory: specs/changes/<change-id>/

PREVIOUS GATE FAILURE FOR THIS AGENT (re-invocation):
<the exact gate error line(s) tied to this agent>

FIX TARGET:
<the specific file or section that needs to change>

REFERENCES:
- references/agent-log-protocol.md (optional handoff note format, only if useful)
- references/<agent-specific-standard>.md (if applicable)

Fix this exact issue without re-doing your prior work. Re-output only the
section that changed plus any updated handoff note, if useful.
```

After re-invoking, re-run `cdd-kit gate <change-id>`. Repeat up to **3 times**. Each
iteration must be on a strictly smaller error set ??if the same error returns
twice, halt and surface to user (an agent stuck in a loop is more expensive
than a human read).

**Terminal state after 3 failures**: Update `tasks.yml` frontmatter with
`status: gate-blocked` and report all remaining errors to the user, grouped
by responsible agent, so they know who to manually direct next.

---

## Step 5: Report to user

Output a final summary:

```
## /cdd-new complete

Change ID: <change-id>
Risk tier: <tier>
Agents invoked: <list in order>
Gate: PASSED

Tasks completed:
- [x] all applicable items have status: done in specs/changes/<change-id>/tasks.yml

Core artifacts written to: specs/changes/<change-id>/

Next step:
  git add specs/changes/<change-id>/
  git add <any implementation files changed>
  git commit -m "feat(<change-id>): <one-line description>"
```

If gate did not pass after 3 iterations:

```
## /cdd-new ??gate blocked

Change ID: <change-id>
Gate failed after 3 attempts.

Blocking items:
- <item 1>
- <item 2>

Please review the above items and re-run: cdd-kit gate <change-id>
```

---

## Rules

- Never start implementation (backend/frontend-engineer) before `contract-reviewer` has completed for Tier 0?? changes
- Never start implementation (backend/frontend-engineer or dedicated test engineers) before `implementation-plan.md` exists and `tasks.yml` item `1.5` is done
- Never skip `test-plan.md` for Tier 0?? changes
- Never skip `ci-gates.md` for any implementation change
- Agent logs are optional; do not create them just to satisfy a gate.
- Tick the relevant `tasks.yml` checkbox immediately after each agent completes ??do not batch
- `qa-reviewer` always runs last and makes the release-readiness decision

---

## After Completion

The `/cdd-new` workflow is now complete. **Return to normal assistant mode immediately.** Answer any question the user asks ??including questions unrelated to this change, new feature discussions, debugging help, or general conversation ??without requiring them to use a specific command. The git commit shown in the report is a suggestion, not a required next step; do not wait for it before resuming normal behavior.

When the change is merged and ready to close, run `/cdd-close <change-id>` to promote durable learnings to `contracts/` or project guidance (`CLAUDE.md`/`CODEX.md`) and archive the change directory.
