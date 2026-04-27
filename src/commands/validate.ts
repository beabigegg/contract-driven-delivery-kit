import { join } from 'path';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { ASSET } from '../utils/paths.js';
import { log } from '../utils/logger.js';

export interface ValidateOptions {
  contracts: boolean;
  env: boolean;
  ci: boolean;
  spec: boolean;
  versions: boolean;
}

interface ValidatorEntry {
  flag: keyof ValidateOptions;
  script: string;
  label: string;
  args?: string[];
}

const VALIDATORS: ValidatorEntry[] = [
  { flag: 'contracts', script: 'validate_contracts.py',         label: 'contracts'         },
  { flag: 'env',       script: 'validate_env_contract.py',      label: 'env contract'      },
  { flag: 'ci',        script: 'validate_ci_gates.py',          label: 'CI gates'          },
  { flag: 'spec',      script: 'validate_spec_traceability.py', label: 'spec traceability' },
  { flag: 'versions',  script: 'validate_contract_versions.py', label: 'contract versions' },
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
    const r = spawnSync(py, [scriptPath, ...(v.args ?? [])], { stdio: 'inherit', cwd: process.cwd() });
    if (r.status !== 0) {
      log.error(`${v.label} validation failed.`);
      failed = true;
    } else {
      log.ok(`${v.label} passed.`);
    }
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
