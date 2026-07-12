// `enforceAcceptanceOracle` (ADR 0010; ci-gate-contract.md `enforceAcceptanceOracle`
// row) -- the gate check for the human-owned `acceptance.yml` per change.
// Legacy human-relock behavior remains unchanged. `chat-confirmed` is an
// additional confirmation source that binds an authorized PR comment to the
// exact oracle hash and PR source-branch HEAD.

import { existsSync } from 'fs';
import { join } from 'path';
import { ajv, ajvErrorsToMessages, loadYamlFile } from './gate-shared.js';
import { acceptanceSchema } from '../schemas/acceptance.schema.js';
import {
  computeAcceptanceHash,
  readAcceptanceLock,
  type AcceptanceFile,
} from '../utils/acceptance-hash.js';
import { verifyChatAcceptance } from '../utils/acceptance-confirmation.js';
import { findUnboundRules, scanAcceptanceDrivers } from '../utils/mock-of-sut-scan.js';

const validateAcceptance = ajv.compile(acceptanceSchema);

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    if (/^<[^<>]+>$/.test(trimmed)) return false;
    return true;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(isMeaningfulValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isMeaningfulValue);
  return true;
}

export function enforceAcceptanceOracle(
  cwd: string,
  changeDir: string,
  changeId: string,
  isNewChange: boolean,
  strict: boolean,
  errors: string[],
  warnings: string[],
): void {
  const oraclePath = join(changeDir, 'acceptance.yml');

  if (!existsSync(oraclePath)) {
    if (isNewChange || strict) {
      errors.push(
        'missing required artifact: acceptance.yml (ADR 0010 — this gate invocation requires a human-authored ' +
        'acceptance oracle pairing input/expect answer keys with the behavior; author one, or scaffold ' +
        'it once `cdd-kit migrate`/`cdd-kit new` backfill support lands).',
      );
    } else {
      warnings.push(
        'missing acceptance.yml (legacy change; ADR 0010 acceptance oracle not yet backfilled for this change)',
      );
    }
    return;
  }

  const { data, parseError } = loadYamlFile<AcceptanceFile>(oraclePath);
  if (parseError) {
    errors.push(`acceptance.yml: invalid YAML: ${parseError}`);
    return;
  }
  if (!data || typeof data !== 'object') {
    errors.push('acceptance.yml: file is empty or not a YAML mapping');
    return;
  }

  const ok = validateAcceptance(data);
  if (!ok) {
    const out = ajvErrorsToMessages(validateAcceptance.errors, 'acceptance.yml', Object.keys(acceptanceSchema.properties));
    errors.push(...out.errors);
    warnings.push(...out.warnings);
    if (out.errors.length > 0) return;
  }

  const cases = Array.isArray(data.cases) ? data.cases : [];
  const realCases = cases.filter((c) => isMeaningfulValue(c?.input) && isMeaningfulValue(c?.expect));
  if (realCases.length === 0) {
    errors.push(
      'acceptance.yml: every case still has a placeholder (or missing) `input`/`expect` — author at least ' +
      'one real case with a concrete answer key before the gate can pass (AC-1; ADR 0010 §1).',
    );
    return;
  }

  const currentHash = computeAcceptanceHash(data);
  const chatConfirmed = data['confirmation-mode'] === 'chat-confirmed';
  // H2: `chat-confirmed` is a balanced/controlled convenience path. It must
  // never silently substitute for strict acceptance, whose contract
  // (runtime-contracts.md section 3) is the human-authored hash lock. Under
  // strict we downgrade chat-confirmed to a warning and fall through to require
  // the lock, so `confirmation-mode` in an agent-authored oracle can no longer
  // weaken strict.
  const honorChatConfirmed = chatConfirmed && !strict;
  if (chatConfirmed && strict) {
    warnings.push(
      'confirmation-mode: chat-confirmed is not honored under --strict (runtime-contracts.md section 3); ' +
      `strict requires the human-authored hash lock — run \`cdd-kit accept relock ${changeId}\`. ` +
      'Verifying the lock instead.',
    );
  }
  if (honorChatConfirmed) {
    const confirmation = verifyChatAcceptance(cwd, changeDir, changeId, currentHash);
    if (!confirmation.ok) {
      errors.push(`chat-confirmed acceptance is not verified: ${confirmation.error}`);
    }
  } else {
    const lock = readAcceptanceLock(cwd);
    const baseline = lock[changeId];
    if (!baseline) {
      const detail =
        'acceptance.yml has no recorded baseline in .cdd/acceptance-lock.json — an unlocked oracle proves ' +
        'nothing (an agent can write one). A human must record the baseline by running ' +
        `\`cdd-kit accept relock ${changeId}\`.`;
      if (isNewChange || strict) errors.push(detail);
      else warnings.push(detail + ' (legacy change; not yet migrated to the ADR 0010 hash-lock)');
    } else if (baseline.hash !== currentHash) {
      errors.push('acceptance oracle modified after authoring — human must re-confirm.');
    }
  }

  for (const finding of scanAcceptanceDrivers(cwd, changeDir, changeId, realCases)) {
    if (finding.kind === 'mock-of-sut') {
      errors.push(`${finding.file}: acceptance driver ${finding.detail}.`);
    } else {
      errors.push(
        `${finding.file}: acceptance driver ${finding.detail} — read it from the acceptance loader instead ` +
        'of hardcoding the answer key (AC-4; design.md Q2).',
      );
    }
  }

  if (strict) {
    const rules = Array.isArray(data.rules) ? data.rules : [];
    const ruleIds = rules
      .map((r) => r?.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    for (const ruleId of findUnboundRules(cwd, changeId, ruleIds)) {
      errors.push(
        `acceptance rule "${ruleId}" has no bound test in test/acceptance/ (--strict; ADR 0010 §4).`,
      );
    }
  }

  const evidencePath = join(changeDir, 'test-evidence.yml');
  const evidence = existsSync(evidencePath)
    ? loadYamlFile<{ runs?: Array<{ phase?: string; status?: string }>; 'final-status'?: string }>(evidencePath).data
    : undefined;
  const hasPassedAcceptanceRun = (evidence?.runs ?? []).some((r) => r.phase === 'acceptance' && r.status === 'passed');
  const hasPassedFullRun = evidence?.['final-status'] === 'passed'
    && (evidence?.runs ?? []).some((r) => r.phase === 'full' && r.status === 'passed');
  // H2: the relaxed full-run substitute applies only when chat-confirmed is
  // actually honored (non-strict). Under strict the acceptance-phase run is
  // required, matching the lock requirement above.
  const executionEvidencePassed = hasPassedAcceptanceRun || (honorChatConfirmed && hasPassedFullRun);

  if (!executionEvidencePassed) {
    if (isNewChange || strict) {
      if (honorChatConfirmed) {
        errors.push('chat-confirmed acceptance requires a recorded passed full test run in test-evidence.yml.');
      } else {
        errors.push(
          'acceptance.yml: no passed `acceptance`-phase run recorded in test-evidence.yml — a self-reported ' +
          'pass is not enough (AC-5; ADR 0005 §6). Run `cdd-kit test run <change-id> --phase acceptance`.',
        );
      }
    } else {
      warnings.push(
        'missing a passed `acceptance`-phase test-evidence run (legacy change; run `cdd-kit test run ' +
        '<change-id> --phase acceptance`)',
      );
    }
  }
}
