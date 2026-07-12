import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseEndpoints, stripFrontmatter } from '../contracts/parser.js';
import { inferProvider, type ProviderOption } from '../utils/provider.js';
import { USER_ASSET_MANIFEST } from '../utils/user-asset-manifest.js';
import { upgrade } from './upgrade.js';
import { update } from './update.js';
import { boundaryInit } from './boundary.js';
import { log } from '../utils/logger.js';
import { writeGuidanceMigration } from './guidance.js';
import { planRuntime } from '../runtime/engine.js';

interface MigrationReadiness {
  schema_version: '1.0.0';
  provider: string;
  ready: boolean;
  items: Array<{ id: string; status: 'ready' | 'missing' | 'optional'; path: string; action?: string }>;
  guarantees: { active_changes_rewritten: false; archives_rewritten: false; strict_preserved: boolean };
}

export function agentNativeReadiness(cwd = process.cwd(), requested: ProviderOption = 'auto'): MigrationReadiness {
  const provider = inferProvider(cwd, requested);
  const items: MigrationReadiness['items'] = [];
  const add = (id: string, path: string, required: boolean, action?: string) => items.push({ id, path, status: existsSync(join(cwd, path)) ? 'ready' : required ? 'missing' : 'optional', action });
  add('project-policy', '.cdd/policy.yml', true, 'cdd-kit upgrade --yes');
  if (provider === 'claude' || provider === 'both') add('claude-guidance', 'CLAUDE.md', true, 'cdd-kit upgrade --provider claude --yes');
  if (provider === 'codex' || provider === 'both') add('codex-guidance', 'AGENTS.md', true, 'cdd-kit upgrade --provider codex --yes');
  const contractPath = join(cwd, 'contracts', 'api', 'api-contract.md');
  const hasEndpoints = existsSync(contractPath) && parseEndpoints(stripFrontmatter(readFileSync(contractPath, 'utf8')).body).length > 0;
  add('boundary-manifest', '.cdd/boundary-manifest.yml', hasEndpoints, 'cdd-kit boundary init');
  items.push({ id: 'user-asset-manifest', path: USER_ASSET_MANIFEST, status: existsSync(USER_ASSET_MANIFEST) ? 'ready' : 'missing', action: 'cdd-kit update --yes' });
  let strictPreserved = false;
  const policyPath = join(cwd, '.cdd', 'policy.yml');
  if (existsSync(policyPath)) strictPreserved = /strict:[\s\S]*?legacy_workflow:\s*true/.test(readFileSync(policyPath, 'utf8'));
  return {
    schema_version: '1.0.0', provider, ready: items.every(item => item.status !== 'missing') && strictPreserved,
    items, guarantees: { active_changes_rewritten: false, archives_rewritten: false, strict_preserved: strictPreserved },
  };
}

function importActiveChanges(cwd: string): Array<{ change_id: string; run_id?: string; status: 'imported' | 'failed'; error?: string }> {
  const root = join(cwd, 'specs', 'changes');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    try {
      const request = join(root, entry.name, 'change-request.md');
      const objective = existsSync(request)
        ? readFileSync(request, 'utf8').replace(/^---[\s\S]*?---\s*/, '').replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
        : `Continue migrated legacy change ${entry.name}`;
      const state = planRuntime({ cwd, changeId: entry.name, objective: objective || `Continue migrated legacy change ${entry.name}`, profile: 'strict' });
      return { change_id: entry.name, run_id: state.run_id, status: 'imported' as const };
    } catch (error) {
      return { change_id: entry.name, status: 'failed' as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

export async function agentNativeMigrate(options: { yes?: boolean; provider?: ProviderOption; importActive?: boolean; json?: boolean } = {}): Promise<number> {
  const cwd = process.cwd();
  const provider = options.provider ?? 'auto';
  const before = agentNativeReadiness(cwd, provider);
  if (!options.yes) {
    if (options.json) process.stdout.write(JSON.stringify(before, null, 2) + '\n');
    else {
      log.info(`Agent-native migration readiness: ${before.ready ? 'ready' : 'needs migration'} (${before.provider})`);
      for (const item of before.items) log.info(`${item.status.padEnd(8)} ${item.id}: ${item.path}${item.action && item.status === 'missing' ? ` → ${item.action}` : ''}`);
      log.info('Dry run only. Re-run with --yes to add missing assets and safely sync user-level provider files.');
    }
    return before.ready ? 0 : 1;
  }
  await upgrade({ yes: true, provider });
  await update({ yes: true, provider, preserveModified: true });
  const afterUpgrade = agentNativeReadiness(cwd, provider);
  const boundaryMissing = afterUpgrade.items.some(item => item.id === 'boundary-manifest' && item.status === 'missing');
  if (boundaryMissing) boundaryInit({});
  const guidance = writeGuidanceMigration(cwd, false);
  const legacy_imports = options.importActive ? importActiveChanges(cwd) : [];
  const after = agentNativeReadiness(cwd, provider);
  const recordPath = join(cwd, '.cdd', 'migration', 'agent-native.json');
  mkdirSync(join(cwd, '.cdd', 'migration'), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ schema_version: '1.0.0', migrated_at: new Date().toISOString(), provider: after.provider, before, after, guidance, legacy_imports }, null, 2) + '\n', 'utf8');
  if (options.json) process.stdout.write(JSON.stringify(after, null, 2) + '\n');
  else {
    log.ok(`Agent-native migration applied; record: .cdd/migration/agent-native.json`);
    log.info('Active changes and archives were not rewritten. Strict compatibility remains available.');
  }
  return after.ready ? 0 : 1;
}
