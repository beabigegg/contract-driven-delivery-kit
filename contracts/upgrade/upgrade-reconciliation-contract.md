---
contract: upgrade
summary: Three-bucket (keep/replace/reconcile) surface taxonomy and the two non-negotiable write-safety invariants governing every kit-shipped upgrade path (refresh, upgrade, update, reconcile).
owner: platform-team
surface: upgrade-reconciliation
schema-version: 0.3.0
last-changed: 2026-07-14
breaking-change-policy: deprecate-2-minors
---

# Upgrade Reconciliation Contract

## Scope

This contract governs the code paths that write into an adopter project during
an upgrade/refresh/reconcile operation of `cdd-kit`. It states WHAT must hold;
it does not prescribe HOW.

**Where the single-writer invariant is mechanically enforced today**, and where
it is not — stated precisely, because a scope claim wider than the validator is
a guarantee that does not exist:

| path | INV-2 enforcement |
|---|---|
| `cdd-kit reconcile [--plan\|--yes]` | **guarded** — every write goes through `src/reconcile/guard.ts`, statically verified by `enforceReconciliationInvariants` |
| `cdd-kit refresh --yes` (bucket-2 apply) | **guarded** — same writer, same static check |
| `cdd-kit upgrade` | **not guard-routed.** It plans only files that do not exist (`if (!existsSync(dest))`), which bucket 1 already permits ("may create it if entirely absent"), so it cannot overwrite ground truth — but that is a property of its planner, not a chokepoint the validator enforces. |
| `cdd-kit update` | **not guard-routed.** It writes user-level agents/skills and makes its own kit-owned-and-unmodified decision, i.e. a SECOND implementation of bucket-1 rule 5's semantics. Not known to be wrong; not mechanically prevented from becoming wrong. |

Routing the last two through the guard is the obvious next step and is
deliberately not claimed here until it is done and verified — the same guard has
three times refused a kit-owned write it should have allowed (`tests/contract`,
`specs/templates/acceptance.yml`, the refresh backup area), so extending its
reach is a change that must be earned with evidence, not asserted. The architecture — the
classifier, the typed reconciler registry, and the single `GuardedWrite`
chokepoint — is `docs/adr/0014-reconciliation-framework-write-guard.md` and
`specs/changes/reconcile-framework/design.md`. This contract is the binding
source a mechanical validator reads; the design doc is not.

## Bucket Taxonomy (binding)

Every surface a kit upgrade path can touch in an adopter project resolves to
EXACTLY ONE of three buckets. A surface with no explicit disposition is bucket 1
by default (INV-1) — never bucket 2 or 3.

| bucket | name | write policy | applies when |
|---:|---|---|---|
| 1 | keep | NEVER overwritten. The surface is adopter/tool ground truth; an upgrade path may create it if entirely absent, and must otherwise leave it byte-for-byte untouched. | the enumerated ground-truth set below, plus any newly-discovered or unclassified surface (fail-open default, INV-1) |
| 2 | replace | Force-refreshed, but ONLY after a backup of the pre-refresh content is written first. | kit-shipped scaffold/template surfaces the kit owns and regenerates; a user-modified copy of a normally-bucket-2 file demotes to bucket 1 (ownership check) |
| 3 | reconcile | Migrated by a typed reconciler with a human-reviewable plan; never silently auto-applied by a bucket-1/2 code path. | a surface whose shape changed between kit versions and needs field-level migration, not a blind copy |

## Bucket 1 — Never-Overwrite Ground Truth (binding enumeration)

The following surfaces are bucket 1. This is the coverage set a mechanical
validator (see `## Mechanical Enforcement`) must confirm the guard's matcher
covers; an enumerated surface with no matching guard rule is a coverage gap, not
a style nit.

| surface | rationale |
|---|---|
| `contracts/**`, `src/**`, `tests/**` (excluding `tests/templates/**` and the kit-shipped files of `tests/contract/**`), `specs/changes/**`, `specs/archive/**` | adopter/tool ground truth |
| `CLAUDE.md` (everything OUTSIDE its `cdd-kit:learnings` markers — see per-region rule below), `AGENTS.md`, `CODEX.md`, `package.json` | user-owned guidance and manifests |
| `.cdd/policy.yml` (user-set key values only — see per-key rule below), `.cdd/context-policy.json`, `.cdd/code-map-config.yml` | adopter policy |
| `acceptance.yml`, `interaction-design.md`, `.cdd/*-lock.json` (e.g. `.cdd/design-lock.json`, `.cdd/acceptance-lock.json`) | human-confirmed oracle/design and their tamper-evident locks |
| the user's own agents/skills — any agent/skill file the ownership check reports as NOT kit-owned-and-unmodified | user-authored content |

Adding a surface to this enumeration is a minor version bump — a strictly SAFER
change, since bucket 1 was already the fail-open default for anything
unclassified. REMOVING a surface from this enumeration, or reclassifying an
enumerated bucket-1 surface to bucket 2 or 3, is a BREAKING change: it is the
write-safety equivalent of disabling a bone protection (the fat/bone/knob
vocabulary `contracts/ci/ci-gate-contract.md` `### Loosening policy — bone-audit`
already established) and requires a major version bump, an explicit reason, and a
`contracts/CHANGELOG.md` entry naming the surface and why it is now safe to
overwrite.

## `.cdd/policy.yml` is classified PER-KEY, not per-file (binding)

`.cdd/policy.yml` is not a single bucket-1 file. It is a bucket-1 CONTAINER whose
classification is per-key:

- A key the adopter has set (present in the file, whether it equals the shipped
  default or not) is bucket 1 — never flipped or overwritten.
- A key genuinely new to this kit version, absent from the adopter's file, is
  bucket 3 (reconcile) — added with its fail-open safe default (INV-1), never
  silently defaulted to an enforcing/blocking value.

A whole-file bucket-1 rule would permanently freeze new-key migration; a
whole-file bucket-3 rule would risk flipping an adopter's existing value on every
upgrade. A mechanical check that only asserts "the file exists and was not
deleted" does NOT verify this rule — the validator must diff key-by-key against
the adopter's prior value, never treat the file as one opaque blob.

## Bucket-1 containers and their narrow channels (binding)

Two bucket-1 surfaces are CONTAINERS: the file is ground truth, but a delimited
part of it is kit-managed and MUST remain migratable. A whole-file refusal on
either makes a clause elsewhere in this contract unimplementable, which is a
contradiction, not extra safety.

| container | protected (bucket 1) | narrow channel |
|---|---|---|
| `.cdd/policy.yml` | every key the adopter has set, and the file's existing bytes (comments and formatting included) | add a genuinely-new key only, at its safe default |
| `CLAUDE.md` | every byte outside the `cdd-kit:learnings` markers | replace the marked region only |

A narrow channel is binding ONLY where it satisfies all of:

1. it is implemented inside the single guarded writer, not in a reconciler;
2. it re-reads its own output FROM DISK and proves byte-for-byte that the
   protected part survived, restoring the original and failing loudly otherwise —
   the proof is structural, and a caller cannot opt out of it;
3. it never re-serializes a container it only means to extend. Round-tripping
   `.cdd/policy.yml` through a YAML parser silently drops the adopter's comments
   and rewrites their formatting; that is a mutation of ground truth even when
   every key and value survives;
4. it refuses (policy keys) or reports and leaves the file untouched (marked
   region) when the container is missing, unreadable, malformed, or its region is
   absent/ambiguous — an unlocatable region is indistinguishable from a
   hand-edited one.

Adding a narrow channel, or widening what an existing one may write, is a
BREAKING change under the same rule as reclassifying a bucket-1 surface: it is
the write-safety equivalent of disabling a bone protection and requires a major
version bump, an explicit reason, and a `contracts/CHANGELOG.md` entry.

## Invariants (binding)

**INV-1 — Fail-open safe defaults for new surfaces/keys.** A newly-added surface
or a newly-added `.cdd/policy.yml` key that did not exist in the adopter's prior
kit version is introduced with a SAFE default — e.g. a boolean gate defaults to
`shadow_mode: true` / advisory, never to an immediately-enforcing/blocking value.
No adopter is newly blocked by upgrading to a version that adds a surface or key
they have never configured. This governs every bucket-3 reconciler's `apply`
output and every classifier default for an unrecognized surface.

**INV-2 — Never flip / never overwrite existing ground truth.** An existing
adopter-set value (any bucket-1 `.cdd/policy.yml` key) or a bucket-1 ground-truth
file (the enumeration above) is NEVER flipped, mutated, or overwritten by any
upgrade path. This is enforced by ONE guarded writer — every write in the
reconcile/refresh apply path passes through a single bucket-1 write guard; it is
NOT achieved by per-reconciler discipline, and a design with more than one
filesystem write site is a design that cannot satisfy this invariant, whatever
each site individually intends. On malformed, unknown, or unreadable input at
classification time, the classifier FAILS OPEN to bucket 1 (`keep`) — never to
bucket 2 (`replace`). A classifier that cannot determine a surface's bucket must
never guess `replace`.

## Bucket 2 / Bucket 3 — context, not the hard invariant

Bucket 1 (never-overwrite) is this contract's binding invariant. Buckets 2 and 3
exist so the taxonomy is exhaustive, not because either carries an invariant of
comparable weight:

- **Bucket 2 (replace)** requires a backup written BEFORE any overwrite. This
  contract does not prescribe the backup mechanism or retention; it requires only
  that the pre-refresh content is recoverable after an apply.
- **Bucket 3 (reconcile)** requires a typed reconciler registered against the
  shared registry (not an ad-hoc code path) whose `apply` step writes only
  through the same guarded writer as buckets 1/2, so INV-2 applies to bucket-3
  writes too. The four concrete bucket-3 reconcilers (`policy-keys`,
  `gate-rule-map`, `behavior-report`, `learnings-region`) are OUT OF SCOPE of the
  framework this contract governs; this contract binds only the registry contract
  they must plug into (typed registration, `GuardedWrite`-only writes,
  plan-mode-printable).

## Mechanical Enforcement (binding)

Prose alone is not a guarantee. Both invariants above are checked by a
`cdd-kit validate` / `cdd-kit gate` validator (`enforceReconciliationInvariants`,
`contracts/ci/ci-gate-contract.md`) that:

1. asserts the guard's bucket-1 matcher COVERS every surface enumerated above —
   an enumerated surface with no matching rule is a coverage gap and a HARD
   failure, not a warning;
2. asserts no reconciler or bucket-2 apply path writes to the filesystem through
   any capability other than the single guarded writer;
3. requires a recorded, PASSED test proving a bucket-1 write attempt is
   physically REFUSED by the guard (raises/throws), not merely "not exercised" by
   the existing code paths — a green suite with no such test is not evidence
   INV-2 holds;
4. requires a recorded, PASSED test proving fail-open-to-keep for malformed /
   unknown / unreadable classifier input and for a newly-added surface or
   `.cdd/policy.yml` key (INV-1's safe-default requirement);
5. requires, for the narrow channels above, a recorded PASSED test proving an
   adopter-set value survives a channel write (`narrow-channel-refusal`) and one
   proving a malformed / unreadable / ambiguous container is refused or left
   untouched rather than guessed at (`container-fail-open`). A channel is a hole
   in the never-overwrite guard; its byte-level proof is only real if removing
   that proof turns a test red.

A contract claim with no matching validator, and a validator with no test that
turns red when the guard regresses, is prose — not a guarantee. See
`contracts/ci/ci-gate-contract.md` `### enforceReconciliationInvariants` for the
exact pass/fail conditions and trigger vocabulary.

## Consumers

Every adopter of `cdd-kit` that runs any upgrade path (`refresh`, `upgrade`,
`update`, `reconcile`) — i.e. every adopter, since these are the only supported
paths from an older installed template/scaffold to a newer one. This kit's own
repository is also a consumer via its own dogfooded `cdd-kit gate`/`validate`
runs. No frontend/mobile/partner consumer applies (CLI-only surface).

## Rollback

Additive: reverting `reconcile-framework` removes the `reconcile` command, the
`src/reconcile/` module, this contract, and the `enforceReconciliationInvariants`
gate check, with no data migration — `refresh`/`upgrade`/`update` continue to
enforce their existing (narrower) keep/replace boundaries exactly as before this
change (design.md Migration/Rollback).
