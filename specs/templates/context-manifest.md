# Context Manifest

This manifest defines the approved context boundaries for agents working on this change.

## Affected Surfaces
-

## Allowed Paths
- specs/changes/<change-id>/

## Forbidden Paths
- .claude/worktrees/**
- .git/**
- node_modules/**
- dist/**
- build/**
- assets/**
- specs/archive/**
- specs/changes/* except specs/changes/<change-id>/

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
Agents must request context expansion instead of reading outside their work packet.
Use this format only for real requests:

- request-id: CER-001
  requested_paths:
    - src/example.ts
  reason: why this file is required
  status: pending
-->

## Approved Expansions
-
