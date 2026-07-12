import { relative } from 'path';
import { planRuntime, resumeRuntime, runtimeDirectory, runtimeStatus, verifyRuntime } from '../runtime/engine.js';
import type { WorkflowProfile } from '../runtime/types.js';
import type { Provider } from '../utils/provider.js';
import { log } from '../utils/logger.js';

export function runtimePlan(options: { changeId: string; objective: string; provider?: Provider; profile?: WorkflowProfile; base?: string; requireAcceptance?: boolean; json?: boolean }): number {
  try {
    const state = planRuntime(options);
    if (options.json) process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    else {
      const capsule = state.capsule as { profile: string; risk_signals: unknown[] };
      log.ok(`Runtime plan created: ${state.run_id}`);
      log.info(`Profile: ${capsule.profile}; risk signals: ${capsule.risk_signals.length}`);
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
