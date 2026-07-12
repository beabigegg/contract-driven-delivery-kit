import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { auditGuidance } from '../commands/guidance.js';
import { buildRuntimeAgentPrompt } from './agent.js';
import { verifyRuntime } from './engine.js';
import { readRuntimeState, writeRuntimeArtifact } from './store.js';
import type { ExecutionCapsule } from './types.js';

type MutationVerdict = 'caught' | 'missed' | 'not-applicable';
interface MutationMatrix { mutations: Record<string, { strict: MutationVerdict; runtime: MutationVerdict; strict_category?: string; runtime_category?: string }> }

function strictCategories(output: string): string[] {
  const categories = new Set<string>();
  const rules: Array<[string, RegExp]> = [
    ['acceptance-oracle', /acceptance(?:\.yml| oracle)|oracle/i],
    ['legacy-artifacts', /change-request|change-classification|implementation-plan|test-plan|ci-gates|tasks\.yml|context-manifest/i],
    ['tests', /test-evidence|tests? failed|test gate/i],
    ['boundary', /contract|response shape|api conformance|boundary/i],
    ['quality', /quality|lint|typecheck|type check/i],
    ['approval', /approval/i],
  ];
  for (const [category, pattern] of rules) if (pattern.test(output)) categories.add(category);
  if (categories.size === 0 && output.trim()) categories.add('unclassified');
  return [...categories].sort();
}

export function compareRuntimeWithStrict(cwd = process.cwd(), runId?: string, mutationsPath?: string) {
  const state = readRuntimeState(cwd, runId);
  const capsule = state.capsule as unknown as ExecutionCapsule;
  const runtime = verifyRuntime(cwd, state.run_id);
  const cliPath = process.argv[1];
  const strictRun = spawnSync(process.execPath, [cliPath, 'gate', state.change_id, '--strict'], {
    cwd, encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024,
  });
  const strictPassed = strictRun.status === 0;
  const runtimePassed = runtime.evidence.final_status === 'passed';
  const runtimeCategories = runtime.evidence.checks
    .filter(check => check.status !== 'passed' && check.status !== 'not-applicable')
    .map(check => check.id === 'approvals' ? 'approval' : check.id)
    .sort();
  const strictCategoryList = strictPassed ? [] : strictCategories(`${strictRun.stdout}\n${strictRun.stderr}`);
  let mutationMatrix: MutationMatrix | undefined;
  if (mutationsPath) {
    const path = isAbsolute(mutationsPath) ? mutationsPath : resolve(cwd, mutationsPath);
    if (!existsSync(path)) throw new Error(`Mutation matrix not found: ${mutationsPath}`);
    mutationMatrix = JSON.parse(readFileSync(path, 'utf8')) as MutationMatrix;
  }
  const mutations = mutationMatrix ? Object.entries(mutationMatrix.mutations).map(([id, result]) => ({ id, ...result })) : [];
  const mutationEquivalent = mutationMatrix ? mutations.every(item => item.strict === item.runtime && item.strict_category === item.runtime_category) : null;
  const categoryEquivalent = JSON.stringify(runtimeCategories) === JSON.stringify(strictCategoryList);
  const prompt = buildRuntimeAgentPrompt(cwd, state.run_id, 'implementer');
  const guidance = auditGuidance(cwd);
  const report = {
    schema_version: '1.0.0', run_id: state.run_id, change_id: state.change_id, profile: capsule.profile,
    verdicts: {
      runtime: runtime.evidence.final_status,
      strict: strictPassed ? 'passed' : 'failed',
      equivalent: strictPassed === runtimePassed && categoryEquivalent && (mutationEquivalent ?? true),
      strict_compatible: true,
      category_equivalent: categoryEquivalent,
      mutation_equivalent: mutationEquivalent,
    },
    detection: {
      runtime_categories: runtimeCategories,
      strict_categories: strictCategoryList,
      mutations,
      false_negatives: mutations.filter(item => item.strict === 'caught' && item.runtime === 'missed').map(item => item.id),
      false_positives: mutations.filter(item => item.strict === 'missed' && item.runtime === 'caught').map(item => item.id),
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
