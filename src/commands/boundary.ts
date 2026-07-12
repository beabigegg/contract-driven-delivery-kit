import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { DEFAULT_CONTRACT_PATH, normalizeApiPath, parseEndpoints, parseSchemaCellRef, stripFrontmatter } from '../contracts/parser.js';
import { runBoundaryGuard, type BoundaryGuardOptions } from '../boundary/guard.js';
import { log } from '../utils/logger.js';

export interface BoundaryCheckOptions extends Omit<BoundaryGuardOptions, 'cwd'> {
  json?: boolean;
}

export interface BoundaryInitOptions {
  contract?: string;
  out?: string;
  force?: boolean;
}

export function boundaryCheck(options: BoundaryCheckOptions = {}): number {
  try {
    const result = runBoundaryGuard(options);
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      log.blank();
      log.info(`Boundary Guard: ${result.status} (${result.profile})`);
      log.info(`Changed operations: ${result.changed_operations.length}`);
      for (const finding of result.findings) {
        const text = `${finding.operation ? `${finding.operation}: ` : ''}${finding.message}`;
        if (finding.level === 'error') log.error(text);
        else if (finding.level === 'warning') log.warn(text);
        else log.info(text);
      }
      if (result.status === 'passed') log.ok('Boundary Guard passed.');
      else if (result.status === 'not-applicable') log.info('No applicable changed boundary operations.');
      else log.error(`Boundary Guard failed with ${result.summary.errors} error(s).`);
      log.blank();
    }
    return result.status === 'failed' ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) process.stdout.write(JSON.stringify({ schema_version: '1.0.0', status: 'error', error: message }, null, 2) + '\n');
    else log.error(message);
    return 2;
  }
}

export function boundaryInit(options: BoundaryInitOptions = {}): number {
  const cwd = process.cwd();
  const contractRel = options.contract ?? DEFAULT_CONTRACT_PATH;
  const outRel = options.out ?? '.cdd/boundary-manifest.yml';
  const contractPath = join(cwd, contractRel);
  const outPath = join(cwd, outRel);
  if (!existsSync(contractPath)) {
    log.error(`API contract not found: ${contractRel}`);
    return 2;
  }
  if (existsSync(outPath) && !options.force) {
    log.error(`${outRel} already exists; use --force to replace the generated scaffold.`);
    return 2;
  }
  const contractText = readFileSync(contractPath, 'utf8');
  const endpoints = parseEndpoints(stripFrontmatter(contractText).body);
  const manifest = {
    schema_version: '1.0.0',
    contract_digest: `sha256:${createHash('sha256').update(contractText).digest('hex')}`,
    generated_at: new Date().toISOString(),
    operations: endpoints.map(row => {
      const response = parseSchemaCellRef(row.response);
      return {
        method: row.method.toUpperCase(),
        path: normalizeApiPath(row.path),
        ...(parseSchemaCellRef(row.request) ? { request_schema: parseSchemaCellRef(row.request)!.name } : {}),
        variants: response ? [{ id: 'default-200', status: 200, content_type: 'application/json', schema: response.name, required: true }] : [],
        consumers: [],
        source_files: [],
        discovery: { adapter: 'unconfigured', completeness: 'unknown', unknown_reasons: ['Configure a stack adapter and enumerate runtime branches.'] },
      };
    }),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml.dump(manifest, { noRefs: true, lineWidth: 120 }), 'utf8');
  log.ok(`Boundary manifest scaffold written: ${outRel} (${endpoints.length} operation(s)).`);
  log.warn('The scaffold fails closed until source files, consumers, variant discovery, and real captures are configured.');
  return 0;
}
