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
    if (trimmed === '' || /^<[^<>]+>$/.test(trimmed)) return false;
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
        'missing required artifact: acceptance.yml — the main agent may draft plain-language criteria, ' +
        'but a human must confirm them through either the legacy relock path or an authorized PR comment.',
      );
    } else {
      warnings.push('missing acceptance.yml (legacy change; acceptance oracle not yet backfilled)');
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
    errors.push('acceptance.yml: author at least one real case with a concrete input and expected outcome.');
    return;
  }

  const currentHash = computeAcceptanceHash(data);
  const chatConfirmed = data['confirmation-mode'] === 'chat-confirmed';
  if (chatConfirmed) {
    const confirmation = verifyChatAcceptance(cwd, changeDir, changeId, currentHash);
    if (!confirmation.ok) errors.push(`chat-confirmed acceptance is not verified: ${confirmation.error}`);
  } else {
    const lock = readAcceptanceLock(cwd);
    const baseline = lock[changeId];
    if (!baseline) {
      const detail =
        'acceptance.yml has no recorded baseline in .cdd/acceptance-lock.json. ' +
        `Run \`cdd-kit accept relock ${changeId}\`, or use confirmation-mode: chat-confirmed with an authorized PR comment.`;
      if (isNewChange || strict) errors.push(detail);
      else warnings.push(detail + ' (legacy change; not yet migrated)');
    } else if (baseline.hash !== currentHash) {
      errors.push('acceptance oracle modified after confirmation — human must re-confirm.');
    }
  }

  for (const finding of scanAcceptanceDrivers(cwd, changeDir, changeId, realCases)) {
    if (finding.kind === 'mock-of-sut') {
      errors.push(`${finding.file}: acceptance driver ${finding.detail}.`);
    } else {
      errors.push(
        `${finding.file}: acceptance driver ${finding.detail} — read it from the acceptance loader instead of hardcoding the answer key.`,
      );
    }
  }

  if (strict) {
    const rules = Array.isArray(data.rules) ? data.rules : [];
    const ruleIds = rules
      .map((r) => r?.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    for (const ruleId of findUnboundRules(cwd, changeId, ruleIds)) {
      errors.push(`acceptance rule "${ruleId}" has no bound test in test/acceptance/.`);
    }
  }

  const evidencePath = join(changeDir, 'test-evidence.yml');
  const evidence = existsSync(evidencePath)
    ? loadYamlFile<{ runs?: Array<{ phase?: string; status?: string }>; 'final-status'?: string }>(evidencePath).data
    : undefined;
  const hasPassedAcceptanceRun = (evidence?.runs ?? []).some((r) => r.phase === 'acceptance' && r.status === 'passed');
  const hasPassedFullEvidence = evidence?.['final-status'] === 'passed'
    && (evidence?.runs ?? []).some((r) => r.phase === 'full' && r.status === 'passed');
  const executionEvidencePassed = hasPassedAcceptanceRun || (chatConfirmed && hasPassedFullEvidence);

  if (!executionEvidencePassed) {
    if (isNewChange || strict) {
      errors.push(
        chatConfirmed
          ? 'chat-confirmed acceptance requires a passed full test run in test-evidence.yml.'
          : `acceptance.yml: no passed acceptance-phase run recorded. Run \`cdd-kit test run ${changeId} --phase acceptance\`.`,
      );
    } else {
      warnings.push('missing passed acceptance execution evidence (legacy change)');
    }
  }
}
