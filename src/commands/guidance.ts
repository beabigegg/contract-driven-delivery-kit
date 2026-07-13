import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ASSET, ASSETS_DIR } from '../utils/paths.js';
import { log } from '../utils/logger.js';

interface GuidanceMetric {
  path: string;
  bytes: number;
  estimated_tokens: number;
  legacy_references: number;
}

export interface GuidanceAudit {
  schema_version: '1.0.0';
  current: GuidanceMetric[];
  legacy_agent_prompts: { files: number; bytes: number; estimated_tokens: number };
  agent_native_templates: { bytes: number; estimated_tokens: number };
  total_current_estimated_tokens: number;
  estimated_recurring_reduction_percent: number;
}

function metric(path: string, content: string): GuidanceMetric {
  return {
    path, bytes: Buffer.byteLength(content), estimated_tokens: Math.ceil(content.length / 4),
    legacy_references: (content.match(/specs\/changes|tasks\.yml|implementation-plan\.md|test-plan\.md|context-manifest\.md|cdd-kit new/gi) ?? []).length,
  };
}

function markdownFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => join(path, entry.name));
}

export function auditGuidance(cwd = process.cwd()): GuidanceAudit {
  const current = ['CLAUDE.md', 'AGENTS.md', 'CODEX.md'].filter(path => existsSync(join(cwd, path)))
    .map(path => metric(path, readFileSync(join(cwd, path), 'utf8')));
  const legacyPaths = markdownFiles(join(cwd, '.claude', 'agents')).length
    ? markdownFiles(join(cwd, '.claude', 'agents'))
    : markdownFiles(join(ASSETS_DIR, 'agents'));
  const legacyBytes = legacyPaths.reduce((total, path) => total + Buffer.byteLength(readFileSync(path)), 0);
  const templatePaths = [ASSET.claudeTemplate, ASSET.agentsTemplate, ASSET.codexTemplate].filter(existsSync);
  const nativeBytes = templatePaths.reduce((total, path) => total + Buffer.byteLength(readFileSync(path)), 0);
  const currentTokens = current.reduce((total, item) => total + item.estimated_tokens, 0) + Math.ceil(legacyBytes / 4);
  const nativeTokens = Math.ceil(nativeBytes / 4);
  return {
    schema_version: '1.0.0', current,
    legacy_agent_prompts: { files: legacyPaths.length, bytes: legacyBytes, estimated_tokens: Math.ceil(legacyBytes / 4) },
    agent_native_templates: { bytes: nativeBytes, estimated_tokens: nativeTokens },
    total_current_estimated_tokens: currentTokens,
    estimated_recurring_reduction_percent: currentTokens > 0 ? Math.max(0, Math.round((1 - nativeTokens / currentTokens) * 1000) / 10) : 0,
  };
}

const MANAGED_START = '<!-- cdd-kit:managed:start -->';
const MANAGED_END = '<!-- cdd-kit:managed:end -->';

function managedBlock(content: string): string | null {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END, start + MANAGED_START.length);
  return start >= 0 && end >= 0 ? content.slice(start, end + MANAGED_END.length) : null;
}

function mergeManaged(existing: string, template: string): string | null {
  const replacement = managedBlock(template);
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END, start + MANAGED_START.length);
  if (!replacement || start < 0 || end < 0) return null;
  return existing.slice(0, start) + replacement + existing.slice(end + MANAGED_END.length);
}

export function writeGuidanceMigration(cwd = process.cwd(), replace = false): { audit: GuidanceAudit; proposals: string[]; backups: string[]; skipped: Array<{ path: string; reason: string }> } {
  const root = join(cwd, '.cdd', 'migration');
  const proposalDir = join(root, 'guidance-proposals');
  const backupDir = join(root, 'guidance-backups');
  mkdirSync(proposalDir, { recursive: true });
  const mappings: Array<[string, string]> = [
    ['CLAUDE.md', ASSET.claudeTemplate], ['AGENTS.md', ASSET.agentsTemplate], ['CODEX.md', ASSET.codexTemplate],
  ];
  const proposals: string[] = [];
  const backups: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const [name, template] of mappings) {
    if (!existsSync(template)) continue;
    const proposal = join(proposalDir, name);
    cpSync(template, proposal);
    proposals.push(`.cdd/migration/guidance-proposals/${name}`);
    if (replace) {
      const target = join(cwd, name);
      if (existsSync(target)) {
        const existing = readFileSync(target, 'utf8');
        const merged = mergeManaged(existing, readFileSync(template, 'utf8'));
        if (merged === null) {
          skipped.push({ path: name, reason: 'Existing guidance has no complete cdd-kit managed markers; review the proposal and merge project knowledge manually.' });
          continue;
        }
        mkdirSync(backupDir, { recursive: true });
        const backup = join(backupDir, name);
        cpSync(target, backup);
        backups.push(`.cdd/migration/guidance-backups/${name}`);
        writeFileSync(target, merged, 'utf8');
      } else {
        cpSync(template, target);
      }
    }
  }
  const audit = auditGuidance(cwd);
  writeFileSync(join(root, 'guidance-audit.json'), JSON.stringify(audit, null, 2) + '\n', 'utf8');
  writeFileSync(join(root, 'guidance-migration.json'), JSON.stringify({
    schema_version: '1.0.0', created_at: new Date().toISOString(), replace, proposals, backups, skipped,
    rollback: backups.length ? 'Restore files from .cdd/migration/guidance-backups/.' : 'No project guidance was replaced.',
  }, null, 2) + '\n', 'utf8');
  return { audit, proposals, backups, skipped };
}

export function guidanceAuditCommand(options: { json?: boolean }): number {
  const result = auditGuidance();
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    log.info(`Current recurring guidance estimate: ${result.total_current_estimated_tokens} tokens`);
    log.info(`Agent-native template estimate: ${result.agent_native_templates.estimated_tokens} tokens`);
    log.ok(`Estimated recurring reduction: ${result.estimated_recurring_reduction_percent}%`);
  }
  return 0;
}

export function guidanceMigrateCommand(options: { apply?: boolean; replace?: boolean; json?: boolean }): number {
  if (options.replace && !options.apply) { log.error('--replace requires --apply.'); return 2; }
  if (!options.apply) return guidanceAuditCommand(options);
  const result = writeGuidanceMigration(process.cwd(), options.replace === true);
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    log.ok(`Guidance proposals written: ${result.proposals.join(', ')}`);
    if (result.backups.length) log.warn(`Managed guidance blocks updated with rollback copies: ${result.backups.join(', ')}`);
    for (const item of result.skipped) log.warn(`${item.path} preserved: ${item.reason}`);
    if (!result.backups.length && !result.skipped.length) log.info('Existing guidance was preserved; review proposals before using --replace.');
  }
  return 0;
}
