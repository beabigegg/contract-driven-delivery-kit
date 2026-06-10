import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadTierPolicy, computeTierFloor } from '../utils/tier-floor.js';
import { getStagedPaths } from '../utils/git-paths.js';
import { loadYamlFile, type TasksFile } from './gate-shared.js';

export interface TierResolution {
  tier: number | null;
  source: 'tasks-frontmatter' | 'classification-structured' | 'classification-bold' | 'none';
  classificationPresent: boolean;
  classificationHasLooseMarker: boolean;
}

/**
 * Structured tier marker: a `## Tier` heading whose sole list item is a single
 * digit (`## Tier\n- 2`). Anchored to its own line and range-validated to 0-5,
 * so the unfilled template stub (`- 0 / 1 / 2 / 3 / 4 / 5`) does not match.
 * Returns null when absent or out of range.
 */
function parseStructuredTier(text: string): number | null {
  const m = text.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 0 && n <= 5 ? n : null;
}

/**
 * Legacy bold tier marker (`**Tier:** Tier 2`), anchored to the start of its
 * line and range-validated to 0-5. Returns null when absent or out of range.
 */
function parseBoldTier(text: string): number | null {
  const m = text.match(/^\s*\*\*Tier:\*\*\s*Tier\s*(\d)\b/im);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 0 && n <= 5 ? n : null;
}

/**
 * Whether the classification carries SOME deliberate risk/tier marker, used only
 * as the legacy fallback when no machine-readable tier is set. Hardened (P1-12)
 * so it matches a marker in marker position — a `Tier N` token (digit-guarded,
 * so `tier-based` cannot trip it), a `low|medium|high|critical` value as a list
 * item, or a labelled risk/severity/priority value — and NOT incidental prose
 * such as "critical systems" or "high availability", which previously suppressed
 * the missing-tier error.
 */
function hasLooseRiskMarker(text: string): boolean {
  if (/^[^\n]*\btier\s*[0-5]\b/im.test(text)) return true;
  const RISK = '(?:low|medium|high|critical)';
  // A list item value: "- high", "* critical".
  if (new RegExp(String.raw`^\s*[-*]\s+${RISK}\b`, 'im').test(text)) return true;
  // A labelled value: "**Risk Level:** medium", "Risk: high", "Severity: critical".
  if (new RegExp(String.raw`^\s*(?:\*\*\s*)?(?:risk(?:\s*level)?|severity|priority)\s*\*?\*?\s*:\s*${RISK}\b`, 'im').test(text)) {
    return true;
  }
  return false;
}

export function resolveTier(changeDir: string): TierResolution {
  const classifPath = join(changeDir, 'change-classification.md');
  const classificationPresent = existsSync(classifPath);
  const classificationText = classificationPresent ? readFileSync(classifPath, 'utf8') : '';
  const classificationHasLooseMarker = classificationPresent && hasLooseRiskMarker(classificationText);

  const tasksPath = join(changeDir, 'tasks.yml');
  if (existsSync(tasksPath)) {
    const { data } = loadYamlFile<TasksFile>(tasksPath);
    const t = data?.tier;
    if (typeof t === 'number' && t >= 0 && t <= 5) {
      return { tier: t, source: 'tasks-frontmatter', classificationPresent, classificationHasLooseMarker };
    }
  }

  // Precedence: tasks.yml frontmatter (above) > structured `## Tier` > legacy bold.
  if (classificationPresent) {
    const structured = parseStructuredTier(classificationText);
    if (structured !== null) {
      return { tier: structured, source: 'classification-structured', classificationPresent, classificationHasLooseMarker };
    }
    const bold = parseBoldTier(classificationText);
    if (bold !== null) {
      return { tier: bold, source: 'classification-bold', classificationPresent, classificationHasLooseMarker };
    }
  }

  return { tier: null, source: 'none', classificationPresent, classificationHasLooseMarker };
}

export function enforceTierConsistency(changeDir: string, errors: string[], warnings: string[]): void {
  const resolution = resolveTier(changeDir);
  const classificationText = resolution.classificationPresent
    ? readFileSync(join(changeDir, 'change-classification.md'), 'utf8')
    : '';
  const structuredTier = resolution.classificationPresent ? parseStructuredTier(classificationText) : null;
  const boldTier = resolution.classificationPresent ? parseBoldTier(classificationText) : null;

  // Two declared markers inside the SAME classification that disagree is an
  // authoring error: the gate must not silently pick one. (A tasks.yml/
  // classification disagreement is a softer warning below — frontmatter is the
  // machine-readable source of truth, but two prose markers have no tiebreaker.)
  if (structuredTier !== null && boldTier !== null && structuredTier !== boldTier) {
    errors.push(
      `change-classification.md: conflicting tier markers — \`## Tier\\n- ${structuredTier}\` vs ` +
      `\`**Tier:** Tier ${boldTier}\`. Keep a single tier marker (prefer \`tier: <0-5>\` in tasks.yml frontmatter).`,
    );
    return;
  }

  if (resolution.tier === null) {
    if (resolution.classificationPresent && !resolution.classificationHasLooseMarker) {
      errors.push(
        'change-classification.md: missing tier marker. Set `tier: <0-5>` in tasks.yml frontmatter (preferred) or include `## Tier\\n- N` in change-classification.md.',
      );
    }
    return;
  }

  if (resolution.source === 'classification-bold') {
    warnings.push(
      'tier marker is bold-text only (legacy format); set `tier: <0-5>` in tasks.yml frontmatter for machine-readable classification.',
    );
    return;
  }

  if (resolution.source === 'tasks-frontmatter' && resolution.classificationPresent) {
    const classifTier = structuredTier ?? boldTier;
    if (classifTier !== null && classifTier !== resolution.tier) {
      warnings.push(
        `tier mismatch: tasks.yml frontmatter says ${resolution.tier}, change-classification.md says ${classifTier} (frontmatter wins; reconcile classification).`,
      );
    }
  }
}

/**
 * Mechanical risk-tier floor — the deterministic safety net under the AI
 * classifier. Scans the change's stated intent in `change-request.md` (the
 * user's own words, not the classification it is checking against) and the
 * change's touched file paths (against the critical tier-0 rules only) for
 * sensitive surfaces, and fails the gate when the declared tier is weaker
 * (numerically higher) than the matched floor. A change may bypass with
 * `tier-floor-override: "<reason>"` in tasks.yml frontmatter, which downgrades
 * the error to an audit warning.
 */
export function enforceTierFloor(changeDir: string, errors: string[], warnings: string[]): void {
  const cwd = process.cwd();
  const policy = loadTierPolicy(cwd);
  if (!policy.enabled) return;

  // Intent is scanned from the user's own words (change-request.md), not the
  // classification we are checking against — scanning the classification would
  // let "this is NOT an auth change" trip the net, and would make the floor
  // circular. The request is the ground truth of what was asked for. Staged
  // paths add a path-only signal so a generic request ("refactor middleware")
  // whose staged work lives under auth/ or payments/ still trips the floor. We
  // scan only the STAGED change (not the whole worktree) so an unrelated
  // unstaged auth/ edit can't trip the floor and reject a low-risk commit.
  const requestPath = join(changeDir, 'change-request.md');
  const requestText = existsSync(requestPath) ? readFileSync(requestPath, 'utf8') : '';
  const staged = getStagedPaths(cwd);

  // The pre-commit hook gates each staged change separately, but the staged
  // path list is global to the commit. When a single commit stages more than
  // one change directory, a source path can't be attributed to a specific
  // change — including another change's staged auth/ path would wrongly raise
  // THIS change's floor. In that case drop the path signal and fall back to the
  // request text alone; single-change commits keep the full staged-path floor.
  const stagedChangeIds = new Set(
    staged
      .map(p => /^specs\/changes\/([^/]+)\//.exec(p)?.[1])
      .filter((id): id is string => id !== undefined),
  );
  const touched = stagedChangeIds.size > 1 ? [] : staged;

  const floor = computeTierFloor(requestText, policy, { paths: touched });
  if (floor.floorTier === null) return;

  const declared = resolveTier(changeDir).tier;
  // A missing tier is already reported elsewhere; don't double-report. But do
  // leave a breadcrumb so the operator knows the floor that will apply.
  if (declared === null) {
    warnings.push(
      `tier floor: ${floor.label} detected (matched: ${floor.matched.join(', ')}); classification must declare tier ${floor.floorTier} or stricter.`,
    );
    return;
  }

  if (declared <= floor.floorTier) return; // declared is at least as strict — OK

  // Declared tier is weaker than the floor requires.
  const overrideRaw = (() => {
    const { data } = loadYamlFile<TasksFile>(join(changeDir, 'tasks.yml'));
    const o = data?.['tier-floor-override'];
    return typeof o === 'string' ? o.trim() : '';
  })();

  const detail =
    `${floor.label} detected (matched: ${floor.matched.join(', ')}) requires tier ${floor.floorTier} or stricter, ` +
    `but classification declared tier ${declared}.`;

  if (overrideRaw) {
    warnings.push(`tier floor override: ${detail} Bypassed by tier-floor-override: "${overrideRaw}".`);
  } else {
    errors.push(
      `tier floor violation: ${detail} Re-classify to tier ${floor.floorTier} (or stricter), ` +
      `or record \`tier-floor-override: "<reason>"\` in tasks.yml frontmatter to bypass with an audit trail. ` +
      `Disable entirely in .cdd/tier-policy.json.`,
    );
  }
}
