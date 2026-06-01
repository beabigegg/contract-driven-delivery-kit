# OpenAPI export

`cdd-kit openapi export` projects `contracts/api/api-contract.md` (the source of
truth) into a minimal **OpenAPI 3.1** skeleton for tooling. The markdown contract
stays authoritative; the OpenAPI document is a one-way, regenerable projection.

See `docs/adr/0001-contract-to-openapi-export.md` for the design rationale and
why per-stack client generation is intentionally left to the consumer repo.

## Usage

```bash
cdd-kit openapi export                          # JSON to stdout
cdd-kit openapi export --yaml                    # YAML to stdout
cdd-kit openapi export --out build/openapi.json  # write to a file
cdd-kit openapi export --yaml --out openapi.yaml
cdd-kit openapi export --contract path/to/api-contract.md
cdd-kit openapi export --check --out build/openapi.json  # sync gate (see below)
```

## The sync gate: `--check`

A regenerable artifact is only safe if it is actually regenerated. `--check`
makes that mechanical instead of a habit:

```bash
cdd-kit openapi export --check --out build/openapi.json
```

It does **not** write. It compares the committed artifact at `--out` against what
the contract produces right now and exits:

- `0` — in sync.
- `1` — the artifact is missing, or the contract changed but the export was not
  regenerated (it prints the exact `openapi export --out …` command to fix it).

Wire it into CI (or a pre-commit hook) so a contract edit that forgets to
regenerate the export — and therefore the typed client downstream — fails the
build. `--check` honors `--yaml`, so check the same format you committed.

## What it derives (and what it doesn't)

From the endpoint table (`| method | path | auth | request schema | response schema | errors | tests |`):

| Contract column | OpenAPI output |
|---|---|
| `method` + `path` | operation under `paths`, with `:id`/`{id}` normalized to `{id}` |
| path templates | `parameters` (`in: path`, `required: true`, `type: string`) |
| `auth` | `security` (`bearerAuth`) for `required`/`admin`, optional+anonymous for `optional`, none for `none`/`public` |
| `method` | success status: `201` for `POST`, else `200` |
| `errors` | extra response entries for any explicit `4xx`/`5xx` codes listed |
| `response schema` | recorded as `x-cdd-response-contract` (prose, not a JSON Schema) |
| `request schema` | `requestBody` marked `x-cdd-unresolved: true` |

**It does not fabricate field-level schemas.** Request/response bodies are
free-form prose in the contract today (e.g. `User`, `CreateOrder`), so the export
records the contract's wording and flags it unresolved rather than inventing
`properties`. This is deliberate — emitting a fake schema would be a new drift
source. Fill bodies in either the consumer generator config or a future
schema-carrying contract format.

## Wiring a typed client in a consumer repo

The kit produces the OpenAPI seam; you generate the client with an existing,
well-maintained generator in your own CI. When a `package.json` is present,
`cdd-kit init` scaffolds this for you as two editable npm scripts:

```jsonc
"scripts": {
  // regenerate the OpenAPI artifact + the typed client
  "contract:client": "cdd-kit openapi export --out contracts/api/openapi.json && npx --yes openapi-typescript contracts/api/openapi.json -o src/api/types.ts",
  // the sync gate — fails if the artifact drifted from the contract
  "contract:client:check": "cdd-kit openapi export --check --out contracts/api/openapi.json"
}
```

These are a starting point, not a hard dependency: the generator
(`openapi-typescript`) and the output path are yours to change. The kit owns the
generic contract→OpenAPI half (`openapi export` / `--check`); the stack-specific
codegen stays in your repo, which is why init writes an *editable* script rather
than hard-coding a tool. Run `npm run contract:client:check` in CI as the gate.

Doing it by hand instead, for a TypeScript frontend:

```bash
# 1. Export the contract to OpenAPI (committed or generated in CI)
cdd-kit openapi export --yaml --out openapi.yaml

# 2. Generate types with openapi-typescript (or orval / openapi-generator)
npx openapi-typescript openapi.yaml -o src/api/schema.d.ts
```

Now frontend calls typed against `schema.d.ts` make a divergent path or method a
**compile error** — the preventive complement to the detective
`validate_api_conformance.py` check. Run both: conformance as the universal floor
for code that can't be regenerated, generated types where the stack allows it.

Because request/response bodies are unresolved, the generated types cover paths,
params, and status codes but not body shapes until the contract carries schemas.
That is the honest current boundary.
