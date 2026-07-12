import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  DEFAULT_CONTRACT_PATH,
  normalizeApiPath,
  parseContractSchemas,
  parseEndpoints,
  parseSchemaCellRef,
  stripFrontmatter,
  type EndpointRow,
} from '../contracts/parser.js';
import { cddPolicySchema } from '../schemas/cdd-policy.schema.js';
import { boundaryManifestSchema } from '../schemas/boundary-manifest.schema.js';
import type { BoundaryOperation, WorkflowProfile } from '../runtime/types.js';

export interface BoundaryGuardOptions {
  cwd?: string;
  contract?: string;
  policy?: string;
  manifest?: string;
  base?: string;
  head?: string;
  all?: boolean;
  operations?: string[];
}

export interface BoundaryFinding {
  code: string;
  level: 'error' | 'warning' | 'info';
  operation?: string;
  message: string;
  evidence: string[];
}

export interface BoundaryGuardResult {
  schema_version: '1.0.0';
  status: 'passed' | 'failed' | 'not-applicable';
  profile: WorkflowProfile;
  contract: string;
  contract_digest: string;
  changed_files: string[];
  changed_operations: string[];
  coverage_non_vacuous: boolean;
  findings: BoundaryFinding[];
  summary: { errors: number; warnings: number; checked_operations: number };
}

interface BoundaryException {
  id: string; operation: string; class: string; reason: string; owner: string; expires: string; approval?: string;
}

interface Policy {
  version: 1;
  default_profile: WorkflowProfile;
  shadow_mode?: boolean;
  boundary_guard: {
    enabled: boolean;
    fail_on_zero_coverage: boolean;
    changed_api_requires_typed_request: boolean;
    changed_api_requires_typed_response: boolean;
    require_complete_variant_discovery?: boolean;
    generic_schema_policy?: 'allow' | 'controlled' | 'deny';
  };
  profiles: Record<string, { fail_on_unknown?: boolean }>;
  exceptions?: BoundaryException[];
}

interface BoundaryManifest {
  schema_version: '1.0.0';
  contract_digest: string;
  operations: BoundaryOperation[];
}

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validatePolicy = ajv.compile(cddPolicySchema);
const validateManifest = ajv.compile(boundaryManifestSchema);

function sha256(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function operationKey(row: Pick<EndpointRow, 'method' | 'path'>): string {
  return `${row.method.toUpperCase()} ${normalizeApiPath(row.path)}`;
}

function parseYaml<T>(path: string): T {
  return yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA }) as T;
}

function schemaErrors(errors: typeof validatePolicy.errors): string {
  return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

function loadPolicy(cwd: string, path: string): Policy {
  if (!existsSync(path)) throw new Error(`CDD policy not found: ${relative(cwd, path)}`);
  const value = parseYaml<Policy>(path);
  if (!validatePolicy(value)) throw new Error(`Invalid CDD policy: ${schemaErrors(validatePolicy.errors)}`);
  return value;
}

function loadManifest(cwd: string, path: string): BoundaryManifest | null {
  if (!existsSync(path)) return null;
  const value = parseYaml<BoundaryManifest>(path);
  if (!validateManifest(value)) throw new Error(`Invalid boundary manifest: ${schemaErrors(validateManifest.errors)}`);
  return value;
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : null;
}

function changedFiles(cwd: string, base?: string, head = 'HEAD'): string[] {
  const args = base ? ['diff', '--name-only', `${base}...${head}`] : ['diff', '--name-only', 'HEAD'];
  const output = git(cwd, args);
  const files = new Set((output ?? '').split(/\r?\n/).filter(Boolean));
  const status = git(cwd, ['status', '--porcelain']);
  for (const line of (status ?? '').split(/\r?\n/)) {
    if (line.length >= 4) files.add(line.slice(3).replace(/^"|"$/g, ''));
  }
  return [...files].filter(file => !file.startsWith('.cdd/runtime/')).sort();
}

function contractAtRevision(cwd: string, revision: string, contract: string): string | null {
  return git(cwd, ['show', `${revision}:${contract}`]);
}

function changedContractOperations(current: EndpointRow[], previousText: string | null): Set<string> {
  if (previousText === null) return new Set(current.map(operationKey));
  const previous = parseEndpoints(stripFrontmatter(previousText).body);
  const before = new Map(previous.map(row => [operationKey(row), JSON.stringify(row)]));
  const after = new Map(current.map(row => [operationKey(row), JSON.stringify(row)]));
  const changed = new Set<string>();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) changed.add(key);
  }
  return changed;
}

function activeException(policy: Policy, operation: string): BoundaryException | null {
  const today = new Date().toISOString().slice(0, 10);
  return policy.exceptions?.find(exception => exception.operation === operation && exception.expires >= today) ?? null;
}

function isApiLookingPath(path: string): boolean {
  return /(^|\/)(api|routes?|controllers?|clients?|serializers?)(\/|\.|-)/i.test(path)
    || /(^|\/)contracts\/api\//i.test(path)
    || /(^|\/)[^/]*api[^/]*schemas?(\/|\.|-)/i.test(path);
}

export function runBoundaryGuard(options: BoundaryGuardOptions = {}): BoundaryGuardResult {
  const cwd = options.cwd ?? process.cwd();
  const contractRel = options.contract ?? DEFAULT_CONTRACT_PATH;
  const contractPath = join(cwd, contractRel);
  const policyPath = join(cwd, options.policy ?? '.cdd/policy.yml');
  const manifestPath = join(cwd, options.manifest ?? '.cdd/boundary-manifest.yml');
  const policy = loadPolicy(cwd, policyPath);
  const profile = policy.default_profile;
  const findings: BoundaryFinding[] = [];

  if (!policy.boundary_guard.enabled) {
    return {
      schema_version: '1.0.0', status: 'not-applicable', profile, contract: contractRel,
      contract_digest: sha256(''), changed_files: [], changed_operations: [], coverage_non_vacuous: true,
      findings: [{ code: 'boundary-disabled', level: 'info', message: 'Boundary Guard is disabled by project policy.', evidence: [relative(cwd, policyPath)] }],
      summary: { errors: 0, warnings: 0, checked_operations: 0 },
    };
  }
  if (!existsSync(contractPath)) throw new Error(`API contract not found: ${contractRel}`);

  const contractText = readFileSync(contractPath, 'utf8');
  const contractDigest = sha256(contractText);
  const body = stripFrontmatter(contractText).body;
  const endpoints = parseEndpoints(body);
  const schemas = parseContractSchemas(body);
  const definedSchemas = new Set(Object.keys(schemas.schemas));
  const rows = new Map(endpoints.map(row => [operationKey(row), row]));
  const manifest = loadManifest(cwd, manifestPath);
  const manifestOps = new Map((manifest?.operations ?? []).map(operation => [`${operation.method.toUpperCase()} ${normalizeApiPath(operation.path)}`, operation]));
  const files = changedFiles(cwd, options.base, options.head);

  const selected = new Set<string>();
  if (options.all) for (const key of rows.keys()) selected.add(key);
  for (const operation of options.operations ?? []) selected.add(operation.trim().replace(/^([a-z]+)/, method => method.toUpperCase()));
  if (!options.all && !options.operations?.length) {
    if (files.includes(contractRel)) {
      const previous = options.base ? contractAtRevision(cwd, options.base, contractRel) : null;
      for (const key of changedContractOperations(endpoints, previous)) selected.add(key);
    }
    for (const [key, operation] of manifestOps) {
      if ([...operation.source_files, ...operation.consumers].some(file => files.includes(file))) selected.add(key);
    }
  }

  const apiLookingUnmapped = files.filter(file => isApiLookingPath(file) && ![...manifestOps.values()].some(operation => [...operation.source_files, ...operation.consumers].includes(file)));
  if (apiLookingUnmapped.length > 0) {
    findings.push({
      code: 'unmapped-api-impact', level: policy.profiles[profile]?.fail_on_unknown ? 'error' : 'warning',
      message: 'API-looking changed files are not mapped to boundary operations; impact completeness is unknown.', evidence: apiLookingUnmapped,
    });
  }

  for (const key of selected) {
    const row = rows.get(key);
    const operation = manifestOps.get(key);
    if (!row) {
      findings.push({ code: 'route-not-contracted', level: 'error', operation: key, message: 'Changed operation is not present in the canonical API contract.', evidence: [contractRel] });
      continue;
    }

    const requestRef = parseSchemaCellRef(row.request);
    const requestApplicable = ['POST', 'PUT', 'PATCH'].includes(row.method.toUpperCase());
    if (policy.boundary_guard.changed_api_requires_typed_request && requestApplicable && (!requestRef || !definedSchemas.has(requestRef.name))) {
      findings.push({ code: 'request-schema-missing', level: 'error', operation: key, message: 'Changed write operation has no resolved typed request schema.', evidence: [contractRel] });
    }
    const responseRef = parseSchemaCellRef(row.response);
    if (policy.boundary_guard.changed_api_requires_typed_response && (!responseRef || !definedSchemas.has(responseRef.name))) {
      const exception = activeException(policy, key);
      findings.push({
        code: 'response-schema-missing', level: exception ? 'warning' : 'error', operation: key,
        message: exception ? `Typed response is covered only by active exception ${exception.id} until ${exception.expires}.` : 'Changed operation has no resolved typed response schema.',
        evidence: [contractRel],
      });
    }
    if (!operation) {
      findings.push({ code: 'operation-manifest-missing', level: 'error', operation: key, message: 'Changed operation has no Boundary Guard manifest entry.', evidence: [relative(cwd, manifestPath)] });
      continue;
    }
    if (manifest?.contract_digest !== contractDigest) {
      findings.push({ code: 'manifest-contract-stale', level: 'error', operation: key, message: 'Boundary manifest contract digest does not match the canonical contract.', evidence: [relative(cwd, manifestPath), contractRel] });
    }
    const requiredVariants = operation.variants.filter(variant => variant.required);
    if (requiredVariants.length === 0) {
      findings.push({ code: 'zero-required-variants', level: 'error', operation: key, message: 'Changed operation declares zero required response variants.', evidence: [relative(cwd, manifestPath)] });
    }
    for (const variant of requiredVariants) {
      if (!variant.capture || !existsSync(join(cwd, variant.capture.path))) {
        findings.push({ code: 'variant-capture-missing', level: 'error', operation: key, message: `Required variant ${variant.id} has no existing real-boundary capture.`, evidence: [variant.capture?.path ?? relative(cwd, manifestPath)] });
        continue;
      }
      const expectedSchema = schemas.schemas[variant.schema];
      if (!expectedSchema) {
        findings.push({ code: 'variant-schema-undefined', level: 'error', operation: key, message: `Variant ${variant.id} references undefined schema ${variant.schema}.`, evidence: [contractRel, relative(cwd, manifestPath)] });
        continue;
      }
      try {
        const sample = JSON.parse(readFileSync(join(cwd, variant.capture.path), 'utf8')) as unknown;
        const sampleAjv = new Ajv({ allErrors: true, strict: false });
        addFormats(sampleAjv);
        const validateSample = sampleAjv.compile({ ...expectedSchema, components: { schemas: schemas.schemas } });
        if (!validateSample(sample)) {
          findings.push({
            code: 'variant-shape-mismatch', level: 'error', operation: key,
            message: `Captured variant ${variant.id} does not conform to schema ${variant.schema}: ${(validateSample.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ')}`,
            evidence: [variant.capture.path, contractRel],
          });
        }
      } catch (error) {
        findings.push({ code: 'variant-capture-invalid', level: 'error', operation: key, message: `Variant ${variant.id} capture/schema could not be validated: ${error instanceof Error ? error.message : String(error)}`, evidence: [variant.capture.path] });
      }
    }
    if (policy.boundary_guard.require_complete_variant_discovery && operation.discovery.completeness !== 'complete') {
      findings.push({
        code: 'variant-discovery-incomplete', level: 'error', operation: key,
        message: `Variant discovery is ${operation.discovery.completeness}; unknown runtime branches must fail upward.`,
        evidence: [relative(cwd, manifestPath), ...operation.discovery.unknown_reasons],
      });
    }
    if (operation.consumers.length === 0) {
      findings.push({ code: 'consumer-coverage-unknown', level: 'warning', operation: key, message: 'No known consumer is recorded; verify this is intentionally backend-only.', evidence: [relative(cwd, manifestPath)] });
    }
  }

  const coverageNonVacuous = selected.size === 0 || [...selected].every(key => {
    const operation = manifestOps.get(key);
    return !!operation && operation.variants.some(variant => variant.required);
  });
  if (selected.size > 0 && !coverageNonVacuous && policy.boundary_guard.fail_on_zero_coverage) {
    findings.push({ code: 'vacuous-coverage', level: 'error', message: 'API-affecting changes produced zero required typed boundary checks.', evidence: [...selected] });
  }
  const errors = findings.filter(finding => finding.level === 'error').length;
  const warnings = findings.filter(finding => finding.level === 'warning').length;
  return {
    schema_version: '1.0.0', status: selected.size === 0 && errors === 0 ? 'not-applicable' : errors > 0 ? 'failed' : 'passed',
    profile, contract: contractRel, contract_digest: contractDigest, changed_files: files,
    changed_operations: [...selected].sort(), coverage_non_vacuous: coverageNonVacuous,
    findings, summary: { errors, warnings, checked_operations: selected.size },
  };
}
