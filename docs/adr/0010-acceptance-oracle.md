# ADR 0010: Acceptance oracle — human-supplied ground truth as a tamper-evident gate

- Status: Proposed
- Date: 2026-07-08
- Deciders: maintainer (non-coding spec author) + AI delivery agent
- Relates to: `cdd-kit gate`, `acceptance.yml` (new artifact), ADR 0005
  (bounded test execution and structured evidence), ADR 0007 (data-shape
  conformance), ADR 0004 §6 (write-side chokepoint hooks), ADR 0009 (parallel
  worktrees), `hooks/pre-tool-use-contract-write.sh`, `cdd-kit migrate` /
  `refresh` / `upgrade`

## Context

cdd-kit's purpose is to constrain AI delivery agents so a **non-coding** author
gets correct software with minimal effort. The kit already enforces a great deal
mechanically — contracts, schema conformance, bounded test evidence, bug-fix
evidence — but every one of those checks answers the same shape of question:
*"does the implementation match **the standard**?"*. None of them can generate
the standard. This is the **oracle problem**: a checker can only enforce
consistency against an oracle; it cannot invent what "correct" means.

Two facts make this the kit's central risk:

1. **The author cannot review code.** If the AI writes both the contract *and*
   the implementation and the author rubber-stamps the contract, the review adds
   zero information — the two sides can be consistently wrong and the author
   cannot see it. This is the human version of the verified gate hole (`gate`
   passes unfilled placeholders, self-reported task-done, and zero code change).

2. **Contract self-consistency ≠ intent.** A future Z3/SMT layer (see "Out of
   scope") can prove a contract does not contradict itself, but still cannot
   prove the contract is what the author *wanted*. No solver closes the intent
   gap.

The one thing no AI, solver, or linter can manufacture is **what the author
actually wants**. The author *can* supply that — not as code, but as
business-language ground truth: concrete input→expected-output examples,
never-break invariants, and (when a reference system exists, e.g. the author's
DashBoard_clone) parity targets. The kit's job is to take that small,
code-free human input and mechanically amplify it into checks the AI **cannot
satisfy by faking both sides**.

Everything mechanical sits on a guarantee ladder (format → lint → type →
contract-conformance → mutation/property → formal). The cheap deterministic
rungs are necessary hygiene but prove almost nothing about intent, because
passing them does not require the code to do the right thing. The acceptance
oracle is the first rung whose passing condition is defined by a human and
checked against the **real running system**.

## Decision

Add a first-class, human-owned artifact — `acceptance.yml` — per change, and a
hard gate that the implementation must pass it against the real system, with the
author's expected values **locked against agent tampering**.

### 1. The artifact (`specs/changes/<id>/acceptance.yml`)

Authored by the human (or dictated to the main agent, which transcribes but does
not invent values). Business language plus concrete answer keys:

```yaml
oracle-version: 0.1.0
authored-by: human            # provenance marker; see §3
cases:
  - id: over-limit-order-rejected
    given: "a customer whose credit limit is 1000"
    when:  "they submit an order for 1500"
    then:  "the order is rejected with reason 'credit-limit-exceeded'"
    input:  { customer_limit: 1000, order_amount: 1500 }
    expect: { status: "rejected", reason: "credit-limit-exceeded" }
rules:                         # invariants that must ALWAYS hold
  - id: refund-never-exceeds-payment
    statement: "a refund amount can never exceed the original payment"
```

`given/when/then` is the human's words; `input`/`expect` are the **oracle** — the
answer key the author owns. `rules` are invariants (checked by property-based
tests, ADR 0005 ladder / a follow-up). Schema:
`src/schemas/acceptance.schema.ts`.

### 2. Binding (AI writes the plumbing, never the answer)

The agent's job is only to write a driver that feeds `input` into the **real**
code path and captures the actual output for comparison to `expect`. Two
non-negotiable constraints make the driver honest:

- The driver **reads `expect` from `acceptance.yml`** (via a generated
  fixture/loader the kit emits), never hardcodes it — so changing the answer
  means editing the locked artifact (§3), not the test.
- The driver must exercise the system under test (SUT), not a stand-in (§3
  mock-of-SUT ban).

### 3. Tamper-evidence (the anti-gaming core)

Four mechanisms, each reusing an existing kit pattern:

1. **Hash-lock.** The gate records a checksum of the human region
   (`cases[].input/expect`, `rules`) in the change metadata. If an
   implementation agent alters an expected value, the hash diverges and the gate
   fails with "acceptance oracle modified after authoring — human must
   re-confirm." (Same shape as the version/metadata reconciliation the gate
   already does.)
2. **Agent-write block.** A PreToolUse hook
   (`pre-tool-use-acceptance-write.sh`, modeled exactly on
   `pre-tool-use-contract-write.sh`) blocks an agent Edit/Write/MultiEdit to
   `acceptance.yml`. Advisory by default, `CDD_ACCEPTANCE_WRITE_STRICT=1` to
   hard-block. A human editing the file is unaffected. Armed via
   `install-agent-hooks --acceptance-write`.
3. **Mock-of-SUT ban.** The gate scans each acceptance driver for mocking of the
   change's own SUT (the modules the change touches, resolved from the code-map)
   and fails: "acceptance test mocks the thing it is supposed to verify."
   External I/O boundaries (network, clock) may still be faked; the SUT may not.
4. **Executed-and-passed evidence.** Acceptance runs through the ADR 0005
   evidence harness as a new `acceptance` phase, so passing is a recorded
   bounded run, not a self-report. `test-evidence.yml` gains an `acceptance`
   block.

### 4. Gate check (`enforceAcceptanceOracle`)

Under `gate` (and hard under `--strict`):

- `acceptance.yml` exists and is **non-placeholder** (reuses the existing
  placeholder/`meaningfulChars` detection) with ≥1 case.
- Every case has a corresponding acceptance driver whose recorded run
  **passed**.
- The oracle hash matches (untampered).
- No acceptance driver mocks the SUT.
- `rules` each have at least one bound invariant test (strict mode).

> **Update (interaction-design-loop, 2026-07-09).** This bullet described a
> check that was never implemented — `rules` did not appear anywhere in
> `gate-acceptance.ts`. It landed as part of the interaction-design-loop
> change's scope expansion 2, as `findUnboundRules`
> (`src/utils/mock-of-sut-scan.ts`), enforced only under `--strict`. Binding
> convention: a rule is bound when a driver file under `test(s)/acceptance/`
> that belongs to the same change (`driverBelongsToChange`) contains a
> word-boundary occurrence (`isWordBoundaryOccurrence`) of the rule's id —
> conventionally inside a test title (`it("rule <id>: ...", ...)`), the same
> test-title-carries-the-id convention already used for AC ids. Reusing both
> guards means the scan cannot reproduce the two false-positive bugs this
> ADR's own mock-of-SUT/hardcoded-expect scan shipped with and had to fix
> (cross-change contamination; substring matching) — see
> `contracts/ci/ci-gate-contract.md` `enforceAcceptanceOracle` condition 6 for
> the full pass/fail text. `rules: []` (or no `rules` key) passes trivially.

Non-behavioral changes (pure refactor) opt out **only** via reference-parity
("outputs must match the reference/old system") or an auditable, agent-forbidden
`acceptance-not-applicable` reason that a review agent countersigns — the opt-out
is deliberately harder than ADR 0005's, because an empty acceptance oracle is the
exact failure this ADR exists to prevent.

### 5. Portable enforcement vs. harness automation (design boundary)

cdd-kit ships as a portable npm CLI plus project-local `.claude/` assets. Its
**guarantees must live in the portable layer** (CLI validators, `gate`, and the
settings.json hooks the kit writes) so they hold for Claude agents, Codex agents,
and plain CI alike. Claude Code's session primitives — **Workflow, Loop,
Worktree** — are powerful but session-scoped and unavailable in headless CI or
non-Claude providers. Therefore:

- **Enforcement** (the four tamper-evidence mechanisms, the gate) is CLI/hook
  only. A change never passes because a harness feature ran; it passes because
  `cdd-kit gate` said so.
- **Automation** layers on top for Claude users, calling the same CLI:
  - **Hooks** (already the kit's mechanism) carry the acceptance-write block and
    the existing chokepoints — the one harness feature the kit *does* depend on,
    because it is written into settings.json and is itself gate-detectable
    (doctor chokepoint dashboard).
  - **Worktree** (ADR 0009) already isolates parallel changes; acceptance drivers
    run per-worktree with no new work.
  - **Loop** automates the fixback cycle: run `gate` → if it fails, hand the
    structured failure back to the implementation agent → repeat until green or a
    retry budget is hit. This is a `cdd-kit`-driven `/loop`, not a new guarantee.
  - **Workflow** expresses the whole change as a deterministic script (scaffold →
    author-oracle checkpoint → implement → gate-loop → close). The workflow
    *orchestrates*; the gate *decides*. A skill (`cdd-new`) remains the
    natural-language entry point for users who do not invoke Workflow directly.

The rule of thumb, recorded here so future features respect it: **never let a
correctness guarantee depend only on a harness primitive.** Harness features make
the portable checks faster and hands-free; they never replace them.

### 6. Migration and versioned upgrade

Existing users must land the oracle and, more generally, be able to fully
re-scaffold onto a new kit version. Two parts:

- **Backfill.** `acceptance.yml` joins the change template set, so `refresh`
  (agents/skills/templates/hooks/model-policy) and `upgrade` (missing repo
  files) pick it up for new work, and `cdd-kit migrate` scaffolds a
  placeholder-plus-instructions `acceptance.yml` into existing in-flight change
  dirs (the same path that already upgrades `tasks.yml`/`agent-log`). A migrated
  change fails the new gate until the author supplies real cases — intentionally,
  so the oracle is never silently skipped on upgrade.
- **Version + content-digest stamping (new).** Installed agents, skills, hooks,
  and templates are stamped with the package version and a content digest at
  install/refresh time; `doctor` compares installed global assets against the
  packaged assets and reports drift (closes the gap where a repo can claim vN
  governance while running drifted prompts, and lets `refresh`/`upgrade` prove a
  *complete* re-scaffold rather than a best-effort copy). The digest is also
  what `doctor` uses to tell a stale install from a current one after
  `npm i -g`.

## Consequences

- The intent gap is closed at the one point only a human can close it: the author
  supplies a few real examples/rules the AI did not write, and the kit enforces
  the implementation against them on the real system. This is why the acceptance
  oracle is prioritized above a Z3 layer — Z3 checks a contract's internal
  coherence; the oracle checks intent.
- The classic AI cheats are mechanically blocked: editing the expected answer
  (hash-lock + write-block), mocking the SUT (scan), and self-reporting done
  (executed evidence).
- Cost, honestly stated: the author must write **real, non-trivial** cases — a
  useless case buys nothing, and no mechanism can detect a lazy-but-well-formed
  oracle. The kit can only require ≥N cases and nudge coverage of the change's
  stated behavior. This residual is irreducible: it is the author's oracle role,
  the part of the work that cannot be delegated.
- Upgrading users get a complete, digest-verifiable re-scaffold and an explicit
  (failing-until-filled) acceptance backfill, not a silent partial copy.

## Out of scope (candidate follow-up ADRs)

- **Z3/SMT contract & business-rule consistency** — prove contracts don't
  contradict each other and business rules aren't mutually unsatisfiable/dead.
  Sits above the oracle on the ladder; does not close the intent gap, so it
  follows this ADR rather than preceding it.
- **Mutation testing as an evidence phase** — mechanically kill placeholder
  tests by measuring whether the change's tests detect injected faults. Strong
  complement to §4 but independent of the oracle artifact.
- **Property-based generation from contracts** — auto-derive `rules` invariant
  tests from contract schemas so the author writes the invariant, the machine
  finds counterexamples.
- **Deterministic Workflow script for the full change lifecycle** — promoting the
  `cdd-new` skill's natural-language orchestration into a resumable Workflow,
  keeping the gate as the sole decider.
