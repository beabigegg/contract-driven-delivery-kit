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

Run `cdd-kit detect-stack` to verify the detected tech stack.
