# Feature disposition map for the agent-native CDD redesign

## Purpose

This document prevents simplification from becoming accidental deletion. Every
current capability must retain a safety outcome, move to a clearer owner, become
conditional, remain under the strict compatibility profile, or be retired by an
explicit maintainer decision.

Status values:

- **strengthen**: core protection remains and receives more enforcement;
- **retain**: current behavior remains substantially unchanged;
- **move-doctrine**: preserve the rule as modular engineering doctrine;
- **move-runtime**: preserve the outcome in CLI/MCP state or generated evidence;
- **conditional**: invoke only when risk/surface requires it;
- **strict-only**: retain for compatibility/high-risk use while replacement is
  proven;
- **deprecate-after-parity**: remove only after tested replacement and migration;
- **review**: maintainer decision still needed.

## Core contract and boundary capabilities

| Current capability | Disposition | Target owner | Required preservation or improvement |
|---|---|---|---|
| API contract | strengthen | Boundary Guard + contracts | Remains canonical; add typed request/status-specific response coverage |
| Data-shape contract | strengthen | Boundary Guard + contracts | Enforce fields, types, nullability, enums, malformed and empty behavior |
| OpenAPI export | strengthen | contract compiler | Keep generated projection and stale-artifact gate |
| Backend route conformance | strengthen | Boundary Guard | Improve adapters and changed-operation awareness |
| Frontend call conformance | strengthen | Boundary Guard | Keep blocking for changed application API calls |
| Response-sample validation | strengthen | Boundary Guard | Add multi-variant/status support and live regeneration expectations |
| Generated frontend client/types | strengthen | stack adapter + CI | Detect stale generation and duplicate hand-written API types |
| Backend generated models | conditional | stack adapter | Use where framework support is honest; HTTP samples remain universal floor |
| Generic response schemas | review/ratchet | policy + Boundary Guard | Classify as closed/open-content/legacy; changed endpoints cannot silently pass |
| API inventory | retain | contract compiler/runtime | Generate where possible; preserve explicit exceptions and ownership |
| Contract versioning/changelog | retain | contract validator | Keep compatibility history; reduce manual duplication only if derivable |
| Error-format contract | strengthen | Boundary Guard | Add status/semantic error reconciliation where project contracts support it |
| CSS/UI contract | retain | contracts + UI checks | Keep project design-system invariants |
| Environment contract | retain | contracts + runtime | Keep secret/default/deploy validation |
| Business-rule contract | retain | contracts | Keep decision tables and edge cases |
| CI/CD contract | move-runtime + retain | policy/runtime | Policy becomes executable; human-readable contract/export remains available |

## Context and repository exploration

| Current capability | Disposition | Target owner | Required preservation or improvement |
|---|---|---|---|
| Code map | retain | runtime index | Continue deterministic symbol/line discovery |
| Code graph | retain | runtime graph | Continue caller/callee/consumer impact analysis |
| Graph-first agent guidance | move-runtime | execution capsule | Runtime supplies relevant graph results; prompt retains only fallback rule |
| Project map/contracts index | retain | runtime cache | Generate incrementally and invalidate by content hash |
| Context manifest | strict-only / conditional | runtime scope | Use committed manifest for strict/audit; generated scope for routine work |
| Context expansion request | conditional | runtime approval | Keep for sensitive or strict scope; routine legitimate impact expansion is logged automatically |
| Forbidden directory policy | retain | runtime policy | Continue excluding archives, build output, secrets and vendor trees by default |
| Broad-read prevention | move-runtime | runtime context provider | Supply exact ranges/symbols and record reads where supported |

## Engineering doctrine currently embedded in agents

| Current rule cluster | Disposition | Doctrine module | Mechanical counterpart |
|---|---|---|---|
| Reuse-first / solution minimalism | move-doctrine | core-engineering | dependency and dead-code checks where available |
| Do not reduce tests/contracts/security for minimalism | move-doctrine | core-engineering | required gate policy |
| Thin controllers / service boundaries | move-doctrine | backend | architecture/static checks per project |
| Input validation at boundary | move-doctrine | backend/api-boundary | request schema/runtime tests |
| Standardized errors | move-doctrine | api-boundary/backend | error-schema validation |
| Backward compatibility | move-doctrine | api-boundary | schema diff and consumer checks |
| N+1, transaction and connection safety | move-doctrine | backend | project tests/telemetry/static checks where feasible |
| Idempotency and retry/timeout rules | move-doctrine | backend/operations | resilience tests and policy triggers |
| Stable pagination | move-doctrine | backend/api-boundary | contract/integration tests |
| Do not assume backend shape | move-doctrine | frontend/api-boundary | generated types + Boundary Guard |
| Loading/empty/error/permission/slow states | move-doctrine | frontend/interaction | interaction evidence and UI tests when applicable |
| Accessibility | move-doctrine | frontend/interaction | axe/component/E2E checks |
| Native/reuse-first UI | move-doctrine | frontend | review guidance; no universal hard scanner |
| TDD discipline | move-doctrine + runtime | testing | test selection/evidence gates |
| Breaking-change definitions | move-doctrine + validator | api-boundary/contract | schema compatibility diff |
| Consumer inventory | move-runtime + doctrine | impact engine | graph/contract consumer checks |
| Migration safety | move-doctrine + validator | data-migration | DDL/backfill/rollback checks |
| Security/authorization review | move-doctrine + policy | security | auth tests, scanners, approval |

## Agent roles

| Current agent | Disposition | Target composition | Notes |
|---|---|---|---|
| change-classifier | move-runtime + conditional reviewer | risk engine + reviewer | Runtime computes signals; strong reviewer handles ambiguity only |
| repo-context-scanner | move-runtime | graph/index service | No routine agent needed for deterministic inventory |
| contract-reviewer | conditional | reviewer + contract capability | Required for changed boundary/compatibility or policy trigger |
| test-strategist | conditional | planner/reviewer + testing capability | Runtime selects baseline; strategist handles complex test design |
| spec-architect | conditional | planner/reviewer + architecture capability | Only for real architectural decisions |
| implementation-planner | conditional / move-runtime | planner + capsule generator | Routine plan becomes generated capsule; complex plan remains human-readable |
| backend-engineer | retain as capability | implementer + backend | Preserve doctrine; remove duplicated workflow manuals |
| frontend-engineer | retain as capability | implementer + frontend | Preserve API/UI/a11y doctrine |
| bug-fix-engineer | retain as capability | implementer + diagnosis | Keep symptom/reproduction/regression expertise |
| ci-cd-gatekeeper | move-runtime + conditional | policy engine + release reviewer | Runtime generates gate plan; reviewer handles release-policy changes |
| qa-reviewer | conditional | reviewer + testing | Independent review selected by risk/profile |
| ui-ux-reviewer | conditional | reviewer + interaction | Use for meaningful UI behavior/design changes |
| visual-reviewer | conditional | reviewer + visual | Use when visual surface changes |
| interaction-designer | conditional | planner/reviewer + interaction | Preserve human-confirmed intent where UI decisions are material |
| dependency-security-reviewer | conditional | reviewer + security | Use on dependency, secret, auth or migration risk |
| e2e-resilience-engineer | conditional | implementer/reviewer + resilience | Trigger from actual affected runtime paths |
| monkey-test-engineer | conditional | testing capability | Trigger from interaction/concurrency risk, not every feature |
| stress-soak-engineer | conditional | performance capability | Trigger from real load/resource impact |
| spec-drift-auditor | move-runtime + conditional review | drift scanner + reviewer | Deterministic drift first; reviewer for semantic ambiguity |

## Change artifacts

| Current artifact | Disposition | Target representation | Preservation rule |
|---|---|---|---|
| `change-request.md` | strict-only / generated view | `change.yml.intent` or runtime request | Existing files remain readable |
| `change-classification.md` | move-runtime | risk/profile result | Exportable; strict keeps current file |
| `context-manifest.md` | conditional | capsule scope/read policy | Commit only for strict/audit/sensitive scope |
| `test-plan.md` | conditional / generated view | selected tests + required evidence | Complex strategy remains a document |
| `ci-gates.md` | move-runtime / generated view | executable policy plan | Human-readable export for audit |
| `implementation-plan.md` | conditional | execution capsule or decision plan | Keep for complex/strict changes |
| `tasks.yml` | move-runtime | run state | Backward reader and archive support required |
| `interaction-design.md` | conditional retain | decision record | Preserve human-confirmed intent and provenance |
| `acceptance.yml` | conditional retain / strict compatibility | capsule human-origin evidence | Required in strict; optional unless policy/capsule activates it in other profiles |
| `design.md` | conditional retain | `decision.md` | Only when architecture decision exists |
| `proposal.md` / `spec.md` | conditional retain | decision/spec record | Not required by default |
| `test-evidence.yml` | move-runtime | versioned evidence JSON/YAML | Backward reader; no loss of test pointers |
| `agent-log/*.yml` | deprecate-after-parity for clean runs | runtime run log | Detailed export for failures/risk/audit |
| `qa-report.md` | conditional retain | exception/risk report | Keep for blocking or approved-risk findings |
| stress/soak/monkey reports | conditional retain | evidence bundle | Only when tests are actually required |
| `archive.md` | retain / generated | archive export | Historical summaries remain readable |

## Skills and commands

| Current capability | Disposition | Target owner | Notes |
|---|---|---|---|
| `/cdd-new` | strict-only then compatibility alias | orchestration skill/runtime | New default candidate is `cdd work` after parity |
| `/cdd-resume` | retain | runtime state | Resume must work for both legacy and new runs |
| `/cdd-close` | retain/refactor | runtime archive/export | Learning promotion remains evidence-backed |
| Codex `cdd-work` skill | add provider adapter | `$HOME/.agents/skills/cdd-work` | Thin provider-neutral entrypoint over the same CLI/MCP runtime |
| `cdd-kit setup` | retain/simplify | installer | Install runtime, adapter, policy and indexes |
| `cdd-kit gate` | retain | verifier | Becomes profile-aware; strict behavior preserved |
| `cdd-kit validate` | retain | validators | Boundary Guard becomes a major subsystem |
| `cdd-kit graph/index` | retain | runtime | Continue direct advanced access |
| `cdd-kit test select/run` | retain/refactor | test runtime | Agent prompts no longer repeat syntax |
| `cdd-kit doctor` | retain/strengthen | diagnostics | Report profile, coverage, dormant checks and migration readiness |
| 50+ advanced subcommands | retain behind namespaces/review | CLI | Public quick path should expose fewer primary commands |
| MCP graph/context tools | retain | MCP adapter | Add capsule, boundary and evidence tools |
| User-level provider assets | strengthen | installation manifest + updater | Track ownership/digests separately for `~/.claude` and `$HOME/.agents`; never silently overwrite user edits |

## Hooks and gates

| Current mechanism | Disposition | Target role | Required change |
|---|---|---|---|
| pre-commit `gate --strict` | retain for strict | hard chokepoint | Profile-aware replacement only after parity |
| graph-first PreToolUse hook | advisory/move-runtime | context steering | Runtime provides context directly |
| test-runner PreToolUse hook | advisory/move-runtime | test steering | Runtime invokes bounded test plan |
| contract-write hook | review | advisory or real command boundary | Do not claim hard protection if Bash bypasses it |
| design/acceptance hash locks | retain conditional | provenance guard | Mandatory in strict or when the capsule requires `acceptance-oracle`; never created solely for routine ceremony |
| OpenAPI sync gate | strengthen | Boundary Guard | Keep blocking for contract projection drift |
| response-shape gate | strengthen | Boundary Guard | Multi-variant and non-vacuous checks |
| tier floor keyword scan | refactor | risk heuristic | Graph/diff evidence primary; keywords advisory |
| required Markdown headings | deprecate-after-structured replacement | schema validation | Validate structured data, not magic wording |
| clean-pass agent-log warnings | deprecate-after-parity | runtime evidence | Preserve failure/risk logs |
| CI required checks | retain | repository protection | Remain final authority |

## Project guidance and learning

| Current capability | Disposition | Target owner | Preservation rule |
|---|---|---|---|
| project overview/commands/architecture | retain | project guidance | Always local and concise |
| project-specific invariants | retain/strengthen | project guidance/contracts | Never replaced by generic doctrine |
| generic CDD command table | move-runtime | help/skill reference | Load on demand |
| context-governance manual | move-runtime | help/policy | Keep short pointer locally |
| solution-minimalism prose | move-doctrine | core doctrine | One canonical source |
| promoted learnings | retain | contracts/project references | Evidence-backed, pointer-oriented, deduplicated |
| kit upgrade notes | move-runtime/docs | doctor/help | Not loaded in every project session |
| archives | retain cold | historical store | Never planning context by default |

## Safety-outcome checklist for removals

A current feature cannot be deprecated until its PR answers:

1. Which real or anticipated failure did the feature prevent?
2. Is the replacement doctrine, deterministic enforcement, independent review,
   approval or some combination?
3. Where is the replacement implemented?
4. What mutation or regression test proves it?
5. Is bypass resistance equal or better?
6. What happens to existing projects and archives?
7. How does a project roll back?
8. What measurable token/complexity reduction results?

A missing answer blocks removal.
