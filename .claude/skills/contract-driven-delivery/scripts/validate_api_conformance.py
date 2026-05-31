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
  "backendGlobsExt": [".py", ".js", ".ts", ".go", ".java", ".php", ".rb"],
  "frontendGlobsExt": [".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"],
  "excludeDirs": ["node_modules", "dist", "build", ".git", "tests", "__tests__"],
  "ignorePaths": ["/health", "/metrics"],  // contract+code paths to ignore (supports trailing *)
  "checks": {
    "backendRouteNotInContract": "error",
    "contractEndpointNotImplemented": "warning",
    "frontendCallNotInContract": "error"
  },
  "strict": false                   // escalate all warnings to errors
}
"""
import json
import os
import re
import sys
from pathlib import Path

CONTRACT_PATH = Path('contracts/api/api-contract.md')
CONFIG_PATH = Path('.cdd/conformance.json')

VALID_METHODS = {'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'}

DEFAULT_CONFIG = {
    'enabled': False,
    'apiPrefixes': ['/api'],
    'sourceRoots': [],  # auto-detected when empty
    'backendGlobsExt': ['.py', '.js', '.ts', '.mjs', '.cjs', '.go', '.java', '.php', '.rb'],
    'frontendGlobsExt': ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.vue', '.svelte'],
    'excludeDirs': ['node_modules', 'dist', 'build', '.git', '.cdd', 'coverage',
                    'vendor', '__pycache__', '.next', '.nuxt'],
    'ignorePaths': [],
    'checks': {
        'backendRouteNotInContract': 'error',
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

# Backend route declarations -> list of (method_or_None, raw_path)
BACKEND_PATTERNS = [
    # Express / Koa / Fastify / NestJS-ish: app.get('/x'), router.post("/x"), r.put(`/x`)
    (re.compile(r'\b(?:app|router|api|server|fastify|r|route|routes)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*[\'"`]([^\'"`]+)[\'"`]', re.I), 'verb_first'),
    # FastAPI / APIRouter decorators: @app.get("/x"), @router.post('/x')
    (re.compile(r'@(?:app|router|api|blueprint|bp|\w+)\.(get|post|put|delete|patch|options|head)\s*\(\s*[\'"]([^\'"]+)[\'"]', re.I), 'verb_first'),
    # Flask: @app.route("/x", methods=["POST"])  (methods captured separately below)
    (re.compile(r'@(?:app|bp|blueprint|\w+)\.route\s*\(\s*[\'"]([^\'"]+)[\'"]([^)]*)', re.I), 'flask_route'),
    # Django urls: path("x/", ...)  re_path(r"^x/$", ...)
    (re.compile(r'\b(?:path|re_path|url)\s*\(\s*[\'"]([^\'"]+)[\'"]', re.I), 'path_only'),
    # Spring: @GetMapping("/x") @RequestMapping(value="/x", method=RequestMethod.POST)
    (re.compile(r'@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?[\'"]([^\'"]+)[\'"]', re.I), 'verb_first'),
    (re.compile(r'@RequestMapping\s*\(\s*(?:value\s*=\s*)?[\'"]([^\'"]+)[\'"]', re.I), 'path_only'),
    # Go chi/gin/echo/mux: r.Get("/x", ...) router.POST("/x", ...) mux.HandleFunc("/x", ...)
    (re.compile(r'\b\w+\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"', re.I), 'verb_first'),
    (re.compile(r'\b\w+\.HandleFunc\s*\(\s*"([^"]+)"', re.I), 'path_only'),
    # Laravel: Route::get('/x', ...)
    (re.compile(r'\bRoute::(get|post|put|delete|patch|options|any|match)\s*\(\s*[\'"]([^\'"]+)[\'"]', re.I), 'verb_first'),
]

FLASK_METHODS_RE = re.compile(r'methods\s*=\s*\[([^\]]*)\]', re.I)

# Frontend HTTP calls -> list of (method_or_None, raw_path)
# The capture allows ${...} template params (normalize_path collapses them) but
# stops at the closing quote/backtick, a paren, or whitespace.
_FE_PATH = r"([^`'\")\s]+)"
FRONTEND_PATTERNS = [
    # axios.get('/x'), http.post(`/x`), api.put("/x"), $http.delete('/x'), client.patch('/x')
    (re.compile(r'\b(?:axios|http|\$http|api|client|request|httpClient|fetcher)\.(get|post|put|delete|patch|head|options)\s*\(\s*[`\'"]' + _FE_PATH, re.I), 'verb_first'),
    # fetch('/x')  fetch(`/x`)  — method comes from 2nd arg, handled by post-scan
    (re.compile(r'\bfetch\s*\(\s*[`\'"]' + _FE_PATH, re.I), 'fetch'),
    # axios({ url: '/x', method: 'post' })  / useFetch('/x') / useSWR('/x')
    (re.compile(r'\burl\s*:\s*[`\'"]' + _FE_PATH, re.I), 'path_only'),
    (re.compile(r'\b(?:useFetch|useSWR|useQuery)\s*\(\s*[`\'"]' + _FE_PATH, re.I), 'path_only'),
]


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


def scan_backend(roots, exts, exclude_dirs):
    """Return set of (METHOD, normalized_path). METHOD may be 'ANY'."""
    routes = set()
    for path in iter_source_files(roots, exts, exclude_dirs):
        if looks_like_test(path):
            continue
        try:
            text = Path(path).read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for pat, kind in BACKEND_PATTERNS:
            for m in pat.finditer(text):
                if kind == 'verb_first':
                    method = m.group(1).upper()
                    raw = m.group(2)
                    method = 'ANY' if method == 'ALL' else method
                    routes.add((method, normalize_path(raw)))
                elif kind == 'flask_route':
                    raw = m.group(1)
                    tail = m.group(2) or ''
                    mm = FLASK_METHODS_RE.search(tail)
                    if mm:
                        for meth in re.findall(r'[A-Za-z]+', mm.group(1)):
                            if meth.upper() in VALID_METHODS:
                                routes.add((meth.upper(), normalize_path(raw)))
                    else:
                        routes.add(('GET', normalize_path(raw)))
                elif kind == 'path_only':
                    routes.add(('ANY', normalize_path(m.group(1))))
    return routes


def scan_frontend(roots, exts, exclude_dirs):
    calls = set()
    for path in iter_source_files(roots, exts, exclude_dirs):
        if looks_like_test(path):
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
                    method = 'ANY'  # method lives in 2nd arg; treat as wildcard
                    raw = m.group(1)
                else:  # path_only
                    method = 'ANY'
                    raw = m.group(1)
                if not raw.startswith('/'):
                    continue  # skip absolute URLs / relative non-rooted strings
                calls.add((method, normalize_path(raw)))
    return calls


# ── contract matching ──────────────────────────────────────────────────────────

def contract_has(method: str, path: str, contract: set) -> bool:
    """A code endpoint conforms if some contract entry matches the path and
    (the method matches OR either side is method-agnostic 'ANY')."""
    for c_method, c_path in contract:
        if c_path != path:
            continue
        if method == 'ANY' or c_method == method:
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

    body = strip_frontmatter(CONTRACT_PATH.read_text(encoding='utf-8', errors='ignore'))
    contract = find_contract_endpoints(body.splitlines())
    if not contract:
        print('API conformance: no endpoint table found in contract; nothing to check.')
        sys.exit(0)

    roots = resolve_roots(cfg)
    if not roots:
        print('API conformance: no source roots found to scan '
              '(set "sourceRoots" in .cdd/conformance.json).')
        sys.exit(0)

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
