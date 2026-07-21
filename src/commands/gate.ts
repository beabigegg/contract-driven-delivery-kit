import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { validate } from './validate.js';
import { explainGateError } from '../utils/gate-explain.js';
import { type TasksFile, enforceConfirmationHookInstallation } from './gate-shared.js';
import {
  MIN_CHARS,
  V2_PLAN_SECTIONS,
  v2PlanSectionFinding,
  meaningfulChars,
  findPlaceholders,
  countPendingContextRequests,
  isContextGovernedChange,
  governanceVersion,
  requiredFilesFor,
  lintTasksFile,
  enforceClassificationSubstance,
  getArchiveTaskIds,
} from './gate-artifacts.js';
import { sectionBody } from '../utils/markdown-section.js';
import { resolveTier, enforceTierConsistency, enforceTierFloor } from './gate-tier.js';
import { validateDependencies } from './gate-dependencies.js';
import { enforceContractSubstance } from './gate-contracts.js';
import { enforceTestEvidence, enforceBugFixEvidence } from './gate-evidence.js';
import { enforceRequiredAgentEvidence } from './gate-agents.js';
import { enforceAcceptanceOracle } from './gate-acceptance.js';
import { enforceInteractionDesign } from './gate-design.js';
import { enforceReconciliationInvariants } from '../reconcile/invariants.js';
import { isSafeChangeId } from '../utils/change-id.js';
import yaml from 'js-yaml';
import { runBoundaryGuard, classifyBoundaryFinding } from '../boundary/guard.js';
import { acceptanceOracleRequired, resolveGateProfile } from '../policy/profile.js';
import type { WorkflowProfile } from '../runtime/types.js';
import { verifyRuntime } from '../runtime/engine.js';

export interface GateOptions {
  strict?: boolean;
  profile?: WorkflowProfile;
  requireAcceptance?: boolean;
  runId?: string;
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
  const explain = opts.explain ?? false;
  const cwd = process.cwd();

  // Validate the change id before it is ever joined into a filesystem path, so a
  // value like `../../src` cannot escape specs/changes/<id> (parity with
  // new-change.ts and test-run.ts; ADR 0005 §4).
  if (!isSafeChangeId(changeId)) {
    log.error(`Invalid change id "${changeId}". Use letters, numbers, hyphens, or underscores (max 64 chars).`);
    if (explain) {
      log.dim('      Why: the change id becomes a folder path; unusual characters could point outside specs/changes/.');
      log.info('      Say this to Claude: "What is the exact id of the change I should run the gate on?"');
    }
    process.exit(1);
  }

  const changeDir = join(cwd, 'specs', 'changes', changeId);

  let profileResolution;
  try {
    profileResolution = resolveGateProfile(cwd, changeId, opts.profile, opts.strict ?? false, opts.runId);
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const strict = profileResolution.profile === 'strict' || (opts.strict ?? false);

  if (profileResolution.profile && !strict) {
    if (!profileResolution.capsule) {
      log.error(`Profile ${profileResolution.profile} requires a matching runtime capsule. Run \`cdd-kit work ${changeId} "<objective>" --profile ${profileResolution.profile}\` first.`);
      process.exit(1);
    }
    if (opts.requireAcceptance && !profileResolution.capsule.required_evidence.includes('acceptance-oracle')) {
      log.error(`The existing runtime capsule does not require acceptance. Re-plan with \`cdd-kit work ${changeId} "<objective>" --require-acceptance\`.`);
      process.exit(1);
    }
    const result = verifyRuntime(cwd, profileResolution.run_id ?? opts.runId);
    if (result.state.change_id !== changeId) {
      log.error(`Current runtime run belongs to ${result.state.change_id}, not ${changeId}.`);
      process.exit(1);
    }
    if (result.evidence.final_status !== 'passed') {
      const failures = result.evidence.checks
        .filter(check => check.status === 'failed' || check.status === 'unknown')
        .map(check => `runtime check ${check.id}: ${check.status}`);
      if (result.evidence.approvals.some(approval => approval.status === 'pending')) failures.push('runtime approvals are still pending');
      reportGateFailure(changeId, failures.length ? failures : ['runtime verification is blocked'], explain);
    }
    log.ok(`gate passed for change: ${changeId} (${profileResolution.profile} runtime; ${result.path})`);
    return;
  }

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

  const requiredFiles = requiredFilesFor(changeDir);

  for (const f of requiredFiles) {
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

  // v2 folds test-plan.md and ci-gates.md into implementation-plan.md. The
  // requirement moved into the plan; it did not soften -- an absent section is
  // the same failure a missing file was.
  if (errors.length === 0 && governanceVersion(changeDir) === 'v2') {
    const plan = readFileSync(join(changeDir, 'implementation-plan.md'), 'utf8');
    for (const section of V2_PLAN_SECTIONS) {
      const finding = v2PlanSectionFinding(plan, section);
      if (finding) errors.push(finding);
    }
  }

  if (errors.length === 0) {
    for (const f of requiredFiles) {
      if (f === 'context-manifest.md' && !hasManifest) continue;
      if (f === 'tasks.yml') continue;
      const content = readFileSync(join(changeDir, f), 'utf8');
      const minChars = MIN_CHARS[f] ?? 100;
      if (meaningfulChars(content) < minChars) {
        errors.push(`${f}: appears to be a stub (< ${minChars} meaningful chars)`);
        continue;
      }
      // context-manifest.md is exempt from the placeholder check: its template
      // ships illustrative agent sub-sections (`### <implementation-agent>`,
      // `<change-id>` path stubs) that are documentation, not fields to fill,
      // so a placeholder there is not an unfilled-substance signal.
      //
      // The exemption used to be justified with "gate enforces Allowed Paths,
      // not individual packets". That was false: no gate code reads Allowed
      // Paths. `cdd-kit context check` does, and nothing invokes it -- not CI,
      // not validate, not a hook. Under v2 the manifest is optional and this
      // branch only runs for a v1 change that still ships one.
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
  enforceClassificationSubstance(changeDir, tasksData, errors);
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
  const acceptanceRequired = acceptanceOracleRequired(cwd, profileResolution, opts.requireAcceptance ?? false);
  if (acceptanceRequired === null) {
    // No explicit/runtime profile: preserve the pre-agent-native behavior byte
    // for byte during the compatibility window.
    enforceAcceptanceOracle(cwd, changeDir, changeId, isNewChange, strict, errors, warnings);
  } else if (acceptanceRequired) {
    // A required oracle receives every provenance, lock, driver and evidence
    // check even when the surrounding profile is not strict.
    enforceAcceptanceOracle(cwd, changeDir, changeId, true, true, errors, warnings);
  }
  // `isNewChange` is threaded from gate.ts's single computation above (never
  // re-derived) — see gate-design.ts's module header ("TOP RISK") for why.
  await enforceInteractionDesign(cwd, changeDir, changeId, isNewChange, strict, errors, warnings);
  // enforceConfirmationHookInstallation (ci-gate-contract.md). Deliberately NOT
  // threaded `isNewChange` — hook installation is a property of the project, not of
  // one change directory's vintage, so a legacy and a brand-new change see the same
  // shape. `ci-or-strict`: hard error inside CI or under --strict, else a warning.
  // The nested `validate` call below is invoked with `hookCheck: false` so this same
  // check does not run twice within one `gate`.
  enforceConfirmationHookInstallation(cwd, strict, errors, warnings);

  // enforceReconciliationInvariants (contracts/upgrade/upgrade-reconciliation-
  // contract.md `## Mechanical Enforcement`; ci-gate-contract.md
  // `### enforceReconciliationInvariants`). `ci-or-strict`, NOT gated on
  // isNewChange, no shadow-mode knob -- a no-op outside this kit's own repo
  // (see src/reconcile/invariants.ts module header).
  enforceReconciliationInvariants(cwd, strict, errors, warnings);

  // Agent-native Boundary Guard starts in shadow mode. Shadow findings remain
  // visible but cannot break the legacy strict compatibility gate. Projects
  // promote it explicitly by setting shadow_mode: false after parity evidence.
  const runtimePolicyPath = join(cwd, '.cdd', 'policy.yml');
  if (existsSync(runtimePolicyPath)) {
    try {
      const policy = yaml.load(readFileSync(runtimePolicyPath, 'utf8'), { schema: yaml.JSON_SCHEMA }) as { shadow_mode?: boolean };
      const boundary = runBoundaryGuard({ cwd });
      const enforced = policy.shadow_mode === false;
      for (const finding of boundary.findings) {
        if (finding.level === 'info') continue;
        const { blocking, message } = classifyBoundaryFinding(finding, enforced);
        if (blocking) errors.push(message);
        else warnings.push(message);
      }
    } catch (error) {
      const message = `Boundary Guard${' [shadow]'}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
    }
  }

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
    await validate({ contracts: true, env: true, ci: true, spec: false, versions: true, hookCheck: false, reconciliationCheck: false });
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
