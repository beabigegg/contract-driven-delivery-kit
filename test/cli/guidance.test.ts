import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

let repo: string;
let home: string;

beforeEach(() => {
  repo = makeTempDir('cdd-guidance-'); home = makeTempDir('cdd-guidance-home-');
  writeFileSync(join(repo, 'AGENTS.md'), 'CUSTOM PROJECT RULE\nspecs/changes/<change-id> tasks.yml implementation-plan.md\n', 'utf8');
});

afterEach(() => { cleanupDir(repo); cleanupDir(home); });

describe('guidance migration', () => {
  it('measures recurring tokens, proposes safely, and creates rollback copies before replacement', () => {
    const audit = runCli(['guidance', 'audit', '--json'], { cwd: repo, home });
    expect(audit.status, audit.stderr).toBe(0);
    const metrics = JSON.parse(audit.stdout);
    expect(metrics.current[0].legacy_references).toBeGreaterThan(0);
    expect(metrics.legacy_agent_prompts.files).toBeGreaterThan(0);
    expect(metrics.estimated_recurring_reduction_percent).toBeGreaterThan(0);

    const proposed = runCli(['guidance', 'migrate', '--apply', '--json'], { cwd: repo, home });
    expect(proposed.status, proposed.stderr).toBe(0);
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('CUSTOM PROJECT RULE');
    expect(existsSync(join(repo, '.cdd', 'migration', 'guidance-proposals', 'AGENTS.md'))).toBe(true);

    const replaced = runCli(['guidance', 'migrate', '--apply', '--replace', '--json'], { cwd: repo, home });
    expect(replaced.status, replaced.stderr).toBe(0);
    expect(readFileSync(join(repo, '.cdd', 'migration', 'guidance-backups', 'AGENTS.md'), 'utf8')).toContain('CUSTOM PROJECT RULE');
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('cdd-kit work');
  });
});
