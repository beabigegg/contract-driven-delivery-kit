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
  if (files.length > 0 && files.every(file => /(^|\/)(docs?|README|CHANGELOG|specs\/changes)\b/i.test(file) || /\.md$/i.test(file))) {
    signals.push({ id: 'documentation-only', source: 'diff', confidence: 'high', evidence: files, floor: 'lightweight' });
  }
  if (changedOperations.length > 0 || files.some(file => /(^|\/)(contracts\/api|api|routes?|controllers?|clients?|serializers?)(\/|\.|-)/i.test(file)
    || /(^|\/)[^/]*api[^/]*schemas?(\/|\.|-)/i.test(file))) {
    signals.push({ id: 'api-boundary', source: 'diff', confidence: 'high', evidence: changedOperations.length ? changedOperations : files, floor: 'controlled' });
  }
  const migrationFiles = files.filter(file => /(^|\/)(migrations?|alembic|prisma)(\/|\.|-)/i.test(file));
  if (migrationFiles.length) signals.push({ id: 'data-migration', source: 'diff', confidence: 'high', evidence: migrationFiles, floor: 'controlled', approvals: ['destructive_migration'] });
  const authFiles = files.filter(file => /(^|\/)(auth|permissions?|rbac|acl)(\/|\.|-)/i.test(file));
  if (authFiles.length) signals.push({ id: 'authorization-policy', source: 'diff', confidence: 'high', evidence: authFiles, floor: 'controlled', approvals: ['auth_policy'] });
  const productionFiles = files.filter(file => /(^|\/)(deploy|infra|terraform|k8s|production|secrets?)(\/|\.|-)/i.test(file));
  if (productionFiles.length) signals.push({ id: 'production-operation', source: 'diff', confidence: 'high', evidence: productionFiles, floor: 'controlled', approvals: ['production_operation'] });
  const destructive = /\b(drop|truncate|delete all|force push|destroy|irreversible)\b/i.test(objective);
  if (destructive) signals.push({ id: 'destructive-intent', source: 'objective', confidence: 'low', evidence: [objective], floor: 'strict', approvals: ['production_operation'] });
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
  if (ids.has('api-boundary') || ids.has('unknown-boundary-impact')) {
    capabilities.add('contract'); capabilities.add('backend');
    doctrine.add('api-boundary'); doctrine.add('backend');
  }
  if (ids.has('data-migration')) { capabilities.add('migration'); doctrine.add('data-migration'); doctrine.add('operations-resilience'); }
  if (ids.has('authorization-policy')) { capabilities.add('security'); doctrine.add('security-authorization'); }
  if (ids.has('production-operation') || ids.has('destructive-intent')) { capabilities.add('release-operations'); doctrine.add('operations-resilience'); }
  return { capabilities: [...capabilities].sort(), doctrine: [...doctrine].sort(), independentReview: profile === 'controlled' || profile === 'strict' };
}
