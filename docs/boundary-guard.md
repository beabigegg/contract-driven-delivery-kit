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

Captures use registered adapters, not manifest-provided shell commands:

```yaml
capture:
  path: tests/contract/samples/health.json
  adapter: flask-test-client       # or fastapi-testclient / express-supertest
  target: app:app
  request: { path: /health }
```

Run `cdd-kit boundary capture "GET /health"` to refresh a capture. CI and
Runtime use `boundary check --verify-captures --verify-generated` to execute the
adapter/generator again and compare observed serialized data. An agent-written
sample or updated digest alone cannot satisfy this check.

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
- generated client/type artifacts are bound to the current contract and are
  reproducible by a registered generator;
- manifest contract digest is current;
- at least one required response variant exists;
- every required variant has a digest-bound registered framework capture that
  the Guard can replay itself;
- captures are bound to the current backend producer digest;
- captured JSON validates against the canonical schema;
- variant discovery is complete when policy requires it;
- zero applicable typed checks cannot pass an API-affecting change.

The legacy gate consumes Boundary Guard in shadow mode by default. Set
`shadow_mode: false` only after the repository's mutation/parity evidence has
passed. The strict legacy workflow remains available independently.

Standalone `cdd-kit boundary check` honors the identical `shadow_mode` default
as `cdd-kit gate`: an `error`-level finding is printed as advisory
`Boundary Guard [shadow]: ...` and exits 0 while `.cdd/policy.yml` has
`shadow_mode: true` (the shipped default) or no `shadow_mode` key at all. Both
callers derive this decision from one shared enforcement-semantics source, so
they cannot diverge. Pass `--enforce` to override shadow mode for a single
standalone invocation — any error-level finding then exits 1, and the message
drops the `[shadow]` label since the finding is no longer advisory:

```bash
cdd-kit boundary check --enforce
```

`--enforce` is standalone-only; `cdd-kit gate` has no equivalent per-invocation
flag — promote gate-side enforcement by setting `.cdd/policy.yml`
`shadow_mode: false` project-wide instead.

## Runtime workflow

```bash
cdd-kit work my-change "add async job status"
cdd-kit runtime status
cdd-kit runtime resume
cdd-kit runtime agent prompt
cdd-kit runtime agent complete
cdd-kit runtime check run --all
cdd-kit runtime review
cdd-kit runtime approval import signed-approval.json <run-id>
cdd-kit runtime verify
```

The runtime selects a profile, capability set and doctrine modules, writes a
versioned execution capsule under `.cdd/runtime/<run-id>/`, binds evidence to
contract/policy/working-tree digests, and invalidates resume when those inputs
change.

High-risk approvals are not accepted from `--actor` text. Configure trusted
public keys per approval ID in `.cdd/approval-policy.yml`; the signed envelope
is bound to the run, change, scope, current HEAD, policy/working-tree digests,
nonce, and recent timestamp.
The approval policy and selected public key must be byte-identical to the PR
base (or prior trusted commit). Approver onboarding must therefore be merged as
a separate change before that identity can approve high-risk work.

## Migration

```bash
cdd-kit runtime migrate --provider codex          # dry run
cdd-kit runtime migrate --provider codex --yes
```

Migration adds missing policy/guidance, installs provider assets and scaffolds
Boundary Guard without rewriting active changes or archives. User-level assets
are ownership-tracked in `~/.cdd-kit/install-manifest.json`; npm postinstall
never overwrites user-modified assets.

Readiness is reported as `installed`, `configured`, `shadow_ready`, and
`promotion_ready`. A fail-closed empty manifest is not configured. Existing
projects that receive a new policy through migration start on `strict` until
project-specific parity is demonstrated.

It also writes a guidance token audit and replacement proposals under
`.cdd/migration/`. Existing guidance is preserved unless the user explicitly
runs `cdd-kit guidance migrate --apply --replace`. It updates only the managed
marker block and creates a rollback copy; unmarked project guidance is preserved
for manual proposal integration.
