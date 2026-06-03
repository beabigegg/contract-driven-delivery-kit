# API Conformance: catching frontend/backend drift mechanically

## Why this exists

cdd-kit calls `contracts/api/api-contract.md` the single source of truth for the
API. But the other validators only check that the contract *document* is well
formed (`validate_api_semantic.py` validates the endpoint table's columns). They
never look at code. So the frontend and backend can both drift away from the
contract — the frontend can call `/api/v2/orders` while the backend serves
`/api/orders` and the contract documents neither — and every gate stays green.

In a workflow where **no human reviews the contract by hand**, prose review is
worthless and the markdown is only worth what a machine can enforce against real
code. `validate_api_conformance.py` is that machine check: it parses the actual
backend routes and frontend call sites and diffs them against the contract.

## What it checks

| Check | Meaning | Default severity |
|---|---|---|
| `backendRouteNotInContract` | a route is declared in backend code but not in the contract | warning |
| `contractEndpointNotImplemented` | a contract endpoint has no backend route in scanned source | warning |
| `frontendCallNotInContract` | the frontend calls a path/method that is not in the contract | error |

Paths are normalized so `/users/:id`, `/users/{id}`, and `/users/${id}` all
compare equal. Methods are compared too; `fetch()` and Django/Spring-style
declarations that don't expose a verb to the regex are treated as method-agnostic.

It is **heuristic** (regex, stack-agnostic) by design — a generic kit cannot ship
a parser for every framework. It recognizes:

- **Backend**: Express/Koa/Fastify (`app/router.get('/x')`), NestJS
  (`@Controller` prefix + `@Get(':id')`), Flask/FastAPI/Django, Spring
  (`@GetMapping`, and `@RequestMapping(..., method=...)` with the method parsed),
  Go (chi/gin/echo/mux + `HandleFunc`), and Laravel (`Route::get` and
  `Route::match([...])`).
- **Flask Blueprint / FastAPI APIRouter prefixes** are resolved across files: a
  pre-pass maps each router variable to its prefix — from the constructor kwarg
  (`Blueprint(..., url_prefix="/admin")`, `APIRouter(prefix="/admin")`) and/or the
  registration call (`register_blueprint(bp, url_prefix=...)`,
  `include_router(router, prefix=...)`) — and folds it into every route on that
  router. The registration-site prefix wins over the constructor's.
- **Frontend**: `fetch` (method read from the options object; defaults to GET),
  `axios`/`ky`/`$http`/`client`/`http`/`api.*` verb calls, the
  `axios({ url, method })` config-object form, and `useFetch`/`useSWR`/`useQuery`.

Backend patterns are **gated by file extension** so a Python/Go/PHP pattern can
never match a JS/TS file (and vice versa). Treat it as a high-signal net, not a
proof.

### Known heuristic limits

- **Ruby/Rails is not supported.** Rails routing is a stateful `routes.rb draw`
  DSL that a regex cannot parse honestly, so `.rb` is not in the default
  `backendGlobsExt` and Rails routes are not claimed.
- **Mounted Express routers** (`app.use('/api', router)` + `router.get('/users')`)
  record only `/users`; the validator does not resolve the mount prefix across
  files. (Flask Blueprint and FastAPI APIRouter prefixes *are* resolved — see
  above — but the Express `app.use` mount form is not.) If you use mounted
  routers, either declare the unprefixed paths in the contract, add the mount
  prefix in the route literal, or set `contractEndpointNotImplemented` to `off`.
- **Prefix resolution keys on the local variable name.** A Blueprint/APIRouter
  imported under an alias, registered under two different prefixes, or with a
  FastAPI `include_router` prefix *added on top of* an `APIRouter(prefix=...)`
  (the two concatenate) is not fully resolved.
- **Dynamic routes** built from variables or registered via framework modules
  (NestJS `RouterModule`, dynamic prefixes) are not detected.

Because of these residual blind spots, `backendRouteNotInContract` **defaults to
`warning`**: a route the scanner mislocates must not break CI on a contract that
is actually correct. Raise it to `error` (or set `"strict": true`) once your
project's routing shape is known to resolve cleanly.

## Enabling it

It is **off unless `.cdd/conformance.json` exists with `"enabled": true`**, so it
never breaks repos that ship the kit. `cdd-kit init` scaffolds a disabled config;
flip it on:

```json
{
  "enabled": true,
  "apiPrefixes": ["/api"],
  "sourceRoots": ["src", "app"],
  "ignorePaths": ["/health", "/metrics"],
  "checks": {
    "backendRouteNotInContract": "warning",
    "contractEndpointNotImplemented": "warning",
    "frontendCallNotInContract": "error"
  },
  "strict": false
}
```

- `apiPrefixes` — only frontend calls under these prefixes are checked, so
  static-asset and third-party URLs don't produce noise. Leave empty to check all.
- `sourceRoots` — directories to scan. Empty means auto-detect common roots
  (`src`, `app`, `server`, `frontend`, …) that exist.
- `ignorePaths` — contract/code paths to skip; a trailing `*` matches a prefix.
- `strict` — escalate every warning to an error.
- Per-check severity can be set to `"error"`, `"warning"`, or `"off"`.

## How it runs

It is chained under contract validation, so both of these pick it up:

```bash
cdd-kit validate --contracts      # runs it alongside the markdown validators
cdd-kit gate <change-id>          # gate runs the contract validators, so drift blocks the gate
```

`cdd-kit doctor` reports whether the net is armed (`enabled` / `present but
disabled` / `not configured`) without failing — turning it on is a project policy
decision, not a doctor error.

## Tuning false positives

Because it is regex-based, an internal helper that isn't really an HTTP route can
occasionally match. Options, in order of preference:

1. Add the genuine endpoint to the contract (usually the right fix).
2. Add the path to `ignorePaths`.
3. Narrow `sourceRoots` to where real routes/calls live.
4. Lower a specific check to `"warning"` or `"off"`.
