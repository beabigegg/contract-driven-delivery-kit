# Design: interaction-design-loop

## Summary
Add a design-side counterpart to the ADR 0010 acceptance oracle: a per-change,
human-confirmed `interaction-design.md` produced by a read-only
`interaction-designer` proposer, reconciled against the API and data-shape
contracts in a **convergence loop** (with a back-edge to `contract-reviewer`), and
hash-locked against agent tampering before implementation proceeds. A new REQUIRED
gate check `enforceInteractionDesign` enforces file presence, zero unresolved
`## Open Decisions`, a human `## Confirmed`, referential integrity, provenance
reconciliation, and the confirmed-region hash. The full decision record — node
placement, the six-row hard/advisory provenance boundary, the state-discriminator
HARD ruling, and the explicit Never-Gated prohibition — lives in
`docs/adr/0012-interaction-design-loop.md`; this design does not restate it.

## Affected Components
| component | file path(s) | nature of change |
|---|---|---|
| ADR | `docs/adr/0012-interaction-design-loop.md` | new — locks node/convergence semantics, provenance join rules, Never-Gated list |
| New agent | `.claude/agents/interaction-designer.md` (+ `assets/` via `node build.js`) | new read-only proposer; fills derivation chain + `## Open Decisions` |
| Artifact template | `specs/templates/interaction-design.md` | new per-change template carrying the ADR §1 derivation chain |
| Gate check | `src/commands/gate-design.ts`, `src/commands/gate.ts`, `src/commands/gate-shared.ts` | new `enforceInteractionDesign`; `isNewChange \|\| strict` window |
| Provenance validator | `src/commands/gate-design.ts` (+ reuse `openapi-export.ts` projection) | joins info items/states → api/data-shape suppliers; hard vs advisory |
| Confirm CLI + lock | `src/commands/design.ts`, `src/utils/design-hash.ts`, `src/schemas/`, `src/cli/index.ts` | `cdd-kit design confirm <id>`; sole writer of `.cdd/design-lock.json`; canonical-projection sha256 |
| Write-block hook | `hooks/pre-tool-use-design-write.sh`, `src/commands/install-agent-hooks.ts` | blocks agent writes to `.cdd/design-lock.json` (mirrors acceptance) |
| Scaffold | `src/commands/new-change.ts` | scaffolds `interaction-design.md` into new change dirs |
| Workflow order | `.claude/skills/cdd-new/SKILL.md`, `.claude/skills/cdd-resume/SKILL.md` | insert node after `contract-reviewer`, before `implementation-planner`; back-edge |
| Downstream agents | `.claude/agents/frontend-engineer.md`, `implementation-planner.md`, `ui-ux-reviewer.md` | blocked-until-confirmed; remove states `when applicable`; review vs confirmed design; fix `contracts/ui/`→`contracts/css/` |
| Skip authority | `.claude/skills/contract-driven-delivery/scripts/applicability.py` | reused as-is (single authority); no TS second authority |
| CI contract | `contracts/ci/ci-gate-contract.md` | register `enforceInteractionDesign` as REQUIRED + migration window |
| Join targets (read-only) | `contracts/api/api-contract.md`, `contracts/data/data-shape-contract.md` | not modified; `## Invalid Data Behavior` rows gain their first consumer, cited by the stable `condition` key (not the free-text `error code / UI state` column) |

## Key Decisions
- **State discriminator = HARD at introduction** → two states differing in meaning
  must cite distinct discriminators; a state citing a contract-absent discriminator
  is a hard error that drives the back-edge. Rejected ADVISORY: failure mode #2
  (`[]` means both "calm" and "blind") is the ADR's strongest justification; a soft
  rule gets disarmed. AC-5 in `change-classification.md` stands unchanged.
  See ADR 0012 §2.
- **Convergence loop with back-edge, not a straight line** → contract and design are
  mutually constraining; design demands discriminators/timestamps/distinct HTTP
  statuses the contract may lack. Rejected strict "designer after contract-reviewer":
  half-true, ignores the reverse demand. See ADR 0012 §3.
- **Provenance boundary: 4 HARD / 1 out-of-scope / 1 advisory**. Row 3 (distinct
  error copy) resolves via a **distinct HTTP status or an enum-pinned success field**,
  NOT via a semantic error code — the `errors` column is bare HTTP-status integers
  only, and `contracts/api/error-format.md` is deliberately not a join target
  (semantic-code joins deferred). The reverse/over-fetch advisory is a corpus-wide
  `cdd-kit doctor` report, NOT a per-change gate finding (a single change cannot see
  sibling screens). Rejected blocking N+1/latency: semantic, not statically joinable
  → `stress-soak-engineer`. See ADR 0012 §2, §6.
- **Never-Gated prohibition** (aesthetics, motion, layout taste, type/color, latency)
  → no oracle for taste; a context-blind rule reproduces the disease. Rejected
  proposals #1 (affordance scanner) and #2 (filter-needs-reset) are recorded as
  evidence. See ADR 0012 "Never Gated".
- **Reuse ADR 0010 tamper-evidence + ADR 0011 skip** verbatim in spirit: canonical
  parsed-projection hash, single writer CLI, write-block hook, `isNewChange||strict`
  window; `applicability: not-applicable` + reason via the single `applicability.py`
  authority. Rejected re-inventing either mechanism or adding a TS skip authority.
- **Human dialogue choreography** (agent proposes → main Claude runs dialogue →
  human decides → main Claude writes `## Confirmed` → `design confirm` locks) →
  subagents cannot converse with the user; mirrors `Step 0` and `Atomic Split
  Proposal` precedents in `cdd-new/SKILL.md`. See ADR 0012 §4.
- **`interaction-design.md` is per-change** under `specs/changes/<id>/`; a durable
  `contracts/css/` layout-language contract is deferred to a future ADR.

## Migration / Rollback
Additive and fully reversible dev-tooling change; no data migration, no DB. New
change dirs get the template via `new-change.ts`; legacy dirs are shielded by the
`isNewChange || strict` window so they do not fail on introduction (mirrors
`enforceAcceptanceOracle`). `.cdd/design-lock.json` is a regenerable sidecar, safe
to delete/regenerate. Rollback removes the gate check, template, hook, confirm CLI,
and the ADR-registered `ci-gate-contract.md` row, with no residual state. Edit only
`.claude/`, then `node build.js` to regenerate `assets/`; never hand-edit `assets/`.

## Open Risks
- The confirm hash must project the *parsed semantic* chain, not raw bytes, or
  reformatting breaks the lock (ADR 0012 §5); a weak projection reintroduces
  false-tamper failures.
- Provenance join depends on endpoints being migrated from prose to typed schemas in
  `api-contract.md` (ADR 0007 limit); unmigrated cells cannot be field-checked and
  fall back to advisory — coverage is only as deep as the contract is typed.
- A lazy-but-well-formed `## Confirmed` is undetectable (irreducible oracle residual,
  as in ADR 0010); the gate proves consistency, not that the human thought hard.
- `.cdd/code-map.yml` staleness would weaken any SUT/graph-based reasoning downstream;
  refresh before implementation planning.
