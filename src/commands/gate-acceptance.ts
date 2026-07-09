// `enforceAcceptanceOracle` (ADR 0010; ci-gate-contract.md `enforceAcceptanceOracle`
// row) -- the gate check for the human-owned `acceptance.yml` per change. Mirrors
// the module shape of gate-evidence.ts: a present-artifact validator (schema +
// cross-field semantics) plus a missing-artifact migration-window branch.
//
// Enforces AC-1 (existence/placeholder/case-count), AC-2 (hash-lock reconcile),
// AC-4 (mock-of-SUT + hardcoded-expect driver scan, src/utils/mock-of-sut-scan.ts),
// AC-5 (executed, passed `acceptance`-phase test-evidence), and -- `--strict`
// only -- the `rules[]` invariant-binding scan (ci-gate-contract.md
// `enforceAcceptanceOracle` condition 6; ADR 0010 §4; findUnboundRules in
// src/utils/mock-of-sut-scan.ts, added by interaction-design-loop scope
// expansion 2 -- this contract line was previously undocumented-but-absent).
// AC-7 needs no separate code: once `acceptance.yml` is backfilled (IP-11) into
// a migrated change, the AC-1 placeholder check below already fails it until
// real cases are supplied.
//
// Missing-artifact semantics (both the file itself, AC-1, and the executed
// evidence, AC-5) deliberately mirror `enforceTestEvidence` (gate-evidence.ts)
// rather than ci-gate-contract.md's eventual required-from-day-one text: not
// every existing change dir has authored real cases or run the acceptance
// phase yet, so a hard requirement for every legacy/non-strict change would
// fail the kit's own existing change dirs and test fixtures overnight. The
// `isNewChange || strict` split is the same migration-window device the
// context-manifest and test-evidence checks already use.

import { existsSync } from 'fs';
import { join } from 'path';
import { ajv, ajvErrorsToMessages, loadYamlFile } from './gate-shared.js';
import { acceptanceSchema } from '../schemas/acceptance.schema.js';
import {
  computeAcceptanceHash,
  readAcceptanceLock,
  type AcceptanceFile,
} from '../utils/acceptance-hash.js';
import { findUnboundRules, scanAcceptanceDrivers } from '../utils/mock-of-sut-scan.js';

const validateAcceptance = ajv.compile(acceptanceSchema);

/**
 * True when a case's `input`/`expect` value is a real answer, not an unfilled
 * placeholder. Mirrors the spirit of gate-artifacts.ts's `meaningfulChars`/
 * `findPlaceholders` (AC-1 explicitly reuses that detection philosophy) but
 * operates on a single parsed YAML value rather than markdown/frontmatter text:
 * a bare `<...>` bracket token (the same fill-in convention
 * `PLACEHOLDER_LITERALS` uses, generalized since the template's own tokens
 * -- e.g. `<input-value>` -- are not yet fixed at this pass, IP-10) or an empty
 * string/collection is not meaningful; any other scalar, or a non-empty
 * array/object containing at least one meaningful value, is.
 */
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

/**
 * ADR 0010 / ci-gate-contract.md `enforceAcceptanceOracle` -- validate this
 * change's `acceptance.yml`:
 *   - present + valid shape + >=1 non-placeholder case (AC-1)
 *   - hash-lock reconcile against `.cdd/acceptance-lock.json` (AC-2)
 *   - no acceptance driver mocks the resolved SUT, and none hardcodes a
 *     case's `expect` value (AC-4)
 *   - a recorded, passed `acceptance`-phase run in test-evidence.yml (AC-5)
 *   - missing -> migration-window graceful degradation (see module header)
 */
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
        'missing required artifact: acceptance.yml (ADR 0010 — every change needs a human-authored ' +
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
    if (out.errors.length > 0) return; // shape is not trustworthy for the checks below
  }

  // AC-1 -- at least one case must carry a real (non-placeholder) input/expect.
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const realCases = cases.filter((c) => isMeaningfulValue(c?.input) && isMeaningfulValue(c?.expect));
  if (realCases.length === 0) {
    errors.push(
      'acceptance.yml: every case still has a placeholder (or missing) `input`/`expect` — author at least ' +
      'one real case with a concrete answer key before the gate can pass (AC-1; ADR 0010 §1).',
    );
    return; // hashing/locking a still-placeholder oracle is not meaningful
  }

  // AC-2 -- hash-lock reconcile against the author-time baseline.
  const currentHash = computeAcceptanceHash(data);
  const lock = readAcceptanceLock(cwd);
  const baseline = lock[changeId];
  if (!baseline) {
    warnings.push(
      'acceptance.yml has no recorded baseline in .cdd/acceptance-lock.json — this oracle is not yet ' +
      'protected against tampering; a human must record the baseline by running ' +
      `\`cdd-kit accept relock ${changeId}\`.`,
    );
  } else if (baseline.hash !== currentHash) {
    errors.push('acceptance oracle modified after authoring — human must re-confirm.');
  }

  // AC-4 -- no acceptance driver mocks the resolved SUT, and none hardcodes a
  // case's expect value instead of reading it from the emitted loader
  // (design.md Q2). Scans only discovered driver files (tests/acceptance/ or
  // test/acceptance/); no drivers found is a silent no-op here -- AC-5 below
  // separately requires a recorded, passed run, so "no driver at all" is
  // still caught, just by a different signal.
  for (const finding of scanAcceptanceDrivers(cwd, changeDir, changeId, realCases)) {
    if (finding.kind === 'mock-of-sut') {
      // finding.detail already carries the "supposed to verify" framing and the
      // AC-4/ADR pointer (mock-of-sut-scan.ts), so the gate message need not
      // duplicate it -- one source of truth for the phrase.
      errors.push(`${finding.file}: acceptance driver ${finding.detail}.`);
    } else {
      errors.push(
        `${finding.file}: acceptance driver ${finding.detail} — read it from the acceptance loader instead ` +
        'of hardcoding the answer key (AC-4; design.md Q2).',
      );
    }
  }

  // ADR 0010 §4 / ci-gate-contract.md `enforceAcceptanceOracle` condition 6 --
  // `--strict` only (never the default mode): every `rules[]` invariant must
  // have >=1 bound driver test. `rules: []` (or no `rules` key at all -- true
  // for every pre-existing change dir today, verified: none but this change's
  // own acceptance.yml declares any) passes trivially -- there is nothing to
  // bind, so this newly-implemented check cannot regress a legacy change dir
  // that has never used `rules[]`. See src/utils/mock-of-sut-scan.ts
  // findUnboundRules for the binding convention and the two anti-false-
  // positive guards it reuses from the AC-4 scan above.
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

  // AC-5 -- a case's pass must be a recorded, bounded, passed `acceptance`-
  // phase run in test-evidence.yml; a self-reported pass with no recorded run
  // fails. Mirrors the isNewChange||strict migration-window split above (see
  // module header) so a legacy/non-strict change is not newly hard-failed by
  // this check landing.
  const evidencePath = join(changeDir, 'test-evidence.yml');
  const hasPassedAcceptanceRun = (() => {
    if (!existsSync(evidencePath)) return false;
    const { data: evidence } = loadYamlFile<{ runs?: Array<{ phase?: string; status?: string }> }>(evidencePath);
    return (evidence?.runs ?? []).some((r) => r.phase === 'acceptance' && r.status === 'passed');
  })();
  if (!hasPassedAcceptanceRun) {
    if (isNewChange || strict) {
      errors.push(
        'acceptance.yml: no passed `acceptance`-phase run recorded in test-evidence.yml — a self-reported ' +
        'pass is not enough (AC-5; ADR 0005 §6). Run `cdd-kit test run <change-id> --phase acceptance`.',
      );
    } else {
      warnings.push(
        'missing a passed `acceptance`-phase test-evidence run (legacy change; run `cdd-kit test run ' +
        '<change-id> --phase acceptance`)',
      );
    }
  }
}
