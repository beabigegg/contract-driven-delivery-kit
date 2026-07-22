// `cdd-kit accept relock <change-id>` and `cdd-kit accept confirm <change-id>`
// (ADR 0010 SS3.1; design.md Maintainer Decisions, 2026-07-08).
//
// `.cdd/acceptance-lock.json` is a HARD forbidden path in `.cdd/context-policy.json`
// (src/commands/context.ts DEFAULT_FORBIDDEN_PATHS), so an agent cannot write it
// via Edit/Write -- the only way to record acceptance is these sanctioned CLI
// entry points.
//
//   relock   -- re-baseline the lock after a legitimate human edit (legacy path).
//   confirm  -- show the criteria and require an interactive human keystroke
//               before recording a `human` acceptance; or, with `--autonomous`,
//               record an explicitly delegated (loop-mode) acceptance that the
//               gate surfaces as "no human reviewed the criteria".

import { existsSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { log } from '../utils/logger.js';
import { t } from '../utils/i18n.js';
import { isSafeChangeId } from '../utils/change-id.js';
import { ajv, loadYamlFile } from './gate-shared.js';
import { acceptanceSchema } from '../schemas/acceptance.schema.js';
import {
  computeAcceptanceHash,
  readAcceptanceLock,
  writeAcceptanceLock,
  type AcceptanceFile,
} from '../utils/acceptance-hash.js';

const validateAcceptance = ajv.compile(acceptanceSchema);

function loadValidatedOracle(changeId: string): { cwd: string; data: AcceptanceFile; hash: string } {
  if (!isSafeChangeId(changeId)) {
    log.error(`Invalid change id "${changeId}". Use letters, numbers, hyphens, or underscores (max 64 chars).`);
    process.exit(1);
  }
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);
  if (!existsSync(changeDir)) {
    log.error(`change not found: ${changeId} (looked in ${changeDir})`);
    process.exit(1);
  }
  const oraclePath = join(changeDir, 'acceptance.yml');
  if (!existsSync(oraclePath)) {
    log.error(`missing specs/changes/${changeId}/acceptance.yml -- author the oracle before confirming it.`);
    process.exit(1);
  }
  const { data, parseError } = loadYamlFile<AcceptanceFile>(oraclePath);
  if (parseError) {
    log.error(`acceptance.yml: invalid YAML: ${parseError}`);
    process.exit(1);
  }
  if (!data || typeof data !== 'object') {
    log.error('acceptance.yml: file is empty or not a YAML mapping');
    process.exit(1);
  }
  if (!validateAcceptance(data)) {
    log.error('acceptance.yml does not match the schema -- fix it before confirming:');
    for (const e of validateAcceptance.errors ?? []) {
      log.error(`  ${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
    }
    process.exit(1);
  }
  return { cwd, data: data as AcceptanceFile, hash: computeAcceptanceHash(data as AcceptanceFile) };
}

export async function acceptRelock(changeId: string): Promise<void> {
  const { cwd, hash: newHash } = loadValidatedOracle(changeId);
  const existing = readAcceptanceLock(cwd)[changeId];

  if (existing && existing.hash === newHash) {
    // Write nothing — see the identical guard in `design.ts`. A re-run that reports
    // "no change" must not silently replace the provenance of the original relock.
    log.ok(`baseline for ${changeId} already matches the current acceptance.yml -- no change.`);
    log.info('.cdd/acceptance-lock.json left untouched; its recorded provenance still describes the original relock.');
    return;
  }

  writeAcceptanceLock(cwd, changeId, newHash, { mode: 'human' });

  if (!existing) {
    log.ok(`recorded a new baseline for ${changeId}: ${newHash}`);
  } else {
    log.ok(`re-baselined ${changeId}: ${existing.hash} -> ${newHash}`);
  }
  log.info('.cdd/acceptance-lock.json updated. Commit it alongside the acceptance.yml change.');
}

function printCriteria(cwd: string, data: AcceptanceFile): void {
  log.info(t(cwd, 'confirm.title'));
  log.blank();
  for (const c of Array.isArray(data.cases) ? data.cases : []) {
    const id = typeof c.id === 'string' ? c.id : '(unnamed case)';
    log.info(`  • ${id}`);
    // The `given:`/`when:`/`then:` labels echo the acceptance.yml keys the
    // human is approving — grammar tokens, so they stay English (#70 boundary);
    // the VALUES are the human's own prose in whatever language they wrote.
    for (const field of ['given', 'when', 'then'] as const) {
      const value = (c as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim()) log.info(`      ${field}: ${value.trim()}`);
    }
  }
  log.blank();
}

function promptLine(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

export async function acceptConfirm(
  changeId: string,
  opts: { autonomous?: boolean; reason?: string } = {},
): Promise<void> {
  const { cwd, data, hash } = loadValidatedOracle(changeId);

  if (opts.autonomous) {
    const reason = (opts.reason ?? '').trim() || 'loop mode: run explicitly delegated to the agent';
    writeAcceptanceLock(cwd, changeId, hash, { mode: 'autonomous', reason });
    log.warn(t(cwd, 'confirm.autonomous-recorded', { id: changeId }));
    log.info(t(cwd, 'confirm.autonomous-reason', { reason }));
    log.info(t(cwd, 'confirm.autonomous-note'));
    return;
  }

  // Interactive human confirmation. A non-interactive invocation (e.g. an agent
  // shelling out) has no TTY and cannot silently satisfy this — it must either
  // route the human to a terminal or use the explicit --autonomous delegation.
  if (!process.stdin.isTTY) {
    log.error(t(cwd, 'confirm.needs-tty'));
    log.info(t(cwd, 'confirm.needs-tty-hint1', { id: changeId }));
    log.info(t(cwd, 'confirm.needs-tty-hint2', { id: changeId }));
    process.exit(1);
  }

  printCriteria(cwd, data);
  const answer = await promptLine(t(cwd, 'confirm.prompt', { id: changeId }));
  if (answer.trim() !== changeId) {
    log.error(t(cwd, 'confirm.mismatch'));
    process.exit(1);
  }

  writeAcceptanceLock(cwd, changeId, hash, { mode: 'human' });
  log.ok(t(cwd, 'confirm.recorded', { id: changeId }));
  log.info(t(cwd, 'confirm.commit-hint'));
}
