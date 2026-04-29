import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';
import { validate } from './validate.js';

const REQUIRED_FILES = [
  'change-request.md',
  'change-classification.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.md',
  'context-manifest.md',
];

const TIER_PATTERN = /\b(tier\s*[0-5]|low|medium|high|critical)\b/i;

// Fix 1d: differentiated minimum content per artifact
const MIN_CHARS: Record<string, number> = {
  'change-classification.md': 200,
  'test-plan.md': 200,
  'ci-gates.md': 150,
  'change-request.md': 100,
  'tasks.md': 100,
  'context-manifest.md': 50,
};

function meaningfulChars(text: string): number {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l)
    .filter(l => !l.startsWith('#'))
    .filter(l => !/^[|\s\-:]+$/.test(l))
    .filter(l => !l.startsWith('<!--'))
    .join('').length;
}

export interface GateOptions {
  strict?: boolean;
}

interface ContextPolicy {
  forbiddenPaths: string[];
  audit: {
    requireFilesRead: boolean;
    unknownFilesRead: string;
  };
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function pathMatches(relPath: string, patterns: string[], currentChangeId?: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');

  return patterns.some(rawPattern => {
    const pattern = rawPattern.replace(/\\/g, '/').replace(/^\.\//, '');

    if (pattern === 'specs/changes/*' && currentChangeId) {
      const current = `specs/changes/${currentChangeId}`;
      if (normalized === current || normalized.startsWith(`${current}/`)) return false;
      return normalized.startsWith('specs/changes/');
    }

    if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3);
      return normalized === base || normalized.startsWith(`${base}/`);
    }

    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      if (!normalized.startsWith(`${base}/`)) return false;
      return !normalized.slice(base.length + 1).includes('/');
    }

    return normalized === pattern || normalized.startsWith(`${pattern}/`);
  });
}

function parseListSection(content: string, heading: string): string[] {
  const clean = stripHtmlComments(content);
  const match = clean.match(new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?:\\n## |$)`));
  if (!match) return [];

  return match[1]
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*-\s*/, '').trim())
    .filter(item => item && item !== '-' && item.toLowerCase() !== 'none');
}

function parseContextManifest(content: string): { allowedPaths: string[]; approvedExpansions: string[]; pendingExpansions: number } {
  const clean = stripHtmlComments(content);
  const requestMatch = clean.match(/## Context Expansion Requests\s*\n([\s\S]*?)(?:\n## |$)/);
  const pendingExpansions = requestMatch
    ? (requestMatch[1].match(/^\s*-\s*status:\s*pending\b/gim) || []).length
    : 0;

  return {
    allowedPaths: parseListSection(content, 'Allowed Paths'),
    approvedExpansions: parseListSection(content, 'Approved Expansions'),
    pendingExpansions,
  };
}

function loadContextPolicy(cwd: string): ContextPolicy {
  const defaults: ContextPolicy = {
    forbiddenPaths: [
      '.claude/worktrees/**',
      '.git/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'assets/**',
      'specs/archive/**',
      'specs/changes/*',
    ],
    audit: {
      requireFilesRead: true,
      unknownFilesRead: 'warn-for-legacy-fail-for-new',
    },
  };

  const policyPath = join(cwd, '.cdd', 'context-policy.json');
  if (!existsSync(policyPath)) return defaults;

  try {
    const custom = JSON.parse(readFileSync(policyPath, 'utf8')) as Partial<ContextPolicy>;
    return {
      ...defaults,
      ...custom,
      forbiddenPaths: Array.from(new Set([...(defaults.forbiddenPaths), ...(custom.forbiddenPaths ?? [])])),
      audit: { ...defaults.audit, ...(custom.audit ?? {}) },
    };
  } catch {
    log.warn('could not parse .cdd/context-policy.json; using default context policy');
    return defaults;
  }
}

function isContextGovernedChange(changeDir: string): boolean {
  const tasksPath = join(changeDir, 'tasks.md');
  if (!existsSync(tasksPath)) return false;
  return /^context-governance:\s*v1\b/m.test(readFileSync(tasksPath, 'utf8'));
}

function parseTaskFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    out[key] = line.slice(colon + 1).trim();
  }
  return out;
}

function parseListField(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[]') return [];
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(',')
    .map(item => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function parseDependsOn(content: string): string[] {
  return parseListField(parseTaskFrontmatter(content)['depends-on']);
}

function parseTaskStatus(content: string): string {
  const fm = parseTaskFrontmatter(content);
  return (fm.status ?? 'in-progress').toLowerCase();
}

interface TierResolution {
  tier: number | null;
  source: 'tasks-frontmatter' | 'classification-structured' | 'classification-bold' | 'none';
  classificationPresent: boolean;
  classificationHasLooseMarker: boolean;
}

function resolveTier(changeDir: string): TierResolution {
  const classifPath = join(changeDir, 'change-classification.md');
  const classificationPresent = existsSync(classifPath);
  const classificationText = classificationPresent ? readFileSync(classifPath, 'utf8') : '';
  const classificationHasLooseMarker = classificationPresent && TIER_PATTERN.test(classificationText);

  const tasksPath = join(changeDir, 'tasks.md');
  if (existsSync(tasksPath)) {
    const fm = parseTaskFrontmatter(readFileSync(tasksPath, 'utf8'));
    const raw = fm.tier;
    if (raw && raw !== '') {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 5) {
        return { tier: n, source: 'tasks-frontmatter', classificationPresent, classificationHasLooseMarker };
      }
    }
  }

  if (classificationPresent) {
    const structured = classificationText.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
    if (structured) {
      const n = parseInt(structured[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 5) {
        return { tier: n, source: 'classification-structured', classificationPresent, classificationHasLooseMarker };
      }
    }
    const bold = classificationText.match(/\*\*Tier:\*\*\s*Tier\s*(\d)\b/i);
    if (bold) {
      const n = parseInt(bold[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 5) {
        return { tier: n, source: 'classification-bold', classificationPresent, classificationHasLooseMarker };
      }
    }
  }

  return { tier: null, source: 'none', classificationPresent, classificationHasLooseMarker };
}

const DEFAULT_ARCHIVE_TASKS = ['7.1', '7.2'];

function getArchiveTaskIds(content: string): string[] {
  const fm = parseTaskFrontmatter(content);
  const parsed = parseListField(fm['archive-tasks']);
  return parsed.length > 0 ? parsed : DEFAULT_ARCHIVE_TASKS;
}

function enforceTierRequirements(
  changeDir: string,
  agentLogDir: string | null,
  errors: string[],
  warnings: string[],
): void {
  const resolution = resolveTier(changeDir);

  if (resolution.tier === null) {
    if (resolution.classificationPresent && !resolution.classificationHasLooseMarker) {
      errors.push(
        'change-classification.md: missing tier marker. Set `tier: <0-5>` in tasks.md frontmatter (preferred) or include `## Tier\\n- N` in change-classification.md.'
      );
    }
    return;
  }

  // Legacy bold-only format (`**Tier:** Tier N`) is allowed for back-compat but
  // does NOT trigger tier-specific agent enforcement — that would silently
  // promote legacy changes. Warn and stop here so users migrate.
  if (resolution.source === 'classification-bold') {
    warnings.push(
      'tier marker is bold-text only (legacy format); set `tier: <0-5>` in tasks.md frontmatter so tier-specific agent requirements are enforced.'
    );
    return;
  }

  const tier = resolution.tier;
  const agentLogFiles = agentLogDir && existsSync(agentLogDir)
    ? readdirSync(agentLogDir).map(f => f.replace('.md', ''))
    : [];

  if (tier <= 1) {
    for (const required of ['e2e-resilience-engineer', 'monkey-test-engineer', 'stress-soak-engineer']) {
      if (!agentLogFiles.includes(required)) {
        errors.push(`Tier ${tier} change requires agent-log/${required}.md (high-risk change — E2E/monkey/stress testing mandatory)`);
      }
    }
  }
  if (tier <= 3) {
    for (const required of ['contract-reviewer', 'qa-reviewer']) {
      if (!agentLogFiles.includes(required)) {
        errors.push(`Tier ${tier} change requires agent-log/${required}.md`);
      }
    }
  }

  // Drift signal: if both sources present, warn when they disagree.
  if (resolution.source === 'tasks-frontmatter' && resolution.classificationPresent) {
    const text = readFileSync(join(changeDir, 'change-classification.md'), 'utf8');
    const structured = text.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
    const bold = text.match(/\*\*Tier:\*\*\s*Tier\s*(\d)\b/i);
    const classifTier = structured ? parseInt(structured[1], 10) : (bold ? parseInt(bold[1], 10) : NaN);
    if (!Number.isNaN(classifTier) && classifTier !== tier) {
      warnings.push(
        `tier mismatch: tasks.md frontmatter says ${tier}, change-classification.md says ${classifTier} (frontmatter wins; reconcile classification).`
      );
    }
  }
}

function isArchivedChange(cwd: string, changeId: string): boolean {
  const archiveRoot = join(cwd, 'specs', 'archive');
  if (!existsSync(archiveRoot)) return false;

  const years = readdirSync(archiveRoot, { withFileTypes: true }).filter(d => d.isDirectory());
  return years.some(year => existsSync(join(archiveRoot, year.name, changeId)));
}

function validateDependencies(cwd: string, changeId: string, changeDir: string): string[] {
  const tasksPath = join(changeDir, 'tasks.md');
  if (!existsSync(tasksPath)) return [];

  const dependencies = parseDependsOn(readFileSync(tasksPath, 'utf8'));
  const errors: string[] = [];

  for (const dep of dependencies) {
    if (dep === changeId) {
      errors.push(`tasks.md: change cannot depend on itself (${dep})`);
      continue;
    }

    const upstreamDir = join(cwd, 'specs', 'changes', dep);
    if (existsSync(upstreamDir)) {
      const upstreamTasks = join(upstreamDir, 'tasks.md');
      if (!existsSync(upstreamTasks)) {
        errors.push(`dependency ${dep}: missing tasks.md`);
        continue;
      }
      const status = parseTaskStatus(readFileSync(upstreamTasks, 'utf8'));
      if (!['complete', 'completed', 'done'].includes(status)) {
        errors.push(`dependency ${dep}: upstream change is not completed (status: ${status})`);
      }
      continue;
    }

    if (!isArchivedChange(cwd, dep)) {
      errors.push(`dependency ${dep}: upstream change not found in specs/changes/ or specs/archive/`);
    }
  }

  return errors;
}

interface FilesReadParseResult {
  present: boolean;
  files: string[];
  errors: string[];
}

function parseFilesRead(content: string): FilesReadParseResult {
  const clean = stripHtmlComments(content);
  const allLines = clean.split(/\r?\n/);
  const startIndex = allLines.findIndex(line => /^\s*-\s*files-read:\s*$/.test(line));
  if (startIndex === -1) return { present: false, files: [], errors: [] };

  const files: string[] = [];
  const errors: string[] = [];
  const lines: string[] = [];

  for (let i = startIndex + 1; i < allLines.length; i++) {
    const line = allLines[i];
    if (/^-\s*[a-zA-Z][\w-]*:\s*/.test(line) || /^#/.test(line)) break;
    lines.push(line);
  }

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const itemMatch = rawLine.match(/^\s{2,}-\s+(.+?)\s*$/);
    if (!itemMatch) {
      errors.push(`invalid files-read entry format: ${rawLine.trim()}`);
      continue;
    }

    const item = itemMatch[1].trim();
    if (!item || item === '-' || item.toLowerCase() === 'none' || item.toLowerCase() === 'unknown') {
      continue;
    }

    const normalized = item.replace(/\\/g, '/').replace(/^\.\//, '');
    if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) {
      errors.push(`files-read path must be repo-relative: ${item}`);
      continue;
    }
    if (normalized.split('/').includes('..')) {
      errors.push(`files-read path must not contain "..": ${item}`);
      continue;
    }

    files.push(normalized);
  }

  if (files.length === 0 && errors.length === 0) {
    errors.push('files-read section must list repo-relative paths or omit the section for legacy changes');
  }

  return { present: true, files, errors };
}

export async function gate(changeId: string, opts: GateOptions = {}): Promise<void> {
  const strict = opts.strict ?? false;
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);

  if (!existsSync(changeDir)) {
    log.error(`change not found: ${changeId} (looked in ${changeDir})`);
    process.exit(1);
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const contextPolicy = loadContextPolicy(cwd);
  const isNewChange = isContextGovernedChange(changeDir);
  const manifestPath = join(changeDir, 'context-manifest.md');
  const hasManifest = existsSync(manifestPath);
  let allowedPaths: string[] = [];
  let approvedExpansions: string[] = [];

  errors.push(...validateDependencies(cwd, changeId, changeDir));

  if (hasManifest) {
    const manifest = parseContextManifest(readFileSync(manifestPath, 'utf8'));
    allowedPaths = manifest.allowedPaths;
    approvedExpansions = manifest.approvedExpansions;
    if (manifest.pendingExpansions > 0) {
      errors.push(`context-manifest.md: has ${manifest.pendingExpansions} pending context expansion request(s)`);
    }
  }

  // Step 2: required files
  for (const f of REQUIRED_FILES) {
    if (f === 'context-manifest.md') {
      if (!hasManifest) {
        if (isNewChange || strict) {
          errors.push('missing required artifact: context-manifest.md');
        } else {
          warnings.push('missing context-manifest.md (legacy change; run cdd-kit migrate after upgrading)');
        }
      }
      continue;
    }
    if (!existsSync(join(changeDir, f))) {
      errors.push(`missing required artifact: ${f}`);
    }
  }

  if (errors.length === 0) {
    // Step 3: stub check (Fix 1d: per-artifact minimum char counts)
    for (const f of REQUIRED_FILES) {
      if (f === 'context-manifest.md' && !hasManifest) continue;
      const content = readFileSync(join(changeDir, f), 'utf8');
      const minChars = MIN_CHARS[f] ?? 100;
      if (meaningfulChars(content) < minChars) {
        errors.push(`${f}: appears to be a stub (< ${minChars} meaningful chars)`);
      }
    }

    // Step 4: tier marker (B1: prefer tasks.md frontmatter, fall back to legacy classification text)
    const classifPath = join(changeDir, 'change-classification.md');
    const tierResolution = resolveTier(changeDir);
    if (tierResolution.tier === null && existsSync(classifPath) && !tierResolution.classificationHasLooseMarker) {
      errors.push('change-classification.md: missing tier/risk marker (set tier in tasks.md frontmatter, or include Tier 0-5 / low|medium|high|critical in change-classification.md)');
    }
  }

  // Step 4b: tasks.md pending check (Fix 1a + 1e + B2)
  const tasksPath = join(changeDir, 'tasks.md');
  if (existsSync(tasksPath)) {
    const tasksContent = readFileSync(tasksPath, 'utf8');
    const archiveTaskIds = new Set(getArchiveTaskIds(tasksContent));
    const pendingMatches = tasksContent.match(/^\s*-\s*\[ \]\s+([\d.]+)?[^\n]*/gm) || [];
    const nonArchivePending = pendingMatches.filter(line => {
      const idMatch = line.match(/\[ \]\s+([\d.]+)/);
      const id = idMatch?.[1];
      if (!id) return true;
      return !archiveTaskIds.has(id);
    }).length;
    if (nonArchivePending > 0) {
      if (strict) {
        errors.push(`${nonArchivePending} task(s) still pending (use [-] for N/A items, [x] for done). Run gate without --strict during development.`);
      } else {
        warnings.push(`${nonArchivePending} task(s) still pending (warning only in non-strict mode)`);
      }
    }
  }

  // Step 5: agent-log validation
  const agentLogDir = join(changeDir, 'agent-log');
  if (existsSync(agentLogDir)) {
    const logFiles = readdirSync(agentLogDir).filter(f => f.endsWith('.md'));
    for (const f of logFiles) {
      const content = readFileSync(join(agentLogDir, f), 'utf8');
      const filesRead = parseFilesRead(content);

      if (!filesRead.present) {
        if (contextPolicy.audit.requireFilesRead) {
          const msg = `agent-log/${f}: missing "- files-read:" section`;
          if (isNewChange || strict || contextPolicy.audit.unknownFilesRead !== 'warn-for-legacy-fail-for-new') {
            errors.push(msg);
          } else {
            warnings.push(`${msg} (legacy warning only)`);
          }
        }
      } else {
        for (const parseError of filesRead.errors) {
          errors.push(`agent-log/${f}: ${parseError}`);
        }
        for (const pathRead of filesRead.files) {
          if (pathMatches(pathRead, contextPolicy.forbiddenPaths, changeId)) {
            errors.push(`agent-log/${f}: read forbidden path -> ${pathRead}`);
          }
          if (
            hasManifest &&
            allowedPaths.length > 0 &&
            !pathMatches(pathRead, allowedPaths) &&
            !pathMatches(pathRead, approvedExpansions)
          ) {
            errors.push(`agent-log/${f}: read unauthorized path -> ${pathRead} (not in allowed paths or approved expansions)`);
          }
        }

        // B3: reconcile self-reported files-read against runtime hook log.
        // The hook (.cdd/runtime/<change-id>-files-read.jsonl) records actual
        // tool reads. Any path in the runtime log that the agent did NOT
        // declare is suspicious and reported as a warning (or strict error).
        const runtimeLog = join(cwd, '.cdd', 'runtime', `${changeId}-files-read.jsonl`);
        if (existsSync(runtimeLog)) {
          const runtimePaths = readFileSync(runtimeLog, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => {
              try { return (JSON.parse(line) as { path?: string }).path; } catch { return undefined; }
            })
            .filter((p): p is string => Boolean(p))
            .map(p => p.replace(/\\/g, '/').replace(/^\.\//, ''));

          const declared = new Set(filesRead.files);
          const undeclared = runtimePaths.filter(p => !declared.has(p));
          if (undeclared.length > 0) {
            const sample = undeclared.slice(0, 5).join(', ');
            const more = undeclared.length > 5 ? ` (+${undeclared.length - 5} more)` : '';
            const msg = `agent-log/${f}: runtime log shows ${undeclared.length} read(s) not declared in files-read: ${sample}${more}`;
            if (strict) errors.push(msg);
            else warnings.push(msg);
          }
        }
      }

      // Extract status line
      const statusMatch = content.match(/^\s*-\s*status:\s*(complete|needs-review|blocked)\s*$/m);
      if (!statusMatch) {
        errors.push(`agent-log/${f}: missing or invalid "status:" line (must be complete | needs-review | blocked)`);
        continue;
      }

      const status = statusMatch[1];

      // For blocked status, require next-action
      if (status === 'blocked') {
        const nextActionMatch = content.match(/^\s*-\s*next-action:\s*(.+)$/m);
        if (!nextActionMatch || nextActionMatch[1].trim().toLowerCase() === 'none' || nextActionMatch[1].trim().length < 10) {
          errors.push(`agent-log/${f}: status=blocked requires concrete "next-action:" line (>= 10 chars, not "none")`);
        }
      }

      // Fix 1b: artifact pointer validation in strict mode
      if (strict) {
        const artifactsMatch = content.match(/- artifacts:([\s\S]*?)(?:\n- |\n#|$)/);
        if (artifactsMatch) {
          const artifactLines = artifactsMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
          for (const line of artifactLines) {
            // Extract pointer value (part after the colon)
            const pointer = line.replace(/^\s*-\s*[\w-]+:\s*/, '').trim();
            // If it looks like a path (contains / and not a URL)
            const pathPart = pointer.split(':')[0];
            if (pathPart.includes('/') && !pointer.startsWith('http')) {
              const abs = join(cwd, pathPart);
              if (!existsSync(abs)) {
                errors.push(`agent-log/${f}: artifact pointer not found: ${pathPart}`);
              }
            }
          }
        }
      }
    }

    // Tier-based agent-log validation (Fix 1c + B1)
    enforceTierRequirements(changeDir, agentLogDir, errors, warnings);
  }
  // Also check tier even when agent-log dir doesn't exist yet
  else {
    enforceTierRequirements(changeDir, null, errors, warnings);
  }

  // Emit warnings
  for (const w of warnings) {
    log.warn(`  ${w}`);
  }

  if (errors.length > 0) {
    log.error(`gate failed for change: ${changeId}`);
    for (const e of errors) {
      log.error(`  ${e}`);
    }
    process.exit(1);
  }

  // Step 6: contract validators (B9: in-process call, no subprocess)
  // Skip --spec (already covered by steps 2-4 above).
  log.info(`gate: running contract validators for ${changeId}…`);
  try {
    await validate({ contracts: true, env: true, ci: true, spec: false, versions: true });
  } catch (err) {
    log.error(`gate failed for change: ${changeId} (validators threw): ${(err as Error).message}`);
    process.exit(1);
  }

  // Emit task warnings after all blocking checks pass
  for (const w of warnings) {
    log.warn(`  ${w}`);
  }

  log.ok(`gate passed for change: ${changeId}`);
}
