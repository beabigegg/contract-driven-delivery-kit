/**
 * Tests for the code-vs-contract API conformance validator
 * (.claude/skills/contract-driven-delivery/scripts/validate_api_conformance.py).
 *
 * This is the mechanical net that catches frontend/backend drift against
 * contracts/api/api-contract.md — the gap the markdown-only validators leave
 * open. The validator is invoked directly here to isolate it from the rest of
 * the contract chain.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '.claude', 'skills', 'contract-driven-delivery', 'scripts', 'validate_api_conformance.py',
);

function python(): string {
  for (const cmd of ['python3', 'python']) {
    if (spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0) return cmd;
  }
  return 'python3';
}

function run(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(python(), [SCRIPT], { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function writeApiContract(repo: string, rows: string[]): void {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|--------|------|------|----------------|-----------------|--------|-------|',
    ...rows,
  ].join('\n');
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'),
    `---\ncontract: api\n---\n\n# API Contract\n\n## Endpoints\n${table}\n`, 'utf8');
}

function writeConfig(repo: string, cfg: Record<string, unknown>): void {
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  writeFileSync(join(repo, '.cdd', 'conformance.json'), JSON.stringify(cfg), 'utf8');
}

function writeSrc(repo: string, rel: string, content: string): void {
  const full = join(repo, 'src', rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

const ENABLED = { enabled: true, apiPrefixes: ['/api'], sourceRoots: ['src'] };

let repo: string;
beforeEach(() => { repo = makeTempDir('conformance-'); });
afterEach(() => cleanupDir(repo));

describe('validate_api_conformance.py', () => {
  it('skips when no config is present (never breaks repos that opt out)', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    const r = run(repo);
    expect(r.status).toBe(0);
    expect(r.out).toContain('skipped (no .cdd/conformance.json');
  });

  it('skips when config is present but disabled', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, { enabled: false });
    const r = run(repo);
    expect(r.status).toBe(0);
    expect(r.out).toContain('enabled": false');
  });

  it('passes when backend routes and frontend calls all match the contract', () => {
    if (!hasPython()) return;
    writeApiContract(repo, [
      '| GET | /api/users | required | - | User[] | 401 | yes |',
      '| POST | /api/users | required | User | User | 400 | yes |',
    ]);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js',
      "app.get('/api/users', h);\napp.post('/api/users', h);\n");
    writeSrc(repo, 'web/api.js',
      "axios.get('/api/users');\naxios.post('/api/users', body);\n");
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('fails when the frontend calls a path that is not in the contract', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\n");
    writeSrc(repo, 'web/api.js', "axios.get('/api/orders');\n");
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('frontend calls');
    expect(r.out).toContain('/api/orders');
  });

  it('fails when a backend route is missing from the contract (check set to error)', () => {
    if (!hasPython()) return;
    // backendRouteNotInContract defaults to "warning" (a regex scan cannot
    // resolve every cross-file route prefix, so a blind spot must not break CI).
    // Projects that want it enforced raise it to "error" — exercised here.
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, { ...ENABLED, checks: { backendRouteNotInContract: 'error' } });
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\napp.delete('/api/secret', h);\n");
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('backend route DELETE /api/secret');
  });

  it('reports a missing backend route as a warning (not a CI failure) by default', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\napp.delete('/api/secret', h);\n");
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance warnings:');
    expect(r.out).toContain('backend route DELETE /api/secret');
  });

  it('normalizes route params so :id, {id} and ${id} compare equal', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users/{id} | required | - | User | 404 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users/:id', h);\n");
    writeSrc(repo, 'web/api.js', 'axios.get(`/api/users/${userId}`);\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('treats unimplemented contract endpoints as warning by default, error under strict', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/ghost | required | - | X | 404 | yes |']);
    // No backend route for /api/ghost.
    writeConfig(repo, { ...ENABLED });
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\n");
    const lenient = run(repo);
    // /api/users is an undocumented backend route -> that already errors; isolate
    // the unimplemented check by documenting /api/users too.
    writeApiContract(repo, [
      '| GET | /api/ghost | required | - | X | 404 | yes |',
      '| GET | /api/users | required | - | User[] | 401 | yes |',
    ]);
    const lenient2 = run(repo);
    expect(lenient2.status, lenient2.out).toBe(0);
    expect(lenient2.out).toContain('has no backend route');

    writeConfig(repo, { ...ENABLED, strict: true });
    const strict = run(repo);
    expect(strict.status).toBe(1);
    void lenient;
  });

  it('does not count a frontend api.* client wrapper as a backend route', () => {
    if (!hasPython()) return;
    // /api/users is documented and called via an axios-style `api.get`, but there
    // is NO server route — the contract endpoint must still report unimplemented.
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'web/api.js', "export const api = axios.create();\napi.get('/api/users');\n");
    const r = run(repo);
    expect(r.status, r.out).toBe(0); // unimplemented is a warning by default
    expect(r.out).toContain('has no backend route');
  });

  it('treats a path-only backend route (ANY) as satisfying a concrete contract method', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, { ...ENABLED, strict: true });
    // Django-style path() registers as method-agnostic ANY.
    writeSrc(repo, 'server/urls.py', "urlpatterns = [path('api/users/', view)]\n");
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('catches fetch() method drift and defaults bare fetch to GET', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\n");
    writeSrc(repo, 'web/api.js', "fetch('/api/users', { method: 'DELETE' });\n");
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('DELETE /api/users');
  });

  it('recognizes Laravel Route::match array form', () => {
    if (!hasPython()) return;
    writeApiContract(repo, [
      '| GET | /api/users | required | - | User[] | 401 | yes |',
      '| POST | /api/users | required | User | User | 400 | yes |',
    ]);
    writeConfig(repo, { ...ENABLED, strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'server/routes.php', "Route::match(['get', 'post'], '/api/users', 'C@m');\n");
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('scans ky client calls for drift', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\n");
    writeSrc(repo, 'web/api.js', "ky.get('/api/orders');\n");
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('/api/orders');
  });

  it('catches axios config-object method drift', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\n");
    writeSrc(repo, 'web/api.js', "axios({ url: '/api/users', method: 'delete' });\n");
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('DELETE /api/users');
  });

  it('parses Spring @RequestMapping method instead of wildcarding it', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, { ...ENABLED, strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'server/UserController.java',
      '@RequestMapping(value="/api/users", method=RequestMethod.POST)\npublic X create() {}\n');
    const r = run(repo);
    // POST route + GET-only contract -> backend route not in contract.
    expect(r.status).toBe(1);
    expect(r.out).toContain('POST /api/users');
  });

  it('detects NestJS @Controller + @Get decorator routes', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users/{id} | required | - | User | 404 | yes |']);
    writeConfig(repo, { ...ENABLED, strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'server/users.controller.ts',
      "@Controller('api/users')\nexport class UsersController {\n  @Get(':id')\n  findOne() {}\n}\n");
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('resolves a Flask Blueprint url_prefix declared in a separate file (issue #15)', () => {
    if (!hasPython()) return;
    // Contract documents the prefixed paths; the routes carry only the suffix,
    // and the /admin prefix is added by register_blueprint in another file.
    // strict mode escalates backendRouteNotInContract to error, so a regression
    // (prefix not resolved) would fail this test loudly.
    writeApiContract(repo, [
      '| GET | /admin/api/logs | required | - | Log[] | 401 | yes |',
      '| GET | /admin/api/drawers | required | - | Drawer[] | 401 | yes |',
    ]);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/admin'], sourceRoots: ['src'], strict: true });
    writeSrc(repo, 'routes/admin_routes.py',
      'admin_bp = Blueprint("admin", __name__, url_prefix="/admin")\n'
      + '@admin_bp.route("/api/logs", methods=["GET"])\ndef logs(): ...\n'
      + '@admin_bp.route("/api/drawers", methods=["GET"])\ndef drawers(): ...\n');
    writeSrc(repo, 'app.py',
      'from routes.admin_routes import admin_bp\napp.register_blueprint(admin_bp)\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('resolves a FastAPI APIRouter prefix and still flags genuinely missing routes', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /admin/items | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/admin'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    // /admin/items is documented; /admin/secret is not -> the prefix must fold
    // into the route path for BOTH the match and the error message.
    writeSrc(repo, 'routes.py',
      'router = APIRouter(prefix="/admin")\n'
      + '@router.get("/items")\ndef items(): ...\n'
      + '@router.get("/secret")\ndef secret(): ...\n');
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('GET /admin/secret');
    expect(r.out).not.toContain('/admin/items is not in');
  });

  it('applies a Blueprint prefix supplied only at register_blueprint', () => {
    if (!hasPython()) return;
    // No url_prefix on the constructor; the /admin prefix is added solely at the
    // registration call (in another file) — the cross-file registration map must
    // still resolve it.
    writeApiContract(repo, ['| GET | /admin/items | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/admin'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'routes/admin.py',
      'admin_bp = Blueprint("admin", __name__)\n@admin_bp.route("/items")\ndef items(): ...\n');
    writeSrc(repo, 'app.py',
      'from routes.admin import admin_bp\napp.register_blueprint(admin_bp, url_prefix="/admin")\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('lets a register_blueprint prefix override the constructor url_prefix', () => {
    if (!hasPython()) return;
    // Constructor says /old, registration says /admin — registration wins, so the
    // route resolves to /admin/items (documented) and NOT /old/items.
    writeApiContract(repo, ['| GET | /admin/items | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/admin', '/old'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'routes/admin.py',
      'admin_bp = Blueprint("admin", __name__, url_prefix="/old")\n@admin_bp.route("/items")\ndef items(): ...\n');
    writeSrc(repo, 'app.py',
      'from routes.admin import admin_bp\napp.register_blueprint(admin_bp, url_prefix="/admin")\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('scopes a reused `router` prefix per file (FastAPI APIRouter, no cross-module collision)', () => {
    if (!hasPython()) return;
    // Both modules name the router `router` with different prefixes — a global
    // var->prefix map would fold every route under whichever was scanned last.
    writeApiContract(repo, [
      '| GET | /users/list | required | - | User[] | 401 | yes |',
      '| GET | /orders/list | required | - | Order[] | 401 | yes |',
    ]);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/users', '/orders'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'users.py', 'router = APIRouter(prefix="/users")\n@router.get("/list")\ndef l(): ...\n');
    writeSrc(repo, 'orders.py', 'router = APIRouter(prefix="/orders")\n@router.get("/list")\ndef l(): ...\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('reads the prefix kwarg past a nested-paren kwarg in the constructor', () => {
    if (!hasPython()) return;
    // `dependencies=[Depends(auth)]` before `prefix=` must not truncate the
    // constructor-args capture (a plain [^)]* would stop at the Depends paren).
    writeApiContract(repo, ['| GET | /admin/items | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/admin'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'routes.py',
      'router = APIRouter(dependencies=[Depends(auth)], prefix="/admin")\n@router.get("/items")\ndef i(): ...\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('resolves a module-qualified constructor name (flask.Blueprint / fastapi.APIRouter)', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /admin/items | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/admin'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'routes.py',
      'bp = flask.Blueprint("a", __name__, url_prefix="/admin")\n@bp.get("/items")\ndef i(): ...\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('composes a FastAPI include_router prefix additively with the APIRouter prefix', () => {
    if (!hasPython()) return;
    // FastAPI serves @router.get("/list") at <include prefix>/<APIRouter prefix>/list,
    // i.e. /api/items/list — the registration prefix must NOT replace the
    // constructor prefix (that is Flask's semantics, not FastAPI's).
    writeApiContract(repo, ['| GET | /api/items/list | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/api'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'items.py', 'router = APIRouter(prefix="/items")\n@router.get("/list")\ndef l(): ...\n');
    writeSrc(repo, 'app.py', 'from items import router\napp.include_router(router, prefix="/api")\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('does not misroute when the same router name is registered with conflicting prefixes', () => {
    if (!hasPython()) return;
    // app.py registers a reused `router` name under two different prefixes; that
    // ambiguous registration must be dropped so each module's per-file APIRouter
    // prefix decides, rather than the last-scanned registration clobbering both.
    writeApiContract(repo, [
      '| GET | /users/list | required | - | User[] | 401 | yes |',
      '| GET | /orders/list | required | - | Order[] | 401 | yes |',
    ]);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/users', '/orders'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'users.py', 'router = APIRouter(prefix="/users")\n@router.get("/list")\ndef l(): ...\n');
    writeSrc(repo, 'orders.py', 'router = APIRouter(prefix="/orders")\n@router.get("/list")\ndef l(): ...\n');
    writeSrc(repo, 'app.py',
      'from users import router\napp.include_router(router, prefix="/users")\n'
      + 'from orders import router\napp.include_router(router, prefix="/orders")\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('keys the prefix to the receiver on a type-annotated router assignment', () => {
    if (!hasPython()) return;
    // `router: APIRouter = APIRouter(prefix="/admin")` — the prefix must attach to
    // `router`, not the `APIRouter` annotation, so @router.get resolves prefixed.
    writeApiContract(repo, ['| GET | /admin/items | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/admin'], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'routes.py',
      'router: APIRouter = APIRouter(prefix="/admin")\n@router.get("/items")\ndef i(): ...\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('honors an explicit empty register_blueprint url_prefix as a root-mount override', () => {
    if (!hasPython()) return;
    // Blueprint('/old') is deliberately mounted at root via url_prefix="" — Flask
    // serves /items, so the empty registration prefix must override the
    // constructor's /old, not be discarded as falsy (which would invent /old/items
    // and report the real /items as unimplemented).
    writeApiContract(repo, ['| GET | /items | required | - | Item[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: [], sourceRoots: ['src'], strict: true, frontendGlobsExt: [] });
    writeSrc(repo, 'routes/admin.py',
      'admin_bp = Blueprint("a", __name__, url_prefix="/old")\n@admin_bp.route("/items")\ndef i(): ...\n');
    writeSrc(repo, 'app.py',
      'from routes.admin import admin_bp\napp.register_blueprint(admin_bp, url_prefix="")\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('fails when enabled but no source roots resolve (config mistake)', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, { enabled: true, apiPrefixes: ['/api'], sourceRoots: ['does-not-exist'] });
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('no source roots were found');
  });
});
