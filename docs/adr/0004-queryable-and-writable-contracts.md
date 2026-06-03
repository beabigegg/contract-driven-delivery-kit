# ADR 0004: Queryable and writable contracts (ask-don't-read, set-don't-edit)

- Status: Accepted (design); implementation to follow in separate PRs
- Date: 2026-06-03
- Deciders: maintainer + AI delivery agent
- Relates to: ADR 0001 (Contract → OpenAPI export), ADR 0002 (Schema-carrying
  contract format), ADR 0003 (Code-intelligence indexing strategy). Extends the
  same parser those built; applies ADR 0003's determinism stance to the contract
  layer.
- Touches: `cdd-kit openapi export`, `cdd-kit mcp`, `cdd-kit gate`,
  `cdd-kit doctor` (chokepoints), `contracts/**`.

## Context

The kit's token-efficiency and drift-control moat for **source code** is built:
`cdd-kit code-map`/`graph`/`index` turn code into a machine index addressable by
symbol, and agents *query* a slice (`index query`, `graph query --with-source`)
instead of `Read`-ing whole files (ADR 0003). The **contract layer has no
equivalent**, and that gap now bites on both the read and the write path as
contracts grow:

1. **Read path.** `contracts/api/api-contract.md` and `api-inventory.md` are
   dominated by tables that grow one row per endpoint. To answer a narrow
   question ("what is the contract for `POST /api/orders`?") an agent reads the
   whole file and re-reads it in chunks as it grows. The cost is unbounded in the
   number of endpoints, even though the answer is a single row plus the schemas
   it references.

2. **Write path.** The Claude Code agent harness enforces a **read-before-write
   guard**: its `Edit`/`Write` tools fail unless the file was `Read` earlier in
   the session. So even *appending one endpoint row* forces a full read of the
   contract — re-paying exactly the cost the read path is trying to remove, on
   every contract mutation. And contract mutation is the *common* case: nearly
   every tracked change adds or updates contract rows.

The structure to fix both already exists. **Every contract table is a relation
with a primary key:**

| Contract | Relation / primary key |
|---|---|
| `api-contract.md` → `Endpoint Requirements` | `(method, path)`; `## Schemas` → `### Name` keyed by name |
| `api-inventory.md` | `(method, path)` + `category`, `owner` |
| `business-rules.md` → `Rule Inventory` | `rule id` |
| `data-shape-contract.md` → columns | `column` |
| `env-contract.md` | key (already projected to `env.schema.json`) |

And the parser to read these mechanically **already exists**:
`src/commands/openapi-export.ts` (`parseEndpoints`, `parseContractSchemas`,
`stripFrontmatter`, `parseRow`, `isSeparator`) deterministically turns the API
contract markdown into structured rows + named schemas. It is only ever used to
emit OpenAPI; it has never been pointed at "answer a query" or "apply a keyed
edit." The contracts are already a machine-readable index — they simply lack a
query layer and a write layer.

This ADR decides how to give the contract layer the same *ask, don't read* and a
new *set, don't edit* capability, **without** betraying the constraints the prior
ADRs were careful about (markdown stays the single source of truth; non-engineers
author contracts; determinism over precision-at-any-cost; zero forced migration).

## Decision

### 1. Contracts become queryable by key — `cdd-kit contract query` + an MCP tool

Add a read command `cdd-kit contract query` and an MCP tool `cdd_contract_query`,
shaped exactly like the existing `index query` / `cdd_index_query` pair (same
flags, same `--json`, same wrapper in `src/mcp/server.ts`). An agent asks for a
key and gets back only the matching slice:

- `--endpoint "POST /api/orders"` — exact `(method, path)`; returns that row plus
  the **actual definitions of the schemas it references** (request/response),
  inlined as text. This is the contract analog of `index query --with-source`: a
  true drop-in for opening the file, not a pointer into it.
- `--path /api/orders` (prefix/glob) — every endpoint under a path, across *both*
  `api-contract.md` and `api-inventory.md`.
- `--schema CreateOrder` — that schema's field table / `json-schema` block, plus
  the **reverse index** ("which endpoints reference it").
- column filters — `--auth admin`, `--category legacy-transition`, `--owner …`.
- a free-text term — fuzzy match across rows / schema names / rule ids, reusing
  the `index query` scoring.

An endpoint answer also **names (and optionally inlines) the bounded shared prose
sections** — `Error Format`, `Compatibility Policy`, `Breaking Change Policy` —
so routing through the query never hides the non-tabular parts of the contract.

**Deliberate divergence from the code-map design: query parses the markdown live
on every call; there is NO compiled `.cdd/contract-index.*` artifact and no
freshness machinery.** The code index needs a cached, digest-checked artifact
because source is large and the index is *derived*. Contracts are the opposite:
small, and themselves the source of truth. Parsing them per call is trivially
cheap and buys three things a cached artifact would cost us — **zero staleness,
zero drift, and zero added gate burden** (nothing to keep in sync, nothing that
can disagree with the file). For a kit whose purpose is to *constrain* drift,
"there is no intermediate layer that can fall out of step" is a feature, not a
compromise. (If cross-contract graph or expensive derived facts are ever wanted,
a compiled artifact can be layered on later, the way `graph` layered on
`code-map` — see Revisit.)

### 2. Keyed structured query, NOT embeddings / semantic RAG

The query is **mechanical and deterministic**: same key → same byte-identical
slice, by table lookup and reference resolution. We explicitly reject a vector /
embedding index over contract prose. It would be "smarter" but non-deterministic
(same question can return different slices, letting an agent selectively quote),
which is the exact trade ADR 0003 already refused for code intelligence
("determinism over precision-at-any-cost"). A contract chokepoint must return the
*same* answer every time, or it is not a chokepoint.

### 3. Contracts become writable by key — `cdd-kit contract set`

Add a mutation command `cdd-kit contract set` with keyed sub-forms, e.g.:

```
cdd-kit contract endpoint set --method POST --path /api/orders \
  --auth admin --request CreateOrder --response Order --errors 400 --tests yes

cdd-kit contract schema set CreateOrder \
  --field "email:string:yes:email:login identity" --field "name:string:yes"
```

The command, in-process:

1. reads the file itself and parses it with the shared parser (§4);
2. **upserts by primary key** — an existing `(method, path)` updates only the
   named cells; a new key appends a row; a `### Name` schema section is inserted
   or replaced;
3. validates structurally — valid method, `path` starts with `/`, **no duplicate
   primary key**, and any referenced schema resolves in `## Schemas` (reusing the
   export's compile rules);
4. **re-serializes only the affected table block** with deterministic, single-
   space-padded cells, leaving every other line byte-identical; optionally bumps
   frontmatter `last-changed`;
5. returns a small confirmation (`upserted POST /api/orders; 1 row changed`) — the
   agent never reads the whole file.

**Why this escapes the read-before-write guard (and why that is legitimate):**
the guard is enforced by the agent harness against *its own* `Edit`/`Write`
tools. A `cdd-kit` subprocess performs ordinary `readFileSync`/`writeFileSync`
and is not subject to it — exactly as `cdd-kit code-map`, `openapi export --out`,
and `cdd-kit new` already write files the agent never read. Routing contract
mutation through the CLI is the same established pattern, not a workaround.

**This is a stronger constraint than the read side, not just a faster path.**
Today an agent edits a contract with a free-form `Edit`: it can re-align or drop a
column, write a row that does not validate, or silently touch a neighbouring row.
Once mutation goes through `contract set`, every change is **structurally valid by
construction** and touches **only the key it names** — the agent loses the ability
to free-form-edit the contract at all. That is the point.

We accept a one-time, bounded cost: the first `set` that touches a hand-aligned
table re-emits that table with normalized padding (a one-off diff); thereafter it
is stable and diffable, consistent with ADR 0003's "byte-identical, diffable"
value for generated artifacts.

### 4. One shared contract parser; export / query / set all consume it

Extract the parsing core currently embedded in `openapi-export.ts` into a shared
module (working name `src/contracts/parser.ts`). It becomes the single way the kit
reads a contract; three consumers project from it:

- `openapi export` → an OpenAPI document (unchanged behaviour);
- `contract query` → a query answer (a slice);
- `contract set` → parse → mutate → re-serialize.

The extraction must be behaviour-preserving for export — the existing
`openapi-export` tests are the guard that it is.

### 5. The gate gains a substantive contract check

Today `cdd-kit gate` checks bookkeeping (required artifacts, stub length,
placeholders, tier consistency) and runs the contract *validators*, but it cannot
assert that the contract actually *says what the change claims* — the known
"gate passes placeholders / self-reported done" weakness. The query + set layer is
the missing substrate: because contracts are now machine-valid by construction and
queryable by key, the gate can make **substantive, mechanical assertions**, e.g.:

- an endpoint the change claims to add/modify **resolves** to a contract row;
- an endpoint row's `tests` cell is non-empty (no row claims coverage it lacks);
- every `request`/`response` cell that names a schema **resolves** to a defined
  `### Name`;
- (extensible) inventory category / owner present for non-standard surfaces.

This ADR fixes the *direction* (gate asserts contract substance via the shared
parser), not the full rule set; the exact assertions are an implementation
decision tuned to avoid false positives on legitimately-prose Tier C cells (per
ADR 0002's no-migration guarantee).

### 6. Two-stage enforcement — the write-side analog of the graph-first hook

Enforcement is rolled out in two stages so it never bricks an agent before the
machinery is proven:

- **Stage 1 — advisory (ships first).** `contract set` exists as the faster, safer
  path; agent guidance says to prefer it; `cdd-kit doctor` gains a chokepoint
  probe reporting the contract-query/contract-write surfaces as `live`/`dormant`
  (matching the existing chokepoint dashboard in `src/commands/chokepoints.ts`).
  Nothing is blocked.
- **Stage 2 — hard (after query + set + gate are proven green).** Arm an opt-in
  PreToolUse hook that blocks the agent's `Edit`/`Write` on `contracts/**` and
  routes it to `cdd-kit contract set` — the contract-write analog of the
  `pre-tool-use-graph-first` hook. It gates only the *agent's* tools; a human
  editing a contract in their editor is unaffected, and `contract set` remains
  available to humans who want validated edits.

**MCP stays read-only for now.** Mutation ships as a CLI command the agent invokes
via Bash (visible, permission-gated like any command); we do **not** add a
mutating `cdd_contract_set` MCP tool in this work, keeping all six existing MCP
tools read-only. A mutating MCP tool can be added later if the ergonomics warrant
it.

### 7. Generalize across surfaces, API first

The query/set/gate backbone is identical for every keyed contract — business
rules (`rule id`), data columns (`column`), env (already projected to
`env.schema.json`). Adoption is incremental, mirroring ADR 0002's per-schema
rollout: ship the API surface first (the largest pain), then extend the same
commands to the other contracts. The command grammar is designed surface-generic
from the start so later surfaces add a parser adapter, not a new command.

## Consequences

**Positive**

- An agent answers a contract question, and applies a contract change, by **key**
  — both costs become O(the row), not O(the file). The write path stops re-paying
  the full-read cost the read path removes.
- Two new mechanical chokepoints: a **read** chokepoint (deterministic slice the
  agent cannot selectively quote) and a **write** chokepoint (mutation is valid by
  construction and cannot touch un-named rows) — the latter strictly stronger than
  read-only query.
- The gate gets, for the first time, a substrate for **substantive** contract
  assertions, directly addressing the placeholder/self-report weakness.
- Contract handling unifies around one parser; `openapi export` becomes one of
  three consumers rather than the sole owner of contract parsing.
- No new derived artifact and no freshness machinery → **nothing new can drift**.

**Negative / limits**

- `contract set`'s first touch of a hand-aligned table normalizes its padding
  (one-time diff). Accepted, and bounded to the touched table block.
- Parse-on-demand correctness now depends on the shared parser being a faithful
  extraction of today's export parser. The export tests are the guard; the
  extraction PR must not change export output.
- The substantive gate check must be conservative: a Tier C prose cell (ADR 0002)
  that names no schema is **not** a violation. Over-strict assertions would break
  the no-migration guarantee, so the rule set starts minimal and grows.
- Stage 2's hard hook can block an agent if some rare contract mutation has no
  `contract set` form yet. Mitigated by shipping Stage 2 only after the command
  covers the real mutation set, and by keeping it opt-in.
- Source/asset duplication caveat (as in ADR 0002): edits land in the **source**
  trees (`contracts/`, `src/`, `.claude/skills/...`); `build.js` regenerates
  `assets/**` via `copy('contracts','assets/contracts')` etc. New commands, the
  parser, templates, and any hook must be authored in source, never in `assets/`.

**Revisit when**

- Cross-contract relationships (an endpoint → the business rules and data shapes
  it touches) or expensive derived facts (e.g. "endpoints with no contract test"
  computed repo-wide) are wanted at scale — then a compiled `contract-index`
  artifact with a freshness digest, layered the way `graph` layered on `code-map`,
  becomes justified. It is explicitly **not** needed for the ask/set wins here.
- A mutating MCP tool proves ergonomically worth the shift away from a read-only
  MCP surface.

## Scope of the proposed implementation

If accepted, the work ships in sequenced PRs (each its own decision where noted):

1. **Shared parser extraction.** Move the contract-parsing core out of
   `openapi-export.ts` into `src/contracts/parser.ts`; `openapi export` consumes
   it unchanged. Guard: existing export tests stay green.
2. **`cdd-kit contract query` + `cdd_contract_query` MCP tool.** Read-only;
   selectors of §1; `--json` and inline-slice output; tests modelled on
   `test/cli/openapi-export.test.ts`; a `doctor` chokepoint probe (dormant/live).
3. **`cdd-kit contract set`.** Endpoint + schema upsert first; structural
   validation; affected-block-only re-serialization; tests proving upsert,
   no-duplicate-key, unresolved-ref rejection, and byte-identical untouched lines.
4. **Gate substantive contract check (§5).** Minimal, conservative rule set wired
   into `cdd-kit gate`; tests including the Tier C no-false-positive cases.
5. **Stage 2 hard hook (separate, later).** PreToolUse block on agent
   `Edit`/`Write` of `contracts/**`, routing to `contract set`; armed opt-in,
   reported by `doctor`.

Non-goals for this work: a compiled contract-index artifact; a mutating MCP tool;
extending set/query to business/data/env surfaces beyond API (follow-ups, §7);
cross-contract graph and repo-wide derived facts.
