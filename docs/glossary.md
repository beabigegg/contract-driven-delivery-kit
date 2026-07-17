# Glossary

cdd-kit uses a small private vocabulary. Each term below is precise, not
decorative — `bone` means "a protection you may not disable without a recorded
reason", which no ordinary word says as briefly. The cost of a precise private
term is one lookup; this page is that lookup.

The **authority** column is where the term is actually defined and where its
behaviour is specified. If this page and the authority ever disagree, the
authority wins and this page is the bug.

## Terms

| term | what it means | authority |
|---|---|---|
| **acceptance oracle** | The human-authored answer key for a change: concrete inputs and the expected results, written in business language before the code. `acceptance.yml`. The one artifact an agent may draft but never sign off. | [ADR 0010](adr/0010-acceptance-oracle.md) |
| **agent-log** | A short optional note an agent leaves under `specs/changes/<id>/agent-log/`. Post-hoc audit, never prevention — which is why a missing one warns and never fails. | [ADR 0008](adr/0008-required-agent-evidence.md) |
| **applicability marker** | `applicability: not-applicable` plus a mandatory non-empty reason, declaring a contract or artifact genuinely does not apply to this change. A bare skip with no reason is always a hard failure. | [ADR 0011](adr/0011-not-applicable-contract-marker.md) |
| **Boundary Guard** | The check that every changed API-looking file maps to a declared boundary operation, so an impact nobody declared cannot pass unnoticed. | [boundary-guard.md](boundary-guard.md) |
| **bucket 1 / 2 / 3** | The three dispositions of any file during an upgrade: **1 keep** (adopter ground truth, never overwritten), **2 replace** (kit-managed and regenerable, force-refreshed with a backup), **3 reconcile** (needs a typed migration, never a blind copy). | [upgrade-reconciliation-contract.md](../contracts/upgrade/upgrade-reconciliation-contract.md) |
| **capsule** | The runtime record of one `cdd-kit work` run: the profile, the evidence it requires, and what has been satisfied. | [ADR 0013](adr/0013-agent-native-delivery-runtime.md) |
| **chokepoint** | A single place every instance of an operation must pass through, so the rule is enforced by the structure rather than by each caller remembering. `cdd-kit init` "arms" them; `cdd-kit doctor` reports dormant ones. Two exist today: the graph-first read hook and the pre-commit gate. A third governs upgrade writes ([ADR 0014](adr/0014-reconciliation-framework-write-guard.md)). | [install-hooks](../src/commands/install-hooks.ts), [chokepoints](../src/commands/chokepoints.ts) |
| **context-governance** | The `tasks.yml` frontmatter key that decides which artifact set a change is held to. `v2` (current) requires `change-request.md`, `implementation-plan.md`, `tasks.yml`, `context-manifest.md`. `v1` requires those plus `change-classification.md`, `test-plan.md`, `ci-gates.md`. A v1 directory keeps the v1 shape and the v1 checks forever — it is never migrated. | [gate-artifacts.ts](../src/commands/gate-artifacts.ts) `REQUIRED_FILES_V1` |
| **discriminator** | How the *contract* — not the code — tells one screen state apart from another. Two states with different meanings may never cite the same discriminator. | [interaction-design-guide.md](interaction-design-guide.md) |
| **fat / bone / knob** | The three kinds of thing a harness contains. **Fat**: removable with no loss. **Bone**: a protection you may not disable without a recorded, reviewed reason. **Knob**: legitimately tunable. Disabling a bone requires a `loosening` entry or the audit fails. | [loosening-the-harness.md](loosening-the-harness.md) |
| **hash-lock** | A recorded hash of what a human confirmed, so a later edit is detectable. Applies to `acceptance.yml` and `interaction-design.md`. Editing after locking fails the gate on purpose: re-confirm, never silently trust. | [ADR 0010](adr/0010-acceptance-oracle.md), [ADR 0012](adr/0012-interaction-design-loop.md) |
| **lane** | `feature` or `bug-fix`. Set `lane: bug-fix` in `tasks.yml`'s `classification:` block to arm bug-fix evidence enforcement (reproduction, root cause, regression test). | [ADR 0006](adr/0006-bug-fix-lane-for-symptom-driven-repair.md) |
| **loosening** | A deliberate, recorded decision to disable a bone protection: an id plus a real reason in `.cdd/policy.yml`. Present → the audit warns. Absent → the audit fails. The point is that loosening becomes visible, not impossible. | [loosening-the-harness.md](loosening-the-harness.md) |
| **mutation-red** | The only evidence a test is worth anything: break the thing on purpose and watch that test turn red. A green suite proves nothing about a check nobody has tried to defeat. | [loosening-the-harness.md](loosening-the-harness.md) |
| **provenance** | Where a piece of information on a screen actually comes from, cited in one of five exact forms. If nothing in the contracts can back up what a screen shows, the backend contract needs to grow before the screen can honestly promise it. | [interaction-design-guide.md](interaction-design-guide.md) |
| **shadow_mode** | A gate that reports but does not block. The safe default for anything newly added, so upgrading never newly blocks an adopter who never configured it. | [boundary-guard.md](boundary-guard.md) |
| **tier** | How much process a change earns, 0 (most) to 5 (least). Lives in `tasks.yml`'s top-level `tier:`. | [tier-policy.json](../.cdd/tier-policy.json) |
| **tier floor** | The minimum tier a change may declare, forced by what it touches — a migration cannot be filed as tier 5. An override needs a recorded reason. | [ADR 0013](adr/0013-agent-native-delivery-runtime.md) |
| **vacuous test** | A test that passes whether or not the behaviour it names is present. In gate tests the exit code is usually the culprit: assert the stream (`log.warn` → stdout, `log.error` → stderr), not that the command exited non-zero. | [loosening-the-harness.md](loosening-the-harness.md) |

## Words that are not terms

These read like vocabulary and are not. They carry no definition and nothing
enforces them — they are writing habit, and they cost a reader the lookup that
this page exists to prevent. Prefer the plain word.

| avoid | say instead |
|---|---|
| linchpin | the check that would fail first, or just name the check |
| the harness | cdd-kit, or the specific gate |
| ceremony | the artifacts, the workflow |

## Adding a term

A term belongs here when it is **enforced** — a gate reads it, a schema
constrains it, or a contract binds it. If nothing mechanically depends on the
word, it is prose, and prose does not need a glossary entry.

Add the row here, then link this page from the term's first use in whatever
contract introduces it. `bone` was used 278 lines before it was defined and then
deferred to a third file; that is the shape this page exists to prevent, and a
row here does not fix it on its own.
