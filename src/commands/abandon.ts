import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
import { log } from '../utils/logger.js';
import { isSafeChangeId } from '../utils/change-id.js';

/**
 * Outcome of an abandon attempt. A command must never announce a guarantee
 * that did not happen (the `installHooks` soft-skip precedent,
 * `install-hooks.ts`'s `InstallHooksResult`): `tasksFileCreated` distinguishes
 * a stale directory that got a brand-new minimal `tasks.yml` from one whose
 * existing `tasks.yml` was merely updated, so the CLI can print what actually
 * happened instead of a fixed success sentence. `error` is returned — never
 * thrown/exited from inside this function — so a future composing caller (or
 * a test) can inspect the outcome without parsing stdout.
 */
export type AbandonResult =
  | { status: 'abandoned'; changeId: string; reason: string; date: string; tasksFileCreated: boolean }
  | { status: 'error'; message: string };

export async function abandon(changeId: string, opts: { reason?: string }): Promise<AbandonResult> {
  const cwd = process.cwd();

  if (!isSafeChangeId(changeId)) {
    return { status: 'error', message: `invalid change id: ${changeId}` };
  }

  const changeDir = join(cwd, 'specs', 'changes', changeId);
  if (!existsSync(changeDir)) {
    return { status: 'error', message: `change not found: specs/changes/${changeId}` };
  }

  // Mandatory non-empty reason, fail-closed (mirrors the ADR 0011
  // applicability-marker discipline: an explicit marker + a mandatory reason).
  // Checked before any write so an invalid invocation persists nothing.
  const reason = (opts.reason ?? '').trim();
  if (!reason) {
    return { status: 'error', message: 'abandon requires a non-empty --reason (fail-closed — nothing was written)' };
  }

  const today = new Date().toISOString().split('T')[0];
  const tasksPath = join(changeDir, 'tasks.yml');
  let tasksFileCreated = false;

  if (existsSync(tasksPath)) {
    const raw = readFileSync(tasksPath, 'utf8');
    const data = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    data['status'] = 'abandoned';
    data['abandoned-reason'] = reason;
    data['abandoned-at'] = today;
    if (!data['change-id']) {
      data['change-id'] = changeId;
    }
    writeFileSync(tasksPath, yaml.dump(data, { lineWidth: -1, noRefs: true }), 'utf8');
  } else {
    // Stale directories (the normal state of a change abandoned long after the
    // fact) have no tasks.yml at all. Creating a minimal one carrying the
    // abandoned marker is the fix for the defect this type mirrors: silently
    // skipping this write while still reporting success below.
    const minimal: Record<string, unknown> = {
      'change-id': changeId,
      status: 'abandoned',
      'abandoned-reason': reason,
      'abandoned-at': today,
      tasks: [],
    };
    writeFileSync(tasksPath, yaml.dump(minimal, { lineWidth: -1, noRefs: true }), 'utf8');
    tasksFileCreated = true;
  }

  const archiveDir = join(cwd, 'specs', 'archive');
  const indexPath = join(archiveDir, 'INDEX.md');
  const indexLine = `| ${changeId} | abandoned | ${today} | ${reason} |\n`;

  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }

  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `# Archive Index\n\n| change-id | status | date | notes |\n|---|---|---|---|\n${indexLine}`, 'utf8');
  } else {
    appendFileSync(indexPath, indexLine, 'utf8');
  }

  return { status: 'abandoned', changeId, reason, date: today, tasksFileCreated };
}
