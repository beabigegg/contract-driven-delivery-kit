import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { runtimeStateSchema } from '../schemas/runtime-state.schema.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateState = ajv.compile(runtimeStateSchema);

export interface StoredRuntimeState {
  schema_version: '1.0.0';
  run_id: string;
  change_id: string;
  status: 'planned' | 'running' | 'blocked' | 'failed' | 'completed';
  provider: 'claude' | 'codex' | 'both';
  capsule: Record<string, unknown>;
  pending_approvals: string[];
  steps: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export function runtimeRoot(cwd: string): string { return join(cwd, '.cdd', 'runtime'); }
const SAFE_RUNTIME_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const SAFE_ARTIFACT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function requireSafeRuntimeId(runId: string): void {
  if (!SAFE_RUNTIME_ID.test(runId)) throw new Error(`Invalid runtime run id: ${runId}`);
}

export function runDir(cwd: string, runId: string): string {
  requireSafeRuntimeId(runId);
  return join(runtimeRoot(cwd), runId);
}

export function withRuntimeLock<T>(cwd: string, fn: () => T): T {
  const root = runtimeRoot(cwd);
  mkdirSync(root, { recursive: true });
  const lock = join(root, '.lock');
  let fd: number;
  try { fd = openSync(lock, 'wx'); }
  catch { throw new Error('Another cdd-kit runtime mutation is in progress (.cdd/runtime/.lock exists).'); }
  try { return fn(); }
  finally { closeSync(fd); rmSync(lock, { force: true }); }
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

export function writeRuntimeState(cwd: string, state: StoredRuntimeState): void {
  if (!validateState(state)) throw new Error(`Invalid runtime state: ${(validateState.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ')}`);
  atomicJson(join(runDir(cwd, state.run_id), 'state.json'), state);
  atomicJson(join(runtimeRoot(cwd), 'current.json'), { schema_version: '1.0.0', run_id: state.run_id, change_id: state.change_id });
}

export function readRuntimeState(cwd: string, runId?: string): StoredRuntimeState {
  let id = runId;
  if (!id) {
    const pointer = join(runtimeRoot(cwd), 'current.json');
    if (!existsSync(pointer)) throw new Error('No current cdd-kit runtime run. Start one with `cdd-kit work`.');
    id = (JSON.parse(readFileSync(pointer, 'utf8')) as { run_id: string }).run_id;
  }
  const path = join(runDir(cwd, id), 'state.json');
  if (!existsSync(path)) throw new Error(`Runtime run not found: ${id}`);
  const state = JSON.parse(readFileSync(path, 'utf8')) as StoredRuntimeState;
  if (!validateState(state)) throw new Error(`Runtime state is invalid: ${(validateState.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ')}`);
  return state;
}

export function writeRuntimeArtifact(cwd: string, runId: string, name: string, value: unknown): string {
  if (!SAFE_ARTIFACT_NAME.test(name)) throw new Error(`Invalid runtime artifact name: ${name}`);
  const path = join(runDir(cwd, runId), name);
  atomicJson(path, value);
  return path;
}
