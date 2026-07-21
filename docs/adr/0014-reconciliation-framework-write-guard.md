# ADR 0014: Reconciliation framework — single guarded writer and fail-open taxonomy

## Status
proposed

## Context
The old→new upgrade path is spread across three commands with three independent
copy loops: `refresh` force-refreshes kit templates with backup, `upgrade` adds
missing files only, and `update` overwrites `~/.claude` assets that are
digest-owned and unmodified. `refresh.ts` documents its keep/replace boundaries
only as a prose comment, and each command writes to the filesystem itself. As four
new bucket-3 reconcilers (policy-keys, gate-rule-map, behavior-report,
learnings-region) are added, a fourth, fifth, sixth ad-hoc write site would each be
a fresh place the "never overwrite adopter ground truth" invariant could silently
regress. A wrong disposition that overwrites `contracts/**`, a human-confirmed
`acceptance.yml`, or a user-set `.cdd/policy.yml` value corrupts irreplaceable
adopter state across every adopter repo — the single highest-blast-radius failure
in this tool.

## Decision
Introduce one `src/reconcile/` module that owns a three-bucket surface taxonomy
(keep / replace / reconcile), a typed reconciler registry, and a single bucket-1
write guard. Two structural rules make the safety invariant mechanical rather than
documented:

1. **Single guarded writer.** Reconcilers never call `fs` directly; they return
   plans or write only through a `GuardedWrite` capability. The framework's applier
   is the sole writer and passes every destination through `guard.assertWritable()`,
   which throws on any bucket-1 (never-overwrite) path. A reconciler physically
   cannot write a bucket-1 file.
2. **Fail-open to keep.** Any surface that is unknown, unclassified, unreadable, or
   malformed classifies as bucket-1 keep — never replace. Kit-vs-user ownership is
   delegated to the existing `digest.ts` / `asset-manifest.ts` /
   `user-asset-manifest.ts` utilities; a modified or unstamped kit file demotes
   bucket 2 → bucket 1.

The two invariants are additionally encoded in a new
`contracts/upgrade/upgrade-reconciliation-contract.md` and mechanically checked by a
`validate`/`gate` validator plus a `ci-gate-contract.md` inventory row.

## Consequences
- The never-overwrite guarantee has one chokepoint to audit and test, not N write
  sites. The adversarial corpus proves a bucket-1 write is physically refused.
- Future bucket-3 reconcilers register into one list; the plan/apply pass iterates
  that single registry. Reversing rule 1 (letting a reconciler write directly) would
  silently reopen the corruption surface, which is why it is recorded here.
- Fail-open trades completeness for safety: a genuinely-new replace surface that the
  classifier does not yet recognise is left untouched until explicitly classified,
  rather than being overwritten by default. This is the intended bias.
- `.cdd/policy.yml` must be classified per-key (user-set value = keep; new-key
  migration = reconcile), not per-file.