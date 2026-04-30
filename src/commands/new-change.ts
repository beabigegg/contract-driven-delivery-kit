import { join } from 'path';
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { ASSET } from '../utils/paths.js';
import { copyFile, ensureDir } from '../utils/copy.js';
import { log } from '../utils/logger.js';
import { contextScan } from './context-scan.js';

export interface NewChangeOptions {
  all: boolean;
  force: boolean;
  dependsOn?: string;
  skipScan?: boolean;
}

function sha256OfFile(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return '';
  }
}

function inputsDigest(paths: string[]): string {
  const combined = paths.slice().sort()
    .map(p => `${p}:${sha256OfFile(p)}`)
    .join('\n');
  return createHash('sha256').update(combined).digest('hex');
}

function findContractFiles(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) findContractFiles(fullPath, found);
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md' && entry.name !== 'CHANGELOG.md') {
      found.push(fullPath);
    }
  }
  return found;
}

function readIndexDigest(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const m = readFileSync(filePath, 'utf8').match(/^inputs-digest:\s*([a-f0-9]+)/m);
  return m ? m[1] : null;
}

async function ensureFreshContextIndexes(cwd: string): Promise<void> {
  const projectMap = join(cwd, 'specs', 'context', 'project-map.md');
  const contractsIndex = join(cwd, 'specs', 'context', 'contracts-index.md');
  const policyPath = join(cwd, '.cdd', 'context-policy.json');

  const policyInputs = [policyPath].filter(existsSync);
  const contractFiles = findContractFiles(join(cwd, 'contracts'));

  const wantProjectDigest = inputsDigest(policyInputs);
  const wantContractsDigest = inputsDigest(contractFiles);

  const haveProjectDigest = readIndexDigest(projectMap);
  const haveContractsDigest = readIndexDigest(contractsIndex);

  const needsScan =
    !existsSync(projectMap) ||
    !existsSync(contractsIndex) ||
    haveProjectDigest !== wantProjectDigest ||
    haveContractsDigest !== wantContractsDigest;

  if (!needsScan) return;

  log.info('context indexes missing or stale — running cdd-kit context-scan…');
  await contextScan();
  log.dim('  (skip with --skip-scan)');
}

const REQUIRED_TEMPLATES = [
  'change-request.md',
  'change-classification.md',
  'test-plan.md',
  'ci-gates.md',
  'tasks.yml',
  'context-manifest.md',
];

function listOptional(): string[] {
  try {
    const all = readdirSync(ASSET.specsTemplates).filter((f) => f.endsWith('.md') || f.endsWith('.yml'));
    return all.filter((f) => !REQUIRED_TEMPLATES.includes(f));
  } catch {
    return [];
  }
}

const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function parseDependsOn(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export async function newChange(name: string, opts: NewChangeOptions): Promise<void> {
  if (!SAFE_NAME.test(name)) {
    log.error(`Invalid change name: "${name}". Use letters, numbers, hyphens, or underscores (max 64 chars).`);
    process.exit(1);
  }
  const dependencies = parseDependsOn(opts.dependsOn);
  for (const dep of dependencies) {
    if (!SAFE_NAME.test(dep)) {
      log.error(`Invalid dependency name: "${dep}". Use letters, numbers, hyphens, or underscores (max 64 chars).`);
      process.exit(1);
    }
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

  if (!opts.skipScan) {
    try {
      await ensureFreshContextIndexes(cwd);
    } catch (err) {
      log.warn(`context-scan failed: ${(err as Error).message}; continuing without fresh indexes`);
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

  if (dependencies.length > 0) {
    const tasksPath = join(changeDir, 'tasks.yml');
    if (existsSync(tasksPath)) {
      const raw = readFileSync(tasksPath, 'utf8');
      const data = (yaml.load(raw) ?? {}) as Record<string, unknown>;
      data['depends-on'] = dependencies;
      writeFileSync(tasksPath, yaml.dump(data, { lineWidth: -1, noRefs: true }), 'utf8');
      log.dim(`depends-on: ${dependencies.join(', ')}`);
    }
  }

  log.blank();
  log.ok(`${written} template(s) created in specs/changes/${name}`);
  log.blank();
}
