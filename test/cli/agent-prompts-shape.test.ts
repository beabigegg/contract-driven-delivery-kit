import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

// All agent names
const ALL_AGENTS = [
  'backend-engineer',
  'bug-fix-engineer',
  'change-classifier',
  'ci-cd-gatekeeper',
  'contract-reviewer',
  'dependency-security-reviewer',
  'e2e-resilience-engineer',
  'frontend-engineer',
  'implementation-planner',
  'monkey-test-engineer',
  'qa-reviewer',
  'repo-context-scanner',
  'spec-architect',
  'spec-drift-auditor',
  'stress-soak-engineer',
  'test-strategist',
  'ui-ux-reviewer',
  'visual-reviewer',
];

// Agents that have ## Read scope (10 agents from Defect 2)
const SCOPED_AGENTS = [
  'backend-engineer',
  'bug-fix-engineer',
  'ci-cd-gatekeeper',
  'contract-reviewer',
  'e2e-resilience-engineer',
  'frontend-engineer',
  'implementation-planner',
  'monkey-test-engineer',
  'qa-reviewer',
  'spec-architect',
  'stress-soak-engineer',
  'test-strategist',
];

function readAgent(name: string): string {
  return readFileSync(join(repoRoot, '.claude', 'agents', `${name}.md`), 'utf8');
}

function extractRequiredArtifactsSection(content: string): string | null {
  const match = content.match(
    /### (?:Suggested|Required) artifacts for this agent\s*\n[\s\S]*?(?=\n#{2,3} |\n---|\s*$)/,
  );
  return match ? match[0] : null;
}

/**
 * Returns true only when the section has flat-keyed bullets WITHOUT a yaml fence.
 * Description bullets in the new format are intentionally present alongside
 * the YAML block and must not be flagged.
 */
function hasFlatBacktickKeysWithoutFence(section: string): boolean {
  if (/```ya?ml\s*\nartifacts:/.test(section)) return false;
  const withoutFence = section.replace(/```ya?ml[\s\S]*?```/g, '');
  return /^- `[a-z][a-z0-9-]+`:/m.test(withoutFence);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('agent prompt shapes — all 16 agents', () => {
  it.each(ALL_AGENTS)(
    '%s: Suggested artifacts section has a YAML fence with artifacts:, at least one {type,pointer} item, and no flat backtick-keyed lines',
    (agentName) => {
      const content = readAgent(agentName);
      const section = extractRequiredArtifactsSection(content);

      expect(section, `${agentName}: missing ### Suggested artifacts for this agent section`).toBeTruthy();

      // Must contain a fenced yaml block starting with artifacts:
      expect(section, `${agentName}: missing \`\`\`yaml artifacts: fence`).toMatch(
        /```ya?ml\s*\nartifacts:/,
      );

      // Must have at least one { type: ..., pointer: ... } item
      expect(section, `${agentName}: no { type: ..., pointer: ... } items found`).toMatch(
        /\{\s*type:/,
      );

      // Must NOT have flat backtick-keyed lines without an artifacts: fence
      // (description bullets in the new format are OK alongside the YAML block)
      expect(
        hasFlatBacktickKeysWithoutFence(section!),
        `${agentName}: found flat backtick-keyed lines with no artifacts: YAML fence (old format)`,
      ).toBe(false);
    },
  );

  it.each(ALL_AGENTS)(
    '%s: at most one ## Read scope heading',
    (agentName) => {
      const content = readAgent(agentName);
      const count = (content.match(/^## Read scope\s*$/gm) ?? []).length;
      expect(count, `${agentName}: expected <= 1 ## Read scope, found ${count}`).toBeLessThanOrEqual(1);
    },
  );

  it.each(SCOPED_AGENTS)(
    '%s (scoped): ## Read scope references context-manifest.md',
    (agentName) => {
      const content = readAgent(agentName);
      // Find the Read scope section content
      const match = content.match(/## Read scope\s*\n([\s\S]*?)(?=\n## |\s*$)/);
      expect(match, `${agentName}: no ## Read scope section found`).toBeTruthy();
      expect(
        match![0],
        `${agentName}: ## Read scope does not reference context-manifest.md`,
      ).toContain('context-manifest.md');
    },
  );

  it.each(ALL_AGENTS)(
    '%s: references references/agent-log-protocol.md',
    (agentName) => {
      const content = readAgent(agentName);
      expect(
        content,
        `${agentName}: missing reference to references/agent-log-protocol.md`,
      ).toContain('references/agent-log-protocol.md');
    },
  );

  it.each(ALL_AGENTS)(
    '%s: model frontmatter uses a provider-neutral model class',
    (agentName) => {
      const content = readAgent(agentName);
      expect(
        content,
        `${agentName}: model must be one of opus, sonnet, haiku`,
      ).toMatch(/^model:\s*(opus|sonnet|haiku)\s*$/m);
      expect(
        content,
        `${agentName}: model must not pin a provider release ID`,
      ).not.toMatch(/^model:\s*claude-/m);
    },
  );
});
