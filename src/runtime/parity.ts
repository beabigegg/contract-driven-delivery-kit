import { spawnSync } from 'child_process';
import { relative } from 'path';
import { auditGuidance } from '../commands/guidance.js';
import { buildRuntimeAgentPrompt } from './agent.js';
import { verifyRuntime } from './engine.js';
import { readRuntimeState, writeRuntimeArtifact } from './store.js';
import type { ExecutionCapsule } from './types.js';

export function compareRuntimeWithStrict(cwd = process.cwd(), runId?: string) {
  const state = readRuntimeState(cwd, runId);
  const capsule = state.capsule as unknown as ExecutionCapsule;
  const runtime = verifyRuntime(cwd, state.run_id);
  const cliPath = process.argv[1];
  const strictRun = spawnSync(process.execPath, [cliPath, 'gate', state.change_id, '--strict'], {
    cwd, encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024,
  });
  const strictPassed = strictRun.status === 0;
  const runtimePassed = runtime.evidence.final_status === 'passed';
  const prompt = buildRuntimeAgentPrompt(cwd, state.run_id, 'implementer');
  const guidance = auditGuidance(cwd);
  const report = {
    schema_version: '1.0.0', run_id: state.run_id, change_id: state.change_id, profile: capsule.profile,
    verdicts: {
      runtime: runtime.evidence.final_status,
      strict: strictPassed ? 'passed' : 'failed',
      equivalent: strictPassed === runtimePassed,
      strict_compatible: true,
    },
    metrics: {
      dynamic_agent_calls: capsule.independent_review ? 2 : 1,
      selected_doctrine_modules: capsule.doctrine.length,
      dynamic_prompt_estimated_tokens: prompt.estimated_tokens,
      legacy_guidance_and_agent_estimated_tokens: guidance.total_current_estimated_tokens,
      estimated_token_reduction_percent: guidance.total_current_estimated_tokens > 0
        ? Math.max(0, Math.round((1 - prompt.estimated_tokens / guidance.total_current_estimated_tokens) * 1000) / 10) : 0,
      permanent_runtime_artifacts: state.steps.reduce((total, step) => total + (Array.isArray(step.evidence) ? step.evidence.length : 0), 0),
      legacy_required_artifacts: 7,
    },
    strict: { exit_code: strictRun.status, stdout: strictRun.stdout, stderr: strictRun.stderr },
    created_at: new Date().toISOString(),
  };
  const path = writeRuntimeArtifact(cwd, state.run_id, 'parity.json', report);
  return { report, path: relative(cwd, path) };
}
