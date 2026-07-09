#!/usr/bin/env python3
"""Code-vs-contract API conformance check.

The other API validator (validate_api_semantic.py) only checks that the
contract *document* is internally well formed. It never looks at code, so
frontend and backend can both drift away from the contract without anything
failing. In a workflow where no human reviews the contract by hand, that
markdown is only worth what a machine can enforce against real code.

This validator closes that gap. It:
  1. reads the authoritative endpoint table from contracts/api/api-contract.md
  2. scans backend source for route declarations (Express/Koa/Fastify/NestJS,
     Flask/FastAPI/Django, Spring, Go net/http & chi/gin, Laravel, Rails-ish)
  3. scans frontend source for HTTP call sites (fetch/axios/ky/$http/api.*)
  4. diffs both against the contract and reports drift

It is intentionally heuristic and stack-agnostic (regex, no per-framework
parser). To avoid false positives on the many repos that ship this kit, it is
OFF unless `.cdd/conformance.json` exists with `"enabled": true`. When the
config is absent it prints a one-line skip notice and exits 0.

Exit codes:
  0  conformance OK, or skipped (no/disabled config)
  1  drift found (or, in strict mode, warnings escalated to errors)

Config (.cdd/conformance.json), all keys optional:
{
  "enabled": true,
  "apiPrefixes": ["/api"],          // only FE calls under these prefixes are checked
  "sourceRoots": ["src", "app"],    // dirs to scan; default: common roots that exist
  "backendGlobsExt": [".py", ".js", ".ts", ".go", ".java", ".php"],
  "frontendGlobsExt": [".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"],
  "excludeDirs": ["node_modules", "dist", "build", ".git", "tests", "__tests__"],
  "ignorePaths": ["/health", "/metrics"],  // contract+code paths to ignore (supports trailing *)
  "checks": {
    "backendRouteNotInContract": "warning",
    "contractEndpointNotImplemented": "warning",
    "frontendCallNotInContract": "error"
  },
  "strict": false                   // escalate all warnings to errors
}

Cross-file prefix resolution: Flask Blueprint `url_prefix` and FastAPI
APIRouter `prefix` are declared on the router object and the routes hang off
that object. Constructor prefixes (`Blueprint(url_prefix=...)`,
`APIRouter(prefix=...)`) are resolved per file — scoped to the file so a bare
`router` name reused across modules cannot collide — while registration
prefixes (`register_blueprint(bp, url_prefix=...)`, `include_router(router,
prefix=...)`) are resolved across files, registration winning. The route path
then has the resolved prefix folded in. This keys on the local variable name,
so a router imported under an alias, a module-qualified registration
(`include_router(users.router, ...)`), or a dynamically assembled prefix is
not resolved; that residual heuristic gap is why `backendRouteNotInContract`
defaults to "warning" rather than "error".
"""
import json
import os
import re
import sys
from pathlib import Path

from applicability import classify_file

CONTRACT_PATH = Path('contracts/api/api-contract.md')
CONFIG_PATH = Path('.cdd/conformance.json')

VALID_METHODS = {'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'}

DEFAULT_CONFIG = {
    'enabled': False,
    'apiPrefixes': ['/api'],
    'sourceRoots': [],  # auto-detected when empty
    # No '.rb' by default: Rails routing is a stateful DSL (routes.rb draw block)
    # that a regex heuristic cannot parse honestly, so it is not claimed here.
    'backendGlobsExt': ['.py', '.js', '.ts', '.mjs', '.cjs', '.go', '.java', '.php'],
    'frontendGlobsExt': ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.vue', '.svelte'],
    'excludeDirs': ['node_modules', 'dist', 'build', '.git', '.cdd', 'coverage',
                    'vendor', '__pycache__', '.next', '.nuxt'],
    'ignorePaths': [],
    'checks': {
        # Heuristic regex scanning cannot resolve every cross-file route prefix
        # (aliased routers, dynamic mounts). Defaulting this to "warning" keeps a
        # scanner blind spot from breaking CI on a contract that is actually
        # correct; set it to "error" (or "strict": true) to enforce once the
        # project's routing shape is known to be fully resolvable.
        'backendRouteNotInContract': 'warning',
        'contractEndpointNotImplemented': 'warning',
        'frontendCallNotInContract': 'error',
    },
    'strict': False,
}

AUTO_ROOTS = ['src', 'app', 'lib', 'server', 'backend', 'frontend', 'web', 'api', 'pages', 'packages']


# ── contract parsing (mirrors validate_api_semantic.py table logic) ───────────

def strip_frontmatter(text: str) -> str:
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            return text[end + 4:].lstrip('\n')
    return text


def parse_table_row(line: str) -> list:
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def is_separator_row(cells: list) -> bool:
    return all(re.match(r'^:?-+:?$', c) for c in cells if c)


def find_contract_endpoints(lines: list) -> set:
    """Return a set of (METHOD, normalized_path) from all '| method |' tables."""
    in_table = False
    sep_seen = False
    endpoints = set()
    for line in lines:
        stripped = line.strip()
        if not stripped or not stripped.startswith('|'):
            continue
        cells = parse_table_row(stripped)
        if not cells:
            continue
        if cells[0].lower() == 'method':
            in_table = True
            sep_seen = False
            continue
        if not in_table:
            continue
        if not sep_seen and is_separator_row(cells):
            sep_seen = True
            continue
        if len(cells) < 2 or not any(cells):
            continue
        method = cells[0].upper()
        path = cells[1]
        if method not in VALID_METHODS or not path.startswith('/'):
            continue
        endpoints.add((method, normalize_path(path)))
    return endpoints


# ── path normalization ────────────────────────────────────────────────────────

PARAM_PATTERNS = [
    re.compile(r'\$\{[^}/]*\}'),             # ${id}          (js template literal) — before {id}
    re.compile(r':[A-Za-z_][\w]*'),          # :id            (express/rails)
    re.compile(r'\{[^}/]*\}'),               # {id}           (flask/fastapi/spring)
    re.compile(r'<[^>/]*>'),                 # <int:id>       (django/flask)
    re.compile(r'\*\*?'),                    # wildcard segments
]


def normalize_path(path: str) -> str:
    """Collapse route params and template interpolations to a single token so
    `/users/:id`, `/users/{id}`, and `/users/${x}` all compare equal."""
    # strip query string / hash
    path = path.split('?', 1)[0].split('#', 1)[0]
    for pat in PARAM_PATTERNS:
        path = pat.sub('{}', path)
    # template literal leftovers like /users/`+id+`  -> treat remainder as param
    path = re.sub(r'`.*$', '{}', path)
    if not path.startswith('/'):
        path = '/' + path
    if len(path) > 1:
        path = path.rstrip('/')
    # collapse duplicate slashes
    path = re.sub(r'/{2,}', '/', path)
    return path


def matches_ignore(path: str, ignore_list: list) -> bool:
    for ig in ignore_list:
        ig_norm = normalize_path(ig.rstrip('*'))
        if ig.endswith('*'):
            if path == ig_norm or path.startswith(ig_norm.rstrip('/') + '/') or path.startswith(ig_norm):
                return True
        elif path == normalize_path(ig):
            return True
    return False


def under_api_prefix(path: str, prefixes: list) -> bool:
    if not prefixes:
        return True
    for p in prefixes:
        pn = normalize_path(p)
        if path == pn or path.startswith(pn.rstrip('/') + '/'):
            return True
    return False


# ── source scanning ────────────────────────────────────────────────────────────

# Backend route patterns grouped by language. Only the patterns for a file's
# extension are applied to it, so a Python Flask/Django pattern can never match a
# PHP or JS file (cross-language false matches were polluting results, e.g. the
# Flask route regex firing on a Laravel `Route::match` line).
_JS_BACKEND = [
    # Express / Koa / Fastify: app.get('/x'), router.post("/x").
    # Client idioms (api/http/client/request/...) are intentionally excluded —
    # those are frontend calls, not server routes; counting them as backend
    # would silently satisfy `contractEndpointNotImplemented`.
    (re.compile(r'\b(?:app|router|server|fastify|route|routes)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*[\'"`]([^\'"`]+)[\'"`]', re.I), 'verb_first'),
]

# NestJS: @Controller('users') class prefix + @Get(':id') method decorators.
# Handled by a dedicated two-pass scanner (scan_nestjs) since the route path is
# the join of the controller prefix and the per-method decorator argument.
NEST_CONTROLLER_RE = re.compile(r'@Controller\s*\(\s*[\'"`]?([^\'"`)]*)[\'"`]?\s*\)', re.I)
NEST_METHOD_RE = re.compile(r'@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*[\'"`]?([^\'"`)]*)[\'"`]?\s*\)', re.I)
_PY_BACKEND = [
    # FastAPI/APIRouter and Flask 2.0 shorthand: @app.get("/x"), @router.post('/x'),
    # @bp.get('/x'). The receiver (group 1) is captured so a Blueprint/APIRouter
    # url_prefix/prefix can be folded in by _apply_prefix.
    (re.compile(r'@(\w+)\.(get|post|put|delete|patch|options|head)\s*\(\s*[\'"]([^\'"]+)[\'"]', re.I), 'py_verb_first'),
    # Flask: @app.route("/x", methods=["POST"])  (methods captured separately below).
    # Group 1 is the receiver (app/bp/...), group 2 the path, group 3 the call tail.
    (re.compile(r'@(\w+)\.route\s*\(\s*[\'"]([^\'"]+)[\'"]([^)]*)', re.I), 'flask_route'),
    # Django urls: path("x/", ...)  re_path(r"^x/$", ...)
    (re.compile(r'\b(?:path|re_path|url)\s*\(\s*r?[\'"]([^\'"]+)[\'"]', re.I), 'path_only'),
]
_JAVA_BACKEND = [
    # Spring: @GetMapping("/x")
    (re.compile(r'@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?[\'"]([^\'"]+)[\'"]', re.I), 'verb_first'),
    # Spring: @RequestMapping(value="/x", method=RequestMethod.POST) — method (if
    # present) is parsed from the call tail so method drift is not wildcarded.
    (re.compile(r'@RequestMapping\s*\(\s*(?:value\s*=\s*)?[\'"]([^\'"]+)[\'"]([^)]*)', re.I), 'spring_request_mapping'),
]
_GO_BACKEND = [
    # chi/gin/echo/mux: r.Get("/x", ...) router.POST("/x", ...) mux.HandleFunc("/x", ...)
    (re.compile(r'\b\w+\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"', re.I), 'verb_first'),
    (re.compile(r'\b\w+\.HandleFunc\s*\(\s*"([^"]+)"', re.I), 'path_only'),
]
_PHP_BACKEND = [
    # Laravel verb form: Route::get('/x', ...)
    (re.compile(r'\bRoute::(get|post|put|delete|patch|options|any)\s*\(\s*[\'"]([^\'"]+)[\'"]', re.I), 'verb_first'),
    # Laravel array form: Route::match(['get','post'], '/x', ...)
    (re.compile(r'\bRoute::match\s*\(\s*\[([^\]]*)\]\s*,\s*[\'"]([^\'"]+)[\'"]', re.I), 'laravel_match'),
]

BACKEND_PATTERNS_BY_EXT = {
    '.js': _JS_BACKEND, '.jsx': _JS_BACKEND, '.mjs': _JS_BACKEND, '.cjs': _JS_BACKEND,
    '.ts': _JS_BACKEND, '.tsx': _JS_BACKEND,
    '.py': _PY_BACKEND,
    '.java': _JAVA_BACKEND,
    '.go': _GO_BACKEND,
    '.php': _PHP_BACKEND,
}

FLASK_METHODS_RE = re.compile(r'methods\s*=\s*\[([^\]]*)\]', re.I)
SPRING_METHOD_RE = re.compile(r'method\s*=\s*\{?([^)}]*)', re.I)

# Cross-file route-prefix resolution for Flask Blueprint / FastAPI APIRouter.
# The argument capture `(?:[^()]|\([^()]*\))*` tolerates one level of nested
# parens so a kwarg like `dependencies=[Depends(auth)]` before `prefix=` does not
# truncate the capture. `(?:\w+\.)*` accepts qualified calls (flask.Blueprint,
# fastapi.APIRouter). `(?::[^=\n]+)?` tolerates an annotated assignment
# (`router: APIRouter = APIRouter(...)`) so the prefix is keyed to the receiver
# (`router`) rather than the type name. Constructor prefixes are resolved per
# file (see scan_backend) so a bare `router` reused across modules cannot collide.
# Constructor:  admin_bp = Blueprint("admin", __name__, url_prefix="/admin")
#               router: APIRouter = APIRouter(prefix="/admin")
_CALL_ARGS = r'((?:[^()]|\([^()]*\))*)'
BLUEPRINT_CTOR_RE = re.compile(r'(\w+)\s*(?::[^=\n]+)?=\s*(?:\w+\.)*(?:Blueprint|APIRouter)\s*\(' + _CALL_ARGS + r'\)', re.S)
# Registration (cross-file): group 1 is the verb (register_blueprint = Flask,
# url_prefix OVERRIDES the Blueprint's own; include_router = FastAPI, prefix is
# ADDITIVE with the APIRouter prefix), group 2 the receiver, group 3 the args.
#   app.register_blueprint(admin_bp, url_prefix="/admin")
#   app.include_router(router, prefix="/admin")
BLUEPRINT_REG_RE = re.compile(r'\b(register_blueprint|include_router)\s*\(\s*(\w+)\s*' + _CALL_ARGS + r'\)', re.S)
# url_prefix="/x" or prefix='/x' kwarg, read out of either call's argument list.
PREFIX_KWARG_RE = re.compile(r'(?:url_prefix|prefix)\s*=\s*[\'"]([^\'"]*)[\'"]')

# Frontend HTTP calls -> list of (method_or_None, raw_path). Only scanned in
# files with a frontend extension. The path capture allows ${...} template
# params (normalize_path collapses them) but stops at the closing quote/backtick,
# a paren, or whitespace.
_FE_PATH = r"([^`'\")\s]+)"
_FE_EXTS = {'.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte'}
FRONTEND_PATTERNS = [
    # axios.get('/x'), ky.post(`/x`), http.put("/x"), $http.delete('/x'), client.patch('/x')
    (re.compile(r'\b(?:axios|ky|http|\$http|api|client|request|httpClient|fetcher)\.(get|post|put|delete|patch|head|options)\s*\(\s*[`\'"]' + _FE_PATH, re.I), 'verb_first'),
    # fetch('/x', { method: 'POST' })  — method parsed from the options object below
    (re.compile(r'\bfetch\s*\(\s*[`\'"]' + _FE_PATH, re.I), 'fetch'),
    # axios({ url: '/x', method: 'post' }) — method parsed from a nearby window so
    # config-object method drift is caught instead of wildcarded.
    (re.compile(r'\burl\s*:\s*[`\'"]' + _FE_PATH, re.I), 'config_object'),
    # useFetch('/x') / useSWR('/x') — no method on the call site; method-agnostic.
    (re.compile(r'\b(?:useFetch|useSWR|useQuery)\s*\(\s*[`\'"]' + _FE_PATH, re.I), 'path_only'),
]

# Look a short window on EITHER side of a config-object `url:` for `method:`
# (the key order in axios({ method, url }) is not fixed).
OBJECT_METHOD_RE = re.compile(r'method\s*:\s*[`\'"](\w+)[`\'"]', re.I)
OBJECT_METHOD_WINDOW = 200


def iter_source_files(roots, exts, exclude_dirs):
    seen = set()
    excl = set(exclude_dirs)
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in excl and not d.startswith('.')]
            for fn in filenames:
                ext = os.path.splitext(fn)[1]
                if ext not in exts:
                    continue
                full = os.path.join(dirpath, fn)
                if full in seen:
                    continue
                seen.add(full)
                yield full


def looks_like_test(path: str) -> bool:
    base = os.path.basename(path).lower()
    return ('.test.' in base or '.spec.' in base or base.startswith('test_')
            or '/tests/' in path.replace('\\', '/') or '/__tests__/' in path.replace('\\', '/'))


def _join_route(prefix: str, suffix: str) -> str:
    parts = [p.strip('/') for p in (prefix, suffix) if p and p.strip('/')]
    return normalize_path('/' + '/'.join(parts)) if parts else normalize_path('/')


def _prefix_kwargs(text: str, pattern: re.Pattern) -> dict:
    """Collect {var: prefix} from constructor calls in `text`.

    Presence-checks the kwarg rather than truthiness so an explicit empty prefix
    (`url_prefix=""` / `prefix=""`, a deliberate root mount) is preserved and can
    override a value elsewhere, instead of being silently discarded."""
    out = {}
    for m in pattern.finditer(text):
        km = PREFIX_KWARG_RE.search(m.group(2))
        if km is not None:
            out[m.group(1)] = km.group(1)
    return out


def _apply_prefix(reg_prefixes: dict, local_ctor: dict, receiver: str, raw: str) -> str:
    """Fold a resolved Blueprint/APIRouter prefix into a route path.

    Combines a *file-local* constructor prefix (so a bare `router` reused in
    another module cannot fold these routes under the wrong prefix) with a
    cross-file registration prefix, respecting each framework's semantics:
      - Flask `register_blueprint(bp, url_prefix=...)` OVERRIDES the Blueprint's
        own `url_prefix`.
      - FastAPI `include_router(router, prefix=...)` is ADDITIVE — the served
        path is `<include prefix>/<APIRouter prefix>/<route>`.
    `reg_prefixes` maps receiver -> (verb, prefix); ambiguous receivers (the same
    name registered with conflicting prefixes across files) are dropped upstream
    so the per-file constructor prefix wins instead of a guessed one. An explicit
    empty registration prefix (`register_blueprint(bp, url_prefix="")`) is a
    deliberate root mount and still shadows the constructor prefix — the route
    resolves to root, not the constructor's value. Receivers with no resolved
    prefix (the Flask `app` itself, or a shape the heuristic cannot follow) pass
    through unchanged — that residual gap is why backendRouteNotInContract
    defaults to a warning."""
    ctor = local_ctor.get(receiver)
    reg = reg_prefixes.get(receiver)
    if reg is not None:
        verb, rprefix = reg
        # FastAPI: include_router prefix + APIRouter prefix. Flask: override.
        prefix = _join_route(rprefix, ctor) if (verb == 'include_router' and ctor) else rprefix
    else:
        prefix = ctor
    return _join_route(prefix, raw) if prefix else normalize_path(raw)


def scan_nestjs(text: str):
    """Yield (METHOD, normalized_path) for NestJS controllers in one file.

    Each method decorator's path is joined with the nearest preceding
    @Controller(prefix). This is the documented NestJS shape; it deliberately
    does not try to resolve dynamic prefixes or RouterModule registrations."""
    controllers = [(m.start(), m.group(1) or '') for m in NEST_CONTROLLER_RE.finditer(text)]
    if not controllers:
        return
    for mm in NEST_METHOD_RE.finditer(text):
        prefix = ''
        for pos, pfx in controllers:
            if pos < mm.start():
                prefix = pfx
            else:
                break
        method = mm.group(1).upper()
        method = 'ANY' if method == 'ALL' else method
        yield (method, _join_route(prefix, mm.group(2) or ''))


def scan_backend(roots, exts, exclude_dirs):
    """Return set of (METHOD, normalized_path). METHOD may be 'ANY'."""
    routes = set()
    # Pre-pass: read every Python file once (caching the text so the main loop
    # below does not re-read it — these two passes used to double the .py IO) and
    # resolve cross-file *registration* prefixes (register_blueprint /
    # include_router). Constructor prefixes are resolved per file in the main
    # loop so a bare `router` name reused across modules cannot collide.
    py_text = {}
    reg_seen = {}  # receiver -> {(verb, prefix), ...}  (collision detection)
    for path in iter_source_files(roots, {'.py'}, exclude_dirs):
        if looks_like_test(path):
            continue
        try:
            text = Path(path).read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        py_text[path] = text
        for m in BLUEPRINT_REG_RE.finditer(text):
            km = PREFIX_KWARG_RE.search(m.group(3))
            if km is not None:  # presence, not truthiness: keep an explicit ""
                reg_seen.setdefault(m.group(2), set()).add((m.group(1).lower(), km.group(1)))
    # Keep only receivers registered with a single, unambiguous prefix. A name
    # registered under conflicting prefixes across files (e.g. two modules each
    # `include_router(router, prefix=...)`) is dropped so the per-file
    # constructor prefix decides rather than whichever was scanned last. When the
    # routers carry no constructor prefix either, that receiver is left
    # unresolved (a warning under the default) rather than mis-attributed —
    # resolving it would need import tracking (which module each bare `router`
    # came from), which this regex heuristic deliberately does not attempt.
    reg_prefixes = {var: next(iter(entries)) for var, entries in reg_seen.items()
                    if len({prefix for _, prefix in entries}) == 1}

    for path in iter_source_files(roots, exts, exclude_dirs):
        if looks_like_test(path):
            continue
        ext = os.path.splitext(path)[1].lower()
        patterns = BACKEND_PATTERNS_BY_EXT.get(ext)
        if not patterns:
            continue
        text = py_text.get(path)
        if text is None:
            try:
                text = Path(path).read_text(encoding='utf-8', errors='ignore')
            except OSError:
                continue
        # Constructor prefixes are scoped to this file (see _apply_prefix).
        local_ctor = _prefix_kwargs(text, BLUEPRINT_CTOR_RE) if ext == '.py' else {}
        if ext in ('.ts', '.tsx', '.js', '.mjs', '.cjs'):
            routes.update(scan_nestjs(text))
        for pat, kind in patterns:
            for m in pat.finditer(text):
                if kind == 'verb_first':
                    method = m.group(1).upper()
                    raw = m.group(2)
                    method = 'ANY' if method == 'ALL' else method
                    routes.add((method, normalize_path(raw)))
                elif kind == 'py_verb_first':
                    receiver = m.group(1)
                    method = m.group(2).upper()
                    raw = m.group(3)
                    method = 'ANY' if method == 'ALL' else method
                    routes.add((method, _apply_prefix(reg_prefixes, local_ctor, receiver, raw)))
                elif kind == 'flask_route':
                    receiver = m.group(1)
                    raw = m.group(2)
                    tail = m.group(3) or ''
                    full = _apply_prefix(reg_prefixes, local_ctor, receiver, raw)
                    mm = FLASK_METHODS_RE.search(tail)
                    if mm:
                        for meth in re.findall(r'[A-Za-z]+', mm.group(1)):
                            if meth.upper() in VALID_METHODS:
                                routes.add((meth.upper(), full))
                    else:
                        routes.add(('GET', full))
                elif kind == 'path_only':
                    routes.add(('ANY', normalize_path(m.group(1))))
                elif kind == 'laravel_match':
                    methods_raw = m.group(1)
                    raw = m.group(2)
                    found = [meth.upper() for meth in re.findall(r'[A-Za-z]+', methods_raw)
                             if meth.upper() in VALID_METHODS]
                    for meth in (found or ['ANY']):
                        routes.add((meth, normalize_path(raw)))
                elif kind == 'spring_request_mapping':
                    raw = m.group(1)
                    tail = m.group(2) or ''
                    mm = SPRING_METHOD_RE.search(tail)
                    methods = []
                    if mm:
                        # method=RequestMethod.POST  or  method={RequestMethod.GET, RequestMethod.POST}
                        methods = [tok.upper() for tok in re.findall(r'[A-Za-z]+', mm.group(1))
                                   if tok.upper() in VALID_METHODS]
                    for meth in (methods or ['ANY']):
                        routes.add((meth, normalize_path(raw)))
    return routes


def scan_frontend(roots, exts, exclude_dirs):
    calls = set()
    for path in iter_source_files(roots, exts, exclude_dirs):
        if looks_like_test(path):
            continue
        if os.path.splitext(path)[1].lower() not in _FE_EXTS:
            continue
        try:
            text = Path(path).read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for pat, kind in FRONTEND_PATTERNS:
            for m in pat.finditer(text):
                if kind == 'verb_first':
                    method = m.group(1).upper()
                    raw = m.group(2)
                elif kind == 'fetch':
                    raw = m.group(1)
                    # Per the fetch spec the default method is GET; look a short
                    # window past the URL for an explicit `method:` so method
                    # drift (e.g. DELETE on a GET-only endpoint) is caught.
                    window = text[m.end():m.end() + OBJECT_METHOD_WINDOW]
                    mm = OBJECT_METHOD_RE.search(window)
                    method = mm.group(1).upper() if mm else 'GET'
                elif kind == 'config_object':
                    raw = m.group(1)
                    # axios({ url, method }) — key order is not fixed, so scan a
                    # window on both sides of the url: token for method:.
                    lo = max(0, m.start() - OBJECT_METHOD_WINDOW)
                    window = text[lo:m.end() + OBJECT_METHOD_WINDOW]
                    mm = OBJECT_METHOD_RE.search(window)
                    method = mm.group(1).upper() if mm else 'ANY'
                else:  # path_only
                    method = 'ANY'
                    raw = m.group(1)
                if not raw.startswith('/'):
                    continue  # skip absolute URLs / relative non-rooted strings
                calls.add((method, normalize_path(raw)))
    return calls


# ── contract matching ──────────────────────────────────────────────────────────

def contract_has(method: str, path: str, contract: set) -> bool:
    """A code endpoint conforms if some entry matches the path and the method
    matches OR *either* side is method-agnostic ('ANY'). Path-only declarations
    (Go HandleFunc, Django path(), Spring @RequestMapping) register as 'ANY' and
    must therefore satisfy a concrete contract method, and vice versa."""
    for c_method, c_path in contract:
        if c_path != path:
            continue
        if method == 'ANY' or c_method == 'ANY' or c_method == method:
            return True
    return False


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if not CONFIG_PATH.exists():
        return cfg, False
    try:
        user = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'API conformance: .cdd/conformance.json is not valid JSON: {e}')
        sys.exit(1)
    cfg.update({k: v for k, v in user.items() if k != 'checks'})
    if isinstance(user.get('checks'), dict):
        merged = dict(DEFAULT_CONFIG['checks'])
        merged.update(user['checks'])
        cfg['checks'] = merged
    return cfg, True


def resolve_roots(cfg):
    roots = cfg.get('sourceRoots') or []
    if roots:
        return [r for r in roots if os.path.isdir(r)]
    return [r for r in AUTO_ROOTS if os.path.isdir(r)]


def severity(check_name, cfg):
    sev = cfg['checks'].get(check_name, 'error')
    if cfg.get('strict') and sev == 'warning':
        return 'error'
    return sev


def main() -> None:
    cfg, present = load_config()

    if not present:
        print('API conformance: skipped (no .cdd/conformance.json; '
              'add one with "enabled": true to enforce code-vs-contract checks).')
        sys.exit(0)
    if not cfg.get('enabled'):
        print('API conformance: skipped (.cdd/conformance.json has "enabled": false).')
        sys.exit(0)

    if not CONTRACT_PATH.exists():
        print(f'API conformance: contract not found: {CONTRACT_PATH}')
        sys.exit(1)

    # ADR 0011: defensive self-skip (validate_contracts.py / validate_api_semantic.py
    # are the primary enforcement points, but this validator can also be run
    # standalone). An invalid marker is still a hard error.
    applicability = classify_file(CONTRACT_PATH)
    if applicability.status == 'invalid':
        print('API conformance validation failed:')
        print(f'  {applicability.error}')
        sys.exit(1)
    if applicability.status == 'not-applicable':
        print(f'API conformance: skipped (API contract marked applicability: not-applicable — {applicability.reason}).')
        sys.exit(0)

    body = strip_frontmatter(CONTRACT_PATH.read_text(encoding='utf-8', errors='ignore'))
    contract = find_contract_endpoints(body.splitlines())
    if not contract:
        print('API conformance: no endpoint table found in contract; nothing to check.')
        sys.exit(0)

    roots = resolve_roots(cfg)
    if not roots:
        # Enabled but nothing to scan almost always means a mistyped/missing
        # sourceRoots. Failing (not exit 0) prevents a config mistake from
        # silently disabling the drift net while the gate stays green.
        print('API conformance validation failed:')
        print('  conformance is enabled but no source roots were found to scan; '
              'set "sourceRoots" in .cdd/conformance.json to existing directories.')
        sys.exit(1)

    exclude = cfg['excludeDirs']
    ignore = cfg['ignorePaths']
    prefixes = cfg['apiPrefixes']

    backend = scan_backend(roots, set(cfg['backendGlobsExt']), exclude)
    frontend = scan_frontend(roots, set(cfg['frontendGlobsExt']), exclude)

    errors = []
    warnings = []

    def emit(check_name, message):
        (errors if severity(check_name, cfg) == 'error' else warnings).append(message)

    # 1. Backend routes that are not documented in the contract.
    for method, path in sorted(backend):
        if matches_ignore(path, ignore):
            continue
        if not under_api_prefix(path, prefixes):
            continue
        if not contract_has(method, path, contract):
            emit('backendRouteNotInContract',
                 f'backend route {method} {path} is not in the API contract')

    # 2. Contract endpoints with no backend implementation found.
    for method, path in sorted(contract):
        if matches_ignore(path, ignore):
            continue
        if not contract_has(method, path, backend):
            emit('contractEndpointNotImplemented',
                 f'contract endpoint {method} {path} has no backend route in scanned source')

    # 3. Frontend calls to paths not in the contract (the FE/BE drift case).
    for method, path in sorted(frontend):
        if matches_ignore(path, ignore):
            continue
        if not under_api_prefix(path, prefixes):
            continue
        if not contract_has(method, path, contract):
            label = path if method == 'ANY' else f'{method} {path}'
            emit('frontendCallNotInContract',
                 f'frontend calls {label} which is not in the API contract')

    print(f'API conformance: contract={len(contract)} endpoint(s), '
          f'backend={len(backend)} route(s), frontend={len(frontend)} call(s) '
          f'across roots: {", ".join(roots)}')

    if warnings:
        print('API conformance warnings:')
        for w in warnings:
            print(f'  {w}')

    if errors:
        print('API conformance validation failed:')
        for e in errors:
            print(f'  {e}')
        sys.exit(1)

    print('API conformance validation passed.')


if __name__ == '__main__':
    main()
