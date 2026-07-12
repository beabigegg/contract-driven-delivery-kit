# Boundary Guard

Boundary Guard is the independently runnable API/data-shape subsystem of the
agent-native runtime. It does not require a tracked CDD change.

## Configure

```bash
cdd-kit upgrade --yes                  # adds .cdd/policy.yml
cdd-kit boundary init                  # fail-closed manifest scaffold
cdd-kit boundary check --all --json
```

For each operation, complete `.cdd/boundary-manifest.yml` with source files,
known consumers, required status/runtime variants, discovery completeness and a
capture produced by a real framework test client. The manifest is bound to the
canonical contract digest. Contract changes therefore invalidate stale
coverage.

## Changed-operation mode

```bash
cdd-kit boundary check --base origin/main
cdd-kit boundary check --operation "POST /jobs"
```

The guard maps contract-row changes and changed source/consumer files to
operations. API-looking files without a manifest mapping produce an unknown
impact finding. Unknowns fail upward according to policy.

## Enforced invariants

- changed write operations have resolved typed body schemas;
- path and query parameters have typed optionality metadata;
- changed operations have resolved typed response schemas or an owned,
  unexpired exception;
- broad/generic response schemas are denied or escalated to Controlled review;
- mapped backend files exist and declare the contracted method/path;
- recorded consumers exist and call the contracted method/path;
- generated client/type artifacts match their recorded digests;
- manifest contract digest is current;
- at least one required response variant exists;
- every required variant has a digest-bound framework-test-client capture;
- captures are bound to the current backend producer digest;
- captured JSON validates against the canonical schema;
- variant discovery is complete when policy requires it;
- zero applicable typed checks cannot pass an API-affecting change.

The legacy gate consumes Boundary Guard in shadow mode by default. Set
`shadow_mode: false` only after the repository's mutation/parity evidence has
passed. The strict legacy workflow remains available independently.

## Runtime workflow

```bash
cdd-kit work my-change "add async job status"
cdd-kit runtime status
cdd-kit runtime resume
cdd-kit runtime agent prompt
cdd-kit runtime agent complete
cdd-kit runtime check run --all
cdd-kit runtime review
cdd-kit runtime approve
cdd-kit runtime verify
```

The runtime selects a profile, capability set and doctrine modules, writes a
versioned execution capsule under `.cdd/runtime/<run-id>/`, binds evidence to
contract/policy/working-tree digests, and invalidates resume when those inputs
change.

## Migration

```bash
cdd-kit runtime migrate --provider codex          # dry run
cdd-kit runtime migrate --provider codex --yes
```

Migration adds missing policy/guidance, installs provider assets and scaffolds
Boundary Guard without rewriting active changes or archives. User-level assets
are ownership-tracked in `~/.cdd-kit/install-manifest.json`; npm postinstall
never overwrites user-modified assets.

It also writes a guidance token audit and replacement proposals under
`.cdd/migration/`. Existing guidance is preserved unless the user explicitly
runs `cdd-kit guidance migrate --apply --replace`; rollback copies are created
before replacement.
