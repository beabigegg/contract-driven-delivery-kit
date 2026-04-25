import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { ASSET } from '../utils/paths.js';
import { copyFile, ensureDir } from '../utils/copy.js';
import { log } from '../utils/logger.js';

export interface NewChangeOptions {
  all: boolean;
  force: boolean;
}

const REQUIRED_TEMPLATES = [
  'change-request.md',
  'change-classification.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.md',
];

function listOptional(): string[] {
  try {
    const all = readdirSync(ASSET.specsTemplates).filter((f) => f.endsWith('.md'));
    return all.filter((f) => !REQUIRED_TEMPLATES.includes(f));
  } catch {
    return [];
  }
}

const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export async function newChange(name: string, opts: NewChangeOptions): Promise<void> {
  if (!SAFE_NAME.test(name)) {
    log.error(`Invalid change name: "${name}". Use letters, numbers, hyphens, or underscores (max 64 chars).`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const changeDir = join(cwd, 'specs', 'changes', name);

  if (existsSync(changeDir)) {
    if (opts.force) {
      log.warn(`Forcing re-scaffold of existing change directory: ${changeDir}`);
      log.warn('Existing files will NOT be deleted; only template files will be overwritten.');
    } else {
      log.warn(`Change directory already exists: ${changeDir}`);
      log.warn('Aborting — remove or rename the directory to re-scaffold.');
      return;
    }
  }

  log.blank();
  log.info(`Creating change scaffold: specs/changes/${name}`);
  ensureDir(changeDir); // no-op if already exists (recursive: true)

  const templates = opts.all
    ? [...REQUIRED_TEMPLATES, ...listOptional()]
    : [...REQUIRED_TEMPLATES];

  let written = 0;
  for (const tmpl of templates) {
    const src  = join(ASSET.specsTemplates, tmpl);
    const dest = join(changeDir, tmpl);
    if (!existsSync(src)) {
      log.warn(`Template not found, skipping: ${tmpl}`);
      continue;
    }
    copyFile(src, dest, { overwrite: opts.force });
    log.dim(tmpl);
    written += 1;
  }

  log.blank();
  log.ok(`${written} template(s) created in specs/changes/${name}`);
  log.blank();
}
