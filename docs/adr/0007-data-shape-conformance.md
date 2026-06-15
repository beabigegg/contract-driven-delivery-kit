# ADR 0007: Data-shape conformance — enforce response bodies against the contract

- Status: Accepted
- Date: 2026-06-15
- Deciders: maintainer + AI delivery agent

## Context

ADR 0001 split API conformance into **preventive** (generate the client from the
contract → divergence is a compile error) and **detective** (parse real code and
diff it against the contract table). Both, as shipped, only cover **routes**:
method + path. ADR 0001 itself flagged the gap and deferred it:

> Still deferred: a schema-carrying contract format (so request/response
> **bodies** become preventive too, not just paths/methods)…

ADR 0002 added the schema-carrying format (`## Schemas`, Tier A field tables /
Tier B `json-schema` blocks → compiled JSON Schema, projected into
`openapi.json`'s `components.schemas` with response cells resolved to `$ref`s).
So the contract *can* now carry a field-level response body shape. But nothing
**checks code against it**. `validate_api_conformance.py` explicitly skips
request/response schema refs (route-only). The result, observed in a real
consumer project:

- The contract's `response schema` column is left as prose labels
  (`success_response`) — the typed-schema machinery exists but is unused, so
  `openapi export` resolves nothing and codegen produces `unknown`.
- The real shape lives in two independent places — backend dict literals and a
  hand-written frontend `endpoint-schemas.ts` — which drift. In that project the
  *same* endpoint returned `topReasons` on its cache path and omitted it on its
  Oracle-fallback path; the frontend type omitted it too. Three shapes, zero
  enforcement, intermittent "the data doesn't match" breakage in production.

This is the body-level version of exactly the failure ADR 0001 set out to kill,
and it is the one that actually breaks frontend/backend integration.

A constraint sharpens the design: the kit ships to **any** stack (the consumer
above is Flask + Vue; sibling projects are FastAPI, Express, Go). So the
enforcement point must be language-neutral.

## Decision

Extend **both** conformance axes from routes to response **bodies**, keeping the
generic/stack-specific seam ADR 0001 established. The single source of truth
stays the markdown contract; `openapi.json` (already produced by `openapi
export`, already `--check`-gated) stays the generated projection that both new
mechanisms consume. **No new schema-export command** — the existing
`components.schemas` + resolved `$ref`s in `openapi.json` are that artifact.

### 1. Detective, stack-agnostic: response-shape validator (kit-owned)

Add `validate_response_shape.py` to the `validate --contracts` chain. It:

1. reads `contracts/api/openapi.json` and, per endpoint, resolves the success
   response schema (a `$ref` into `components.schemas`, or inline);
2. reads a **response-sample manifest** (`tests/contract/response-samples.json`)
   that maps `"METHOD /path"` → a captured JSON sample (optionally with a
   `dataPath` to drill into an envelope like `{success, data}`);
3. validates each sample against its endpoint's response schema with
   `jsonschema` (OpenAPI 3.1 ⇒ Draft 2020-12).

Why a **sample** and not static code analysis: the only language-neutral place a
response shape is observable is the **serialized JSON at the HTTP boundary**.
Parsing Flask dict returns vs FastAPI models vs Express `res.json` vs Go structs
is the heuristic tail ADR 0001 escaped — we do not re-enter it. A sample is
universal. The scaffold (below) shows how to **regenerate** samples from the real
app inside the test run, so they assert live output rather than going stale.

**Opt-in by adoption, enforced by default once adopted.** The manifest's
*existence* is the opt-in signal: no manifest → the validator prints a one-line
skip and exits 0 (existing projects are untouched on `npm update`). Once a
manifest exists, a declared-schema mismatch is an **error** by default — not a
warning behind a `strict` flag. This is deliberate: the same consumer project
had its route conformance net silently disarmed by setting every check to
`warning` + `strict:false`. A protection that defaults to advisory gets disarmed;
this one defaults to blocking. An endpoint whose response cell is still prose
(no resolved schema) is simply not checked — incremental adoption, never a
forced migration (the ADR 0002 / ADR 0001 no-migration guarantee holds).

Config (`.cdd/conformance.json`, new optional `responseShape` block) can disable
it (`"enabled": false`) or soften severity (`"severity": "warning"`) for a
project that wants a ratchet, but the *default with a manifest present* is
`enabled: true`, `severity: error`.

### 2. Preventive: close the backend half of codegen (kit wires, stack-owns)

ADR 0001 §2 shipped the **frontend** preventive path (`suggest-codegen` wires
`openapi-typescript` → FE types from `openapi.json`). The backend equivalent was
missing — which is why the backend could drift from the very schema the frontend
was generated against. `suggest-codegen` now also wires a **backend** generator
when a known stack is detected, as an editable npm/script default, not a
decision:

- **FastAPI / Python**: `datamodel-codegen` (`openapi.json` → Pydantic models).
  Declaring those models as the route's `response_model` makes FastAPI enforce
  the contracted shape **at runtime, by the framework** — the strongest possible
  guarantee, and it falls out of the same `openapi.json`.

For stacks with no conventional generator, nothing is wired (same honesty as ADR
0001 declining a universal client generator); the detective validator (§1) is
the universal floor that always applies.

### 3. Scaffold + docs make adoption a chokepoint, not a doc

`cdd-kit init`/`refresh` scaffold a `tests/contract/` harness: the
`response-samples.json` manifest (seeded with a worked example) and a README with
**per-stack capture snippets** (FastAPI `TestClient`, Flask test client,
supertest) showing the regenerate-then-validate loop. Capture is consumer-wired
(it touches their app); validation is kit-owned — the same split as the FE
generator choice in ADR 0001.

## Consequences

**Positive**
- Request/response **bodies** are now covered on both axes, closing the gap ADR
  0001 named. The body-level drift that actually breaks integration is caught.
- Zero new per-stack heuristics and no new generated artifact: everything hangs
  off the existing `openapi.json` projection and its `--check` gate.
- Defaults that resist disarming (block-on-adopt), with a documented escape hatch
  for projects that need a ratchet.

**Negative / limits**
- Samples must be representative; a stale committed sample asserts an old shape.
  Mitigated by the scaffold's regenerate-in-test-run pattern, but not forced —
  a project may commit static samples and own that tradeoff.
- Coverage is only as good as the endpoints a project migrates from prose to
  typed schemas. The validator nudges (warns on a typed-but-unsampled endpoint)
  but never forces migration.
- `jsonschema` becomes a test-time dependency for projects that adopt the
  manifest; the validator errors with an install hint rather than silently
  skipping when a manifest is present but the library is missing.

## Scope

This ADR ships: the `validate_response_shape.py` validator + chain wiring; the
`responseShape` config block; the `suggest-codegen` backend half (FastAPI /
datamodel-codegen); the `tests/contract/` scaffold + per-stack capture docs.

It does **not** ship: request-*body* sample validation (symmetric, deferred until
the response path proves out), live-endpoint polling, or a universal backend
generator for stacks without a conventional tool.
