# Context Manifest

This manifest defines the approved context boundaries for agents working on
this change. The forbidden-paths baseline lives in `.cdd/context-policy.json`
and is automatically applied by `cdd-kit gate` — do not duplicate it here.

## Affected Surfaces
-

## Allowed Paths
- specs/changes/<change-id>/
- specs/context/project-map.md
- specs/context/contracts-index.md

## Required Contracts
-

## Required Tests
-

## Agent Work Packets

### change-classifier
- allowed:
  - specs/changes/<change-id>/
  - specs/context/project-map.md
  - specs/context/contracts-index.md

## Context Expansion Requests

<!--
Agents must request context expansion instead of reading outside their work
packet. Format example for real requests:

- request-id: CER-001
  requested_paths:
    - src/example.ts
  reason: why this file is required
  status: pending
-->
-

## Approved Expansions
-
