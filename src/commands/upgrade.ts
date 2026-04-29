import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { ASSET } from '../utils/paths.js';
import { log } from '../utils/logger.js';
import { inferProvider, validateProviderOption, type Provider, type ProviderOption } from '../utils/provider.js';
import { migrate } from './migrate.js';

export interface UpgradeOptions {
  yes?: boolean;
  provider?: ProviderOption;
  migrateChanges?: boolean;
  enableContextGovernance?: boolean;
}

interface PlannedCopy {
  src: string;
  dest: string;
  rel: string;
}

function planMissingFiles(srcDir: string, destDir: string, label: string, planned: PlannedCopy[]): void {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      planMissingFiles(src, dest, join(label, entry.name), planned);
      continue;
    }
    if (!existsSync(dest)) {
      planned.push({ src, dest, rel: join(label, relative(srcDir, src)) });
    }
  }
}

function planProviderGuidance(cwd: string, provider: Provider, planned: PlannedCopy[]): void {
  if (provider === 'claude' || provider === 'both') {
    if (!existsSync(join(cwd, 'CLAUDE.md'))) {
      planned.push({ src: ASSET.claudeTemplate, dest: join(cwd, 'CLAUDE.md'), rel: 'CLAUDE.md' });
    }
    if (!existsSync(join(cwd, 'AGENTS.md'))) {
      planned.push({ src: ASSET.agentsTemplate, dest: join(cwd, 'AGENTS.md'), rel: 'AGENTS.md' });
    }
  }
  if ((provider === 'codex' || provider === 'both') && !existsSync(join(cwd, 'CODEX.md'))) {
    planned.push({ src: ASSET.codexTemplate, dest: join(cwd, 'CODEX.md'), rel: 'CODEX.md' });
  }
}

function applyCopy(plan: PlannedCopy[]): void {
  for (const item of plan) {
    mkdirSync(dirname(item.dest), { recursive: true });
    copyFileSync(item.src, item.dest);
  }
}

export async function upgrade(opts: UpgradeOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const requestedProvider = opts.provider ?? 'auto';
  if (!validateProviderOption(requestedProvider)) {
    log.error(`Invalid provider: ${requestedProvider}. Use auto, claude, codex, or both.`);
    process.exit(1);
  }

  const provider = inferProvider(cwd, requestedProvider);
  const plan: PlannedCopy[] = [];

  planMissingFiles(ASSET.contracts, join(cwd, 'contracts'), 'contracts', plan);
  planMissingFiles(ASSET.specsTemplates, join(cwd, 'specs', 'templates'), 'specs/templates', plan);
  planMissingFiles(ASSET.testsTemplates, join(cwd, 'tests', 'templates'), 'tests/templates', plan);
  planMissingFiles(ASSET.ci, join(cwd, 'ci'), 'ci', plan);
  planMissingFiles(ASSET.githubWorkflows, join(cwd, '.github', 'workflows'), '.github/workflows', plan);
  planMissingFiles(ASSET.cddConfig, join(cwd, '.cdd'), '.cdd', plan);
  planProviderGuidance(cwd, provider, plan);

  log.blank();
  log.info(`Upgrade provider: ${provider}`);
  if (plan.length === 0) {
    log.ok('No missing cdd-kit project files found.');
    if (opts.migrateChanges) {
      log.blank();
      log.info('Running change migration flow...');
      await migrate(undefined, {
        all: true,
        dryRun: !opts.yes,
        enableContextGovernance: opts.enableContextGovernance,
      });
    }
    log.blank();
    return;
  }

  log.info(`${plan.length} missing file(s) detected:`);
  for (const item of plan) log.dim(`  + ${item.rel.replace(/\\/g, '/')}`);

  if (!opts.yes) {
    log.blank();
    log.info('Dry run only. Re-run with --yes to write missing files.');
    if (opts.migrateChanges) {
      log.blank();
      log.info('Previewing existing change migration because --migrate-changes was requested.');
      await migrate(undefined, {
        all: true,
        dryRun: true,
        enableContextGovernance: opts.enableContextGovernance,
      });
    }
    log.blank();
    return;
  }

  applyCopy(plan);

  const modelPolicyPath = join(cwd, '.cdd', 'model-policy.json');
  if (existsSync(modelPolicyPath)) {
    writeFileSync(modelPolicyPath, JSON.stringify({
      provider,
      generated_at: new Date().toISOString(),
      roles: {},
    }, null, 2) + '\n', 'utf8');
  }

  log.blank();
  log.ok(`Upgrade complete: ${plan.length} missing file(s) added.`);
  log.info('Existing project guidance and contracts were preserved.');
  if (opts.migrateChanges) {
    log.blank();
    log.info('Running change migration flow...');
    await migrate(undefined, {
      all: true,
      dryRun: false,
      enableContextGovernance: opts.enableContextGovernance,
    });
  }
  log.blank();
}
