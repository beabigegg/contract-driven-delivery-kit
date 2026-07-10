---
contract: env
summary: Environment variable inventory, secret handling, and deployment sync policy.
owner: platform-team
surface: runtime-config
schema-version: 0.4.0
last-changed: 2026-07-10
breaking-change-policy: deprecate-2-minors
---

# Env Contract

| name | scope | environments | required | secret | default | example | owner | validation | restart required | failure behavior |
|---|---|---|---:|---:|---|---|---|---|---:|---|
| `CI` | cli (`cdd-kit gate`) | any CI runner | no | no | unset | `true` | platform-team | set by the CI provider; read, never written by this kit. Truthy = set, non-empty, and not `0`/`false` | no | When truthy, `enforceConfirmationHookInstallation` hard-fails on stderr instead of warning (`contracts/ci/ci-gate-contract.md`, `ci-or-strict`). No other check reads it. Unset locally = advisory warning. |
| `CDD_ACCEPTANCE_WRITE_STRICT` | cli (agent PreToolUse hook) | local (Claude Code / agent session) | no | no | `0` | `1` | platform-team | **DEPRECATED** (env 0.3.0) — accepted and ignored | no | No effect. `pre-tool-use-acceptance-write.sh` no longer consults it: it blocks a direct `Write`/`Edit`/`MultiEdit` of `.cdd/acceptance-lock.json` unconditionally, and always allows `acceptance.yml`'s body. Retained for this contract's `deprecate-2-minors` window (removal at env >= 0.5.0), then deleted. |

## `CI`: read, not set

Added in env 0.4.0 (`enforce-human-confirmation`, Decision 2 as amended). The kit
never sets `CI`; it only reads what the provider set. The alternative considered and
rejected was an explicit `--require-hooks` flag added to the workflow's gate step.
A flag is a guarantee that has to be remembered — this repository has shipped four
such guarantees that were never wired up. `CI` is set unconditionally by every
mainstream provider, so the check arms itself.

A local run that wants CI behaviour uses `--strict`, not a hand-set `CI=1`.

## Deprecated: the `*_WRITE_STRICT` toggle

`CDD_ACCEPTANCE_WRITE_STRICT` is deprecated as of env 0.3.0
(`enforce-human-confirmation`, Decision 1). The PreToolUse hook payload carries no
agent identity, so a global strict/advisory switch could only block every writer —
including main Claude's sanctioned transcription of the human's answers — or block
nobody, which was its default. It admitted no working configuration. The hooks now
discriminate on the write TARGET PATH instead; see
`contracts/ci/ci-gate-contract.md` `### Write-block hook discrimination axis`.

`CDD_DESIGN_WRITE_STRICT` is deliberately **not** added to the table above. It was
read by `pre-tool-use-design-write.sh` yet never documented here — a real gap — but
the same change retires the axis it controlled, so documenting it now would be to
document it and deprecate it in one breath. This paragraph exists so a later
maintainer who notices the gap does not "fix" it by adding a row for a variable that
does nothing.

## Public Frontend Env Policy

Variables such as `VITE_`, `NEXT_PUBLIC_`, and `PUBLIC_` are browser-exposed. Never store secrets in them.

## Secret Policy

## Deployment Sync Policy
