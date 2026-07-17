/**
 * The two gate checks that read the classification, exercised against the v2
 * location (`tasks.yml`'s `classification:` block).
 *
 * This file exists because folding `change-classification.md` into `tasks.yml`
 * silently disarmed both of them. Neither had a test that would notice: they
 * were only ever driven through a v1 fixture that wrote the file, so the file's
 * absence — the normal state of every v2 change — was never a case. Both
 * readers took "no change-classification.md" to mean "nothing declared" and
 * returned early, which had been true only because the file used to be in
 * REQUIRED_FILES.
 *
 * So the assertions here are deliberately about the FIRING, not the parsing: a
 * v2 change that declares a lane must be subject to bug-fix enforcement, and a
 * v2 change that names a required agent must be warned about a missing log.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { readLane } from '../../src/commands/gate-evidence.js';
import { enforceRequiredAgentEvidence, readRequiredAgents } from '../../src/commands/gate-agents.js';
import { makeTempDir, cleanupDir } from '../helpers.js';

let changeDir: string;
beforeEach(() => { changeDir = makeTempDir('cdd-v2-classif-'); });
afterEach(() => { cleanupDir(changeDir); });

function writeTasks(frontmatter: string): void {
  writeFileSync(
    join(changeDir, 'tasks.yml'),
    `change-id: demo\nstatus: in-progress\ncontext-governance: v2\ntier: 2\n${frontmatter}\ntasks: []\n`,
    'utf8',
  );
}

const V2_BASE = [
  'classification:',
  '  types: [feature]',
  '  risk: low',
  '  impact: isolated',
].join('\n');

function writeLog(stem: string, body: string): void {
  const dir = join(changeDir, 'agent-log');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stem}.yml`), body, 'utf8');
}

const goodLog = (agent: string) =>
  `agent: ${agent}\nchange-id: demo\nstatus: done\nsummary: |\n  Reviewed the change and found no blocking issues; verified the relevant rows and tests.\n`;

// ── readLane (ADR 0006 §1) ───────────────────────────────────────────────────

describe('readLane — v2 reads tasks.yml classification.lane', () => {
  it('reads a bug-fix lane from tasks.yml with no change-classification.md present', () => {
    writeTasks(`${V2_BASE}\n  lane: bug-fix`);
    expect(readLane(changeDir)).toBe('bug-fix');
  });

  it('reads a feature lane from tasks.yml', () => {
    writeTasks(`${V2_BASE}\n  lane: feature`);
    expect(readLane(changeDir)).toBe('feature');
  });

  it('a v2 change that declares no lane is null — not subject to bug-fix enforcement', () => {
    writeTasks(V2_BASE);
    expect(readLane(changeDir)).toBeNull();
  });

  it('tasks.yml wins over a v1 file that disagrees (one authoritative location)', () => {
    writeTasks(`${V2_BASE}\n  lane: bug-fix`);
    writeFileSync(join(changeDir, 'change-classification.md'), '# C\n\n## Lane\n- feature\n', 'utf8');
    expect(readLane(changeDir)).toBe('bug-fix');
  });

  it('still reads the v1 `## Lane` heading when tasks.yml carries no classification', () => {
    writeFileSync(join(changeDir, 'tasks.yml'), 'change-id: demo\nstatus: in-progress\ncontext-governance: v1\ntasks: []\n', 'utf8');
    writeFileSync(join(changeDir, 'change-classification.md'), '# C\n\n## Lane\n- bug-fix\n', 'utf8');
    expect(readLane(changeDir)).toBe('bug-fix');
  });

  it('an unreadable tasks.yml does not crash the lane read', () => {
    writeFileSync(join(changeDir, 'tasks.yml'), 'this: [is: not: valid\n', 'utf8');
    expect(() => readLane(changeDir)).not.toThrow();
  });
});

// ── readRequiredAgents / enforceRequiredAgentEvidence (ADR 0008) ─────────────

describe('required-agent evidence — v2 reads tasks.yml classification.required-agents', () => {
  it('reads the declared agents from tasks.yml with no change-classification.md present', () => {
    writeTasks(`${V2_BASE}\n  required-agents: [backend-engineer, qa-reviewer]`);
    expect(readRequiredAgents(changeDir).sort()).toEqual(['backend-engineer', 'qa-reviewer']);
  });

  it('WARNS about a declared agent that left no log — the check is armed under v2', () => {
    writeTasks(`${V2_BASE}\n  required-agents: [backend-engineer, qa-reviewer]`);
    writeLog('backend-engineer', goodLog('backend-engineer'));
    const warnings: string[] = [];
    enforceRequiredAgentEvidence(changeDir, warnings);
    expect(warnings.join('\n')).toMatch(/qa-reviewer/);
    expect(warnings.join('\n')).not.toMatch(/backend-engineer/);
  });

  it('stays silent when every declared agent logged', () => {
    writeTasks(`${V2_BASE}\n  required-agents: [backend-engineer]`);
    writeLog('backend-engineer', goodLog('backend-engineer'));
    const warnings: string[] = [];
    enforceRequiredAgentEvidence(changeDir, warnings);
    expect(warnings).toEqual([]);
  });

  it('is ADVISORY — it never pushes an error, only warnings (ADR 0008)', () => {
    writeTasks(`${V2_BASE}\n  required-agents: [nobody-logged-this]`);
    const warnings: string[] = [];
    enforceRequiredAgentEvidence(changeDir, warnings);
    expect(warnings.length).toBeGreaterThan(0);
    // enforceRequiredAgentEvidence takes no errors array at all — the signature
    // is the guarantee. Asserted here so a future signature change is a test
    // failure rather than a silent escalation.
    expect(enforceRequiredAgentEvidence.length).toBe(2);
  });

  it('a v2 change declaring an EMPTY required-agents list means empty — it does not fall back to a v1 file', () => {
    writeTasks(`${V2_BASE}\n  required-agents: []`);
    writeFileSync(
      join(changeDir, 'change-classification.md'),
      '# C\n\n## Required Agents\n- `backend-engineer`\n',
      'utf8',
    );
    expect(readRequiredAgents(changeDir)).toEqual([]);
  });

  it('still reads the v1 `## Required Agents` list when tasks.yml carries no classification', () => {
    writeFileSync(join(changeDir, 'tasks.yml'), 'change-id: demo\nstatus: in-progress\ncontext-governance: v1\ntasks: []\n', 'utf8');
    writeFileSync(
      join(changeDir, 'change-classification.md'),
      '# C\n\n## Required Agents\n- `backend-engineer`\n- `qa-reviewer`\n',
      'utf8',
    );
    expect(readRequiredAgents(changeDir).sort()).toEqual(['backend-engineer', 'qa-reviewer']);
  });

  it('ignores a malformed entry rather than trusting it', () => {
    writeTasks(`${V2_BASE}\n  required-agents: ["Not An Agent", backend-engineer]`);
    expect(readRequiredAgents(changeDir)).toEqual(['backend-engineer']);
  });
});
