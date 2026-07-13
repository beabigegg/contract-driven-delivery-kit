# Archive: agent-native-cdd-rearchitecture

## Change Summary

Rearchitected CDD from a uniformly heavy, artifact-first workflow into an
agent-native, risk-selected one. Lightweight / balanced / controlled profiles now
run on runtime-native state and evidence instead of mandating the seven legacy
change artifacts, while strict is retained verbatim as the compatibility and
rollback lane. Claude Code and Codex both drive the flow through provider adapters
and provider-neutral doctrine modules. Contract / API / serialized-data-shape
mismatches are blocked mechanically by a Boundary Guard rather than trusted to the
agent, and genuinely high-risk decisions (breaking API, destructive migration,
auth policy, production operation) return to the human, who the agent cannot
self-approve for. Authored by Codex; reviewed and hardened by Claude across five
follow-up passes.

## Final Behavior

- A user can describe a request in plain conversation; the main agent handles
  files, CDD commands, tests, and delivery evidence without repeatedly
  interrupting the user for routine technical work.
- Frontend/backend/API/data-shape mismatches fail the gate automatically via
  Boundary Guard (route/request/response conformance, capture provenance,
  no-vacuous-green).
- Human acceptance of intent is a real, un-fabricable signal: the agent may draft
  plain-language criteria, but confirmation is either an interactive human
  keystroke (`cdd-kit accept confirm`) or an authorized PR confirmation comment,
  never something the agent can post on the human's behalf. An explicit
  `--autonomous` loop bypass is recorded and always surfaced (never a human
  sign-off), and is refused under strict.
- Strict remains authoritative and one command away as the rollback lane; the new
  runtime stays shadow by default (`shadow_mode: true`).

## Final Contracts Updated

`contracts/` (product contracts) was intentionally untouched. The contract
surface for this change is machine-readable schemas + runtime modules + design
records:

- Schemas: `src/schemas/cdd-policy.schema.ts`, `execution-capsule.schema.ts`,
  `runtime-state.schema.ts`, `runtime-evidence.schema.ts`,
  `boundary-manifest.schema.ts`, and `acceptance.schema.ts` (extended).
- Runtime: `src/runtime/{router,engine,agent,checks,decisions,parity,store,types}.ts`.
- Boundary Guard: `src/boundary/{guard,adapters,generators}.ts`.
- Design records: `docs/adr/0013-agent-native-delivery-runtime.md`,
  `docs/rfc/agent-native-cdd-rearchitecture.md`,
  `docs/rfc/agent-native-cdd-runtime-contracts.md`,
  `docs/boundary-guard.md`, `docs/loosening-the-harness.md`,
  and `docs/migration/*`.

## Final Tests Added / Updated

22 test files, +1487 lines. Runtime + schema tests, Boundary Guard negative /
mutation tests, Claude + Codex provider compatibility tests, migration / user-asset
upgrade tests, a doctrine-traceability contract test, and follow-up coverage for
chat-confirmed trust scope, the tri-state parity verdict, the policy bone-audit,
human/autonomous acceptance, and `acceptance.chat_binds_head`.

## Final CI/CD Gates

From `ci-gates.md` (all tier-0, required on pull request): lockfile, encoding
(mojibake), build, typecheck, full regression (vitest), runtime-contract schema
tests, Boundary Guard negative/mutation, provider compatibility, upgrade safety,
plus a maintainer architecture review. Boundary Guard is composed into
`cdd-kit gate` in shadow mode (informational; strict stays the blocking
authority) until per-project promotion evidence exists.

## Production Reality Findings

- The original review surfaced that chat-confirmed acceptance was framed as
  stronger than it is: it proves the maintainer's DECISION, not an unspoofable
  ORIGIN. Hardened to OWNER-only default trust, never honored under strict, with
  a signed-envelope path documented for a mechanical guarantee.
- Parity could report `equivalent` from two green runs with no mutation evidence —
  "loosening on vibes". Replaced with an honest tri-state verdict
  (`equivalent` | `inconclusive` | `divergent`) that requires mutation evidence.
- `test-evidence.yml` records passed collect / targeted / changed-area / contract /
  quality / full phases; CI `contract-and-fast-tests` gate passed on the merged
  head with a genuine OWNER acceptance confirmation.

## Lessons Promoted to Standards

Reviewed by `contract-reviewer` (Step 3). Two candidates considered:

- **The loosening decision rule** — PROMOTED.
  - Contract: new `### Loosening policy — bone-audit` subsection in
    `contracts/ci/ci-gate-contract.md` (schema-version 0.9.0 → 0.10.0;
    `contracts/CHANGELOG.md` entry `[ci 0.10.0]`). States only what the bone-audit
    mechanically enforces (disabled bone ⇒ audit fails without a `loosening`
    acknowledgment) versus what is documented-and-reviewed (mutation-corpus
    evidence via the optional `evidence` field).
  - Guidance: folded in place into the existing `cdd-kit:learnings` entry 3 of
    `CLAUDE.md` (net-zero line growth) — "a green gate/oracle test, or a loosened
    check, proves nothing without mutation-corpus evidence … stronger agents earn
    more freedom, never more self-certified trust."
  - Evidence: `docs/loosening-the-harness.md`; `src/runtime/parity.ts`
    (`classifyParityVerdict` tri-state); `src/commands/gate-acceptance.ts`
    (strict refuses chat-confirmed/autonomous); `src/commands/policy.ts`
    (`auditLoosening`).

- **"chat-confirmed proves the DECISION, not an unspoofable ORIGIN"** —
  DO-NOT-PROMOTE. True and evidence-backed, but an implementation-site detail
  already documented at the call sites (`src/utils/acceptance-confirmation.ts`,
  `src/schemas/acceptance.schema.ts`) and in `docs/loosening-the-harness.md`, and
  overlapping existing learnings entry 2. Promoting it would grow the
  always-loaded `CLAUDE.md` without distinct cross-change leverage.

## Follow-up Work

- Promotion of any consumer repository from strict to balanced still requires
  repository-specific dual-run + seeded-mutation parity evidence (ci-gates.md
  "Promotion Policy"); migration keeps existing projects on strict until then.
- Boundary Guard stays in shadow mode until a project reviews its manifest,
  captures, and exceptions and explicitly sets `shadow_mode: false`.

## Cold Data Warning

This archive is historical evidence. Current requirements live in `contracts/`
and active project guidance (`CLAUDE.md` / `CODEX.md`).
