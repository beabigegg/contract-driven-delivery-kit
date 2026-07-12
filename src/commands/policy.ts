import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { cddPolicySchema } from '../schemas/cdd-policy.schema.js';
import { log } from '../utils/logger.js';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(cddPolicySchema);

export function policyCheck(options: { path?: string; json?: boolean } = {}): number {
  const path = options.path ?? '.cdd/policy.yml';
  try {
    if (!existsSync(path)) throw new Error(`Policy not found: ${path}`);
    const policy = yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA }) as any;
    const errors: string[] = [];
    if (!validate(policy)) errors.push(...(validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`));
    const today = new Date().toISOString().slice(0, 10);
    for (const exception of Array.isArray(policy?.exceptions) ? policy.exceptions : []) {
      if (typeof exception.expires === 'string' && exception.expires < today) errors.push(`exception ${exception.id} expired on ${exception.expires}`);
    }
    if (policy?.profiles?.strict?.legacy_workflow !== true) errors.push('profiles.strict.legacy_workflow must remain true during the compatibility window');
    if (policy?.profiles?.strict?.acceptance_oracle && policy.profiles.strict.acceptance_oracle !== 'required') {
      errors.push('profiles.strict.acceptance_oracle cannot be weaker than required during the compatibility window');
    }
    const result = { schema_version: '1.0.0', path, status: errors.length ? 'failed' : 'passed', errors };
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else if (errors.length) { for (const error of errors) log.error(error); }
    else log.ok(`CDD policy passed: ${path}`);
    return errors.length ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) process.stdout.write(JSON.stringify({ schema_version: '1.0.0', path, status: 'error', errors: [message] }, null, 2) + '\n');
    else log.error(message);
    return 2;
  }
}
