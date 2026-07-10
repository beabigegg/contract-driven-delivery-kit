// `cdd-kit design confirm <change-id>` (ADR 0012 §5; mirrors src/commands/
// accept.ts's ADR 0010 §3.1 `accept relock` role). The ONLY sanctioned way to
// write/re-baseline `.cdd/design-lock.json` after the human has answered
// `## Open Decisions` and the main agent has transcribed the answers into
// `## Confirmed` -- `.cdd/design-lock.json` is a HARD forbidden path in
// `.cdd/context-policy.json` (src/commands/context.ts DEFAULT_FORBIDDEN_PATHS),
// so an agent cannot write it via Edit/Write, and this command is a plain CLI
// entry point a human runs themselves; it never fires as a side effect of
// gating, authoring, or any other agent-facing action.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { isSafeChangeId } from '../utils/change-id.js';
import { meaningfulChars } from './gate-artifacts.js';
import {
  computeDesignHash,
  extractConfirmedRegion,
  readDesignLock,
  writeDesignLock,
} from '../utils/design-hash.js';

export async function designConfirm(changeId: string): Promise<void> {
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

  const designPath = join(changeDir, 'interaction-design.md');
  if (!existsSync(designPath)) {
    log.error(`missing specs/changes/${changeId}/interaction-design.md -- author + reconcile the design before confirming it.`);
    process.exit(1);
  }

  const body = readFileSync(designPath, 'utf8');
  const confirmed = extractConfirmedRegion(body);
  if (meaningfulChars(confirmed) === 0) {
    log.error(`interaction-design.md has no ## Confirmed section (or it is empty) -- the human must answer ## Open Decisions and have the answers transcribed into ## Confirmed before confirming.`);
    process.exit(1);
  }

  const newHash = computeDesignHash(body);
  const existing = readDesignLock(cwd)[changeId];

  if (existing && existing.hash === newHash) {
    // Write NOTHING. The lock's git-author / tty / timestamp describe the moment the
    // human confirmed. Re-running `design confirm` used to overwrite all three and
    // then print "no change" — destroying the audit clue of the original confirmation
    // while announcing that nothing happened. The clue is the whole point of
    // recording it, and anyone (or anything) able to re-run the command could erase it.
    log.ok(`baseline for ${changeId} already matches the current interaction-design.md -- no change.`);
    log.info('.cdd/design-lock.json left untouched; its recorded provenance still describes the original confirmation.');
    return;
  }

  writeDesignLock(cwd, changeId, newHash);

  if (!existing) {
    log.ok(`recorded a new baseline for ${changeId}: ${newHash}`);
  } else {
    log.ok(`re-confirmed ${changeId}: ${existing.hash} -> ${newHash}`);
  }
  log.info('.cdd/design-lock.json updated. Commit it alongside the interaction-design.md change.');
}
