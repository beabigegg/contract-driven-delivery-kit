# ADR 0001: Contract → OpenAPI export, and the path to generated clients

- Status: Accepted (export PoC); Proposed (client generation)
- Date: 2026-06-01
- Deciders: maintainer + AI delivery agent

## Context

The kit's recurring failure mode is **prose governance**: a rule that only
works if a human or agent chooses to follow it. PRs #6–#8 converted three such
rules into mechanical chokepoints (conformance validator, `--with-source`,
installed graph-first hook). One gap remains, and it is the strongest one.

`contracts/api/api-contract.md` is called the single source of truth for the
API, but **nothing generates code from it**. The conformance validator added in
#6 is *detective*: it parses real backend routes and frontend calls and diffs
them against the contract table *after* the code is written. That is valuable,
but it has two structural limits:

1. **It is heuristic.** As the Codex review rounds on #6 showed, regex route
   detection has an endless tail of framework-shape edge cases (NestJS
   `RouterModule`, mounted Express prefixes, Rails' stateful DSL). Each is a
   patch; none is a proof.
2. **It catches drift; it cannot prevent it.** A divergent call is written,
   committed, and only then flagged.

The category that *prevents* drift is **generation**: if the frontend client (or
its types) is generated from the contract, a divergent call is unrepresentable —
it fails to typecheck. No regex, no edge cases. This ADR decides how the kit
moves toward that without betraying its "generic, ships to any repo" constraint.

## Decision

Split the work along the **generic / stack-specific** seam, and only build the
generic half in the kit core.

### 1. The kit owns contract → OpenAPI extraction (generic, build now)

Add `cdd-kit openapi export`, which reads `contracts/api/api-contract.md` and
emits a **minimal OpenAPI 3.1 skeleton** (`paths`, `operations`, `parameters`
inferred from path templates, response status placeholders, and the API-style
metadata as `info`/`description`). This is:

- **stack-agnostic** — it reads the same markdown table the conformance
  validator already parses; it produces a standard artifact, not code;
- **safe** — it never writes into source trees, only emits an OpenAPI document
  to stdout or a chosen path;
- **non-authoritative by direction** — the markdown contract remains the SoT
  that humans/agents edit; OpenAPI is a *projection* of it for tooling. (We do
  **not** invert this to "OpenAPI is the SoT" — that would require every contract
  author to write OpenAPI, which contradicts the kit's "non-engineers author
  contracts" audience.)

The skeleton is intentionally partial: request/response *schemas* in the
contract table are free-form prose today (e.g. "User", "User[]"), not JSON
Schema, so the export cannot fabricate field-level schemas it does not have. It
emits what is mechanically derivable (path, method, params, status codes,
auth → security scheme hints) and marks the rest as `TODO`/`x-cdd-unresolved`.
This honesty is the point — same principle as removing `.rb` from the
conformance defaults rather than shipping a fake Rails parser.

### 2. Per-stack client generation stays an opt-in adapter (do NOT build in core)

Generating a typed FE client from the OpenAPI document is **stack-specific** and
belongs in the consumer repo, wired by the user with an existing, well-maintained
generator (`openapi-typescript`, `orval`, `openapi-generator`, …). The kit's
role is to **produce the seam** (the OpenAPI doc) and **document the wiring**, not
to ship a universal generator. Shipping one would:

- recreate the maintenance tail we just escaped, now for every target language;
- risk generating subtly wrong clients across arbitrary stacks — itself a new
  drift source, which is antithetical to the kit.

So: kit exports OpenAPI; user runs their generator of choice in their own CI;
the generated client makes divergence a compile error. The kit provides a
documented recipe per common stack, not code.

### 3. Relationship to the conformance validator

The OpenAPI export does **not** replace `validate_api_conformance.py`; they are
complementary along the brownfield axis:

| | Generated client (preventive) | Conformance validator (detective) |
|---|---|---|
| Applicable when | repo owns both sides in a typed stack and can regenerate | brownfield/polyglot, cannot regenerate the client |
| Strength | divergence is unrepresentable (compile error) | divergence is flagged post-hoc, heuristically |
| Cost | requires generator wiring per stack | zero per-stack wiring |

The kit keeps the validator as the universal floor and offers OpenAPI export as
the on-ramp to the stronger, opt-in preventive path. A repo can also feed the
exported OpenAPI **back into** conformance checking later (validate real routes
against the OpenAPI paths instead of the markdown table) — a future unification,
explicitly out of scope here.

## Consequences

**Positive**
- A standard, tool-consumable artifact is derivable from the contract with zero
  per-stack assumptions.
- The kit stays generic; stack-specific risk stays in the consumer repo where it
  belongs.
- Clear, honest boundary: the export emits only what the markdown actually
  determines and flags the rest.

**Negative / limits**
- The skeleton is partial until contracts carry field-level schemas. This ADR
  does not mandate that migration; it leaves request/response bodies as `TODO`.
- Two artifacts now describe the API (markdown SoT + derived OpenAPI). We accept
  this because the direction is fixed (markdown → OpenAPI, never reverse-edited),
  so they cannot become competing sources of truth. `cdd-kit openapi export
  --check` asserts the committed OpenAPI is in sync, the same way `code-map
  --check` does (shipped — see the follow-up note below).

## Scope of the accompanying PoC

This PR ships **only** the generic export half:

- `cdd-kit openapi export [--out <path>] [--json|--yaml]` reading
  `contracts/api/api-contract.md`;
- path-template → OpenAPI `parameters` inference (`/users/:id`, `/users/{id}`);
- method/auth/status extraction; API-style metadata into `info`;
- unresolved request/response schemas emitted as clearly-marked placeholders;
- tests; docs recipe for wiring `openapi-typescript` in a consumer repo.

It does **not** ship any client generation or schema authoring format. Those
remain follow-ups, each its own decision.

## Follow-up shipped since the PoC

- **`--check` sync gate** (`cdd-kit openapi export --check --out <path>`):
  verifies the committed artifact still matches the contract, exiting non-zero on
  drift. This closes the "two artifacts" risk noted above — the derived OpenAPI
  can no longer silently fall out of step with the markdown source of truth.
- **Consumer codegen wiring**: `cdd-kit init` now scaffolds editable
  `contract:client` / `contract:client:check` npm scripts when a `package.json`
  is present, materializing the consumer half of the seam as a chokepoint rather
  than a doc — while keeping the actual generator choice in the consumer repo, as
  this ADR decided.

Still deferred: a schema-carrying contract format (so request/response **bodies**
become preventive too, not just paths/methods), and feeding the exported OpenAPI
back into `validate_api_conformance.py`.
