# API Contract Standard

## Required API style decision

Every repository must define its API response style. Acceptable styles include:

- envelope response, for example `{ success, data, error, meta }`
- direct resource response with standardized error envelope
- framework-native response with documented exception mapping

The style may vary by repo, but it must be explicit.

## Required for every endpoint

- method and path
- auth and permission requirement
- request params/body schema
- response schema
- error response format
- status codes
- pagination/sorting/filtering behavior
- date/time format and timezone
- null and empty behavior
- compatibility notes
- frontend client/type impact
- test coverage

## Response-body shape & the data-shape gate (ADR 0007)

A `response schema` cell written as a **prose label** (`success_response`, `UserList`) documents nothing a machine can check — the route gate verifies method+path only, so the body can drift freely. To make the body **enforced**, declare it as a typed schema and let the gate check real responses against it:

1. **Declare a typed schema** under `## Schemas`: a `| field | type | required |` table (Tier A — primitives, `enum(...)`, schema refs, `[]`) or a fenced ` ```json-schema ` block (Tier B — needed for nested objects / arrays of objects). Point the endpoint's `response schema` cell at that schema name.
2. **Generate the projection**: `cdd-kit openapi export --out contracts/api/openapi.json` (the language-neutral artifact both sides consume).
3. **Capture a sample + enforce**: add the endpoint to `tests/contract/response-samples.json` with a captured real response (see `tests/contract/README.md`). `cdd-kit validate --contracts` (and the gate) then validate the body via `validate_response_shape.py`.
4. **Generate, don't hand-write, the consumer types**: FE via `npm run contract:client` (openapi-typescript); FastAPI backend via `npm run contract:models` (datamodel-codegen → Pydantic `response_model`, which self-enforces at runtime).

Adoption is **incremental and opt-in by the manifest** — endpoints left as prose are not blocked. `cdd-kit doctor` reports the coverage gap (typed vs prose, manifest present) so the migration is visible. Prioritize the highest-traffic / most-integration-critical endpoints first.

## Endpoint inventory

Repos should maintain an endpoint inventory. Any endpoint added, removed, renamed, moved, or exempted must update the inventory in the same change.

## Breaking changes

Breaking changes include:

- field removal or rename
- type change
- enum value change
- status code behavior change
- pagination behavior change
- error format change
- auth/permission change
- timing semantics change that clients depend on

Every breaking change requires migration/compatibility plan and explicit QA sign-off.

## API tests

Minimum API change coverage:

- contract test for response/error format
- validation test for invalid input
- compatibility test for existing clients when relevant
- malicious/fuzz payload test for user-controlled inputs
- smoke/E2E path if user-visible
