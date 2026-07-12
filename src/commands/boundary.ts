import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
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

export interface BoundaryCaptureOptions { operation: string; variant?: string; manifest?: string; timeout?: number; json?: boolean }

function sha(content: string | Buffer): string { return `sha256:${createHash('sha256').update(content).digest('hex')}`; }

export function boundaryCapture(options: BoundaryCaptureOptions): number {
  const cwd = process.cwd();
  const manifestRel = options.manifest ?? '.cdd/boundary-manifest.yml';
  const manifestPath = join(cwd, manifestRel);
  try {
    if (!existsSync(manifestPath)) throw new Error(`Boundary manifest not found: ${manifestRel}`);
    const manifest = yaml.load(readFileSync(manifestPath, 'utf8'), { schema: yaml.JSON_SCHEMA }) as any;
    const key = options.operation.trim().replace(/^([a-z]+)/, method => method.toUpperCase());
    const operation = (manifest.operations ?? []).find((item: any) => `${String(item.method).toUpperCase()} ${normalizeApiPath(item.path)}` === key);
    if (!operation) throw new Error(`Boundary operation not found: ${key}`);
    const variants = options.variant ? operation.variants.filter((variant: any) => variant.id === options.variant) : operation.variants.filter((variant: any) => variant.required);
    if (variants.length === 0) throw new Error(`No matching required capture variants for ${key}.`);
    for (const variant of variants) {
      if (!variant.capture?.command) throw new Error(`Variant ${variant.id} has no capture.command adapter.`);
      const run = spawnSync(variant.capture.command, { cwd, shell: true, encoding: 'utf8', timeout: options.timeout ?? 300_000 });
      if (run.error || run.status !== 0) throw new Error(`Capture adapter failed for ${variant.id}: ${run.stderr || run.error || `exit ${run.status}`}`);
      const capturePath = join(cwd, variant.capture.path);
      if (!existsSync(capturePath)) throw new Error(`Capture adapter did not produce ${variant.capture.path}.`);
      variant.capture.digest = sha(readFileSync(capturePath));
      const sourceEntries = [...operation.source_files].sort().map((path: string) => {
        const absolute = join(cwd, path);
        if (!existsSync(absolute)) throw new Error(`Backend producer source is missing: ${path}`);
        return `${path}:${sha(readFileSync(absolute))}`;
      });
      variant.capture.producer_digest = sha(sourceEntries.join('\n'));
      variant.capture.produced_at = new Date().toISOString();
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
      if (head.status === 0) variant.capture.commit = head.stdout.trim();
    }
    writeFileSync(manifestPath, yaml.dump(manifest, { noRefs: true, lineWidth: 120 }), 'utf8');
    const result = { schema_version: '1.0.0', operation: key, variants: variants.map((variant: any) => variant.id), manifest: manifestRel };
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else log.ok(`Captured ${result.variants.join(', ')} and refreshed digest provenance in ${manifestRel}.`);
    return 0;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
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
      const [pathname, query = ''] = row.path.split('?', 2);
      const parameters = [...pathname.matchAll(/(?::([A-Za-z_][\w-]*)|\{\s*([^}]+)\s*\})/g)].map(match => ({
        name: (match[1] ?? match[2]).trim(), in: 'path', schema: 'string', required: true,
      }));
      for (const part of query.split('&').filter(Boolean)) {
        const rawName = part.split('=', 1)[0].trim();
        parameters.push({ name: rawName.replace(/\?$/, ''), in: 'query', schema: 'string', required: !rawName.endsWith('?') });
      }
      return {
        method: row.method.toUpperCase(),
        path: normalizeApiPath(row.path),
        ...(parseSchemaCellRef(row.request) ? { request_schema: parseSchemaCellRef(row.request)!.name } : {}),
        ...(parameters.length ? { parameters } : {}),
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
