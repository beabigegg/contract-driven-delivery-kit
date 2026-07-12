# Agent-native CDD runtime contracts

## Status and scope

This document turns the architecture direction in
`agent-native-cdd-rearchitecture.md` into implementation boundaries. It is
normative for follow-up runtime work. The existing strict workflow remains the
behavioral compatibility reference until the promotion criteria in this
document pass.

## 1. Canonical boundary ownership

CDD uses one-way authority, not bidirectional synchronization.

1. The project contract is canonical. During the compatibility period this is
   the existing contract Markdown plus its schema-carrying blocks.
2. OpenAPI and JSON Schema are compiled projections. They never silently write
   back to the canonical contract.
3. Frontend clients/types and supported backend boundary models are generated
   projections of OpenAPI or JSON Schema.
4. Framework routes, serializers and captured HTTP responses are observed
   implementations. A disagreement is a conformance failure, not a merge
   opportunity.
5. Code-first import may create a reviewable candidate contract, but adoption
   requires an explicit contract update. Import never changes authority.

Every generated artifact records the canonical contract digest, compiler
version and generation time. Boundary evidence is invalid when its contract or
source digest no longer matches.

## 2. Runtime variant completeness

Boundary Guard distinguishes declared coverage from completeness.

- A **variant declaration** identifies operation, status, content type,
  discriminator conditions and expected schema.
- A **capture** records the real framework serializer output for one declared
  variant and binds it to source, contract and test-run digests.
- A **variant discovery adapter** reports statically or dynamically observable
  branches. Adapters may report uncertainty; they may not claim completeness
  when reflection, dynamic routing or unsupported framework behavior prevents
  it.

Changed operations pass only when:

1. every required declared variant has a valid capture or generated-model
   proof;
2. every discovered variant maps to a declaration;
3. the adapter reports complete coverage, or policy records an owned,
   expiring exception and routes the change to controlled/strict review;
4. zero declarations, captures or consumer checks cannot produce a green
   result for an applicable API change.

Feature flags, permissions, tenant modes, caches, fallbacks, queues and async
responses are variant dimensions. Projects can require dimensions that a stack
adapter cannot infer.

## 3. Risk routing and profile semantics

The risk router emits evidence, confidence and unknowns. It cannot lower a
configured minimum profile.

Precedence, from strongest to weakest, is:

1. organization or CI-required policy;
2. project policy;
3. deterministic graph/diff signals;
4. adapter signals;
5. agent recommendation;
6. prose-keyword suspicion.

Unknown graph edges, unsupported adapters, conflicting signals, missing policy
or incomplete boundary coverage fail upward to `controlled` or `strict`.
Agents and CLI callers may request escalation. Downgrade requires a recorded
human approval and is forbidden for organization-enforced approvals.

Each profile is a versioned policy bundle defining required validators,
reviewer independence, approvals, persistence, evidence retention and failure
behavior. `strict` is a compatibility contract pinned to a cdd-kit version, not
an informal synonym for "more checks".

### Human-origin acceptance evidence

Acceptance provenance is conditional capability, not a universal artifact.
`strict` always requires the existing human-authored `acceptance.yml`, hash
lock, independent driver checks and a recorded acceptance-phase run.
`lightweight` and `balanced` do not require an oracle by default. `controlled`
requires it only when the execution capsule contains `acceptance-oracle` in
`required_evidence`. Callers can explicitly escalate with `cdd-kit work
--require-acceptance` or `cdd-kit gate --require-acceptance`.

Gate profile behavior activates only through an explicit `--profile` or a
matching current runtime capsule. Without either, the pre-agent-native gate
semantics remain unchanged. This prevents package installation from silently
weakening an existing repository. Strict cannot be weakened by project policy.

## 4. Runtime state and evidence integrity

Runtime state is versioned and resumable. Each run records:

- run and change identifiers;
- repository root and provider;
- base/head commit plus dirty-tree digest;
- canonical contract and policy digests;
- selected profile and routing evidence;
- whether human acceptance was required and its provenance verdict;
- capsule version and write scope;
- agent invocations and approvals;
- test/check executions and immutable result pointers;
- supersession links for reruns;
- final verdict.

Evidence is append-only within a run. A rerun creates a new record and marks
the earlier result superseded; it does not rewrite historical proof. Resume
requires compatible schema and matching repository/policy state, otherwise the
runtime explains which inputs invalidated the run and recomputes the affected
steps.

Concurrent runs use an atomic repository-local lease. Parallel changes may
share read-only indexes but not mutable run state. Exports are views of runtime
state, never a second authority.

## 5. Doctrine traceability

Doctrine extraction is complete only with a rule ledger. Every current rule is
assigned a stable ID and records:

- source agent, skill, hook or guidance location;
- safety outcome and originating failure when known;
- target doctrine module, validator, approval or retirement decision;
- applicability and precedence;
- provider-neutral wording;
- selection and packaging tests;
- replacement/parity evidence.

Conflicts are resolved explicitly in the ledger. Project-specific invariants
override generic doctrine inside their scope but cannot disable organization or
deterministic safety policy.

## 6. Provider adapter contract

Claude Code remains the primary compatibility provider. Codex is a first-class
adapter over the same CLI/MCP runtime and provider-neutral doctrine.

| concern | Claude Code | Codex |
|---|---|---|
| project guidance | `CLAUDE.md`, compatible `AGENTS.md` | `AGENTS.md`; `CODEX.md` retained only as a migration pointer |
| user skills | `~/.claude/skills` | `$HOME/.agents/skills` |
| role definitions | `~/.claude/agents` | runtime profiles / Codex subagent configuration when available |
| MCP registration | `claude mcp add --scope user ...` | `codex mcp add ...` / `~/.codex/config.toml` |
| hooks | Claude settings hooks | Codex user/project hook adapter |

Provider adapters declare supported capabilities. Unsupported enforcement is
reported as unavailable and routed to deterministic CLI/CI checks; it is never
reported as installed merely because another provider has an equivalent hook.

## 7. User-level npm installation and upgrade

The npm package owns only files recorded in a user-level installation manifest.
Upgrade follows plan/apply semantics:

1. detect installed providers and locations without assuming the current
   working directory is an initialized project;
2. compare packaged asset digest, last-installed digest and current user digest;
3. skip unchanged files;
4. add missing owned assets;
5. update unmodified owned assets;
6. back up and require explicit apply for user-modified assets;
7. never delete unknown files from `~/.claude`, `$HOME/.agents` or
   `~/.codex`;
8. write the manifest atomically only after successful application.

`postinstall` may automatically update only unmodified, previously owned
assets. It must not overwrite user modifications or migrate project files.
Interactive `cdd-kit update` provides dry-run output, backup paths and provider
selection. Project migration remains a separate idempotent command with its own
backup and rollback record.

## 8. Compatibility matrix

Each release that changes runtime contracts publishes compatibility for:

- CLI command, flags, exit codes and JSON output;
- MCP tool names and schemas;
- project policy and runtime-state schemas;
- legacy change artifacts and archives;
- provider guidance, skills, hooks and installation manifests;
- CI check names and strict profile version;
- supported contract compiler and stack-adapter versions.

Readers support at least the documented compatibility window. Writers emit only
the current schema unless an explicit export version is requested.

## 9. Promotion gates

Before `balanced` becomes the default, a release decision records numeric
thresholds and evidence for:

- 100% catch rate for the required mutation corpus;
- no mutation caught by the pinned strict baseline but missed by balanced;
- representative projects for every supported first-party stack;
- bounded false-positive and override rates;
- median and tail token/agent-call reduction;
- successful crash/resume and strict rollback exercises;
- successful user-level Claude and Codex upgrade/rollback exercises;
- zero unexplained safety-outcome entries in the doctrine ledger.

The exact efficiency thresholds are set before shadow measurement begins and
cannot be selected after seeing the results.
