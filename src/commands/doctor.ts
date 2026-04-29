import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { inferProvider, validateProviderOption, type ProviderOption } from '../utils/provider.js';

export interface DoctorOptions {
  strict?: boolean;
  provider?: ProviderOption;
  json?: boolean;
}

interface Finding {
  level: 'error' | 'warning' | 'ok';
  message: string;
}

interface DoctorReport {
  provider: string;
  strict: boolean;
  findings: Finding[];
  errors: number;
  warnings: number;
  ok: boolean;
}

function fileExists(cwd: string, relPath: string): boolean {
  return existsSync(join(cwd, relPath));
}

function findFiles(dir: string, predicate: (name: string) => boolean, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) findFiles(fullPath, predicate, found);
    else if (entry.isFile() && predicate(entry.name)) found.push(fullPath);
  }
  return found;
}

function newestMtime(paths: string[]): number {
  let newest = 0;
  for (const path of paths) {
    try {
      newest = Math.max(newest, statSync(path).mtimeMs);
    } catch {
      // Ignore paths that disappear during inspection.
    }
  }
  return newest;
}

function readMissingSummaryCount(cwd: string): number | null {
  const indexPath = join(cwd, 'specs', 'context', 'contracts-index.md');
  if (!existsSync(indexPath)) return null;
  const match = readFileSync(indexPath, 'utf8').match(/^missing-summary-count:\s*(\d+)/m);
  return match ? Number(match[1]) : null;
}

function checkContextFreshness(cwd: string): Finding[] {
  const findings: Finding[] = [];
  const projectMap = join(cwd, 'specs', 'context', 'project-map.md');
  const contractsIndex = join(cwd, 'specs', 'context', 'contracts-index.md');
  const contextPolicy = join(cwd, '.cdd', 'context-policy.json');
  const contractFiles = findFiles(join(cwd, 'contracts'), name => name.endsWith('.md'));

  if (!existsSync(projectMap) || !existsSync(contractsIndex)) {
    findings.push({
      level: 'warning',
      message: 'specs/context indexes are missing; run cdd-kit context-scan before classification',
    });
    return findings;
  }

  const projectInputs = [contextPolicy].filter(existsSync);
  if (projectInputs.length > 0 && statSync(projectMap).mtimeMs < newestMtime(projectInputs)) {
    findings.push({
      level: 'warning',
      message: 'specs/context/project-map.md is older than .cdd/context-policy.json; run cdd-kit context-scan',
    });
  }

  if (contractFiles.length > 0 && statSync(contractsIndex).mtimeMs < newestMtime(contractFiles)) {
    findings.push({
      level: 'warning',
      message: 'specs/context/contracts-index.md is older than contracts/; run cdd-kit context-scan',
    });
  }

  const missingSummaryCount = readMissingSummaryCount(cwd);
  if (missingSummaryCount !== null && missingSummaryCount > 0) {
    findings.push({
      level: 'warning',
      message: `contracts-index reports ${missingSummaryCount} contract(s) without deterministic summary metadata`,
    });
  }

  if (findings.length === 0) {
    findings.push({ level: 'ok', message: 'context indexes are present and fresh' });
  }
  return findings;
}

function buildDoctorReport(cwd: string, opts: DoctorOptions): DoctorReport {
  const requestedProvider = opts.provider ?? 'auto';
  if (!validateProviderOption(requestedProvider)) {
    log.error(`Invalid provider: ${requestedProvider}. Use auto, claude, codex, or both.`);
    process.exit(1);
  }

  const strict = opts.strict ?? false;
  const provider = inferProvider(cwd, requestedProvider);
  const findings: Finding[] = [];

  for (const relPath of ['contracts', 'specs/templates', '.cdd/context-policy.json', '.cdd/model-policy.json']) {
    findings.push(fileExists(cwd, relPath)
      ? { level: 'ok', message: `${relPath} exists` }
      : { level: 'warning', message: `${relPath} is missing; run cdd-kit upgrade --yes` });
  }

  if ((provider === 'claude' || provider === 'both') && !fileExists(cwd, 'CLAUDE.md')) {
    findings.push({ level: 'warning', message: 'CLAUDE.md is missing for Claude provider; run cdd-kit upgrade --provider claude --yes' });
  }
  if ((provider === 'claude' || provider === 'both') && !fileExists(cwd, 'AGENTS.md')) {
    findings.push({ level: 'warning', message: 'AGENTS.md is missing for Claude provider; run cdd-kit upgrade --provider claude --yes' });
  }
  if ((provider === 'codex' || provider === 'both') && !fileExists(cwd, 'CODEX.md')) {
    findings.push({ level: 'warning', message: 'CODEX.md is missing for Codex provider; run cdd-kit upgrade --provider codex --yes' });
  }

  findings.push(...checkContextFreshness(cwd));

  const errors = findings.filter(finding => finding.level === 'error').length;
  const warnings = findings.filter(finding => finding.level === 'warning').length;
  return {
    provider,
    strict,
    findings,
    errors,
    warnings,
    ok: errors === 0 && (!strict || warnings === 0),
  };
}

export async function doctor(opts: DoctorOptions = {}): Promise<void> {
  const report = buildDoctorReport(process.cwd(), opts);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
    return;
  }

  log.blank();
  log.info(`Doctor provider: ${report.provider}`);

  for (const finding of report.findings) {
    if (finding.level === 'ok') log.ok(finding.message);
    else if (finding.level === 'warning') log.warn(finding.message);
    else log.error(finding.message);
  }

  log.blank();
  if (!report.ok) {
    log.error(report.strict && report.errors === 0
      ? `doctor failed in strict mode with ${report.warnings} warning(s)`
      : `doctor failed with ${report.errors} error(s)`);
    process.exit(1);
  }

  if (report.warnings > 0) {
    log.warn(`doctor completed with ${report.warnings} warning(s)`);
  } else {
    log.ok('doctor passed');
  }
  log.blank();
}
