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

function meaningfulChars(text: string): number {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l)
    .filter(l => !l.startsWith('#'))
    .filter(l => !/^[|\s\-:]+$/.test(l))
    .filter(l => !l.startsWith('<!--'))
    .join('').length;
}

export async function gate(changeId: string): Promise<void> {
  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', changeId);

  if (!existsSync(changeDir)) {
    log.error(`change not found: ${changeId} (looked in ${changeDir})`);
    process.exit(1);
  }

  const errors: string[] = [];

  // Step 2: required files
  for (const f of REQUIRED_FILES) {
    if (!existsSync(join(changeDir, f))) {
      errors.push(`missing required artifact: ${f}`);
    }
  }

  if (errors.length === 0) {
    // Step 3: stub check
    for (const f of REQUIRED_FILES) {
      const content = readFileSync(join(changeDir, f), 'utf8');
      if (meaningfulChars(content) < 100) {
        errors.push(`${f}: appears to be a stub (< 100 meaningful chars)`);
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

  // Step 5: task completion check (warnings only — does not block)
  const warnings: string[] = [];
  const tasksPath = join(changeDir, 'tasks.md');
  if (existsSync(tasksPath)) {
    const tasksContent = readFileSync(tasksPath, 'utf8');
    const pending = (tasksContent.match(/^\s*-\s*\[ \]/gm) || []).length;
    const done    = (tasksContent.match(/^\s*-\s*\[x\]/gim) || []).length;
    const na      = (tasksContent.match(/^\s*-\s*\[-\]/gm) || []).length;
    if (done + na === 0) {
      warnings.push('tasks.md: no tasks have been marked done ([x]) or N/A ([-]) — has work started?');
    } else if (pending > 0) {
      warnings.push(`tasks.md: ${pending} task(s) still pending ([ ]) — change may not be complete`);
    }
  }

  // Step 6: agent-log validation
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
    }
  }
  // agent-log dir not existing is OK (no agents have logged yet)

  if (errors.length > 0) {
    log.error(`gate failed for change: ${changeId}`);
    for (const e of errors) {
      log.error(`  ${e}`);
    }
    process.exit(1);
  }

  // Step 7: contract validators (delegate to cdd-kit validate)
  log.info(`gate: running contract validators for ${changeId}…`);
  const r = spawnSync(process.execPath, [process.argv[1], 'validate'], {
    cwd,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    log.error(`gate failed for change: ${changeId} (validators returned non-zero)`);
    process.exit(1);
  }

  // Emit task warnings after all blocking checks pass
  for (const w of warnings) {
    log.warn(`  ${w}`);
  }

  log.ok(`gate passed for change: ${changeId}`);
}
