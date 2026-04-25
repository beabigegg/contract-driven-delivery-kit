# Env Contract Standard

## Required fields for every env var

| field | description |
|---|---|
| name | exact variable name |
| scope | frontend, backend, build, runtime, test, deploy |
| environments | local, dev, staging, production, CI |
| required | yes/no |
| secret | yes/no |
| default | safe default or none |
| example | non-secret example |
| owner | responsible area |
| validation | type/range/allowed values |
| restart required | yes/no |
| failure behavior | what happens if missing/invalid |

## Public frontend env rule

Variables with prefixes such as `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`, or similar are browser-exposed and must never contain secrets.

## Required updates for env changes

- env contract
- `.env.example`
- runtime validation/config loader
- deployment docs or workflow secrets
- tests for missing/invalid values when high-risk
- rollback/default behavior
