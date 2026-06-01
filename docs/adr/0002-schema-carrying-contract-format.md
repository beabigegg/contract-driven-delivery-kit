# ADR 0002: Schema-carrying contract format (preventive request/response bodies)

- Status: Proposed
- Date: 2026-06-01
- Deciders: maintainer + AI delivery agent
- Supersedes: nothing; extends ADR 0001 (Contract → OpenAPI export)

## Context

ADR 0001 made **paths and methods** preventive: `cdd-kit openapi export`
projects the markdown contract into OpenAPI, a consumer generates a typed
client, and a wrong *URL or verb* becomes a compile error. It deliberately
stopped there. The contract's `request schema` / `response schema` columns are
free-form prose today — cells say `User`, `User[]`, `CreateUser` — so the
exporter cannot fabricate field-level schemas and marks every request body
`x-cdd-unresolved` (see `src/commands/openapi-export.ts`).

The consequence is a **half-preventive client**. The generated client knows
`POST /api/users` exists and returns *something*, but the request body is typed
`unknown` / `any`. The exact class of bug the kit exists to kill — "the URL is
right but the payload is wrong" (missing required field, wrong field name,
wrong type) — is still only catchable *detectively*, if at all. The conformance
validator (ADR 0001 §3) diffs *routes*, not *body shapes*, so it does not cover
this either.

This ADR decides **how a contract can carry field-level schemas** so that
request/response bodies become preventive too, **without** betraying the two
constraints ADR 0001 was careful about:

1. **Non-engineers author contracts.** We cannot require every author to write
   raw OpenAPI / JSON Schema.
2. **The markdown contract stays the single source of truth**, projected
   one-way into OpenAPI; we never reverse-edit the generated artifact.

## Decision

### 1. Schemas live in the same contract file, referenced by name

Add an optional `## Schemas` section to `contracts/api/api-contract.md`. Each
named schema is a `### <Name>` subsection. The existing endpoint table is
**unchanged**: a `request schema` / `response schema` cell that already says
`CreateUser` simply *becomes a reference* to `### CreateUser` when that section
exists. No new column, no migration of existing rows.

```markdown
## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| POST | /api/users | admin | CreateUser | User | 400 | yes |

## Schemas

### CreateUser
| field | type | required | notes |
|---|---|---|---|
| email | string | yes | login identity |
| name  | string | yes | |
| age   | integer | no | |

### User
| field | type | required | notes |
|---|---|---|---|
| id    | string | yes | |
| email | string | yes | |
| name  | string | yes | |
```

This reuses the **exact authoring idiom the audience already uses** for
endpoints (a markdown table), so the non-engineer constraint holds. One file
stays the source of truth.

**Naming rules** (so cell→schema resolution is unambiguous):

- A schema name must match `^[A-Za-z][A-Za-z0-9_]*$` (the OpenAPI
  `components.schemas` key charset). A `### Name` heading that does not match is
  **not** treated as a schema (it is ordinary prose), so unrelated `###`
  headings in the file are never misread as types.
- Resolution is **exact and case-sensitive**: a cell value resolves only to a
  `### Name` whose text matches byte-for-byte after trimming. `user` does not
  resolve to `### User`. This avoids a class of silent mis-binding; a near-miss
  simply degrades to Tier C (unresolved) and is visible in the export warning.
- **Duplicate `### Name` sections are a hard error** (the export fails, it does
  not pick one), because a duplicate is an ambiguous source of truth — the same
  stance the kit takes elsewhere.
- A rename is just an edit: rename the `### Name` *and* the cells that reference
  it. A dangling cell (references a name with no section) degrades to Tier C and
  warns; `--check` then fails on the regenerated artifact, surfacing the dangling
  reference at the CI gate rather than silently.

### 2. Three fidelity tiers, with graceful degradation

For each `request schema` / `response schema` cell value, the exporter resolves
in this order:

| Tier | Author writes | Export emits | Body is |
|---|---|---|---|
| **A. Field table** | a `### Name` field sub-table | `components.schemas.Name` (JSON Schema) + `$ref` | **preventive** |
| **B. Raw escape hatch** | a fenced ` ```json-schema ` block under `### Name` | that JSON Schema verbatim + `$ref` | **preventive** |
| **C. Unresolved** | nothing (cell is prose, no `### Name`) | **today's markers, unchanged** (see below) | best-effort |

Tier C is the current behavior, so **every existing contract keeps exporting
exactly as it does now**. Crucially, "today's behavior" is **not uniform across
request and response**, and Tier C must preserve each side exactly:

- an unresolved **request** cell keeps emitting the `requestBody` with
  `x-cdd-unresolved` (as `buildDoc` does today);
- an unresolved **response** cell keeps emitting the prose annotation
  `x-cdd-response-contract` (as `buildDoc` does today) — it does **not** gain an
  `x-cdd-unresolved` marker.

Flattening both onto a single `x-cdd-unresolved` marker would rewrite every
existing unresolved-response artifact and break the byte-for-byte/no-migration
guarantee. So Tier C is defined as "emit precisely what the current exporter
emits for this cell"; only resolution to a real `### Name` (Tier A/B) changes
the output. Adoption is incremental and per-schema: define `### User` and only
`User` becomes preventive; everything else degrades untouched. This mirrors
ADR 0001's "emit what is mechanically derivable, mark the rest" honesty — and
mirrors how client codegen itself is opt-in.

Tier B exists because the field-table notation has a deliberate ceiling (below):
power users get a verbatim escape hatch instead of being blocked.

**A and B are mutually exclusive within one `### Name`.** A section is exactly
one of: a field table (Tier A), a single fenced ` ```json-schema ` block
(Tier B), or neither (Tier C). If a section contains **both** a field table and
a `json-schema` block, the export **fails** rather than guessing precedence —
the same no-silent-pick rule as duplicate names. This keeps every schema's
source unambiguous; a power user who needs both a readable table *and* a
constraint the grammar can't express writes the whole schema in Tier B.

### 3. The field-table type grammar (Tier A)

Minimal, closed, table-friendly. The `type` cell accepts:

| `type` cell | JSON Schema |
|---|---|
| `string`, `integer`, `number`, `boolean` | `{ "type": ... }` |
| `<Name>` (matches another `### Name`) | `{ "$ref": "#/components/schemas/Name" }` |
| `<T>[]` (T = any of the above) | `{ "type": "array", "items": <T> }` |
| `enum(a, b, c)` | `{ "type": "string", "enum": [...] }` |

- `required: yes` adds the field to the schema's `required` array.
- `notes` becomes `description` (always non-binding prose). An optional `format`
  column becomes JSON Schema `format` — which is an **optional downstream
  constraint, not guaranteed-inert metadata**: format-aware tooling (ajv with
  formats, `openapi-generator`) *does* enforce values like `email`, `uuid`,
  `date-time` and may narrow generated types. The ADR does not promise `format`
  is never validated; an author writing `format: email` is choosing a constraint
  their generator may apply, and should mean it.
- An unknown `type` value (e.g. `strng`) in a schema that is otherwise Tier A
  **fails the export** (non-zero exit, naming the schema, field, and bad type).
  It must **not** degrade just that one field to an `x-cdd-unresolved` marker:
  extension keywords are ignored by validators and code generators, so a
  per-field marker leaves the property unconstrained while the operation is still
  advertised as Tier A/preventive — the client would accept any value for it.
  Worse, byte-equality `--check` would not catch this, so CI would stay green on
  a silently weakened client. Failing the whole export is the only outcome
  consistent with "Tier A means preventive": a schema is either fully resolvable
  or it is not authored yet (leave the cell prose → Tier C). There is no
  half-preventive Tier A schema.

**Common edge cases, decided explicitly** (so authors know the Tier A/Tier B
line without guessing):

| Need | Tier A answer |
|---|---|
| **Optional vs nullable** | `required: no` means the field *may be absent*. It does **not** make the value `null`. A field that must be present but may hold `null` is a `oneOf`-shaped constraint → **drop to Tier B**. We do not overload the `required` column with two meanings. |
| **Numeric / non-string enums** | `enum(...)` is **string-only** (the 90% case: status strings). A numeric or mixed-type enum → **Tier B**. The grammar stays closed rather than inventing a per-member type syntax in a table cell. |
| **Date / time** | `string` with a `format` note (e.g. `date-time`, `date`) — emitted as JSON Schema `format`. Whether it is *enforced* depends on the consumer's generator (see the `format` note above): format-aware tooling will validate/narrow, format-blind tooling treats it as a hint. Author it only when you mean that constraint; if you need shape beyond a single `format`, → **Tier B**. |

The rule behind all three: Tier A covers objects of scalars, refs, arrays, and
string enums; the moment a field needs `null`-union, non-string enums, or
binding formats, that single schema moves to Tier B. The field table never
grows new columns to chase these — that is the ceiling, by design.

Anything past this grammar (`oneOf`, discriminated unions, deep nesting beyond
named refs, tuple types) is **out of scope for Tier A by design** — that is what
Tier B's raw JSON Schema block is for. We are not rebuilding JSON Schema in
markdown tables; we are covering the 90% object-of-scalars-and-refs case in the
audience's own idiom and providing a clean hatch for the rest.

### 4. What the export changes

- A `components.schemas` map is populated from resolved `### Name` sections.
- A resolvable `request schema` cell emits a real
  `requestBody.content['application/json'].schema = { $ref }` **instead of** the
  `x-cdd-unresolved` placeholder.
- A resolvable `response schema` cell emits
  `responses[code].content['application/json'].schema = { $ref }` (and `User[]`
  → an array wrapper), upgrading today's `x-cdd-response-contract` annotation
  from prose to a typed shape.
- `--check` is unaffected in mechanism: it stays byte-equality of the committed
  artifact against the freshly-generated projection. More of the document is now
  determined by the contract, so the sync gate simply covers more.

Unresolved cells keep emitting exactly the markers they do today, so the
artifact's shape is a **superset** — no existing field is removed or renamed.

## Consequences

**Positive**
- The payload-shape bug class (`wrong/missing field`) becomes a **compile
  error** in the generated client — the strongest, non-heuristic guarantee,
  extended from URLs to bodies.
- Zero forced migration: contracts without a `## Schemas` section are byte-for-
  byte unaffected; the `## Schemas` block is purely additive.
- Authors stay in markdown tables; no one is required to learn OpenAPI.
- The escape hatch keeps complex APIs unblocked without polluting the common
  notation.

**Negative / limits**
- Field-level precision **is** engineering work. This tier targets the engineer
  (or the agent acting on their behalf), not the non-engineer contract author —
  honestly an opt-in enrichment layer, the same status client codegen has. We
  accept this rather than pretend field types can be authored without rigor.
- Two notations now describe a body in some repos (Tier A table for simple,
  Tier B raw for complex). We bound this by making Tier B an explicit fenced
  block, never an inline cell, so the table never becomes a JSON Schema dumping
  ground.
- **Response-body conformance against real code stays out of scope.** Once
  schemas are real, one *could* check that backend response types match the
  contract schema — but that requires per-language type extraction, the exact
  heuristic tail ADR 0001 refused. Generation (preventive) remains the path;
  code-vs-schema conformance is a separate future decision, not this one.
- **Schema-level breaking-change diffing** (adding a required request field is
  breaking) is enabled by this format but **not** built here; it is a follow-up
  that would consume two exported artifacts and apply the contract's existing
  `breaking-change-policy`.

## Scope of the proposed implementation

If accepted, the implementing PR ships:

1. A `## Schemas` parser (`### Name` field sub-tables + Tier B fenced blocks)
   in the export path, behind the existing markdown reader.
2. The Tier A type grammar compiler and `components.schemas` emission.
3. `request schema` / `response schema` cells resolving to `$ref` when defined,
   degrading to each side's existing marker when not (`x-cdd-unresolved` for
   requests, `x-cdd-response-contract` for responses); a duplicate `### Name`,
   a section mixing Tier A + Tier B, or an unknown field type **fails the
   export** (non-zero, no partial artifact).
4. Template + docs: a `## Schemas` stub in `assets/contracts/api/api-contract.md`
   and a worked example in `docs/openapi-export.md`.
5. Tests: resolved object, `[]` array, `enum`, nested `$ref`, Tier B passthrough;
   the **no-migration** cases (undefined name leaves request vs response markers
   exactly as today) proving existing contracts export unchanged; and the
   **fail-fast** cases (unknown type, duplicate name, mixed A+B) proving no
   silently-weakened artifact is ever produced.

It does **not** ship code-vs-schema conformance or schema breaking-change
diffing. Those remain follow-ups, each its own decision.
