import { existsSync, readFileSync } from 'fs';
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

  if (errors.length > 0) {
    log.error(`gate failed for change: ${changeId}`);
    for (const e of errors) {
      log.error(`  ${e}`);
    }
    process.exit(1);
  }

  // Step 5: contract validators (delegate to cdd-kit validate)
  log.info(`gate: running contract validators for ${changeId}…`);
  const r = spawnSync(process.execPath, [process.argv[1], 'validate'], {
    cwd,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    log.error(`gate failed for change: ${changeId} (validators returned non-zero)`);
    process.exit(1);
  }

  log.ok(`gate passed for change: ${changeId}`);
}
