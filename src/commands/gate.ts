import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { log } from '../utils/logger.js';

const REQUIRED_FILES = [
  'change-request.md',
  'change-classification.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.md',
];

const TIER_PATTERN = /\b(tier\s*[0-5]|low|medium|high|critical)\b/i;

// Fix 1d: differentiated minimum content per artifact
const MIN_CHARS: Record<string, number> = {
  'change-classification.md': 200,
  'test-plan.md': 200,
  'ci-gates.md': 150,
  'change-request.md': 100,
  'tasks.md': 100,
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

  // Step 2: required files
  for (const f of REQUIRED_FILES) {
    if (!existsSync(join(changeDir, f))) {
      errors.push(`missing required artifact: ${f}`);
    }
  }

  if (errors.length === 0) {
    // Step 3: stub check (Fix 1d: per-artifact minimum char counts)
    for (const f of REQUIRED_FILES) {
      const content = readFileSync(join(changeDir, f), 'utf8');
      const minChars = MIN_CHARS[f] ?? 100;
      if (meaningfulChars(content) < minChars) {
        errors.push(`${f}: appears to be a stub (< ${minChars} meaningful chars)`);
      }
    }

    // Step 4: tier marker
    const classifPath = join(changeDir, 'change-classification.md');
    if (existsSync(classifPath)) {
      const text = readFileSync(classifPath, 'utf8');
      if (!TIER_PATTERN.test(text)) {
        errors.push('change-classification.md: missing tier/risk marker (Tier 0-5 or low/medium/high/critical)');
      }
    }
  }

  // Step 4b: tasks.md pending check (Fix 1a + 1e)
  const tasksPath = join(changeDir, 'tasks.md');
  if (existsSync(tasksPath)) {
    const tasksContent = readFileSync(tasksPath, 'utf8');
    // Fix 1e: exclude 7.1 and 7.2 (Archive section) from pending count
    // Use a literal space (not \s*) after [ ] to avoid backtracking that defeats the negative lookahead
    const nonArchivePending = (tasksContent.match(/^\s*-\s*\[ \] (?!7\.[12])/gm) || []).length;
    if (nonArchivePending > 0) {
      if (strict) {
        // Fix 1a: in strict mode, pending tasks are an error
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

    // Fix 1c: tier-based required agent-log validation
    const classifPath = join(changeDir, 'change-classification.md');
    if (existsSync(classifPath)) {
      const classificationContent = readFileSync(classifPath, 'utf8');
      const tierMatch = classificationContent.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
      const tier = tierMatch ? parseInt(tierMatch[1]) : null;

      if (tier !== null) {
        const agentLogFiles = readdirSync(agentLogDir).map(f => f.replace('.md', ''));

        if (tier <= 1) {
          // Tier 0-1: must have e2e, monkey, stress agent logs
          for (const required of ['e2e-resilience-engineer', 'monkey-test-engineer', 'stress-soak-engineer']) {
            if (!agentLogFiles.includes(required)) {
              errors.push(`Tier ${tier} change requires agent-log/${required}.md (high-risk change — E2E/monkey/stress testing mandatory)`);
            }
          }
        }
        if (tier <= 3) {
          // Tier 0-3: must have contract-reviewer and qa-reviewer
          for (const required of ['contract-reviewer', 'qa-reviewer']) {
            if (!agentLogFiles.includes(required)) {
              errors.push(`Tier ${tier} change requires agent-log/${required}.md`);
            }
          }
        }
      }
    }
  }
  // Fix 1c: also check tier even when agent-log dir doesn't exist yet
  else {
    const classifPath = join(changeDir, 'change-classification.md');
    if (existsSync(classifPath)) {
      const classificationContent = readFileSync(classifPath, 'utf8');
      const tierMatch = classificationContent.match(/^## Tier\s*\n\s*-\s*(\d)\s*$/m);
      const tier = tierMatch ? parseInt(tierMatch[1]) : null;

      if (tier !== null) {
        if (tier <= 1) {
          for (const required of ['e2e-resilience-engineer', 'monkey-test-engineer', 'stress-soak-engineer']) {
            errors.push(`Tier ${tier} change requires agent-log/${required}.md (high-risk change — E2E/monkey/stress testing mandatory)`);
          }
        }
        if (tier <= 3) {
          for (const required of ['contract-reviewer', 'qa-reviewer']) {
            errors.push(`Tier ${tier} change requires agent-log/${required}.md`);
          }
        }
      }
    }
  }
  // agent-log dir not existing with no tier requirement is OK (no agents have logged yet)

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

  // Step 6: contract validators (delegate to cdd-kit validate)
  // Fix 9: skip --spec (spec traceability already covered by steps 2-4 above)
  log.info(`gate: running contract validators for ${changeId}…`);
  const r = spawnSync(process.execPath, [process.argv[1], 'validate', '--contracts', '--env', '--ci', '--versions'], {
    cwd,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    log.error(`gate failed for change: ${changeId} (validators returned non-zero)`);
    process.exit(1);
  }

  log.ok(`gate passed for change: ${changeId}`);
}
