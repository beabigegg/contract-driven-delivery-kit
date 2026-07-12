import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { cddPolicySchema } from '../schemas/cdd-policy.schema.js';
import { log } from '../utils/logger.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(cddPolicySchema);

interface LooseningAck { id?: unknown; reason?: unknown; reversible?: unknown; evidence?: unknown }

// The load-bearing "bone" protections from docs/loosening-the-harness.md. Each is
// intact only when its predicate holds; a disabled bone must be explicitly
// acknowledged in `loosening` or it is an error. (strict.legacy_workflow and
// strict.acceptance_oracle are stronger still -- hard, non-acknowledgeable
// guards during the compatibility window, enforced separately below.)
const BONES: Array<{ id: string; label: string; intact: (p: any) => boolean }> = [
  { id: 'boundary_guard.enabled', label: 'Boundary Guard', intact: p => p?.boundary_guard?.enabled === true },
  { id: 'boundary_guard.fail_on_zero_coverage', label: 'no-vacuous-green coverage', intact: p => p?.boundary_guard?.fail_on_zero_coverage === true },
  { id: 'boundary_guard.changed_api_requires_typed_request', label: 'typed request on changed API', intact: p => p?.boundary_guard?.changed_api_requires_typed_request === true },
  { id: 'boundary_guard.changed_api_requires_typed_response', label: 'typed response on changed API', intact: p => p?.boundary_guard?.changed_api_requires_typed_response === true },
  { id: 'approvals.breaking_api', label: 'breaking-API approval', intact: p => p?.approvals?.breaking_api === 'required' },
  { id: 'approvals.destructive_migration', label: 'destructive-migration approval', intact: p => p?.approvals?.destructive_migration === 'required' },
  { id: 'approvals.auth_policy', label: 'auth-policy approval', intact: p => p?.approvals?.auth_policy === 'required' },
  { id: 'approvals.production_operation', label: 'production-operation approval', intact: p => p?.approvals?.production_operation === 'required' },
];

function auditLoosening(policy: any, errors: string[], warnings: string[]): void {
  const acks: LooseningAck[] = Array.isArray(policy?.loosening) ? policy.loosening : [];
  const ackById = new Map<string, LooseningAck>();
  for (const ack of acks) if (typeof ack?.id === 'string') ackById.set(ack.id, ack);
  for (const bone of BONES) {
    if (bone.intact(policy)) continue;
    const ack = ackById.get(bone.id);
    const reason = typeof ack?.reason === 'string' ? ack.reason.trim() : '';
    if (ack && reason.length >= 10) {
      const evidence = typeof ack.evidence === 'string' && ack.evidence.trim() ? ` [evidence: ${ack.evidence.trim()}]` : '';
      warnings.push(`loosened bone ${bone.id} (${bone.label}): ${reason}${evidence}`);
    } else {
      errors.push(
        `${bone.id} (${bone.label}) is disabled without a recorded loosening acknowledgment. ` +
        'Restore it, or add a `loosening:` entry with id + reason (+ reversible/evidence) — see docs/loosening-the-harness.md.',
      );
    }
  }
  // Surface stale/unknown acknowledgments so `loosening` cannot rot silently.
  for (const ack of acks) {
    if (typeof ack?.id !== 'string') continue;
    const bone = BONES.find(b => b.id === ack.id);
    if (!bone) warnings.push(`loosening entry id "${ack.id}" does not match a known protection; remove or fix it.`);
    else if (bone.intact(policy)) warnings.push(`loosening entry for ${ack.id} is stale (that protection is intact); remove it.`);
  }
}

export function policyCheck(options: { path?: string; json?: boolean } = {}): number {
  const path = options.path ?? '.cdd/policy.yml';
  try {
    if (!existsSync(path)) throw new Error(`Policy not found: ${path}`);
    const policy = yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA }) as any;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!validate(policy)) errors.push(...(validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`));
    const today = new Date().toISOString().slice(0, 10);
    for (const exception of Array.isArray(policy?.exceptions) ? policy.exceptions : []) {
      if (typeof exception.expires === 'string' && exception.expires < today) errors.push(`exception ${exception.id} expired on ${exception.expires}`);
    }
    if (policy?.profiles?.strict?.legacy_workflow !== true) errors.push('profiles.strict.legacy_workflow must remain true during the compatibility window');
    if (policy?.profiles?.strict?.acceptance_oracle && policy.profiles.strict.acceptance_oracle !== 'required') {
      errors.push('profiles.strict.acceptance_oracle cannot be weaker than required during the compatibility window');
    }
    // Only audit bones once the policy is structurally valid, so schema errors
    // are not double-reported as missing bones.
    if (errors.length === 0) auditLoosening(policy, errors, warnings);
    const result = { schema_version: '1.0.0', path, status: errors.length ? 'failed' : 'passed', errors, warnings };
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      for (const warning of warnings) log.warn(warning);
      if (errors.length) { for (const error of errors) log.error(error); }
      else log.ok(`CDD policy passed: ${path}`);
    }
    return errors.length ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) process.stdout.write(JSON.stringify({ schema_version: '1.0.0', path, status: 'error', errors: [message] }, null, 2) + '\n');
    else log.error(message);
    return 2;
  }
}
