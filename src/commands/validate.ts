import { join } from 'path';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { ASSET } from '../utils/paths.js';
import { log } from '../utils/logger.js';
import { checkConfirmationHookInstallation, isCiEnvironment } from './gate-shared.js';
import { enforceReconciliationInvariants } from '../reconcile/invariants.js';

export interface ValidateOptions {
  contracts: boolean;
  env: boolean;
  ci: boolean;
  spec: boolean;
  versions: boolean;
  /**
   * Run `enforceConfirmationHookInstallation` here as well (ci-gate-contract.md:
   * "Two host commands"). Defaults to on for the standalone `cdd-kit validate`,
   * which runs unconditionally in CI on every event and so catches a pull request
   * that de-arms the hooks while touching no `specs/changes/<id>/` directory.
   * `gate` passes `false` because it already runs the check itself before calling
   * `validate` — this keeps it from running twice within one `gate`.
   */
  hookCheck?: boolean;
  /**
   * Run `enforceReconciliationInvariants` here as well. Same "two host
   * commands" shape as `hookCheck` above: `gate` passes `false` because it
   * already runs the check directly before calling `validate`, which keeps it
   * from running twice within one `gate`. Defaults to on for the standalone
   * `cdd-kit validate`.
   */
  reconciliationCheck?: boolean;
}

interface ValidatorEntry {
  flag: keyof ValidateOptions;
  script: string;
  label: string;
  args?: string[];
  /** extra scripts to run in sequence after this entry's main script */
  chain?: Array<{ script: string; label: string }>;
}

const VALIDATORS: ValidatorEntry[] = [
  {
    flag: 'contracts',
    script: 'validate_contracts.py',
    label: 'contracts',
    chain: [
      { script: 'validate_api_semantic.py',     label: 'API semantic'      },
      { script: 'validate_api_conformance.py',  label: 'API conformance'   },
      { script: 'validate_response_shape.py',   label: 'response shape'    },
      { script: 'validate_env_semantic.py',     label: 'Env semantic'      },
    ],
  },
  { flag: 'env',      script: 'validate_env_contract.py',      label: 'env contract'      },
  { flag: 'ci',       script: 'validate_ci_gates.py',          label: 'CI gates'          },
  { flag: 'spec',     script: 'validate_spec_traceability.py', label: 'spec traceability' },
  { flag: 'versions', script: 'validate_contract_versions.py', label: 'contract versions' },
];

function resolvePython(): string {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (r.status === 0) return cmd;
  }
  throw new Error('Python not found. Install Python 3.8+ and ensure it is on PATH.');
}

export async function validate(opts: ValidateOptions): Promise<void> {
  let py: string;
  try {
    py = resolvePython();
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const scriptsDir = join(ASSET.skill, 'scripts');
  const runAll = !opts.contracts && !opts.env && !opts.ci && !opts.spec && !opts.versions;

  // Force the Python validators into UTF-8 mode. On Windows non-UTF-8 locales
  // (e.g. cp950/zh-TW) Python otherwise decodes file reads, subprocess stdout
  // (git show of a contract), and its own stdout with the locale codec, which
  // crashes with UnicodeDecodeError or mojibakes em-dashes in contracts.
  const pyEnv = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

  log.blank();
  let failed = false;

  for (const v of VALIDATORS) {
    if (!runAll && !opts[v.flag]) continue;

    const scriptPath = join(scriptsDir, v.script);
    if (!existsSync(scriptPath)) {
      log.warn(`${v.label}: script not found, skipping (${v.script})`);
      log.blank();
      continue;
    }

    log.info(`Validating ${v.label}…`);
    const r = spawnSync(py, [scriptPath, ...(v.args ?? [])], { stdio: 'inherit', cwd: process.cwd(), env: pyEnv });
    if (r.status !== 0) {
      log.error(`${v.label} validation failed.`);
      failed = true;
    } else {
      log.ok(`${v.label} passed.`);
    }
    log.blank();

    // Run chained semantic scripts (only if flag is explicitly set or runAll)
    if (v.chain) {
      for (const chained of v.chain) {
        const chainedPath = join(scriptsDir, chained.script);
        if (!existsSync(chainedPath)) {
          log.warn(`${chained.label}: script not found, skipping (${chained.script})`);
          log.blank();
          continue;
        }
        log.info(`Validating ${chained.label}…`);
        const cr = spawnSync(py, [chainedPath], { stdio: 'inherit', cwd: process.cwd(), env: pyEnv });
        if (cr.status !== 0) {
          log.error(`${chained.label} validation failed.`);
          failed = true;
        } else {
          log.ok(`${chained.label} passed.`);
        }
        log.blank();
      }
    }
  }

  // enforceConfirmationHookInstallation, second host (ci-gate-contract.md).
  // `cdd-kit validate` runs unconditionally in CI on every event, so it catches a
  // pull request that de-arms `.claude/settings.json` while the `gate` step is
  // skipped for touching no `specs/changes/<id>/` directory. `validate` has no
  // `--strict`, so `ci-or-strict` reduces to CI here: hard error (stderr) inside
  // CI, warning (stdout) locally.
  if (opts.hookCheck !== false) {
    const findings = checkConfirmationHookInstallation(process.cwd());
    const hard = isCiEnvironment();
    for (const f of findings) {
      // An `advisory` finding never hardens, not even in CI: the only one is
      // "this provider has no PreToolUse mechanism", and a project cannot install
      // a hook its harness does not have.
      if (hard && f.severity !== 'advisory') {
        log.error(f.message);
        failed = true;
      } else {
        log.warn(f.message);
      }
    }
    if (findings.length > 0) log.blank();
  }

  // enforceReconciliationInvariants, second host (ci-gate-contract.md
  // `### enforceReconciliationInvariants`). `validate` has no `--strict`, so
  // `ci-or-strict` reduces to CI here: hard error (stderr) inside CI, warning
  // (stdout) locally. A no-op outside this kit's own repo.
  if (opts.reconciliationCheck !== false) {
    const errs: string[] = [];
    const warns: string[] = [];
    // `strict` is always `false` here: `validate` has no `--strict` of its
    // own, so `enforceReconciliationInvariants`'s internal `ci-or-strict`
    // check reduces to "inside CI" alone -- everything it routes to `errs` is
    // therefore already CI-hard; `warns` is everything else.
    enforceReconciliationInvariants(process.cwd(), false, errs, warns);
    for (const m of errs) { log.error(m); failed = true; }
    for (const m of warns) log.warn(m);
    if (errs.length > 0 || warns.length > 0) log.blank();
  }

  // Agent-native policy bone-audit (docs/loosening-the-harness.md). Opt-in: only
  // when the project has adopted `.cdd/policy.yml`, so legacy strict-only repos
  // are unaffected. This gives the loosening acknowledgments CI teeth — a policy
  // that silently disables a load-bearing protection fails `validate`, while a
  // recorded `loosening:` entry passes with a warning.
  const policyPath = join(process.cwd(), '.cdd', 'policy.yml');
  if (existsSync(policyPath)) {
    log.info('Validating CDD policy (loosening bone-audit)…');
    const { policyCheck } = await import('./policy.js');
    if (policyCheck({ path: policyPath }) !== 0) failed = true;
    log.blank();
  }

  if (failed) {
    log.error('One or more validations failed.');
    process.exit(1);
  } else {
    log.ok('All validations passed.');
    log.blank();
  }
}
