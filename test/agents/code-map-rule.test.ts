/**
 * Structural tests: verify agent prompts carry the graph-first code-map rules.
 *
 * P1-6 widened the policy: any agent that navigates source to do its job gets a
 * `## Code map (READ FIRST)` section, in one of two flavors keyed to its tools:
 *   - command-form (the agent has Bash): steer to `cdd-kit index/graph query
 *     --with-source` first;
 *   - map-first (Read/Grep/Glob only, no Bash): read `.cdd/code-map.yml` as the
 *     index and do targeted offset/limit reads.
 * Agents that do not navigate source (classifier, contract reviewer, CI gate)
 * still must NOT carry the section.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS_DIR = join(repoRoot, '.claude', 'agents');

// Agents with Bash: graph-first guidance is command-form (cdd-kit index/graph).
const REQUIRED_COMMAND_FORM = ['backend-engineer', 'bug-fix-engineer', 'frontend-engineer', 'spec-drift-auditor'];

// Agents without Bash that still navigate source: map-first guidance
// (read .cdd/code-map.yml as the index; no cdd-kit command they cannot run).
const REQUIRED_MAP_FIRST = ['implementation-planner', 'test-strategist', 'spec-architect'];

describe('agent prompts: ## Code map (READ FIRST) section', () => {
  it.each(REQUIRED_COMMAND_FORM)('%s contains the command-form section', (name) => {
    const content = readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');
    expect(content).toContain('## Code map (READ FIRST)');
    expect(content).toMatch(/cdd-kit (graph|index)/);
    expect(content).toContain('references/code-map-protocol.md');
  });

  it.each(REQUIRED_MAP_FIRST)('%s contains the map-first section', (name) => {
    const content = readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');
    expect(content).toContain('## Code map (READ FIRST)');
    expect(content).toContain('.cdd/code-map.yml');
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

  it('agents that do not navigate source do NOT contain the Code map (READ FIRST) section', () => {
    const NOT_REQUIRED = ['change-classifier', 'contract-reviewer', 'ci-cd-gatekeeper'];
    for (const a of NOT_REQUIRED) {
      const content = readFileSync(join(AGENTS_DIR, `${a}.md`), 'utf8');
      expect(content).not.toContain('## Code map (READ FIRST)');
    }
  });
});
