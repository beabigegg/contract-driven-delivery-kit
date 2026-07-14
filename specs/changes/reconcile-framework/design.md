# Design: reconcile-framework

## Summary
This change introduces one typed **reconciliation framework** that unifies the
today-scattered old→new upgrade paths (`refresh` force-refresh, `upgrade`
add-missing, `update` owned-asset resync) under a single three-bucket surface
taxonomy — **keep** (never overwrite), **replace** (force-refresh with backup),
**reconcile** (migrate + human review) — plus a read-only `--plan` classifier and
a registry the four future bucket-3 reconcilers plug into. Its load-bearing
invariant is a single guarded writer: no reconciler touches the filesystem
directly; every write in the reconcile/refresh apply path passes through one
bucket-1 guard that physically refuses to write a never-overwrite path and fails
open to *keep* on any malformed, unknown, or unreadable input. Kit-vs-user
ownership is delegated wholesale to the existing digest/asset-manifest utilities;
nothing is reinvented.

## Affected Components
| component | file path(s) | nature of change |
|---|---|---|
| reconcile module | `src/reconcile/{registry,classifier,guard}.ts` (new) | NEW: surface classifier, typed reconciler registry, single bucket-1 write guard |
| reconcile command | `src/commands/reconcile.ts` (new) | NEW: thin `cdd-kit reconcile [--plan\|--yes]` wrapper over the module |
| schema | `src/schemas/reconciliation.schema.ts` (new) | NEW: `SurfaceDisposition` / `Reconciler` shapes |
| CLI registration | `src/cli/index.ts` | register `reconcile` subcommand |
| force-refresh path | `src/commands/refresh.ts` | EXTEND: bucket-2 apply reuses `planForceRefresh`/`applyPlan`+backup, now routed through the guard |
| ownership (reuse) | `src/utils/{digest,asset-manifest,user-asset-manifest}.ts` | REUSE only (`sha256OfFileNormalized`, `readAssetManifest`, `isOwnedAndUnmodified`); no new detection |
| new contract | `contracts/upgrade/upgrade-reconciliation-contract.md` (new) | contract-reviewer authors text; encodes the two invariants |
| CI gate | `contracts/ci/ci-gate-contract.md` | ci-cd-gatekeeper adds the invariant-check inventory row |
| mechanical check | `cdd-kit validate`/`gate` host (not in my write scope) | hosts the static invariant validator (AC-5) |

## Surface → Bucket Taxonomy
Mapped from `refresh.ts`'s existing keep/replace boundary comment (lines 8-28).

| surface | bucket | rationale |
|---|---|---|
| `contracts/**`, `src/**`, `tests/**` (≠ `tests/templates/`), `specs/changes\|archive/**` | 1 keep | adopter/tool ground truth; `upgrade` already never overwrites these |
| `CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `package.json` | 1 keep | user-owned guidance/manifests; refresh NEVER-TOUCH list |
| `.cdd/policy.yml` user-set values, `.cdd/context-policy.json`, `.cdd/code-map-config.yml` | 1 keep | adopter policy; new keys are bucket-3 additive, never a flip |
| `acceptance.yml`, `interaction-design.md`, `.cdd/*-lock.json` | 1 keep | human-confirmed oracle/design + tamper-evident locks |
| user's own (digest-detected, non-kit) agents/skills | 1 keep | `isOwnedAndUnmodified === false` ⇒ user-authored ⇒ keep |
| `specs/templates/**`, `tests/templates/**`, `tests/contract/` harness, `ci-templates/**`, `.github/workflows/contract-driven-gates.yml` | 2 replace | kit-shipped scaffold; force-refresh w/ backup (preserve the "Repository-specific fast gate" step) |
| `~/.claude/agents\|skills`, `~/.agents/skills` — kit-owned AND unmodified | 2 replace | digest-owned ⇒ overwrite w/ backup; a user-modified copy demotes to bucket 1 |
| `.cdd/code-map.yml`, pre-commit hook (marker present) | 2 replace | regenerable/derived, not adopter source |
| `.cdd/policy.yml` / `model-policy.json` key migration | 3 reconcile | reconciler = `policy-keys` (OUT OF SCOPE) |
| gate rule map | 3 reconcile | reconciler = `gate-rule-map` (OUT OF SCOPE) |
| behavior report | 3 reconcile | reconciler = `behavior-report` (OUT OF SCOPE) |
| `CLAUDE.md` promoted-learnings region | 3 reconcile | reconciler = `learnings-region` (OUT OF SCOPE) |

Bucket-1 never-overwrite is the HARD invariant. The four bucket-3 reconcilers are
OUT OF SCOPE — this change ships only the registry slots they occupy.

## Registry Interface (sketch — not implementation)
```
type Bucket = 'keep' | 'replace' | 'reconcile';
interface SurfaceDisposition { surface; bucket; target; action:'keep'|'add'|'overwrite-with-backup'|'needs-reconcile'; reason }
interface Reconciler {                  // bucket-3 extension point
  surface: string;                      // unique id
  detectNeedsReconcile(ctx): boolean;   // READ-ONLY
  planDescription(ctx): string;         // READ-ONLY, printed by --plan
  apply(ctx, write: GuardedWrite): ReconcileResult; // writes ONLY via the guarded capability
}
interface ReconcileRegistry { register(r): void; list(): Reconciler[] }
```
`GuardedWrite` is the ONLY filesystem capability handed to a reconciler; it routes
through the bucket-1 guard. One plan/apply pass iterates the single `list()` —
never four ad-hoc code paths (AC-3).

## Key Decisions
- **New `cdd-kit reconcile [--plan]` subcommand** (plan is default/read-only, `--yes` applies) → rejected `refresh --plan`: refresh's dry-run is bucket-2-template-scoped and composes mutating sub-steps (code-map regen, model-policy resync), so overloading it blurs "force-refresh templates" with the full three-bucket taxonomy → rejected `upgrade --plan`: upgrade is the add-missing slice only; hosting the whole-taxonomy plan there mislabels scope. A dedicated verb gives the four bucket-3 sub-changes one obvious host.
- **`src/reconcile/` as a new module boundary** (classifier + registry + guard) → rejected growing `src/commands/refresh.ts`: that file is already the bucket-2 command host; coupling the cross-cutting extension point to one bucket's command would fork the taxonomy, not unify it.
- **Single guarded writer is the never-overwrite chokepoint** — reconcilers return plans / write only via `GuardedWrite`; the framework's applier is the sole `fs` writer and passes every dest through `guard.assertWritable()`, which throws on any bucket-1 path → rejected per-reconciler self-policing: four independent write sites are four places the invariant can silently regress (see ADR 0014). This is AC-2/AC-6.
- **Fail-open to keep** — unknown / unclassified / unreadable / malformed input classifies as bucket-1 keep, never replace → rejected fail-closed-to-replace: a wrong classifier overwriting adopter ground truth is the primary risk this change exists to foreclose.
- **Ownership delegated, not reinvented** — bucket assignment for kit-vs-user surfaces calls `isOwnedAndUnmodified` (user-level) and `readAssetManifest` + `sha256OfFileNormalized` (project-level); a modified or unstamped kit file demotes bucket 2 → bucket 1 (AC-7).
- **New contract `contracts/upgrade/upgrade-reconciliation-contract.md`** (path confirmed; contracts-index lists no upgrade family) encoding two invariants — (a) fail-open safe defaults for newly-added surfaces, (b) never-flip / never-overwrite of an existing user-set value or ground-truth file — mechanically checked by a new `validate`/`gate` validator plus a `ci-gate-contract.md` inventory row, not merely documented (AC-5). contract-reviewer owns the text.

## Migration / Rollback / Fail-open
Purely additive: no existing command's default behavior changes — `refresh` /
`upgrade` / `update` keep working, now sharing the guard. `--plan` is read-only and
mutates nothing (AC-1). An apply pass writes a bucket-2 backup BEFORE any overwrite
(reusing refresh's timestamped `.cdd/.refresh-backup/` + gitignore stamp) and
records install digests via `stampAssetManifest`. On ANY error mid-apply the safe
default is keep: the guard refuses, the applier skips that surface and continues,
and no bucket-1 path is ever the target of a write. Rollback is deletion of the new
module / command / contract plus the regenerable sidecar backups; no data migration.

## Open Risks
- `docs/adr/0014-*.md` and `src/reconcile/` are not yet in the manifest `## Allowed Paths`; add them before implementation so `gate` stays truthful.
- The AC-5 static validator must assert the bucket-1 matcher COVERS the enumerated ground-truth set AND that no reconciler bypasses `GuardedWrite`; a coverage gap passes a green gate while leaving a hole — the adversarial corpus (monkey-test-engineer) must prove a bucket-1 write is physically REFUSED, not merely undocumented.
- `.cdd/policy.yml` is both bucket-1 (user-set values) and bucket-3 (new-key migration); the split must be per-KEY, not per-FILE — a whole-file rule would either freeze migration or risk flipping a user value.