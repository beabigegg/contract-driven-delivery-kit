import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { isAbsolute, relative, resolve, sep } from 'path';
import type { BoundaryOperation, BoundaryVariant } from '../runtime/types.js';

export const BOUNDARY_ADAPTER_VERSION = '1.0.0';

export interface AdapterCaptureResult {
  body: unknown;
  status: number;
  content_type: string;
  runner_version: string;
  target_digest: string;
  target_file: string;
}

function sha(value: string): string { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function captureTargetDigest(operation: Pick<BoundaryOperation, 'method' | 'path'>, variant: BoundaryVariant): string {
  const capture = variant.capture;
  if (!capture) throw new Error(`Variant ${variant.id} has no registered capture.`);
  const request = capture.request ?? {};
  const path = request.path ?? operation.path;
  return sha(stable({ adapter: capture.adapter, target: capture.target, request, method: operation.method, path }));
}

const PYTHON_CAPTURE = String.raw`
import importlib, importlib.metadata, json, os, sys
kind, target, method, path, request_json = sys.argv[1:6]
module_name, attr = target.split(':', 1)
module = importlib.import_module(module_name)
app = getattr(module, attr)
request = json.loads(request_json)
if kind == 'fastapi-testclient':
    from fastapi.testclient import TestClient
    client = TestClient(app)
    version = importlib.metadata.version('fastapi')
else:
    client = app.test_client()
    version = importlib.metadata.version('flask')
kwargs = {'headers': request.get('headers') or {}}
if request.get('query'): kwargs['query_string'] = request['query']
if 'json' in request: kwargs['json'] = request['json']
response = client.open(path, method=method, **kwargs)
try: body = response.json()
except Exception:
    try: body = response.get_json()
    except Exception: body = response.get_data(as_text=True)
content_type = response.headers.get('content-type', '').split(';', 1)[0]
print(json.dumps({'body': body, 'status': response.status_code, 'content_type': content_type, 'runner_version': version, 'target_file': os.path.realpath(module.__file__)}))
`;

const EXPRESS_CAPTURE = String.raw`
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { createRequire } from 'module';
const [target, method, path, requestJson] = process.argv.slice(1);
const [file, exportName = 'default'] = target.split('#');
const targetFile = resolve(file);
const module = await import(pathToFileURL(targetFile).href);
const app = module[exportName];
const supertestModule = await import('supertest');
const request = JSON.parse(requestJson);
let call = supertestModule.default(app)[method.toLowerCase()](path);
for (const [key, value] of Object.entries(request.headers || {})) call = call.set(key, value);
if (request.query) call = call.query(request.query);
if (Object.prototype.hasOwnProperty.call(request, 'json')) call = call.send(request.json);
const response = await call;
const require = createRequire(import.meta.url);
let version = 'unknown';
try { version = require('supertest/package.json').version; } catch {}
console.log(JSON.stringify({body: response.body, status: response.status, content_type: String(response.headers['content-type'] || '').split(';', 1)[0], runner_version: version, target_file: targetFile}));
`;

function run(cwd: string, command: string, args: string[], timeoutMs: number): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Boundary adapter failed (${command}): ${result.stderr || result.error || `exit ${result.status}`}`);
  return result.stdout.trim();
}

function git(cwd: string, args: string[]): boolean {
  return spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0;
}

function trustedBase(cwd: string): string | null {
  for (const candidate of [process.env.CDD_BASE_SHA, process.env.GITHUB_BASE_SHA, 'origin/main', 'origin/master', 'HEAD^']) {
    if (candidate && git(cwd, ['rev-parse', '--verify', candidate])) return candidate;
  }
  return null;
}

function validateTargetFile(cwd: string, operation: BoundaryOperation, absoluteTarget: string): string {
  const root = resolve(cwd);
  const target = resolve(absoluteTarget);
  if (target !== root && !target.startsWith(root + sep)) throw new Error('Boundary capture target resolves outside the repository.');
  const relativeTarget = relative(root, target).split(sep).join('/');
  if (!relativeTarget || isAbsolute(relativeTarget) || relativeTarget.split('/').includes('..')) throw new Error('Boundary capture target path is invalid.');
  if (/(^|\/)(tests?|__tests__|fixtures?|mocks?)(\/|$)/i.test(relativeTarget)) {
    throw new Error(`Boundary capture target must be a production entrypoint, not a test or fixture: ${relativeTarget}`);
  }
  if (!operation.source_files.includes(relativeTarget)) {
    throw new Error(`Boundary capture target ${relativeTarget} must be listed in operation.source_files.`);
  }
  if (!git(cwd, ['ls-files', '--error-unmatch', '--', relativeTarget])) {
    throw new Error(`Boundary capture target must be a tracked production file: ${relativeTarget}`);
  }
  const base = trustedBase(cwd);
  if (base && !git(cwd, ['cat-file', '-e', `${base}:${relativeTarget}`])) {
    throw new Error(`Boundary capture target ${relativeTarget} is not present in trusted base ${base}; onboard the production entrypoint separately before using it as evidence.`);
  }
  return relativeTarget;
}

export function executeRegisteredCapture(
  cwd: string,
  operation: BoundaryOperation,
  variant: BoundaryVariant,
  timeoutMs = 300_000,
): AdapterCaptureResult {
  const capture = variant.capture;
  if (!capture) throw new Error(`Variant ${variant.id} has no registered capture.`);
  const request = capture.request ?? {};
  const path = request.path ?? operation.path;
  let output: string;
  if (capture.adapter === 'fastapi-testclient' || capture.adapter === 'flask-test-client') {
    const requiredModule = capture.adapter === 'fastapi-testclient' ? 'fastapi' : 'flask';
    const python = ['python3', 'python'].find(command => spawnSync(command, ['-c', `import ${requiredModule}`], { cwd }).status === 0);
    if (!python) throw new Error(`Registered adapter ${capture.adapter} requires a Python interpreter with ${requiredModule} installed.`);
    output = run(cwd, python, ['-c', PYTHON_CAPTURE, capture.adapter, capture.target, operation.method, path, JSON.stringify(request)], timeoutMs);
  } else if (capture.adapter === 'express-supertest') {
    output = run(cwd, process.execPath, ['--input-type=module', '-e', EXPRESS_CAPTURE, capture.target, operation.method, path, JSON.stringify(request)], timeoutMs);
  } else {
    throw new Error(`Unregistered Boundary capture adapter: ${(capture as { adapter?: string }).adapter ?? 'missing'}`);
  }
  const parsed = JSON.parse(output) as Omit<AdapterCaptureResult, 'target_digest' | 'target_file'> & { target_file?: string };
  if (!Number.isInteger(parsed.status) || typeof parsed.runner_version !== 'string' || typeof parsed.target_file !== 'string') {
    throw new Error(`Boundary adapter returned an invalid envelope for ${variant.id}.`);
  }
  const targetFile = validateTargetFile(cwd, operation, parsed.target_file);
  return { ...parsed, target_file: targetFile, target_digest: captureTargetDigest(operation, variant) };
}
