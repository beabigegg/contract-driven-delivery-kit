import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { validate } from './validate.js';
import { explainGateError } from '../utils/gate-explain.js';
import { type TasksFile } from './gate-shared.js';
import {
  REQUIRED_FILES,
  MIN_CHARS,
  meaningfulChars,
  findPlaceholders,
  countPendingContextRequests,
  isContextGovernedChange,
  lintTasksFile,
  getArchiveTaskIds,
} from './gate-artifacts.js';
import { resolveTier, enforceTierConsistency, enforceTierFloor } from './gate-tier.js';
import { validateDependencies } from './gate-dependencies.js';
import { enforceContractSubstance } from './gate-contracts.js';
import { enforceTestEvidence, enforceBugFixEvidence } from './gate-evidence.js';
import { enforceRequiredAgentEvidence } from './gate-agents.js';

export interface GateOptions {
  strict?: boolean;
  /** Append plain-language explanations + a "say this to Claude" hint to each failure. */
  explain?: boolean;
}

/**
 * Print the failed gate and exit non-zero. In `--explain` mode each error is
 * followed by a plain-language "Why" and a ready-to-paste "Say this to Claude"
 * line; otherwise a single trailing hint points the user at `--explain`. The
 * leading `headline` lets callers distinguish a normal failure from one where
 * the validators themselves threw.
 */
function reportGateFailure(
  changeId: string,
  errors: string[],
  explain: boolean,
  headline?: string,
): never {
  log.error(headline ?? `gate failed for change: ${changeId}`);
  for (const e of errors) {
    log.error(`  ${e}`);
    if (explain) {
      const ex = explainGateError(e);
      if (ex) {
        log.dim(`      Why: ${ex.why}`);
        log.info(`      Say this to Claude: "${ex.sayToClaude}"`);
      }
    }
  }
  if (!explain) {
    log.blank();
    log.info(`Need help? Run: cdd-kit gate ${changeId} --explain for a plain-language explanation of each failure.`);
  }
  process.exit(1);
}

export async function gate(changeId: string, opts: GateOptions = {}): Promise<void> {
  const strict = opts.strict ?? false;
  const explain = opts.explain ?? false;
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);

  if (!existsSync(changeDir)) {
    log.error(`change not found: ${changeId} (looked in ${changeDir})`);
    if (explain) {
      log.dim('      Why: there is no change folder with that name under specs/changes/.');
      log.info('      Say this to Claude: "What is the exact id of the change I should run the gate on?"');
    }
    process.exit(1);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const isNewChange = isContextGovernedChange(changeDir);
  const manifestPath = join(changeDir, 'context-manifest.md');
  const hasManifest = existsSync(manifestPath);

  errors.push(...validateDependencies(cwd, changeId, changeDir));

  if (hasManifest) {
    const pending = countPendingContextRequests(readFileSync(manifestPath, 'utf8'));
    if (pending > 0) {
      warnings.push(`context-manifest.md: has ${pending} pending context expansion request(s)`);
    }
  }

  for (const f of REQUIRED_FILES) {
    if (f === 'context-manifest.md') {
      if (!hasManifest) {
        if (isNewChange || strict) {
          errors.push('missing required artifact: context-manifest.md');
        } else {
          warnings.push('missing context-manifest.md (legacy change; run cdd-kit migrate after upgrading)');
        }
      }
      continue;
    }
    if (!existsSync(join(changeDir, f))) {
      errors.push(`missing required artifact: ${f}`);
    }
  }

  if (errors.length === 0) {
    for (const f of REQUIRED_FILES) {
      if (f === 'context-manifest.md' && !hasManifest) continue;
      if (f === 'tasks.yml') continue;
      const content = readFileSync(join(changeDir, f), 'utf8');
      const minChars = MIN_CHARS[f] ?? 100;
      if (meaningfulChars(content) < minChars) {
        errors.push(`${f}: appears to be a stub (< ${minChars} meaningful chars)`);
        continue;
      }
      // context-manifest.md is exempt: its template ships illustrative agent
      // sub-sections (`### <implementation-agent>`, `<change-id>` path stubs)
      // that are explicitly "documentation only — gate enforces Allowed Paths,
      // not individual packets". Its real enforcement lives elsewhere, so a
      // placeholder there is not an unfilled-substance signal.
      if (f !== 'context-manifest.md') {
        const placeholders = findPlaceholders(content);
        if (placeholders.length > 0) {
          errors.push(
            `${f}: still contains unfilled template placeholder(s) ${placeholders.join(', ')} — replace them with the change's real values before the gate can pass`,
          );
        }
      }
    }

    const classifPath = join(changeDir, 'change-classification.md');
    const tierResolution = resolveTier(changeDir);
    if (tierResolution.tier === null && existsSync(classifPath) && !tierResolution.classificationHasLooseMarker) {
      errors.push('change-classification.md: missing tier/risk marker (set tier in tasks.yml frontmatter, or include Tier 0-5 / low|medium|high|critical in change-classification.md)');
    }
  }

  const tasksPath = join(changeDir, 'tasks.yml');
  let tasksData: TasksFile | null = null;
  if (existsSync(tasksPath)) {
    tasksData = lintTasksFile(tasksPath, errors, warnings);
  }
  if (tasksData) {
    const archiveIds = new Set(getArchiveTaskIds(tasksData));
    const nonArchivePending = (tasksData.tasks ?? [])
      .filter(t => t.status === 'pending')
      .filter(t => !archiveIds.has(t.id))
      .length;
    if (nonArchivePending > 0) {
      if (strict) {
        errors.push(`${nonArchivePending} task(s) still pending (mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped). Run gate without --strict during development.`);
      } else {
        warnings.push(`${nonArchivePending} task(s) still pending (warning only in non-strict mode)`);
      }
    }
  }

  enforceTierConsistency(changeDir, errors, warnings);
  enforceTierFloor(changeDir, errors, warnings);
  enforceContractSubstance(cwd, errors, warnings, strict);
  enforceTestEvidence(cwd, changeDir, changeId, tasksData, isNewChange, strict, errors, warnings);
  enforceBugFixEvidence(changeDir, changeId, cwd, tasksData, errors, warnings);
  enforceRequiredAgentEvidence(changeDir, warnings);

  // Derived-index freshness (P2-1): if this change has generated change.yml /
  // trace.yml that have drifted from their source artifacts, nudge a refresh.
  // Warn-only and ONLY when the files already exist — a change that never opted
  // into the derived index is never nagged, and a missing/stale index never
  // affects the gate's pass/fail (the source artifacts remain the source of
  // truth). Best-effort: the gate must never block on the derived index.
  try {
    const { checkStaleness } = await import('./metadata.js');
    const { stale } = checkStaleness(changeDir, cwd);
    if (stale.length > 0) {
      warnings.push(
        `derived metadata stale (${stale.join(', ')}); run \`cdd-kit metadata ${changeId}\` to refresh the change.yml/trace.yml index`,
      );
    }
  } catch { /* derived index is advisory only — never block the gate on it */ }

  for (const w of warnings) {
    log.warn(`  ${w}`);
  }

  if (errors.length > 0) {
    reportGateFailure(changeId, errors, explain);
  }

  log.info(`gate: running contract validators for ${changeId}`);
  try {
    await validate({ contracts: true, env: true, ci: true, spec: false, versions: true });
  } catch (err) {
    reportGateFailure(
      changeId,
      [(err as Error).message],
      explain,
      `gate failed for change: ${changeId} (contract validators reported a problem):`,
    );
  }

  // Warnings were already printed once above (before the error check); printing
  // them again here would duplicate every warning on a passing run.
  log.ok(`gate passed for change: ${changeId}`);
}
