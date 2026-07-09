# Change Classification

## Change Types
- primary: feature-add, ci-cd-change
- secondary: agent-workflow-change (mandatory node + agent-prompt edits), tooling/validator-add, docs (ADR 0012)

## Lane
- feature

Not a bug-fix: this starts from a desired new behavior (a design-side oracle node), not a symptom of broken existing behavior. The `contracts/ui/` → `contracts/css/` pointer correction in `ui-ux-reviewer.md` is a small fix rolled into the feature, not a symptom-driven lane trigger.

## Risk Level
- high

Authority-bearing: it changes the mandatory workflow for every downstream adopter of the kit and adds a REQUIRED gate check plus an agent hard-write-block. But there is no production DB, no schema/data migration, no concurrency, no secrets, no auth, no payments. High (not critical) is correct.

## Impact Radius
- system-wide (mandatory workflow node + required gate for all adopters)

## Tier
- 1

### Tier-floor override (recorded in tasks.yml frontmatter)
The keyword `migration` appears in this change only as (a) the `isNewChange || strict` **gate migration window** and (b) the upgrade path for legacy change directories. There is no data migration and no database in scope. Tier 1 (high + system-wide, fully reversible dev-tooling artifacts) is the correct mapping; Tier 0 is reserved for irreversible/production-outage class risk that is absent here.

## Architecture Review Required
- yes
- reason: ADR 0012 must be authored FIRST and lock three decisions — (1) the node placement and *convergence* semantics of the human-in-the-design-loop, (2) the provenance-reconciliation join rules and the hard-vs-advisory error boundary (including the state-discriminator strictness open question), and (3) the explicit never-gate list. This is a module-boundary + data-flow + operational-authority decision that `implementation-planner` cannot infer.

## Required Artifacts
Always required: change-request.md, change-classification.md, implementation-plan.md, test-plan.md, ci-gates.md, tasks.yml, context-manifest.md

## Optional Artifacts (default: no — set yes only with explicit reason)
| artifact | create? | reason |
|---|---|---|
| current-behavior.md | no | The "design only appears as after-the-fact review" gap is fully captured in change-request.md § Business / User Goal; ADR 0012 + design.md carry the rest. |
| proposal.md | no | The decision belongs in ADR 0012 / design.md, not a separate product investigation. |
| spec.md | no | No separate user-facing behavior spec beyond the ADR + design. |
| design.md | yes | Architecture Review Required = yes; `spec-architect` writes design.md alongside ADR 0012. |
| qa-report.md | no | Use an `agent-log/qa-reviewer.yml` pointer; promote to yes only if QA returns blocking findings or approved-with-risk on this authority-bearing gate. |
| regression-report.md | no | No existing runtime behavior regresses; the gate migration window covers legacy dirs. A log pointer suffices. |
| visual-review-report.md | no | This repo ships no UI. |
| monkey-test-report.md | no | Not applicable. |
| stress-soak-report.md | no | Explicit non-goal (no latency/N+1/load verification in this node). |

Artifact minimization:
- Prefer optional `agent-log/*.yml` pointers for routine review evidence.
- Create report markdown only for blocking findings, approved-with-risk, visual evidence bundles, or high-risk load/soak results.
- Later artifacts should reference earlier artifacts by path/section/id instead of duplicating full content.

## Required Contracts
- API: none (read-only join target for provenance — `contracts/api/api-contract.md`; not modified)
- CSS/UI: none (repo ships no UI; `contracts/css/` stays `not-applicable`. Only the `ui-ux-reviewer` prompt's broken pointer is corrected.)
- Env: none
- Data shape: none (read-only join target — `contracts/data/data-shape-contract.md` `## Invalid Data Behavior`; not modified)
- Business logic: none
- CI/CD: yes — `contracts/ci/ci-gate-contract.md` must register `enforceInteractionDesign` as a required check, with the `isNewChange || strict` migration window documented.

## Required Tests
- unit: `design-hash` canonical-projection + tamper detection; `gate-design` pass/fail branches; provenance-reconciliation validator (hard error vs advisory); `design confirm` writer + lock schema
- contract: `ci-gate-contract.md` gate-inventory consistency (new required check registered); agent-prompt shape lint for `interaction-designer.md` and the edited prompts
- integration: gate composition in `gate.ts`; `cdd-kit design confirm <id>` end-to-end writes/locks `.cdd/design-lock.json`; `pre-tool-use-design-write.sh` blocks agent writes; `install-agent-hooks.ts` wiring; `new-change.ts` scaffolds the template; `isNewChange || strict` migration-window behavior on a legacy dir; ADR 0011 applicability skip path
- E2E: n/a (CLI E2E is covered by the integration tests above)
- visual: n/a — no UI
- data-boundary: n/a — no data surface of its own
- resilience: n/a
- fuzz/monkey: n/a
- stress: n/a — explicit non-goal
- soak: n/a — explicit non-goal

## Required Agents
- `spec-architect` — ADR 0012 + design.md FIRST (node/convergence semantics, provenance join rules + hard/soft boundary, never-gate list)
- `contract-reviewer` — review the `ci-gate-contract.md` change and the provenance-reconciliation semantics
- `test-strategist` — test-plan + acceptance → test mapping for the new gate/validator/lock/hook
- `ci-cd-gatekeeper` — new required gate check, ci-gate-contract registration, migration-window correctness
- `implementation-planner` — turn ADR/design + contracts into the execution packet before any implementation
- `backend-engineer` — TypeScript CLI + validators + gate + schema + hook wiring, plus the `.claude/` agent-prompt/SKILL/template edits (edit `.claude/`, then run `node build.js`; never hand-edit `assets/`)
- `qa-reviewer` — release readiness for an authority-bearing system-wide change

Not required: `frontend-engineer`, `ui-ux-reviewer`, `visual-reviewer` — this repo ships no UI; the change *builds* UI-design machinery but renders nothing. `interaction-designer` is the artifact being created, not an agent that runs on this change.

## Inferred Acceptance Criteria
- AC-1: A read-only `interaction-designer` agent prompt exists and is inserted between `contract-reviewer` and `implementation-planner` in the cdd-new SKILL agent order for BOTH Tier 0–1 and Tier 2–3, and is reflected in cdd-resume.
- AC-2: A per-change `interaction-design.md` template exists carrying the derivation chain (presented information + rationale → user intent/frequency → control↔intent mapping including deleted controls + reason → state reversibility → meaning⇄form consistency → `## Open Decisions` → `## Confirmed`) and is scaffolded by `cdd-kit new`.
- AC-3: `cdd-kit design confirm <change-id>` is the ONLY path that writes `.cdd/design-lock.json`, and `pre-tool-use-design-write.sh` blocks any agent write to that path (mirrors `.cdd/acceptance-lock.json`).
- AC-4: gate check `enforceInteractionDesign` FAILS when interaction-design.md is missing, has any unresolved `## Open Decisions`, lacks a human `## Confirmed`, breaks referential integrity (every control cites one intent id; every intent has one path), or fails provenance reconciliation.
- AC-5: Provenance reconciliation resolves every information item and UI state to a supplier — an `api-contract.md` endpoint+schema field, an `errors` code, an HTTP status, or a `data-shape-contract.md` `## Invalid Data Behavior` row. An unresolvable reference is a HARD error; a contract field with zero consumers is an ADVISORY warning that does not block.
- AC-6: After human confirm, any subsequent agent edit to interaction-design.md invalidates the canonical-projection sha256 lock and fails gate until re-confirmed (tamper-evidence per ADR 0010).
- AC-7: `enforceInteractionDesign` uses the `isNewChange || strict` migration window, so pre-existing change directories do not fail on introduction (verified by a regression test over a legacy dir).
- AC-8: A change may skip this node via the ADR 0011 `applicability: not-applicable` marker with a required `applicability-reason`, with `applicability.py` remaining the single pass/fail authority.
- AC-9: `frontend-engineer` reports `blocked` when the design is unconfirmed and the states `when applicable` escape hatch is removed; `implementation-planner` references the confirmed design by path/section; `ui-ux-reviewer` reviews against the confirmed design and points to `contracts/css/` (not the non-existent `contracts/ui/`).
- AC-10: ADR 0012 exists and records the explicit NEVER-gate list (visual aesthetics, animation/motion, layout taste, latency/round-trip/N+1) as a written prohibition, and `enforceInteractionDesign` is registered in `ci-gate-contract.md`.

## Tasks Not Applicable
- not-applicable: 2.1, 2.2, 2.3, 2.4, 2.5, 3.3, 3.4, 3.5, 4.2, 4.3, 5.1, 5.2

Rationale: contracts API/CSS/env/data/business are unchanged (2.1–2.5); E2E/data-boundary/monkey/stress-soak are non-goals or n/a for a CLI/validator change (3.3–3.5); this repo ships no UI, so frontend implementation and UI/visual review do not apply (4.2, 5.1, 5.2); no env/deploy change (4.3).

## Clarifications or Assumptions
- Assumed the state-discriminator strictness (the `[]`-for-both-empty-and-no-data failure mode in change-request.md § Open Questions) is decided IN ADR 0012, not deferred. AC-5 treats "every state names a discriminator" as in-scope. If the architect defers it, downgrade that clause to advisory and note it.
- Assumed the design-lock schema lives in `src/schemas/`, mirroring `acceptance.schema.ts`.
- Assumed no change to `.github/workflows/` beyond what registering a required check demands; `ci-cd-gatekeeper` confirms whether the workflow file needs a new job name.
- `interaction-design.md` is per-change only for this change; a long-lived `contracts/css/` "layout language" contract is explicitly deferred to a future ADR (change-request.md § Open Questions, item 2).
- The classifier cited `src/commands/new.ts`; the real file is `src/commands/new-change.ts` (verified). Allowed Paths below use the real name.

## Non-goals (must survive into ADR 0012)
- Never gate visual aesthetics, animation/motion, or layout taste — rules without context misjudge these.
- No new CSS/token/color scanner.
- No latency / round-trip (N+1) verification in this node; that stays with `stress-soak-engineer`.
- Do not modify the acceptance-oracle (ADR 0010) mechanism itself.
- Out of scope: `specs/changes/yaml-migration-plan/`.

## Context Manifest Draft

### Affected Surfaces
- CDD workflow orchestration (`.claude/skills/cdd-new`, `.claude/skills/cdd-resume`) and agent prompts
- CLI commands, gate composition, validators, schemas, hooks (`src/`, `hooks/`)
- CI gate contract (`contracts/ci/`)
- ADR / docs

### Allowed Paths
- specs/changes/interaction-design-loop/
- specs/context/project-map.md
- specs/context/contracts-index.md
- docs/adr/0012-interaction-design-loop.md
- docs/adr/0010-acceptance-oracle.md
- docs/adr/0011-not-applicable-contract-marker.md
- docs/adr/0007-data-shape-conformance.md
- .claude/agents/interaction-designer.md
- .claude/agents/frontend-engineer.md
- .claude/agents/implementation-planner.md
- .claude/agents/ui-ux-reviewer.md
- .claude/skills/cdd-new/SKILL.md
- .claude/skills/cdd-resume/SKILL.md
- .claude/skills/contract-driven-delivery/scripts/applicability.py
- specs/templates/interaction-design.md
- specs/templates/acceptance.yml
- specs/templates/tasks.yml
- src/commands/gate-design.ts
- src/commands/gate.ts
- src/commands/gate-acceptance.ts
- src/commands/gate-shared.ts
- src/commands/gate-contracts.ts
- src/commands/design.ts
- src/commands/accept.ts
- src/commands/new-change.ts
- src/commands/install-agent-hooks.ts
- src/commands/openapi-export.ts
- src/utils/design-hash.ts
- src/utils/acceptance-hash.ts
- src/utils/tier-floor.ts
- src/utils/change-id.ts
- src/schemas/
- src/cli/index.ts
- hooks/pre-tool-use-design-write.sh
- hooks/pre-tool-use-acceptance-write.sh
- hooks/pre-tool-use-contract-write.sh
- contracts/ci/ci-gate-contract.md
- contracts/api/api-contract.md
- contracts/data/data-shape-contract.md
- build.js
- .cdd/context-policy.json
- .github/workflows/contract-driven-gates.yml
- test/cli/
- test/acceptance/
- test/schemas/
- test/utils/
- test/contracts/

Note: `.claude/` and `assets/` are excluded from the `project-map.md` scan, but `.claude/` edits are in-scope for this change (edit `.claude/`, then run `node build.js`; never hand-edit `assets/`). These Allowed Paths entries are the authorization the map cannot express.

### Required Contracts
- contracts/ci/ci-gate-contract.md (modify — register `enforceInteractionDesign`)
- contracts/api/api-contract.md (read-only join target)
- contracts/data/data-shape-contract.md (read-only join target)

### Required Tests
- test/cli/ (gate + hook + install + new-change command tests)
- test/acceptance/ (driver-test pattern for the new lock/confirm flow)
- test/utils/ (design-hash) and test/schemas/ (design-lock schema)

### Agent Work Packets

#### change-classifier
- specs/changes/interaction-design-loop/
- specs/context/project-map.md
- specs/context/contracts-index.md

#### spec-architect
- specs/changes/interaction-design-loop/
- docs/adr/0012-interaction-design-loop.md
- docs/adr/0010-acceptance-oracle.md
- docs/adr/0011-not-applicable-contract-marker.md
- docs/adr/0007-data-shape-conformance.md
- contracts/api/api-contract.md
- contracts/data/data-shape-contract.md
- contracts/ci/ci-gate-contract.md

#### contract-reviewer
- specs/changes/interaction-design-loop/
- contracts/ci/ci-gate-contract.md
- contracts/api/api-contract.md
- contracts/data/data-shape-contract.md

#### test-strategist
- specs/changes/interaction-design-loop/
- test/cli/
- test/acceptance/
- test/utils/
- test/schemas/
- src/commands/gate-design.ts
- src/commands/design.ts
- src/utils/design-hash.ts

#### ci-cd-gatekeeper
- specs/changes/interaction-design-loop/
- contracts/ci/ci-gate-contract.md
- src/commands/gate.ts
- src/commands/gate-design.ts
- src/commands/gate-acceptance.ts
- .github/workflows/contract-driven-gates.yml

#### implementation-planner
- specs/changes/interaction-design-loop/
- docs/adr/0012-interaction-design-loop.md
- src/commands/gate-acceptance.ts
- src/commands/accept.ts
- src/utils/acceptance-hash.ts
- hooks/pre-tool-use-acceptance-write.sh
- .claude/skills/cdd-new/SKILL.md

#### backend-engineer
- specs/changes/interaction-design-loop/
- src/commands/gate-design.ts
- src/commands/gate.ts
- src/commands/gate-shared.ts
- src/commands/gate-acceptance.ts
- src/commands/gate-contracts.ts
- src/commands/design.ts
- src/commands/accept.ts
- src/commands/new-change.ts
- src/commands/install-agent-hooks.ts
- src/commands/openapi-export.ts
- src/utils/design-hash.ts
- src/utils/acceptance-hash.ts
- src/utils/change-id.ts
- src/schemas/
- src/cli/index.ts
- hooks/pre-tool-use-design-write.sh
- hooks/pre-tool-use-acceptance-write.sh
- hooks/pre-tool-use-contract-write.sh
- .claude/agents/interaction-designer.md
- .claude/agents/frontend-engineer.md
- .claude/agents/implementation-planner.md
- .claude/agents/ui-ux-reviewer.md
- .claude/skills/cdd-new/SKILL.md
- .claude/skills/cdd-resume/SKILL.md
- .claude/skills/contract-driven-delivery/scripts/applicability.py
- specs/templates/interaction-design.md
- specs/templates/acceptance.yml
- contracts/ci/ci-gate-contract.md
- contracts/api/api-contract.md
- contracts/data/data-shape-contract.md
- .cdd/context-policy.json
- build.js
- test/cli/
- test/acceptance/
- test/schemas/
- test/utils/
- test/contracts/

#### qa-reviewer
- specs/changes/interaction-design-loop/
- contracts/ci/ci-gate-contract.md

### Context Expansion Requests
(none at classification time — the Allowed Paths above pre-authorize the precedent files the implementers must mirror. An agent that discovers an unlisted required read must file a CER rather than reading outside this packet.)
