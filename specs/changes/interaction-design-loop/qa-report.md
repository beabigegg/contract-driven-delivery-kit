# QA Report — interaction-design-loop

## Decision

**approved-with-risk**

Created because `qa-reviewer` returned `approved-with-risk` on an authority-bearing,
system-wide change, per the artifact opt-in policy. `change-classification.md`
marked `qa-report.md` as `no`; the reviewer's verdict promotes it.

## Scope actually delivered

The change grew beyond its original classification. All three expansions were
approved by the maintainer in-session and are recorded in `change-request.md`:

| # | Expansion | Trigger |
|---|---|---|
| 1 | Make `cdd-kit gate` actually run in CI (both workflow files + `init.ts` version pinning) | `ci-cd-gatekeeper` found the contract's `pull_request` trigger claim was false |
| 2 | Implement the `rules[]` binding scan in `--strict` | `backend-engineer` found `gate-acceptance.ts` never mentions `rules` although the contract and ADR 0010 §4 both require the check |
| 3 | Fix `cdd-kit abandon` + teach `validate_spec_traceability.py` about `status: abandoned` | `abandon` reported success while writing nothing; `validate` has no concept of an abandoned change |

Plus one regression fix not in any plan: both shipped acceptance-driver loaders
hardcoded `specs/changes/<id>/`, so **every acceptance driver silently broke the
moment its change was archived**. Introduced by this repo's own archive commit
`05fcc0b`; found because `full` surfaced it.

## Evidence Verified

`qa-reviewer` re-ran the gates and tests rather than trusting the agent reports,
and audited each claim to `file:line`. Confirmed:

| claim | verdict | evidence |
|---|---|---|
| AC-1..AC-10 all have real passing evidence | confirmed | `test-evidence.yml` 5/5 phases; driver + unit + contract tests |
| `isNewChange` is threaded, never re-derived (top risk) | **refuted as a risk** | `gate.ts:94` computes once via `isContextGovernedChange`; `gate.ts:184` threads it; `gate-design.ts:258-266` accepts it; no local re-derivation |
| `findUnboundRules` reuses the two anti-false-positive guards | confirmed | `mock-of-sut-scan.ts:320-335` composes `driverBelongsToChange` + `isWordBoundaryOccurrence` |
| Never-Gated invariant holds in shipped code | confirmed | no aesthetic/motion/layout/latency logic in `gate-design.ts` or `design-provenance.ts`; both reviewer prompts forbid such findings; driver test feeds colour/shadow/animation/emoji prose through the real gate and it passes |
| over-fetch advisory is not computed by `gate` | confirmed | `gate-design.ts:336-342`; `reconcileProvenance` returns HARD failures only |
| `design confirm` is the sole lock writer; both forbidden lists agree | confirmed | `design.ts:23-62`; `.cdd/context-policy.json:12` and `context.ts:43` |
| tamper message exact | confirmed | `gate-design.ts:359` |
| the contract's `pull_request` trigger claim is now TRUE | confirmed | both workflows diff-derive the change id and invoke the gate; `fetch-depth: 0`; no `continue-on-error`; no `doctor` step; this repo builds from source, adopters pin `@{{cdd-kit-version}}` |
| `assets/` never hand-edited | confirmed | gitignored, generation-only |

## Findings

### Defects in this change
None. All nine adversarial claims held.

### Pre-existing, but activated by this change — HIGH (resolved)
`cdd-kit validate` failed on `specs/changes/yaml-migration-plan/` (missing five
required artifacts). Verified pre-existing: sole commit `a6b624f` (2026-04-30),
git-clean vs HEAD, reproduces with this change stashed out.

Because this change wires `validate` into CI with no `continue-on-error`, the
first CI run after merge would have been red on a dormant directory regardless of
PR contents — the exact "fails closed on something it shouldn't" outcome.

The directory's `plan.md` still reads `status: ready-to-execute`, while
`a6b624f`'s own title is `feat: migrate tasks and agent logs to structured yaml`
— the work shipped and the directory was left behind. Maintainer chose
`cdd-kit abandon` over backfilling five retroactive artifacts. Executing that
choice exposed Scope expansion 3: the command reported success while writing
nothing, and the validator never understood `abandoned` at all.

Resolved in this change. `validate` now exits 0.

### Process drift — recorded, not laundered
Three read-scope events, all in `context-manifest.md` § Recorded Context Violations:

1. `contract-reviewer` read `contracts/api/error-format.md` before filing a CER.
   **Retroactively approved (CER-001)** — the read produced the change's single
   most important finding (the `errors` column holds bare HTTP integers, not
   semantic error codes; ADR 0012 §2 row 3 was factually wrong).
2. `ci-cd-gatekeeper` read `specs/archive/**`, which `.cdd/context-policy.json`
   forbids and CLAUDE.md explicitly bars as planning input. **Not approved.** The
   conclusion it supported was independently re-verified from admissible evidence
   (`.github/workflows/contract-driven-gates.yml` has no `cdd-kit gate`;
   `.git/hooks/pre-commit:17` is the only caller).
3. `backend-engineer` (batch 6) made three inadvertent reads, recorded them
   honestly, filed **CER-002**, and **stopped rather than self-approving**. The
   maintainer approved it. This is the only agent in the run that used the
   mechanism as designed.

**Standing observation for `/cdd-close`:** across this run, two of three read-only
agents crossed the read boundary and nothing stopped either. Read-scope governance
is a post-hoc audit, not a prevention mechanism — structurally the same property
ADR 0008 records for agent logs. Candidate durable lesson.

## Residual Risk

1. **`github-workflows/` vs `.github/workflows/` divergence** now runs deeper (one
   pins a published version, the other builds from source) with no drift check.
   MEDIUM. Owner: follow-up change.
2. **tier-floor scanner matches keywords inside negations.** This change's own
   `gate --strict` reports `matched: auth, endpoint, index, migration, payment`
   solely because `change-request.md` says there is *no* auth and *no* payment
   surface. LOW — the failure direction is fail-safe, and `tier-floor-override`
   demands a substantive reason recorded in `agent-log/audit.yml`. Maintainer
   deliberately deferred it: making the scanner cleverer risks letting a real auth
   change escape. Owner: follow-up change. Noted as the same context-blindness
   ADR 0012 § Never Gated condemns, living inside the kit itself.
3. **Semantic error-code join deferred** (ADR 0012 § Out of scope). A non-2xx JSON
   error body carrying `{"error_code": ...}` has no typed-schema mechanism; the
   `openapi.json` projection resolves the success response only. LOW. Owner: future ADR.
4. **The oracle's irreducible weakness, restated.** A lazy-but-well-formed
   `## Confirmed` block buys nothing, and no mechanism detects it. Same as ADR 0010.

## Follow-ups

| item | owner | evidence |
|---|---|---|
| drift check between `github-workflows/` and `.github/workflows/` | follow-up change | `change-request.md` § Deferred follow-ups |
| tier-floor negation-aware scanning | follow-up change | `gate --strict` output; `src/utils/tier-floor.ts` |
| semantic error-code join | future ADR | ADR 0012 § Out of scope |
| read-scope prevention vs post-hoc audit | `/cdd-close` promotion decision | `context-manifest.md` § Recorded Context Violations |

## Gate Results

- `node dist/cli/index.js gate interaction-design-loop` — passed
- `node dist/cli/index.js validate` — passed (after Scope expansion 3)
- `npx vitest run` — 0 failed
- `test-evidence.yml` — `collect`, `targeted`, `changed-area`, `contract`,
  `acceptance` all recorded `passed`, generated by `cdd-kit test run`, no waivers

Second sign-off by `spec-architect` recommended by the reviewer for an
authority-bearing high-risk change; ADR 0012 was authored by `spec-architect` and
amended by it after `contract-reviewer`'s factual correction, which the maintainer
accepted as that sign-off.
