import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

const PKG_VERSION = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
    'utf8',
  ),
).version as string;

describe('cdd-kit init', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-init-repo-');
    tmpHome = makeTempDir('cdd-init-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('--local-only scaffolds all required project directories and files', () => {
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    expect(existsSync(join(tmpRepo, 'contracts')), 'contracts/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'specs', 'templates')), 'specs/templates/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'tests', 'templates')), 'tests/templates/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'ci')), 'ci/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, '.cdd', 'context-policy.json')), '.cdd/context-policy.json missing').toBe(true);
    expect(existsSync(join(tmpRepo, '.github', 'workflows', 'contract-driven-gates.yml')), '.github/workflows/contract-driven-gates.yml missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md')), 'CLAUDE.md missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'AGENTS.md')), 'AGENTS.md missing').toBe(true);
  });

  it('--global-only installs agents and skill into home dir', () => {
    const r = runCli(['init', '--global-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const agentsDir = join(tmpHome, '.claude', 'agents');
    expect(existsSync(agentsDir), '~/.claude/agents/ missing').toBe(true);
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    expect(agentFiles.length, 'no .md files in agents').toBeGreaterThanOrEqual(1);

    const skillFile = join(tmpHome, '.claude', 'skills', 'contract-driven-delivery', 'SKILL.md');
    expect(existsSync(skillFile), 'SKILL.md missing').toBe(true);
  });

  it('--provider codex scaffolds CODEX.md and skips Claude project files', () => {
    const r = runCli(['init', '--local-only', '--provider', 'codex'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    expect(existsSync(join(tmpRepo, 'CODEX.md')), 'CODEX.md missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md')), 'CLAUDE.md should not be created for codex-only').toBe(false);
    expect(existsSync(join(tmpRepo, 'AGENTS.md')), 'AGENTS.md should not be created for codex-only').toBe(false);

    const policy = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), 'utf8'));
    expect(policy.provider).toBe('codex');
  });

  it('--provider both scaffolds Claude and Codex project files', () => {
    const r = runCli(['init', '--local-only', '--provider', 'both'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    expect(existsSync(join(tmpRepo, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'CODEX.md'))).toBe(true);

    const policy = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), 'utf8'));
    expect(policy.provider).toBe('both');
  });

  it('init (no flags) scaffolds both local project and global home', () => {
    const r = runCli(['init'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    // Local
    expect(existsSync(join(tmpRepo, 'contracts'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md'))).toBe(true);

    // Global
    const agentsDir = join(tmpHome, '.claude', 'agents');
    expect(existsSync(agentsDir)).toBe(true);
    expect(existsSync(join(tmpHome, '.claude', 'skills', 'contract-driven-delivery', 'SKILL.md'))).toBe(true);
  });

  it('--global-only --local-only together exit non-zero with "mutually exclusive" in stderr', () => {
    const r = runCli(['init', '--global-only', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/mutually exclusive/i);
  });

  it('CLAUDE.md is preserved on second init --local-only', () => {
    // First init
    runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });

    // User modifies CLAUDE.md
    const claudePath = join(tmpRepo, 'CLAUDE.md');
    writeFileSync(claudePath, 'USER CONTENT');

    // Second init without --force
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const content = readFileSync(claudePath, 'utf8');
    expect(content).toBe('USER CONTENT');
  });

  it('--force does not overwrite CLAUDE.md but refreshes contracts/', () => {
    // First init
    runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });

    // User modifies CLAUDE.md
    const claudePath = join(tmpRepo, 'CLAUDE.md');
    writeFileSync(claudePath, 'USER CONTENT');

    // Second init with --force
    const r = runCli(['init', '--local-only', '--force'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    // CLAUDE.md must still be preserved (never overwrite policy)
    const content = readFileSync(claudePath, 'utf8');
    expect(content).toBe('USER CONTENT');

    // contracts/ was refreshed (still exists)
    expect(existsSync(join(tmpRepo, 'contracts'))).toBe(true);
  });

  it('--version prints the package.json version', () => {
    const r = runCli(['--version'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout.trim()).toContain(PKG_VERSION);
  });
});
