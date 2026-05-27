/**
 * Structural tests: verify agent prompts have code-map protocol rules.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS_DIR = join(repoRoot, '.claude', 'agents');

const REQUIRED_AGENTS = ['backend-engineer', 'bug-fix-engineer', 'frontend-engineer'];

describe('agent prompts: ## Code map (READ FIRST) section', () => {
  it.each(REQUIRED_AGENTS)('%s contains the section', (name) => {
    const content = readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');
    expect(content).toContain('## Code map (READ FIRST)');
    expect(content).toMatch(/cdd-kit (graph|index)/);
    expect(content).toContain('references/code-map-protocol.md');
  });

  it('reference doc exists', () => {
    expect(
      existsSync(join(repoRoot, '.claude', 'skills', 'contract-driven-delivery', 'references', 'code-map-protocol.md'))
    ).toBe(true);
  });

  it('qa-reviewer mentions code-map discipline', () => {
    const content = readFileSync(join(AGENTS_DIR, 'qa-reviewer.md'), 'utf8');
    expect(content).toMatch(/code-map\.yml/);
  });

  it('non-engineer agents do NOT contain the Code map (READ FIRST) section', () => {
    const NOT_REQUIRED = ['change-classifier', 'contract-reviewer', 'spec-architect'];
    for (const a of NOT_REQUIRED) {
      const content = readFileSync(join(AGENTS_DIR, `${a}.md`), 'utf8');
      expect(content).not.toContain('## Code map (READ FIRST)');
    }
  });
});
