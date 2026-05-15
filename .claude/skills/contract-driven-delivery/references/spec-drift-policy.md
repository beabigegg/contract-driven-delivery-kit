# Spec Drift Policy

Spec drift happens when requirements, contracts, tests, CI gates, and code evolve at different speeds.

## Audit triggers

Run a drift audit when:

- a feature had multiple iterations
- production behavior differs from archived spec
- tests were added after implementation
- CI gates were changed
- a bug fix updates behavior but not spec
- a contract changed without client/test update
- tasks are marked complete but evidence is unclear

## Audit checks

- spec acceptance criteria map to tests
- contracts map to implementation and tests
- CI gates run relevant tests
- tasks marked complete have code/test evidence
- archive promotes durable learnings
- deprecated behavior is removed or documented

## Output

Use concise verdict text plus optional `agent-log/*.yml` evidence pointers for
clean audits. Use `templates/regression-report.md` or create
`spec-drift-audit.md` only when drift is found, the user asked for standalone
audit documentation, or the change needs durable follow-up prose.
