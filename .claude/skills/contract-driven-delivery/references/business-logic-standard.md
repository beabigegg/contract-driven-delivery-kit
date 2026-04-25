# Business Logic Standard

Business logic changes must be explicit, example-driven, and regression-tested.

## Required sections

- current rule
- problem with current rule
- new rule
- decision table
- examples
- edge cases
- backward compatibility
- data migration impact
- audit/logging impact
- permission impact
- reporting/export impact
- regression tests

## Decision table template

| condition | old behavior | new behavior | expected output | test id |
|---|---|---|---|---|

## Example matrix template

| input | old output | new output | reason |
|---|---|---|---|

## Guardrail

If a developer cannot describe the rule in a decision table, implementation is premature.
