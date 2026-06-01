# OpenAPI export

`cdd-kit openapi export` projects `contracts/api/api-contract.md` (the source of
truth) into a minimal **OpenAPI 3.1** skeleton for tooling. The markdown contract
stays authoritative; the OpenAPI document is a one-way, regenerable projection.

See `docs/adr/0001-contract-to-openapi-export.md` and
`docs/adr/0002-schema-carrying-contract-format.md` for the design rationale.

## Usage

```bash
cdd-kit openapi export                          # JSON to stdout
cdd-kit openapi export --yaml                    # YAML to stdout
cdd-kit openapi export --out build/openapi.json  # write to a file
cdd-kit openapi export --yaml --out openapi.yaml
cdd-kit openapi export --contract path/to/api-contract.md
cdd-kit openapi export --check --out build/openapi.json  # sync gate
```

## The sync gate: `--check`

A regenerable artifact is only safe if it is actually regenerated. `--check`
makes that mechanical instead of a habit:

```bash
cdd-kit openapi export --check --out build/openapi.json
```

It does **not** write. It compares the committed artifact at `--out` against what
the contract produces right now and exits:

- `0` - in sync.
- `1` - the artifact is missing, or the contract changed but the export was not
  regenerated. The command prints the exact `openapi export --out ...` command
  to fix it.

Wire it into CI or a pre-commit hook so a contract edit that forgets to
regenerate the export, and therefore the typed client downstream, fails the
build. `--check` honors `--yaml`, so check the same format you committed.

## What it derives

From the endpoint table (`| method | path | auth | request schema | response schema | errors | tests |`):

| Contract column | OpenAPI output |
|---|---|
| `method` + `path` | operation under `paths`, with `:id`/`{id}` normalized to `{id}` |
| path templates | `parameters` (`in: path`, `required: true`, `type: string`) |
| `auth` | `security` (`bearerAuth`) for `required`/`admin`, optional+anonymous for `optional`, none for `none`/`public` |
| `method` | success status: `201` for `POST`, else `200` |
| `errors` | extra response entries for any explicit `4xx`/`5xx` codes listed |
| `response schema` | if it names a schema in `## Schemas`, emitted as response JSON Schema; otherwise recorded as `x-cdd-response-contract` prose |
| `request schema` | if it names a schema in `## Schemas`, emitted as request JSON Schema; otherwise `requestBody` is marked `x-cdd-unresolved: true` |

The exporter does not fabricate field-level schemas. Request/response cells that
do not resolve to a named schema remain prose. The unresolved markers are
deliberate: emitting a fake schema would be a new drift source. Add a
`## Schemas` section when a body shape should become machine-typed.

## Schema-carrying contracts

Add optional `### Name` subsections under `## Schemas`. Existing endpoint table
cells like `CreateUser`, `User`, or `User[]` become references when a matching
schema exists.

```markdown
## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| POST | /api/users | admin | CreateUser | User | 400 | yes |

## Schemas

### CreateUser
| field | type | required | format | notes |
|---|---|---|---|---|
| email | string | yes | email | login identity |
| name | string | yes | | display name |
| role | enum(admin, member) | no | | |

### User
| field | type | required | notes |
|---|---|---|---|
| id | string | yes | |
| email | string | yes | |
```

Field-table types are intentionally small and closed:

| Type cell | Output |
|---|---|
| `string`, `integer`, `number`, `boolean` | primitive JSON Schema |
| `OtherSchema` | `$ref` to another named schema |
| `OtherSchema[]` or `string[]` | array wrapper |
| `enum(active, disabled)` | string enum |

`required: yes` adds the field to JSON Schema `required`. `notes` becomes
`description`. An optional `format` column is emitted as JSON Schema `format`
and may be enforced by downstream tooling.

For complex bodies, use a raw Tier B escape hatch:

````markdown
### Event
```json-schema
{
  "type": "object",
  "oneOf": [
    { "required": ["createdAt"] },
    { "required": ["deletedAt"] }
  ]
}
```
````

The exporter fails instead of weakening types when a schema is ambiguous:
duplicate schema names, a section that mixes a field table and `json-schema`
block, invalid JSON, or an unknown field type all exit non-zero.

## Wiring a typed client in a consumer repo

The kit produces the OpenAPI seam; you generate the client with an existing,
well-maintained generator in your own CI. When a `package.json` is present,
`cdd-kit init` scaffolds this for you as two editable npm scripts:

```jsonc
"scripts": {
  // regenerate the OpenAPI artifact + the typed client
  "contract:client": "cdd-kit openapi export --out contracts/api/openapi.json && npx --yes openapi-typescript contracts/api/openapi.json -o src/api/types.ts",
  // the sync gate - fails if the artifact drifted from the contract
  "contract:client:check": "cdd-kit openapi export --check --out contracts/api/openapi.json"
}
```

These are a starting point, not a hard dependency: the generator
(`openapi-typescript`) and the output path are yours to change. The kit owns the
generic contract-to-OpenAPI half (`openapi export` / `--check`); the
stack-specific codegen stays in your repo, which is why init writes an editable
script rather than hard-coding a tool. Run `npm run contract:client:check` in CI
as the gate.

Doing it by hand instead, for a TypeScript frontend:

```bash
# 1. Export the contract to OpenAPI (committed or generated in CI)
cdd-kit openapi export --yaml --out openapi.yaml

# 2. Generate types with openapi-typescript (or orval / openapi-generator)
npx openapi-typescript openapi.yaml -o src/api/schema.d.ts
```

Now frontend calls typed against `schema.d.ts` make a divergent path, method, or
schema-resolved body shape a compile error. Run both generated clients and
`validate_api_conformance.py`: conformance stays the universal floor for code
that cannot be regenerated, generated types are the stronger path where the
stack allows it.
