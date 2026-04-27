import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// dist/cli/index.js is two dirs deep from package root
export const PACKAGE_ROOT = join(__dirname, '..', '..');
export const ASSETS_DIR = join(PACKAGE_ROOT, 'assets');

export const CLAUDE_HOME = join(homedir(), '.claude');
export const AGENTS_HOME = join(CLAUDE_HOME, 'agents');
export const SKILLS_HOME = join(CLAUDE_HOME, 'skills');

export const ASSET = {
  agents:         join(ASSETS_DIR, 'agents'),
  skills:         join(ASSETS_DIR, 'skills'),
  skill:          join(ASSETS_DIR, 'skills', 'contract-driven-delivery'),
  contracts:      join(ASSETS_DIR, 'contracts'),
  specsTemplates: join(ASSETS_DIR, 'specs-templates'),
  testsTemplates: join(ASSETS_DIR, 'tests-templates'),
  ci:             join(ASSETS_DIR, 'ci'),
  hooks:          join(ASSETS_DIR, 'hooks'),
  claudeTemplate: join(ASSETS_DIR, 'CLAUDE.template.md'),
  agentsTemplate: join(ASSETS_DIR, 'AGENTS.template.md'),
};
