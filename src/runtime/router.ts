import type { WorkflowProfile } from './types.js';

export interface RiskSignal {
  id: string;
  source: 'diff' | 'boundary' | 'policy' | 'objective';
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  floor: WorkflowProfile;
  approvals?: string[];
}

const ORDER: WorkflowProfile[] = ['lightweight', 'balanced', 'controlled', 'strict'];

function maxProfile(profiles: WorkflowProfile[]): WorkflowProfile {
  return profiles.reduce((highest, profile) => ORDER.indexOf(profile) > ORDER.indexOf(highest) ? profile : highest, 'lightweight');
}

export function detectRiskSignals(files: string[], changedOperations: string[], objective: string): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const documentationIntent = /\b(documentation|docs?|readme|changelog|typo|wording)\b/i.test(objective);
  if ((files.length > 0 && files.every(file => /(^|\/)(docs?|README|CHANGELOG|specs\/changes)\b/i.test(file) || /\.md$/i.test(file)))
    || (files.length === 0 && documentationIntent)) {
    signals.push({ id: 'documentation-only', source: 'diff', confidence: 'high', evidence: files, floor: 'lightweight' });
  }
  const apiIntent = /\b(api|endpoint|route|request|response|payload|serializ|data[- ]?shape|frontend call|generated (type|client))\b/i.test(objective);
  if (changedOperations.length > 0 || apiIntent || files.some(file => /(^|\/)(contracts\/api|api|routes?|controllers?|clients?|serializers?)(\/|\.|-)/i.test(file)
    || /(^|\/)[^/]*api[^/]*schemas?(\/|\.|-)/i.test(file))) {
    signals.push({ id: 'api-boundary', source: apiIntent && changedOperations.length === 0 ? 'objective' : 'diff', confidence: 'high', evidence: changedOperations.length ? changedOperations : files.length ? files : [objective], floor: 'controlled' });
  }
  const migrationFiles = files.filter(file => /(^|\/)(migrations?|alembic|prisma)(\/|\.|-)/i.test(file));
  const migrationIntent = /\b(database migration|schema migration|migrate (data|database)|backfill|ddl)\b/i.test(objective);
  if (migrationFiles.length || migrationIntent) signals.push({ id: 'data-migration', source: migrationFiles.length ? 'diff' : 'objective', confidence: 'high', evidence: migrationFiles.length ? migrationFiles : [objective], floor: 'controlled', approvals: ['destructive_migration'] });
  const authFiles = files.filter(file => /(^|\/)(auth|permissions?|rbac|acl)(\/|\.|-)/i.test(file));
  const authIntent = /\b(auth|authorization|permission|rbac|acl|login|oauth|role policy)\b/i.test(objective);
  if (authFiles.length || authIntent) signals.push({ id: 'authorization-policy', source: authFiles.length ? 'diff' : 'objective', confidence: 'high', evidence: authFiles.length ? authFiles : [objective], floor: 'controlled', approvals: ['auth_policy'] });
  const productionFiles = files.filter(file => /(^|\/)(deploy|infra|terraform|k8s|production|secrets?)(\/|\.|-)/i.test(file));
  const productionIntent = /\b(production|deploy|infrastructure|terraform|kubernetes|k8s|secret rotation)\b/i.test(objective);
  if (productionFiles.length || productionIntent) signals.push({ id: 'production-operation', source: productionFiles.length ? 'diff' : 'objective', confidence: 'high', evidence: productionFiles.length ? productionFiles : [objective], floor: 'controlled', approvals: ['production_operation'] });
  if (/\b(redis|cache|queue|worker|async|background job|event bus)\b/i.test(objective)) {
    signals.push({ id: 'operations-runtime', source: 'objective', confidence: 'high', evidence: [objective], floor: 'controlled' });
  }
  if (/\b(breaking|remove field|rename field|incompatible)\b/i.test(objective)) {
    signals.push({ id: 'breaking-api', source: 'objective', confidence: 'high', evidence: [objective], floor: 'controlled', approvals: ['breaking_api'] });
  }
  const destructive = /\b(drop|truncate|delete all|force push|destroy|irreversible)\b/i.test(objective);
  if (destructive) signals.push({ id: 'destructive-intent', source: 'objective', confidence: 'high', evidence: [objective], floor: 'strict', approvals: ['production_operation'] });
  if (signals.length === 0) signals.push({ id: 'ordinary-change', source: 'diff', confidence: 'medium', evidence: files, floor: 'balanced' });
  return signals;
}

export function selectProfile(defaultProfile: WorkflowProfile, signals: RiskSignal[], requested?: WorkflowProfile): WorkflowProfile {
  const onlyDocumentation = signals.length > 0 && signals.every(signal => signal.id === 'documentation-only');
  const floor = onlyDocumentation
    ? 'lightweight'
    : maxProfile([defaultProfile, ...signals.filter(signal => signal.confidence !== 'low').map(signal => signal.floor)]);
  if (!requested) return floor;
  return ORDER.indexOf(requested) < ORDER.indexOf(floor) ? floor : requested;
}

export function requiredApprovals(signals: RiskSignal[]): string[] {
  return [...new Set(signals.flatMap(signal => signal.approvals ?? []))].sort();
}

export function selectCapabilitiesAndDoctrine(signals: RiskSignal[], profile: WorkflowProfile): { capabilities: string[]; doctrine: string[]; independentReview: boolean } {
  const ids = new Set(signals.map(signal => signal.id));
  const capabilities = new Set<string>(['testing']);
  const doctrine = new Set<string>(['core-engineering', 'testing']);
  if (ids.has('api-boundary') || ids.has('unknown-boundary-impact') || ids.has('boundary-review-required') || ids.has('breaking-api')) {
    capabilities.add('contract'); capabilities.add('backend');
    doctrine.add('api-boundary'); doctrine.add('backend');
  }
  if (ids.has('data-migration')) { capabilities.add('migration'); doctrine.add('data-migration'); doctrine.add('operations-resilience'); }
  if (ids.has('authorization-policy')) { capabilities.add('security'); doctrine.add('security-authorization'); }
  if (ids.has('production-operation') || ids.has('destructive-intent')) { capabilities.add('release-operations'); doctrine.add('operations-resilience'); }
  if (ids.has('operations-runtime')) { capabilities.add('operations'); doctrine.add('operations-resilience'); }
  return { capabilities: [...capabilities].sort(), doctrine: [...doctrine].sort(), independentReview: profile === 'controlled' || profile === 'strict' };
}
