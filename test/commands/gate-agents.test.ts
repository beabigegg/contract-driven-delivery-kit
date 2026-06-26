/**
 * Unit tests for required-agent evidence (ADR 0008) — ADVISORY, warning-only.
 *
 * The check surfaces required agents that left no (or only a stub/copied) log as
 * a warning; it never produces an error (an agent-log is post-hoc, self-reported
 * audit, not prevention, so it must not block the gate). These drive the pure
 * functions against temp change directories.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseRequiredAgents, enforceRequiredAgentEvidence } from '../../src/commands/gate-agents.js';
import { makeTempDir, cleanupDir } from '../helpers.js';

function writeClassification(changeDir: string, agents: string[]): void {
  const list = agents.map(a => `- \`${a}\``).join('\n');
  writeFileSync(
    join(changeDir, 'change-classification.md'),
    `# Change Classification\n\n## Tier\n- 2\n\n## Required Agents\n${list}\n\n## Inferred Acceptance Criteria\n- AC-1: something\n`,
    'utf8',
  );
}

function writeLog(changeDir: string, fileStem: string, body: string): void {
  const dir = join(changeDir, 'agent-log');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fileStem}.yml`), body, 'utf8');
}

const goodLog = (agent: string) =>
  `agent: ${agent}\nchange-id: demo\nstatus: done\nsummary: |\n  Reviewed the change and found no blocking issues; verified the relevant rows and tests.\n`;

describe('parseRequiredAgents', () => {
  it('parses backticked and plain list items, dedupes, lowercases', () => {
    const c = '## Required Agents\n- `backend-engineer`\n- frontend-engineer\n- Backend-Engineer\n\n## Next\n- x';
    expect(parseRequiredAgents(c)).toEqual(['backend-engineer', 'frontend-engineer']);
  });

  it('returns [] when the section is absent', () => {
    expect(parseRequiredAgents('# Classification\n## Tier\n- 2')).toEqual([]);
  });
});

describe('enforceRequiredAgentEvidence (advisory)', () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir('gate-agents-'); });
  afterEach(() => { cleanupDir(dir); });

  function run() {
    const warnings: string[] = [];
    enforceRequiredAgentEvidence(dir, warnings);
    return warnings;
  }

  it('no warnings when every required agent has a real log', () => {
    writeClassification(dir, ['backend-engineer', 'qa-reviewer']);
    writeLog(dir, 'backend-engineer', goodLog('backend-engineer'));
    writeLog(dir, 'qa-reviewer', goodLog('qa-reviewer'));
    expect(run()).toEqual([]);
  });

  it('warns (never errors) on a missing log', () => {
    writeClassification(dir, ['backend-engineer', 'visual-reviewer']);
    writeLog(dir, 'backend-engineer', goodLog('backend-engineer'));
    const warnings = run();
    expect(warnings.some(w => w.includes('`visual-reviewer`') && w.includes('no evidence') && w.includes('advisory'))).toBe(true);
  });

  it('warns on a present stub log', () => {
    writeClassification(dir, ['qa-reviewer']);
    writeLog(dir, 'qa-reviewer', 'agent: qa-reviewer\n'); // far below the 60-char floor
    expect(run().some(w => w.includes('`qa-reviewer`') && w.includes('stub'))).toBe(true);
  });

  it('warns on a present log authored by a different agent', () => {
    writeClassification(dir, ['visual-reviewer']);
    writeLog(dir, 'visual-reviewer', goodLog('ui-ux-reviewer')); // copied from another agent
    expect(run().some(w => w.includes('does not match required agent'))).toBe(true);
  });

  it('tolerates the ci-cd-gatekeeper / ci-gatekeeper filename + author alias', () => {
    writeClassification(dir, ['ci-cd-gatekeeper']);
    writeLog(dir, 'ci-gatekeeper', goodLog('ci-gatekeeper')); // historical name
    expect(run()).toEqual([]);
  });

  it('does nothing when no Required Agents section is declared', () => {
    writeFileSync(join(dir, 'change-classification.md'), '# Classification\n## Tier\n- 3\n', 'utf8');
    expect(run()).toEqual([]);
  });
});
