# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

<TODO: one-sentence description of what this repo does and who uses it>

## Dev commands

<TODO: fill in install / dev / test / lint / build commands for this project>

## Architecture

<TODO: describe main modules, service boundaries, and entry points>

---

This repository follows the Contract-Driven Delivery workflow.

- `contracts/` is the single source of truth for what the system should do.
- `tests/` proves the contracts hold.
- `specs/changes/<id>/` records why decisions were made (passive archive — read only when investigating history).
- To start any non-trivial change, use `/cdd-new <description>` in Claude Code.

## CDD Kit Commands

| command | when to use |
|---|---|
| `/cdd-new <description>` | start a new tracked change (scaffolds all artifacts, runs full agent flow) |
| `/cdd-resume <id>` | continue an in-progress change after a session break |
| `/cdd-close <id>` | close a completed change: promote learnings, archive |
| `cdd-kit list` | show all active changes and their status |
| `cdd-kit gate <id>` | verify a change is gate-ready (run before PR) |
| `cdd-kit gate <id> --strict` | full gate with pending-task enforcement (pre-commit default) |
| `cdd-kit archive <id>` | physically move a completed change to `specs/archive/<year>/` |
| `cdd-kit abandon <id> --reason <text>` | mark a change as abandoned; preserves directory for git history |
| `cdd-kit migrate <id> \| --all` | upgrade pre-v1.11 change directories to new format (frontmatter + tier format) |
| `cdd-kit validate` | run all contract validators |
| `cdd-kit detect-stack` | detect the project tech stack |

Run `cdd-kit detect-stack` to verify the detected tech stack.

## Context Governance

For context-governed changes, read `specs/changes/<change-id>/context-manifest.md` before using file-reading or broad search tools.

- Read only paths allowed by the manifest or approved expansions.
- If more context is needed, stop and write a Context Expansion Request in the manifest (`cdd-kit context request`).
- The full agent-log format (including `files-read:` schema) is defined in
  `~/.claude/skills/contract-driven-delivery/references/agent-log-protocol.md`.
  Read that once; do not paraphrase it elsewhere.
