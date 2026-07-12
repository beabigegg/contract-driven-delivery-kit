# Agent-native parity and token report

Measured on 2026-07-12 against the cdd-kit repository. Token figures use the
CLI's deterministic four-characters-per-token estimate and are intended for
before/after trend comparison, not provider billing.

The final repository regression run completed with **120 files passed and 1,576
tests passed** when Python `jsonschema` is installed. Both shipped CI workflows
install that legacy-validator dependency explicitly, so Strict response-shape
coverage is not skipped in CI.

## Recurring context baseline

| Input | Estimated tokens |
|---|---:|
| Current project CLAUDE.md | 2,297 |
| 19 fixed legacy agent prompts | 34,762 |
| Combined legacy baseline | 37,059 |
| Minimal Claude + Codex + AGENTS templates | 1,217 |
| Estimated recurring reduction | 96.7% |

Run `cdd-kit guidance audit --json` in each consumer repository to obtain its
own baseline. Runtime prompts add only the Doctrine selected by a capsule; the
core + testing Doctrine payload is 928 bytes, while API and authorization packs
are added only for those risks.

## Executable parity coverage

The suite includes seeded failures for:

- backend method/path route mismatch;
- missing typed body, path, and query metadata;
- generic/open-content response schema escalation;
- response field/type mismatch, required fields, enums, and variants;
- zero required variants and incomplete runtime-branch discovery;
- capture content digest and backend producer digest staleness;
- invalid capture provenance, adapter replay drift, and repository-escaping paths;
- missing/mismatched frontend consumer calls;
- stale generated artifacts, contract projection drift, generator version drift,
  and generator replay mismatch;
- a clean CI checkout whose changed operations are derived from the PR base;
- stale implementation, test, review, and human-approval evidence.
- forged/free-form approval identities and signed-approval nonce replay.

`cdd-kit runtime parity <run-id>` dual-runs runtime verification and the strict
compatibility gate and writes `.cdd/runtime/<run-id>/parity.json`, including
verdicts, normalized detection categories, selected agent calls, token
estimates, and artifact counts. Equal exit codes with different blocking
categories are not parity. Pass `--mutations <matrix.json>` to compare each
seeded mutation's caught/missed verdict and category and report false positives
and false negatives. A mismatch blocks parity promotion.

## Migration and rollback

`cdd-kit runtime migrate --yes` preserves active changes and archives, writes a
guidance audit plus proposals, and keeps strict available. Add `--import-active`
to create strict runtime capsules from active legacy changes without rewriting
their files. Guidance replacement requires the separate explicit command
`cdd-kit guidance migrate --apply --replace`, which creates rollback copies and
updates only managed marker blocks. Guidance without markers remains untouched.
