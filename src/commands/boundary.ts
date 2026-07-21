import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { DEFAULT_CONTRACT_PATH, normalizeApiPath, parseEndpoints, parseSchemaCellRef, stripFrontmatter } from '../contracts/parser.js';
import { runBoundaryGuard, classifyBoundaryFinding, loadPolicy, type BoundaryGuardOptions } from '../boundary/guard.js';
import { log } from '../utils/logger.js';
import { executeRegisteredCapture } from '../boundary/adapters.js';
import type { BoundaryOperation } from '../runtime/types.js';

export interface BoundaryCheckOptions extends Omit<BoundaryGuardOptions, 'cwd'> {
  json?: boolean;
  /** Fail on any error-level finding even under .cdd/policy.yml shadow_mode. */
  enforce?: boolean;
}

export interface BoundaryInitOptions {
  contract?: string;
  out?: string;
  force?: boolean;
}

export interface BoundaryCaptureOptions { operation: string; variant?: string; manifest?: string; timeout?: number; verify?: boolean; json?: boolean }

function sha(content: string | Buffer): string { return `sha256:${createHash('sha256').update(content).digest('hex')}`; }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function boundaryCapture(options: BoundaryCaptureOptions): number {
  const cwd = process.cwd();
  const manifestRel = options.manifest ?? '.cdd/boundary-manifest.yml';
  const manifestPath = join(cwd, manifestRel);
  try {
    if (!existsSync(manifestPath)) throw new Error(`Boundary manifest not found: ${manifestRel}`);
    const manifest = yaml.load(readFileSync(manifestPath, 'utf8'), { schema: yaml.JSON_SCHEMA }) as any;
    const key = options.operation.trim().replace(/^([a-z]+)/, method => method.toUpperCase());
    const operation = (manifest.operations ?? []).find((item: any) => `${String(item.method).toUpperCase()} ${normalizeApiPath(item.path)}` === key) as BoundaryOperation | undefined;
    if (!operation) throw new Error(`Boundary operation not found: ${key}`);
    const variants = options.variant ? operation.variants.filter((variant: any) => variant.id === options.variant) : operation.variants.filter((variant: any) => variant.required);
    if (variants.length === 0) throw new Error(`No matching required capture variants for ${key}.`);
    for (const variant of variants) {
      if (!variant.capture) throw new Error(`Variant ${variant.id} has no registered capture adapter.`);
      const observed = executeRegisteredCapture(cwd, operation, variant, options.timeout);
      if (observed.status !== variant.status || observed.content_type !== variant.content_type) {
        throw new Error(`Adapter observed ${observed.status} ${observed.content_type} for ${variant.id}, expected ${variant.status} ${variant.content_type}.`);
      }
      const capturePath = join(cwd, variant.capture.path);
      const sourceEntries = [...operation.source_files].sort().map((path: string) => {
        const absolute = join(cwd, path);
        if (!existsSync(absolute)) throw new Error(`Backend producer source is missing: ${path}`);
        return `${path}:${sha(readFileSync(absolute))}`;
      });
      const producerDigest = sha(sourceEntries.join('\n'));
      const contractDigest = manifest.contract_digest;
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
      if (head.status !== 0) throw new Error('Registered capture requires a Git HEAD commit.');
      const body = stable(observed.body);
      if (options.verify) {
        if (!existsSync(capturePath) || stable(JSON.parse(readFileSync(capturePath, 'utf8'))) !== body) {
          throw new Error(`Registered adapter replay differs from committed capture ${variant.capture.path}.`);
        }
        const provenance = variant.capture.provenance;
        if (!provenance || provenance.capture_digest !== sha(body) || provenance.producer_digest !== producerDigest
          || provenance.contract_digest !== contractDigest || provenance.target_digest !== observed.target_digest
          || provenance.commit !== head.stdout.trim()) {
          throw new Error(`Registered adapter provenance is missing or stale for ${variant.id}.`);
        }
      } else {
        mkdirSync(dirname(capturePath), { recursive: true });
        writeFileSync(capturePath, body + '\n', 'utf8');
        variant.capture.provenance = {
          adapter_version: '1.0.0', runner_version: observed.runner_version, target_digest: observed.target_digest,
          contract_digest: contractDigest, producer_digest: producerDigest, capture_digest: sha(body),
          commit: head.stdout.trim(), produced_at: new Date().toISOString(),
        };
      }
    }
    if (!options.verify) writeFileSync(manifestPath, yaml.dump(manifest, { noRefs: true, lineWidth: 120 }), 'utf8');
    const result = { schema_version: '1.0.0', operation: key, mode: options.verify ? 'verified' : 'captured', variants: variants.map((variant: any) => variant.id), manifest: manifestRel };
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else log.ok(`Captured ${result.variants.join(', ')} and refreshed digest provenance in ${manifestRel}.`);
    return 0;
  } catch (error) { log.error(error instanceof Error ? error.message : String(error)); return 2; }
}

export function boundaryCheck(options: BoundaryCheckOptions = {}): number {
  try {
    const result = runBoundaryGuard(options);
    // Same enforcement-semantics source `cdd-kit gate` uses (contracts/ci/
    // ci-gate-contract.md `## Boundary Guard Enforcement Semantics`): shadow
    // mode by default, an explicit --enforce overrides it for this invocation
    // only. Re-loading the policy here (already validated by the
    // runBoundaryGuard call above, which throws first on a bad/missing file)
    // reuses the existing loader instead of surfacing shadow_mode on
    // BoundaryGuardResult, which would change the --json output shape.
    const cwd = process.cwd();
    const policy = loadPolicy(cwd, join(cwd, options.policy ?? '.cdd/policy.yml'));
    const enforced = options.enforce === true || policy.shadow_mode === false;
    const blockingCount = result.findings.filter(finding => finding.level === 'error' && enforced).length;

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      log.blank();
      log.info(`Boundary Guard: ${result.status} (${result.profile})`);
      log.info(`Changed operations: ${result.changed_operations.length}`);
      for (const finding of result.findings) {
        if (finding.level === 'info') {
          log.info(`${finding.operation ? `${finding.operation}: ` : ''}${finding.message}`);
          continue;
        }
        const { blocking, message } = classifyBoundaryFinding(finding, enforced);
        if (blocking) log.error(message);
        else log.warn(message);
      }
      if (blockingCount > 0) log.error(`Boundary Guard failed with ${blockingCount} error(s).`);
      else if (result.status === 'not-applicable') log.info('No applicable changed boundary operations.');
      else if (result.status === 'failed') log.warn('Boundary Guard has advisory finding(s) under shadow mode; not blocking.');
      else log.ok('Boundary Guard passed.');
      log.blank();
    }
    return blockingCount > 0 ? 1 : 0;
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
