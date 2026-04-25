# Monkey Operation Standard

Monkey testing must be structured, not random noise. The goal is to prevent and detect real production misuse.

## Preventive spec checklist

Every user-facing feature should define behavior for:

- double click / repeated submit
- rapid filter changes
- invalid date range
- missing required field
- very long input
- Unicode and special characters
- SQL-like/script-like strings
- hidden tab / visibility change
- browser back/forward
- stale session
- wrong data shape
- network abort

## Test approaches

- Playwright action sequences
- route fuzz payloads
- property-based tests
- malformed fixture datasets
- randomized but bounded user operations

## Assertion rule

A monkey test must assert a safe outcome: validation message, disabled action, stable URL state, retained last snapshot, no duplicate job, no 500, or recoverable error state.
