// `enforceInteractionDesign` (ADR 0012; ci-gate-contract.md
// `enforceInteractionDesign` row) -- the gate check for the human-confirmed
// `interaction-design.md` per change. Mirrors the module shape of
// gate-acceptance.ts: a present-artifact validator (placeholder/open-decisions/
// referential-integrity/provenance/hash-lock) plus a missing-artifact
// migration-window branch, gated on `isNewChange || strict` exactly like
// `enforceAcceptanceOracle` / `enforceTestEvidence` (never re-derived locally --
// see the module header of gate-acceptance.ts and ci-gates.md § Migration
// Window).
//
// Grammar this module parses out of interaction-design.md (ADR 0012 §1; no
// dedicated schema exists for a markdown artifact, so this header is the
// authoritative shape until specs/templates/interaction-design.md ships,
// batch 2, IP-8):
//   ## Presented Information  -- table: | item | rationale | provenance |
//   ## User Intents           -- table: | id | intent | frequency | path |
//   ## Controls               -- table: | id | control | intent |
//                                 optional "### Deleted Controls" sub-table:
//                                 | control | reason |
//   ## States                 -- table: | id | meaning | discriminator |
//   ## Open Decisions         -- list:  "- [ ] ..." (unresolved) / "- [x] ..." (resolved)
//   ## Confirmed               -- human prose (hash-locked, src/utils/design-hash.ts)
//
// The ADR 0011 skip path (`applicability: not-applicable`) is decided
// EXCLUSIVELY by `applicability.py` (the single pass/fail authority, reused
// here for a per-change spec artifact rather than a `contracts/` family file --
// ci-gate-contract.md `## Contract Applicability Marker (ADR 0011)`). This
// module never makes its own skip/fail decision from the marker; it only
// invokes the shared Python reader and relays its verdict.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { ASSET } from '../utils/paths.js';
import { stripFrontmatter } from '../contracts/parser.js';
import { sectionBody } from '../utils/markdown-section.js';
import { meaningfulChars, findPlaceholders } from './gate-artifacts.js';
import { computeDesignHash, readDesignLock } from '../utils/design-hash.js';
import {
  parseTable,
  tableCell,
  reconcileProvenance,
  type InfoItemInput,
  type StateDiscriminatorInput,
} from '../utils/design-provenance.js';

const MIN_MEANINGFUL_CHARS = 100;

interface ApplicabilityResult {
  status: 'applicable' | 'not-applicable' | 'invalid';
  reason?: string;
  error?: string;
}

function resolvePython(): string | null {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (r.status === 0) return cmd;
  }
  return null;
}

/**
 * Evaluate `interaction-design.md`'s `applicability` frontmatter marker via
 * the shared `applicability.py` reader -- the SOLE pass/fail authority for
 * this marker (ADR 0011; ci-gate-contract.md `## Contract Applicability
 * Marker`). This module does not parse/interpret the marker itself; it only
 * relays applicability.py's verdict. If Python cannot be found/run, this
 * fails CLOSED (an 'invalid' verdict) rather than silently defaulting to
 * 'applicable' or 'not-applicable' -- an unevaluable skip path must never be
 * treated as a pass.
 */
function classifyDesignApplicability(designPath: string): ApplicabilityResult {
  const py = resolvePython();
  if (!py) {
    return {
      status: 'invalid',
      error:
        'Python not found on PATH -- applicability.py (ADR 0011\'s sole pass/fail authority) could not run to ' +
        'evaluate this artifact\'s applicability marker. Install Python 3.8+ so the skip path can be evaluated ' +
        '(fail-closed: this is treated as a hard error, not a silent pass).',
    };
  }
  const scriptPath = join(ASSET.skill, 'scripts', 'applicability.py');
  if (!existsSync(scriptPath)) {
    return {
      status: 'invalid',
      error: 'applicability.py not found at ' + scriptPath + ' -- reinstall the cdd-kit package (fail-closed: cannot evaluate the ADR 0011 skip path).',
    };
  }
  const pyEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const r = spawnSync(py, [scriptPath, designPath], { encoding: 'utf8', env: pyEnv });
  if (r.status !== 0 || !r.stdout) {
    return {
      status: 'invalid',
      error: 'applicability.py exited abnormally evaluating ' + designPath + ' (' + (r.stderr?.trim() || 'no output') + ') -- fail-closed.',
    };
  }
  try {
    return JSON.parse(r.stdout.trim()) as ApplicabilityResult;
  } catch {
    return { status: 'invalid', error: 'applicability.py produced unparseable output for ' + designPath + ' -- fail-closed.' };
  }
}

interface OpenDecision {
  resolved: boolean;
  text: string;
}

/** `## Open Decisions` list items: "- [ ] ..." (unresolved) / "- [x] ..." (resolved). */
function parseOpenDecisions(body: string): OpenDecision[] {
  const section = sectionBody(body, 'Open Decisions');
  const out: OpenDecision[] = [];
  const re = /^-\s*\[([ xX])\]\s*(.+)$/;
  for (const line of section.split('\n')) {
    const m = line.trim().match(re);
    if (!m) continue;
    out.push({ resolved: m[1].toLowerCase() === 'x', text: m[2].trim() });
  }
  return out;
}

interface IntentRow {
  id: string;
  path: string;
}

/** `## User Intents` table: | id | intent | frequency | path | */
function parseIntents(body: string): IntentRow[] {
  const table = parseTable(sectionBody(body, 'User Intents'));
  return table.rows.map(row => ({
    id: tableCell(table, row, 'id'),
    path: tableCell(table, row, 'path'),
  }));
}

interface ControlRow {
  id: string;
  control: string;
  intentCell: string;
}

interface DeletedControlRow {
  control: string;
  reason: string;
}

/**
 * `## Controls` table: | id | control | intent | (each row cites exactly one
 * intent id). An optional "### Deleted Controls" sub-heading inside the same
 * section carries a separate table: | control | reason |.
 */
function parseControls(body: string): { controls: ControlRow[]; deleted: DeletedControlRow[] } {
  const section = sectionBody(body, 'Controls');
  const lines = section.split('\n');
  const subIdx = lines.findIndex(l => /^###\s+Deleted Controls\s*$/i.test(l.trim()));
  const mainText = subIdx === -1 ? section : lines.slice(0, subIdx).join('\n');
  const subText = subIdx === -1 ? '' : lines.slice(subIdx + 1).join('\n');

  const mainTable = parseTable(mainText);
  const controls: ControlRow[] = mainTable.rows.map(row => ({
    id: tableCell(mainTable, row, 'id'),
    control: tableCell(mainTable, row, 'control'),
    intentCell: tableCell(mainTable, row, 'intent'),
  }));

  const subTable = parseTable(subText);
  const deleted: DeletedControlRow[] = subTable.rows.map(row => ({
    control: tableCell(subTable, row, 'control'),
    reason: tableCell(subTable, row, 'reason'),
  }));

  return { controls, deleted };
}

/** `## Presented Information` table: | item | rationale | provenance | */
function parsePresentedInformation(body: string): InfoItemInput[] {
  const table = parseTable(sectionBody(body, 'Presented Information'));
  return table.rows.map(row => ({
    item: tableCell(table, row, 'item'),
    provenance: tableCell(table, row, 'provenance'),
  }));
}

/** `## States` table: | id | meaning | discriminator | */
function parseStates(body: string): StateDiscriminatorInput[] {
  const table = parseTable(sectionBody(body, 'States'));
  return table.rows.map(row => ({
    id: tableCell(table, row, 'id'),
    meaning: tableCell(table, row, 'meaning'),
    discriminator: tableCell(table, row, 'discriminator'),
  }));
}

/**
 * Referential integrity (ci-gate-contract.md condition 4 / ADR 0012 §1.3):
 * every control cites exactly one intent id; every intent has exactly one
 * path; every deleted control records a reason.
 */
function checkReferentialIntegrity(
  intents: IntentRow[],
  controls: ControlRow[],
  deleted: DeletedControlRow[],
): string[] {
  const errors: string[] = [];
  const intentIds = new Set(intents.map(i => i.id).filter(Boolean));

  for (const intent of intents) {
    if (!intent.path) {
      errors.push('User Intents: intent "' + (intent.id || '(no id)') + '" has no path — every intent needs exactly one path (ADR 0012 §1.2).');
    }
  }

  for (const control of controls) {
    const label = control.control || control.id || '(unnamed control)';
    const ids = control.intentCell.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      errors.push('Controls: "' + label + '" cites zero intent ids — every control must cite exactly one intent id (ADR 0012 §1.3).');
      continue;
    }
    if (ids.length > 1) {
      errors.push('Controls: "' + label + '" cites ' + ids.length + ' intent ids (' + ids.join(', ') + ') — every control must cite exactly one intent id (ADR 0012 §1.3).');
      continue;
    }
    if (!intentIds.has(ids[0])) {
      errors.push('Controls: "' + label + '" cites intent id "' + ids[0] + '", which is not defined in ## User Intents.');
    }
  }

  for (const d of deleted) {
    if (!d.reason) {
      errors.push('Controls: deleted control "' + (d.control || '(unnamed)') + '" has no recorded reason — every deleted control must record why (ADR 0012 §1.3).');
    }
  }

  return errors;
}

/**
 * ADR 0012 / ci-gate-contract.md `enforceInteractionDesign` -- validate this
 * change's `interaction-design.md`:
 *   - present + non-placeholder (condition 1)
 *   - zero unresolved ## Open Decisions (condition 2)
 *   - a human ## Confirmed section is present (condition 3)
 *   - referential integrity (condition 4)
 *   - provenance reconciliation has zero HARD failures (condition 5)
 *   - the ## Confirmed hash matches .cdd/design-lock.json (condition 6)
 *   - applicability: not-applicable + reason skips conditions 1-6 (condition 7)
 *   - missing -> migration-window graceful degradation (see module header)
 *
 * SAME signature shape as `enforceAcceptanceOracle` (gate-acceptance.ts):
 * `isNewChange` MUST be the value already computed once at gate.ts (via
 * `isContextGovernedChange`) and threaded through -- never re-derived here
 * (ci-gates.md § Migration Window; the TOP RISK this module's callers must
 * respect).
 */
export async function enforceInteractionDesign(
  cwd: string,
  changeDir: string,
  changeId: string,
  isNewChange: boolean,
  strict: boolean,
  errors: string[],
  warnings: string[],
): Promise<void> {
  const designPath = join(changeDir, 'interaction-design.md');

  if (!existsSync(designPath)) {
    if (isNewChange || strict) {
      errors.push(
        'missing required artifact: interaction-design.md (ADR 0012 — every change needs a human-confirmed ' +
        'interaction design deriving what each screen presents, why each control exists, and how each state is ' +
        'told apart; author one via the interaction-designer proposal + human confirmation, or mark it ' +
        '`applicability: not-applicable` with a reason if this change has no UI surface).',
      );
    } else {
      warnings.push(
        'missing interaction-design.md (legacy change; ADR 0012 interaction design not yet backfilled for this change)',
      );
    }
    return;
  }

  const raw = readFileSync(designPath, 'utf8');
  const { body } = stripFrontmatter(raw);

  // Condition 7 -- the ADR 0011 skip path. applicability.py is the SOLE
  // pass/fail authority; this module only relays its verdict.
  const applicability = classifyDesignApplicability(designPath);
  if (applicability.status === 'invalid') {
    errors.push('interaction-design.md: ' + applicability.error);
    return;
  }
  if (applicability.status === 'not-applicable') {
    warnings.push(
      'interaction-design.md marked applicability: not-applicable — ' + applicability.reason +
      ' (ADR 0011/0012; conditions 1-6 skipped).',
    );
    return;
  }

  // Condition 1 / AC-7 -- existence + non-placeholder. A `cdd-kit migrate`
  // placeholder-plus-instructions interaction-design.md is caught here (same
  // detection philosophy as enforceAcceptanceOracle AC-7; no separate code
  // needed -- see gate-acceptance.ts's own module header for the precedent).
  if (meaningfulChars(raw) < MIN_MEANINGFUL_CHARS) {
    errors.push('interaction-design.md: appears to be a stub (< ' + MIN_MEANINGFUL_CHARS + ' meaningful chars) — author the derivation chain before the gate can pass.');
    return;
  }
  const placeholders = findPlaceholders(raw);
  if (placeholders.length > 0) {
    errors.push('interaction-design.md: still contains unfilled template placeholder(s) ' + placeholders.join(', ') + ' — replace them with the change\'s real values before the gate can pass.');
    return;
  }

  // Condition 2 -- zero unresolved ## Open Decisions.
  for (const od of parseOpenDecisions(body)) {
    if (!od.resolved) {
      errors.push('interaction-design.md: unresolved Open Decision: "' + od.text + '" — the human must answer it and have the answer transcribed into ## Confirmed before the gate can pass (ADR 0012 §1.6/§4).');
    }
  }

  // Condition 3 -- a human ## Confirmed section is present.
  const confirmedText = sectionBody(body, 'Confirmed');
  const hasConfirmed = meaningfulChars(confirmedText) > 0;
  if (!hasConfirmed) {
    errors.push('interaction-design.md: no human ## Confirmed section is present — the human\'s answers to ## Open Decisions must be transcribed into ## Confirmed before the gate can pass (ADR 0012 §1.7/§4).');
  }

  // Condition 4 -- referential integrity.
  const intents = parseIntents(body);
  const { controls, deleted } = parseControls(body);
  errors.push(...checkReferentialIntegrity(intents, controls, deleted));

  // Condition 5 -- provenance reconciliation (ADR 0012 §2). HARD failures
  // only; the reverse/over-fetch advisory is NEVER computed here (it is a
  // corpus-wide `cdd-kit doctor` report — a per-change artifact cannot see
  // sibling screens).
  const infoItems = parsePresentedInformation(body);
  const states = parseStates(body);

  // AC-1 (ci-gate-contract.md condition 2 / ADR 0012) -- the derivation chain
  // must not be vacuous. Provenance reconciliation (condition 5, below) over an
  // empty set passes trivially, so without this a human could confirm a design
  // that asserts nothing at all -- the very outcome ADR 0012 exists to prevent.
  // Name WHICH table is empty (the human fixes each differently). Reuses the
  // `infoItems`/`states` arrays already parsed above; no third parser. This sits
  // AFTER the `applicability: not-applicable` short-circuit, so a not-applicable
  // surface never reaches it. Errors under `isNewChange || strict`; a legacy dir
  // is warned, matching every neighbouring condition.
  const emptyChain: string[] = [];
  if (infoItems.length === 0) {
    emptyChain.push(
      'interaction-design.md: `## Presented Information` has zero rows — the derivation chain is vacuous; a ' +
      'confirmed design must present at least one information item (ADR 0012 AC-1). A design whose ' +
      '`## Presented Information` or `## States` has zero rows asserts nothing, and provenance reconciliation ' +
      'over an empty set passes trivially, so nothing else catches it.',
    );
  }
  if (states.length === 0) {
    emptyChain.push(
      'interaction-design.md: `## States` has zero rows — the derivation chain is vacuous; a confirmed design ' +
      'must define at least one state (ADR 0012 AC-1). A design whose `## Presented Information` or `## States` ' +
      'has zero rows asserts nothing, and provenance reconciliation over an empty set passes trivially, so ' +
      'nothing else catches it.',
    );
  }
  if (isNewChange || strict) {
    errors.push(...emptyChain);
  } else {
    warnings.push(...emptyChain.map(m => m + ' (legacy change; ADR 0012 non-vacuity not yet backfilled)'));
  }

  errors.push(...(await reconcileProvenance(cwd, infoItems, states)));

  // Condition 6 -- the ## Confirmed hash must match .cdd/design-lock.json.
  //
  // A MISSING baseline is a hard failure under `isNewChange || strict`, not a
  // warning. An unlocked `## Confirmed` section proves nothing: the design-write
  // hook is advisory by default, so any Edit-capable agent can author its own
  // `## Confirmed` prose, and a warn-only branch here would let that pass the
  // gate -- leaving ADR 0012's entire human-confirmation guarantee unenforced in
  // the default configuration. Only `cdd-kit design confirm` (src/commands/
  // design.ts) writes the lock, and `.cdd/design-lock.json` is a HARD forbidden
  // context path. The `isNewChange || strict` split is the same migration window
  // every other check in this module uses -- a legacy change dir that predates
  // the lock is warned, never newly broken.
  if (hasConfirmed) {
    const currentHash = computeDesignHash(body);
    const lock = readDesignLock(cwd);
    const baseline = lock[changeId];
    if (!baseline) {
      const detail =
        'interaction-design.md has a ## Confirmed section but no recorded baseline in ' +
        '.cdd/design-lock.json — an unconfirmed ## Confirmed proves nothing (an agent can write one). ' +
        'A human must record the baseline by running `cdd-kit design confirm ' + changeId + '`.';
      if (isNewChange || strict) {
        errors.push(detail);
      } else {
        warnings.push(detail + ' (legacy change; not yet migrated to the ADR 0012 hash-lock)');
      }
    } else if (baseline.hash !== currentHash) {
      errors.push('interaction design modified after confirmation — human must re-confirm.');
    }
  }
}
