import { spawnSync } from 'child_process';
import { relative } from 'path';
import type { ExecutionCapsule } from './types.js';
import {
  readRuntimeState,
  withRuntimeLock,
  writeRuntimeArtifact,
  writeRuntimeState,
  writeRuntimeTextArtifact,
  type StoredRuntimeState,
} from './store.js';
import { decisionPolicyDigest, decisionWorkingTreeDigest } from './decisions.js';

export interface RuntimeCheckResult {
  schema_version: '1.0.0';
  run_id: string;
  check_id: string;
  kind: 'test' | 'quality';
  command: string;
  status: 'passed' | 'failed' | 'timeout' | 'error';
  exit_code: number | null;
  duration_ms: number;
  input_digests: Record<string, string>;
  stdout: string;
  stderr: string;
  started_at: string;
  finished_at: string;
}

export function runtimeCheckPlan(cwd = process.cwd(), runId?: string): ExecutionCapsule['check_plan'] {
  const state = readRuntimeState(cwd, runId);
  return (state.capsule as unknown as ExecutionCapsule).check_plan;
}

export function runRuntimeCheck(
  cwd = process.cwd(),
  runId: string | undefined,
  checkId: string,
  timeoutMs = 300_000,
): { state: StoredRuntimeState; result: RuntimeCheckResult; path: string } {
  return withRuntimeLock(cwd, () => {
    const state = readRuntimeState(cwd, runId);
    const capsule = state.capsule as unknown as ExecutionCapsule;
    const planned = capsule.check_plan.find(check => check.id === checkId);
    if (!planned) throw new Error(`Runtime check not found in capsule: ${checkId}`);
    const previous = state.steps.filter(step => step.kind === 'test' && step.phase === checkId).length;
    const attempt = previous + 1;
    const stem = `check-${checkId}-${String(attempt).padStart(3, '0')}`;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const execution = spawnSync(planned.command, {
      cwd,
      shell: true,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    const timedOut = execution.error && 'code' in execution.error && execution.error.code === 'ETIMEDOUT';
    const status: RuntimeCheckResult['status'] = timedOut
      ? 'timeout'
      : execution.error
        ? 'error'
        : execution.status === 0 ? 'passed' : 'failed';
    const stdoutName = `${stem}.stdout.txt`;
    const stderrName = `${stem}.stderr.txt`;
    writeRuntimeTextArtifact(cwd, state.run_id, stdoutName, execution.stdout ?? '');
    writeRuntimeTextArtifact(cwd, state.run_id, stderrName, execution.stderr ?? String(execution.error ?? ''));
    const result: RuntimeCheckResult = {
      schema_version: '1.0.0', run_id: state.run_id, check_id: checkId, kind: planned.kind,
      command: planned.command, status, exit_code: execution.status, duration_ms: Date.now() - started,
      input_digests: {
        working_tree: decisionWorkingTreeDigest(cwd),
        policy: decisionPolicyDigest(cwd),
        contract: capsule.input_digests.contract,
      }, stdout: stdoutName, stderr: stderrName,
      started_at: startedAt, finished_at: new Date().toISOString(),
    };
    const resultName = `${stem}.json`;
    const path = writeRuntimeArtifact(cwd, state.run_id, resultName, result);
    state.steps.push({
      id: `${checkId}-${attempt}`, kind: 'test', status: status === 'passed' ? 'passed' : 'failed',
      phase: checkId, command: planned.command, attempt, evidence: [resultName, stdoutName, stderrName],
    });
    state.status = status === 'passed' ? 'running' : 'failed';
    state.updated_at = new Date().toISOString();
    writeRuntimeState(cwd, state);
    return { state, result, path: relative(cwd, path) };
  });
}

export function runAllRuntimeChecks(
  cwd = process.cwd(),
  runId?: string,
  timeoutMs = 300_000,
): Array<{ state: StoredRuntimeState; result: RuntimeCheckResult; path: string }> {
  const plan = runtimeCheckPlan(cwd, runId);
  const actualRunId = readRuntimeState(cwd, runId).run_id;
  const results: Array<{ state: StoredRuntimeState; result: RuntimeCheckResult; path: string }> = [];
  for (const check of plan) {
    const result = runRuntimeCheck(cwd, actualRunId, check.id, timeoutMs);
    results.push(result);
    if (check.required && result.result.status !== 'passed') break;
  }
  return results;
}
