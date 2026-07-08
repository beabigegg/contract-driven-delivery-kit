// `cdd-kit accept relock <change-id>` (ADR 0010 SS3.1; design.md Maintainer
// Decisions, 2026-07-08). The ONLY sanctioned way to re-baseline
// `.cdd/acceptance-lock.json` after a legitimate human edit to `acceptance.yml`
// -- `.cdd/acceptance-lock.json` is a HARD forbidden path in
// `.cdd/context-policy.json` (src/commands/context.ts DEFAULT_FORBIDDEN_PATHS),
// so an agent cannot write it via Edit/Write, and this command is a plain CLI
// entry point a human runs themselves; it never fires as a side effect of
// gating, authoring, or any other agent-facing action.

import { existsSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
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

export async function acceptRelock(changeId: string): Promise<void> {
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
    log.error(`missing specs/changes/${changeId}/acceptance.yml -- author the oracle before relocking it.`);
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
    log.error('acceptance.yml does not match the schema -- fix it before relocking:');
    for (const e of validateAcceptance.errors ?? []) {
      log.error(`  ${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
    }
    process.exit(1);
  }

  const newHash = computeAcceptanceHash(data as AcceptanceFile);
  const existing = readAcceptanceLock(cwd)[changeId];

  writeAcceptanceLock(cwd, changeId, newHash);

  if (!existing) {
    log.ok(`recorded a new baseline for ${changeId}: ${newHash}`);
  } else if (existing.hash === newHash) {
    log.ok(`baseline for ${changeId} already matches the current acceptance.yml -- no change.`);
  } else {
    log.ok(`re-baselined ${changeId}: ${existing.hash} -> ${newHash}`);
  }
  log.info('.cdd/acceptance-lock.json updated. Commit it alongside the acceptance.yml change.');
}
