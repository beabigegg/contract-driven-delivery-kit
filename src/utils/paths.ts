import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// dist/cli/index.js is two dirs deep from package root
export const PACKAGE_ROOT = join(__dirname, '..', '..');
export const ASSETS_DIR = join(PACKAGE_ROOT, 'assets');

/**
 * The installed cdd-kit package's own version (its package.json, not the
 * consumer project's). Used to stamp `.cdd/asset-manifest.json` (ADR 0010 §6;
 * design.md Q3) so `doctor` can tell which package version installed each
 * asset. Never throws -- an unreadable/missing package.json (unexpected in a
 * real install) yields `"unknown"` rather than crashing a copy step.
 */
export function readKitVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export const CLAUDE_HOME = join(homedir(), '.claude');
export const AGENTS_HOME = join(CLAUDE_HOME, 'agents');
export const SKILLS_HOME = join(CLAUDE_HOME, 'skills');
export const CODEX_SKILLS_HOME = join(homedir(), '.agents', 'skills');

export const ASSET = {
  agents:         join(ASSETS_DIR, 'agents'),
  skills:         join(ASSETS_DIR, 'skills'),
  codexSkills:    join(ASSETS_DIR, 'codex-skills'),
  skill:          join(ASSETS_DIR, 'skills', 'contract-driven-delivery'),
  contracts:      join(ASSETS_DIR, 'contracts'),
  specsTemplates: join(ASSETS_DIR, 'specs-templates'),
  testsTemplates: join(ASSETS_DIR, 'tests-templates'),
  contractHarness: join(ASSETS_DIR, 'contract-harness'),
  ci:             join(ASSETS_DIR, 'ci'),
  githubWorkflows: join(ASSETS_DIR, 'github-workflows'),
  hooks:          join(ASSETS_DIR, 'hooks'),
  claudeTemplate: join(ASSETS_DIR, 'CLAUDE.template.md'),
  codexTemplate:  join(ASSETS_DIR, 'CODEX.template.md'),
  agentsTemplate: join(ASSETS_DIR, 'AGENTS.template.md'),
  cddConfig:      join(ASSETS_DIR, 'cdd'),
  codeMapPython:  join(ASSETS_DIR, 'code-map', 'python_scanner.py'),
};
