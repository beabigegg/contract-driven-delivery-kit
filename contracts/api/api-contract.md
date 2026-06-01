---
contract: api
summary: API behavior, compatibility rules, and endpoint contract requirements.
owner: application-team
surface: api
schema-version: 0.1.0
last-changed: 2026-04-27
breaking-change-policy: deprecate-2-minors
---

# API Contract

## API Style
- response style:
- error style:
- auth style:
- pagination style:
- date/time style:

## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|

## Schemas

<!--
Optional. Add named schemas here when request/response bodies should become
machine-typed in `cdd-kit openapi export`. Reference a schema by name in the
endpoint table's "request schema" / "response schema" cell (use `Name[]` for an
array). A schema is defined ONE of two ways — never both:

Tier A — a field table (preferred; readable, diffable):

### ExampleRequest
| field | type | required | format | notes |
|---|---|---|---|---|
| email | string | yes | email | login identity |
| status | enum(active, disabled) | no | | lifecycle state |
| owner | ExampleUser | no | | reference another schema by name |

Tier B — a raw JSON Schema, for shapes Tier A can't express (oneOf, etc.).
The fence MUST be tagged `json-schema` (NOT `json`) or export fails fast:

### ExampleEvent
```json-schema
{ "type": "object", "oneOf": [ { "required": ["createdAt"] }, { "required": ["deletedAt"] } ] }
```
-->

## Error Format

## Compatibility Policy

## Endpoint Inventory Policy

## Breaking Change Policy
