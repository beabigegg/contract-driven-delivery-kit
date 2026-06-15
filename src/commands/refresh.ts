/**
 * `cdd-kit refresh` — one-shot complete upgrade.
 *
 * Composes existing commands and adds force-refresh for kit-shipped templates
 * that `update --yes` (which only handles `~/.claude/`) and `upgrade --yes`
 * (which only ADDS missing files) leave stale.
 *
 * Boundaries (locked, see CHANGELOG 2.0.8 release notes):
 *
 *   TOUCH — force-refresh w/ backup:
 *     specs/templates/**, tests/templates/**, ci-templates/**,
 *     .github/workflows/contract-driven-gates.yml
 *
 *   TOUCH — resync from authoritative source:
 *     .cdd/model-policy.json roles map ← ~/.claude/agents/<name>.md frontmatter
 *
 *   DELEGATE (existing commands):
 *     ~/.claude/agents/, ~/.claude/skills/  ← cdd-kit update --yes
 *     contracts/, ci/, etc. (add-missing only)  ← cdd-kit upgrade --yes
 *     .cdd/code-map.yml  ← cdd-kit code-map
 *     .git/hooks/pre-commit  ← cdd-kit init --hooks (only if marker exists)
 *
 *   NEVER TOUCH:
 *     contracts/, specs/changes/, specs/archive/, src/, tests/* (except
 *     tests/templates/), .cdd/code-map-config.yml, .cdd/context-policy.json,
 *     CLAUDE.md, AGENTS.md, CODEX.md, package.json, .git/, node_modules/,
 *     dist/, build/
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { createHash } from 'crypto';
import { ASSET, AGENTS_HOME } from '../utils/paths.js';
import { log } from '../utils/logger.js';
import { ensureGitignoreEntry } from '../utils/gitignore.js';
import { update } from './update.js';
import { upgrade } from './upgrade.js';
import { codeMap } from './code-map.js';
import { installCodeMapHook } from './code-map-hook.js';
import type { ProviderOption } from '../utils/provider.js';
import { logRecommendedMcpSetup } from '../utils/mcp-hint.js';

export interface RefreshOptions {
  yes?: boolean;
  noTemplates?: boolean;
  noHooks?: boolean;
  noCodeMap?: boolean;
  noUpdate?: boolean;
  noUpgrade?: boolean;
  provider?: ProviderOption;
}

interface PlannedCopy {
  src: string;
  dest: string;
  rel: string;
  action: 'add' | 'overwrite' | 'skip';
}

const HOOKS_MARKER_PATH = '.cdd/.hooks-installed';

function fileHash(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function planForceRefresh(srcDir: string, destDir: string, sectionLabel: string): PlannedCopy[] {
  const plan: PlannedCopy[] = [];
  if (!existsSync(srcDir)) return plan;

  function walk(curSrc: string, curDest: string): void {
    let items;
    try {
      items = readdirSync(curSrc, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const sp = join(curSrc, item.name);
      const dp = join(curDest, item.name);
      if (item.isDirectory()) {
        walk(sp, dp);
        continue;
      }
      if (!item.isFile()) continue;
      const rel = join(sectionLabel, relative(srcDir, sp)).replace(/\\/g, '/');
      if (!existsSync(dp)) {
        plan.push({ src: sp, dest: dp, rel, action: 'add' });
      } else if (fileHash(sp) !== fileHash(dp)) {
        plan.push({ src: sp, dest: dp, rel, action: 'overwrite' });
      } else {
        plan.push({ src: sp, dest: dp, rel, action: 'skip' });
      }
    }
  }

  walk(srcDir, destDir);
  return plan;
}

function planSingleFile(src: string, dest: string, rel: string): PlannedCopy | null {
  if (!existsSync(src)) return null;
  if (!existsSync(dest)) return { src, dest, rel, action: 'add' };
  if (fileHash(src) !== fileHash(dest)) return { src, dest, rel, action: 'overwrite' };
  return { src, dest, rel, action: 'skip' };
}

function applyPlan(plan: PlannedCopy[], backupRoot: string): { added: number; overwritten: number } {
  let added = 0;
  let overwritten = 0;
  for (const item of plan) {
    if (item.action === 'skip') continue;
    if (item.action === 'overwrite') {
      // Backup existing dest before overwrite.
      const backupPath = join(backupRoot, item.rel);
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(item.dest, backupPath);
      overwritten += 1;
    } else {
      added += 1;
    }
    mkdirSync(dirname(item.dest), { recursive: true });
    copyFileSync(item.src, item.dest);
  }
  return { added, overwritten };
}

interface AgentFrontmatter {
  name?: string;
  model?: string;
}

function parseAgentFrontmatter(content: string): AgentFrontmatter {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm: AgentFrontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([a-zA-Z_-]+):\s*(.+?)\s*$/);
    if (!km) continue;
    if (km[1] === 'name') fm.name = km[2].trim();
    if (km[1] === 'model') fm.model = km[2].trim();
  }
  return fm;
}

/**
 * Resync `.cdd/model-policy.json` roles map from `~/.claude/agents/<name>.md`
 * frontmatter. Returns { changed, before, after } so caller can report.
 */
function resyncModelPolicy(cwd: string): {
  changed: boolean;
  diff: { agent: string; from: string | null; to: string }[];
  policyPath: string;
} {
  const policyPath = join(cwd, '.cdd', 'model-policy.json');
  const result = { changed: false, diff: [] as { agent: string; from: string | null; to: string }[], policyPath };

  if (!existsSync(AGENTS_HOME)) return result;

  // Build authoritative roles map from agent frontmatter.
  const desired: Record<string, string> = {};
  const agentFiles = readdirSync(AGENTS_HOME, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.md'));
  for (const f of agentFiles) {
    const content = readFileSync(join(AGENTS_HOME, f.name), 'utf8');
    const fm = parseAgentFrontmatter(content);
    if (fm.name && fm.model) desired[fm.name] = fm.model;
  }
  if (Object.keys(desired).length === 0) return result;

  // Load existing policy (preserve unrelated keys).
  let existing: Record<string, unknown> = {};
  if (existsSync(policyPath)) {
    try {
      existing = JSON.parse(readFileSync(policyPath, 'utf8'));
    } catch {
      // Treat as empty — we'll rewrite cleanly.
    }
  }
  const existingRoles: Record<string, string> =
    (existing.roles && typeof existing.roles === 'object' ? existing.roles : {}) as Record<string, string>;

  // Compute diff.
  for (const [agent, model] of Object.entries(desired)) {
    if (existingRoles[agent] !== model) {
      result.diff.push({ agent, from: existingRoles[agent] ?? null, to: model });
    }
  }

  if (result.diff.length === 0) return result;

  // Write merged policy: keep existing top-level keys, replace roles map.
  // (We REPLACE rather than merge into roles, because the agent frontmatter is
  // the source of truth — partial merges would re-introduce drift.)
  const merged: Record<string, unknown> = {
    ...existing,
    roles: desired,
  };
  if (!('schema-version' in merged)) merged['schema-version'] = '0.2.0';
  if (!('provider' in merged)) merged['provider'] = 'claude';

  mkdirSync(dirname(policyPath), { recursive: true });
  writeFileSync(policyPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  result.changed = true;
  return result;
}

function planTemplateRefresh(cwd: string): { sections: { name: string; plan: PlannedCopy[] }[]; total: PlannedCopy[] } {
  const sections: { name: string; plan: PlannedCopy[] }[] = [];

  sections.push({
    name: 'specs/templates',
    plan: planForceRefresh(ASSET.specsTemplates, join(cwd, 'specs', 'templates'), 'specs/templates'),
  });
  sections.push({
    name: 'tests/templates',
    plan: planForceRefresh(ASSET.testsTemplates, join(cwd, 'tests', 'templates'), 'tests/templates'),
  });
  // Response-shape harness (ADR 0007): refresh the kit-shipped README + example
  // manifest. The active response-samples.json and captured samples/*.json are
  // not kit assets, so a force-refresh (source-driven) never touches them.
  if (existsSync(ASSET.contractHarness)) {
    sections.push({
      name: 'tests/contract',
      plan: planForceRefresh(ASSET.contractHarness, join(cwd, 'tests', 'contract'), 'tests/contract'),
    });
  }
  // ci-templates ships as a sibling under assets/ and lives at <cwd>/ci-templates
  const ciTemplatesAsset = join(ASSET.ci, '..', 'ci-templates'); // assets/ci-templates
  if (existsSync(ciTemplatesAsset)) {
    sections.push({
      name: 'ci-templates',
      plan: planForceRefresh(ciTemplatesAsset, join(cwd, 'ci-templates'), 'ci-templates'),
    });
  }
  // Single kit-owned workflow file
  const wfAsset = join(ASSET.githubWorkflows, 'contract-driven-gates.yml');
  const wfDest = join(cwd, '.github', 'workflows', 'contract-driven-gates.yml');
  const wfPlan = planSingleFile(wfAsset, wfDest, '.github/workflows/contract-driven-gates.yml');
  if (wfPlan) sections.push({ name: '.github/workflows/contract-driven-gates.yml', plan: [wfPlan] });

  const total = sections.flatMap(s => s.plan);
  return { sections, total };
}

function summarizePlan(items: PlannedCopy[]): { add: number; overwrite: number; skip: number } {
  return {
    add: items.filter(i => i.action === 'add').length,
    overwrite: items.filter(i => i.action === 'overwrite').length,
    skip: items.filter(i => i.action === 'skip').length,
  };
}

export async function refresh(opts: RefreshOptions): Promise<void> {
  const cwd = process.cwd();
  const apply = !!opts.yes;

  log.blank();
  log.info(apply ? 'cdd-kit refresh — applying changes' : 'cdd-kit refresh — dry-run preview (re-run with --yes to apply)');
  log.blank();

  // ── Step 1: ~/.claude/ via cdd-kit update ─────────────────────────────
  if (!opts.noUpdate) {
    log.info('[1/6] ~/.claude/agents and ~/.claude/skills (via cdd-kit update)');
    await update({ yes: apply, provider: opts.provider ?? 'auto' });
  } else {
    log.dim('[1/6] skipped (--no-update)');
  }
  log.blank();

  // ── Step 2: project add-missing via cdd-kit upgrade ───────────────────
  if (!opts.noUpgrade) {
    log.info('[2/6] add missing project files (via cdd-kit upgrade)');
    await upgrade({ yes: apply, provider: opts.provider ?? 'auto' });
  } else {
    log.dim('[2/6] skipped (--no-upgrade)');
  }
  log.blank();

  // ── Step 3: force-refresh kit-shipped templates with backup ──────────
  let templateAdded = 0;
  let templateOverwritten = 0;
  let backupRoot: string | null = null;
  if (!opts.noTemplates) {
    log.info('[3/6] force-refresh kit-shipped templates');
    const { sections, total } = planTemplateRefresh(cwd);
    const summary = summarizePlan(total);
    if (summary.add === 0 && summary.overwrite === 0) {
      log.ok('  templates already up to date');
    } else {
      for (const s of sections) {
        const ss = summarizePlan(s.plan);
        if (ss.add === 0 && ss.overwrite === 0) continue;
        log.info(`  ${s.name}: +${ss.add}  ~${ss.overwrite}  =${ss.skip}`);
        for (const item of s.plan.filter(i => i.action !== 'skip')) {
          log.dim(`    ${item.action === 'add' ? '+' : '~'} ${item.rel}`);
        }
      }
      if (apply) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        backupRoot = join(cwd, '.cdd', '.refresh-backup', ts);
        const result = applyPlan(total, backupRoot);
        templateAdded = result.added;
        templateOverwritten = result.overwritten;
        log.ok(`  applied: +${templateAdded} added, ~${templateOverwritten} overwritten`);
        if (templateOverwritten > 0) {
          log.info(`  backup saved to: ${relative(cwd, backupRoot).replace(/\\/g, '/')}`);
          // Make absolutely sure the user doesn't commit the backup tree.
          if (ensureGitignoreEntry(cwd, '.cdd/.refresh-backup/')) {
            log.info('  added `.cdd/.refresh-backup/` to .gitignore');
          }
        }
      } else {
        log.dim('  (dry-run — no changes written)');
      }
    }
  } else {
    log.dim('[3/6] skipped (--no-templates)');
  }
  log.blank();

  // ── Step 4: re-install pre-commit hook if marker exists ──────────────
  if (!opts.noHooks) {
    const markerPath = join(cwd, HOOKS_MARKER_PATH);
    if (existsSync(markerPath)) {
      log.info('[4/6] re-install code-map pre-commit hook (marker found)');
      if (apply) {
        try {
          await installCodeMapHook(cwd);
        } catch (err) {
          log.warn(`  hook re-install skipped: ${(err as Error).message}`);
        }
      } else {
        log.dim('  (dry-run — would re-install)');
      }
    } else {
      log.dim('[4/6] no .cdd/.hooks-installed marker — skipping (run `cdd-kit init --hooks` to install)');
    }
  } else {
    log.dim('[4/6] skipped (--no-hooks)');
  }
  log.blank();

  // ── Step 5: resync model-policy roles ────────────────────────────────
  log.info('[5/6] resync .cdd/model-policy.json roles from agent frontmatter');
  if (apply) {
    const r = resyncModelPolicy(cwd);
    if (r.diff.length === 0) {
      log.ok('  roles already match agent prompts');
    } else {
      for (const d of r.diff) {
        log.info(`  ${d.agent}: ${d.from ?? '(absent)'} → ${d.to}`);
      }
      log.ok(`  ${r.diff.length} role binding(s) updated`);
    }
  } else {
    // dry-run — compute diff without writing
    const fakeApply = (): void => { /* no-op */ };
    fakeApply();
    log.dim('  (dry-run — drift will be reported only when applied)');
  }
  log.blank();

  // ── Step 6: regenerate code-map ──────────────────────────────────────
  if (!opts.noCodeMap) {
    log.info('[6/6] regenerate .cdd/code-map.yml');
    if (apply) {
      try {
        await codeMap({
          path: '.',
          out: '.cdd/code-map.yml',
          include: [],
          exclude: [],
          check: false,
          maxLines: 600,
        });
      } catch (err) {
        log.warn(`  code-map skipped: ${(err as Error).message}`);
      }
    } else {
      log.dim('  (dry-run — would regenerate)');
    }
  } else {
    log.dim('[6/6] skipped (--no-code-map)');
  }
  log.blank();

  // ── Final summary ────────────────────────────────────────────────────
  if (apply) {
    log.ok('refresh complete.');
    if (backupRoot) {
      log.info(`Backup of overwritten templates: ${relative(cwd, backupRoot).replace(/\\/g, '/')}`);
    }
    log.info('Next: review changes with `git diff`, then commit:');
    log.dim('  git add .cdd/code-map.yml .cdd/model-policy.json specs/templates tests/templates ci-templates .github/workflows');
    log.dim('  git commit -m "chore: cdd-kit refresh"');
    logRecommendedMcpSetup();
  } else {
    log.info('Dry-run finished. Re-run with `--yes` to apply.');
    log.info('After applying, register MCP with `claude mcp add --scope user cdd-kit -- cdd-kit mcp` so agents use graph/code-map tools directly.');
  }
  log.blank();
}
