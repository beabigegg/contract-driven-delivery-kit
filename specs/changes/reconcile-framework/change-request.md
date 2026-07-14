# Change Request

## Original Request

Foundation of the upgrade-reconciliation epic (atomic split from
`upgrade-reconciliation`; 4 bucket-3 sub-changes depend on this one).

Build the **dry-run/plan-mode surface classifier** and the **shared
reconciliation registry** that unifies the whole old→new version upgrade
taxonomy into one coherent mechanism:

- A **surface classifier** that maps every kit-shipped surface an adopter has
  into exactly one of three buckets: **keep** (bucket 1, never overwrite),
  **replace** (bucket 2, force-refresh with backup), **reconcile** (bucket 3,
  migrate + human-review). This is the taxonomy the four bucket-3 sub-changes
  plug into via a registry.
- A **plan / dry-run mode** (e.g. `cdd-kit upgrade --plan` / `cdd-kit reconcile
  --plan`, exact surface TBD in design) that prints, per surface, its bucket and
  what would happen (kept / force-refreshed-with-backup / needs-reconcile +
  what human review is required), WITHOUT mutating anything.
- The **reconciliation registry**: a typed extension point where each bucket-3
  reconciler (policy-keys, gate-rule-map, behavior-report, learnings-region)
  registers itself, so the plan/apply pass iterates a single registry rather
  than four ad-hoc code paths.
- Confirm and encode **bucket 1 (never-overwrite)** as a HARD safety invariant:
  `contracts/**`, `specs/changes|archive/**`, `src/**`, `tests/**` (except
  `tests/templates/`), `.cdd/policy.yml` user-set values, `.cdd/code-map-config.yml`,
  `.cdd/context-policy.json`, `acceptance.yml`/`interaction-design.md`/locks,
  and the user's own (non-kit, digest-detected) agents/skills are NEVER
  overwritten. A wrong classifier corrupting adopter ground truth is the primary
  risk this change must foreclose.
- Confirm **bucket 2 (force-refresh with backup)**: `.claude` kit agents|skills,
  hooks, `specs|tests/templates`, ci-templates, the workflow scaffold (preserving
  the user's "Repository-specific fast gate" step), model-policy roles resync.
- Add an **upgrade-reconciliation contract** encoding the two non-negotiable
  invariants: fail-open safe defaults for newly-added surfaces, and
  never-flip / never-overwrite of an existing user-set value or ground-truth file.

**Reuse-first (compose, do not reinvent):** extend `src/commands/refresh.ts`
(already documents keep/replace boundaries), `src/utils/asset-manifest.ts` and
`src/utils/user-asset-manifest.ts` (already do digest-based ownership detection),
and `src/utils/digest.ts`. The bucket-3 reconcilers themselves are OUT OF SCOPE
here (separate sub-changes) — this change only builds the framework + plan mode
they register into, plus the bucket-1/2 taxonomy and the contract.

CLI-only, no UI surface. This change dogfoods CDD on the cdd-kit tool itself.

## Business / User Goal

## Non-goals

## Constraints

## Known Context

## Open Questions

## Requested Delivery Date / Priority
