import { relative } from 'path';
import { planRuntime, resumeRuntime, runtimeDirectory, runtimeStatus, verifyRuntime } from '../runtime/engine.js';
import type { WorkflowProfile } from '../runtime/types.js';
import type { Provider } from '../utils/provider.js';
import { log } from '../utils/logger.js';
import { runAllRuntimeChecks, runRuntimeCheck, runtimeCheckPlan } from '../runtime/checks.js';
import { importRuntimeApproval, recordRuntimeReview } from '../runtime/decisions.js';
import { buildRuntimeAgentPrompt, recordRuntimeAgentResult, type RuntimeAgentRole } from '../runtime/agent.js';
import { compareRuntimeWithStrict } from '../runtime/parity.js';

export function runtimePlan(options: { changeId: string; objective: string; provider?: Provider; profile?: WorkflowProfile; base?: string; requireAcceptance?: boolean; json?: boolean }): number {
  try {
    const state = planRuntime(options);
    if (options.json) process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    else {
      const capsule = state.capsule as { profile: string; risk_signals: unknown[]; doctrine?: unknown[]; independent_review?: boolean };
      log.ok(`Runtime plan created: ${state.run_id}`);
      log.info(`Profile: ${capsule.profile}; risk signals: ${capsule.risk_signals.length}`);
      // Light-touch "feel the reduction" line: on the lean profiles, name what
      // this run spends versus the legacy strict path (7 change artifacts + full
      // agent chain), so the token/ceremony saving is visible in normal use
      // without a measurement harness.
      if (capsule.profile !== 'strict') {
        const agents = capsule.independent_review ? 2 : 1;
        const modules = Array.isArray(capsule.doctrine) ? capsule.doctrine.length : 0;
        log.info(`Lean run: ${agents} agent${agents === 1 ? '' : 's'}, ${modules} doctrine module${modules === 1 ? '' : 's'}, runtime evidence — vs strict's 7 change artifacts + full agent chain.`);
      }
      if (state.pending_approvals.length) log.warn(`Pending approvals: ${state.pending_approvals.join(', ')}`);
      log.info(`State: .cdd/runtime/${state.run_id}/state.json`);
    }
    return 0;
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

export function runtimeShow(options: { runId?: string; json?: boolean }): number {
  try {
    const state = runtimeStatus(process.cwd(), options.runId);
    if (options.json) process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    else {
      const capsule = state.capsule as { objective: string; profile: string };
      log.info(`${state.run_id}: ${state.status} (${capsule.profile})`);
      log.info(capsule.objective);
      log.info(`Directory: ${relative(process.cwd(), runtimeDirectory(process.cwd(), state.run_id))}`);
    }
    return 0;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeResume(options: { runId?: string; json?: boolean }): number {
  try {
    const result = resumeRuntime(process.cwd(), options.runId);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else if (result.invalidated.length) log.warn(`Run blocked; changed inputs: ${result.invalidated.join(', ')}`);
    else log.ok(`Run resumed: ${result.state.run_id}`);
    return result.invalidated.length ? 1 : 0;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeVerify(options: { runId?: string; json?: boolean }): number {
  try {
    const result = verifyRuntime(process.cwd(), options.runId);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      if (result.evidence.final_status === 'passed') log.ok(`Runtime verification passed: ${result.path}`);
      else log.warn(`Runtime verification blocked: ${result.path}`);
    }
    return result.evidence.final_status === 'passed' ? 0 : 1;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeChecksPlan(options: { runId?: string; json?: boolean }): number {
  try {
    const plan = runtimeCheckPlan(process.cwd(), options.runId);
    if (options.json) process.stdout.write(JSON.stringify({ checks: plan }, null, 2) + '\n');
    else if (plan.length === 0) log.warn('No runtime-native checks could be selected; configure a project test/build script or explicit check plan.');
    else for (const check of plan) log.info(`${check.required ? 'required' : 'optional'} ${check.id}: ${check.command}`);
    return plan.length ? 0 : 1;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeChecksRun(options: { runId?: string; check?: string; all?: boolean; timeout?: number; json?: boolean }): number {
  try {
    if (!options.all && !options.check) throw new Error('Choose --all or --check <id>.');
    const results = options.all
      ? runAllRuntimeChecks(process.cwd(), options.runId, options.timeout)
      : [runRuntimeCheck(process.cwd(), options.runId, options.check!, options.timeout)];
    if (options.json) process.stdout.write(JSON.stringify({ results: results.map(result => result.result) }, null, 2) + '\n');
    else for (const { result, path } of results) {
      const message = `${result.check_id}: ${result.status} (${result.duration_ms}ms) → ${path}`;
      if (result.status === 'passed') log.ok(message); else log.error(message);
    }
    return results.every(result => result.result.status === 'passed') ? 0 : 1;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeReview(options: { runId?: string; actor: string; summary: string; verdict: 'passed' | 'failed'; json?: boolean }): number {
  try {
    const result = recordRuntimeReview(process.cwd(), options.runId, options);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      const message = `Review ${result.record.verdict}: ${result.path}`;
      if (result.record.verdict === 'passed') log.ok(message); else log.error(message);
    }
    return result.record.verdict === 'passed' ? 0 : 1;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeApprovalImport(options: { runId?: string; file: string; json?: boolean }): number {
  try {
    const result = importRuntimeApproval(process.cwd(), options.runId, options.file);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      const message = `${result.record.decision_id} ${result.record.verdict} by verified identity ${result.record.actor}: ${result.path}`;
      if (result.record.verdict === 'approved') log.ok(message); else log.error(message);
    }
    return result.record.verdict === 'approved' ? 0 : 1;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeAgentPrompt(options: { runId?: string; role: RuntimeAgentRole; json?: boolean }): number {
  try {
    const result = buildRuntimeAgentPrompt(process.cwd(), options.runId, options.role);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stdout.write(result.prompt + '\n');
    return 0;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeAgentComplete(options: {
  runId?: string; actor: string; summary: string; status: 'passed' | 'failed' | 'blocked'; files: string[]; json?: boolean;
}): number {
  try {
    const result = recordRuntimeAgentResult(process.cwd(), options.runId, options);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else log.info(`Agent result ${options.status}: ${result.path}`);
    return options.status === 'passed' ? 0 : 1;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function runtimeParity(options: { runId?: string; mutations?: string; json?: boolean }): number {
  try {
    const result = compareRuntimeWithStrict(process.cwd(), options.runId, options.mutations);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      log.info(`Runtime: ${result.report.verdicts.runtime}; strict: ${result.report.verdicts.strict}`);
      log.info(`Estimated token reduction: ${result.report.metrics.estimated_token_reduction_percent}%`);
      log.info(`Parity report: ${result.path}`);
    }
    // Only a proven `equivalent` verdict is a success; `inconclusive` (no
    // mutation corpus) and `divergent` both exit non-zero so parity is never
    // rubber-stamped from two green runs alone.
    return result.report.verdicts.equivalent === 'equivalent' ? 0 : 1;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}
