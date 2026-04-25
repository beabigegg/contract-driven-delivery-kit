# QA Gates

## Gate families

- lint
- typecheck
- build
- unit
- contract
- integration
- E2E
- visual
- data-boundary
- resilience
- monkey/fuzz
- stress
- soak
- security where applicable
- deployment smoke

## QA rule

QA approval requires evidence. Evidence may be command output, CI links, logs, screenshots, videos, traces, metrics, or artifact files.

## Fixback rule

Failures must be routed to the correct owner:

- contract mismatch -> contract reviewer + implementing engineer
- backend/API failure -> backend engineer
- frontend/UI failure -> frontend engineer
- visual failure -> visual reviewer + frontend engineer
- UX failure -> UI/UX reviewer + frontend engineer
- CI/CD failure -> CI/CD gatekeeper
- stress/soak failure -> stress-soak engineer
- monkey/data-boundary failure -> monkey or E2E/resilience engineer
- unclear systemic issue -> spec architect
