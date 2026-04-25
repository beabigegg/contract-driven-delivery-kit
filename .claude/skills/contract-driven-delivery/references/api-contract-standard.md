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
