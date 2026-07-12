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
    expect(r.stdout + r.stderr).toMatch(/Recommended for AI agents: enable the cdd-kit MCP server/i);
    expect(r.stdout + r.stderr).toMatch(/claude mcp add --scope user cdd-kit -- cdd-kit mcp/i);
    expect(r.stdout + r.stderr).toMatch(/~\/\.claude\.json/i);

    expect(existsSync(join(tmpRepo, 'contracts')), 'contracts/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'specs', 'templates')), 'specs/templates/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'tests', 'templates')), 'tests/templates/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'ci')), 'ci/ missing').toBe(true);
    expect(existsSync(join(tmpRepo, '.cdd', 'context-policy.json')), '.cdd/context-policy.json missing').toBe(true);
    expect(existsSync(join(tmpRepo, '.github', 'workflows', 'contract-driven-gates.yml')), '.github/workflows/contract-driven-gates.yml missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md')), 'CLAUDE.md missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'AGENTS.md')), 'AGENTS.md missing').toBe(true);
  });

  it('--local-only pins the adopter workflow\'s cdd-kit install to this running CLI\'s own version (ci-gates.md § Workflow Changes 3)', () => {
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const ciYmlPath = join(tmpRepo, '.github', 'workflows', 'contract-driven-gates.yml');
    const content = readFileSync(ciYmlPath, 'utf8');

    expect(content).not.toMatch(/\{\{cdd-kit-version\}\}/);
    expect(content).toMatch(new RegExp(`npm install -g contract-driven-delivery@${PKG_VERSION.replace(/\./g, '\\.')}`));
  });

  it('pins the version even when stack detection is unknown (no fast-gate template found)', () => {
    // No package.json / environment.yml / lockfiles in tmpRepo — stack detects
    // as 'unknown', so loadCiTemplate returns null and the fast-gate patch
    // block never runs. The {{cdd-kit-version}} substitution must still fire
    // (it is independent of stack detection), or an "unknown stack" project
    // would ship an unresolved token in its CI workflow forever.
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    const ciYmlPath = join(tmpRepo, '.github', 'workflows', 'contract-driven-gates.yml');
    const content = readFileSync(ciYmlPath, 'utf8');
    expect(content).not.toMatch(/\{\{cdd-kit-version\}\}/);
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
    const manifest = JSON.parse(readFileSync(join(tmpHome, '.cdd-kit', 'install-manifest.json'), 'utf8'));
    expect(manifest.providers).toContain('claude');
  });

  it('--provider codex scaffolds AGENTS.md, CODEX.md, and skips Claude-only guidance', () => {
    const r = runCli(['init', '--local-only', '--provider', 'codex'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    expect(existsSync(join(tmpRepo, 'CODEX.md')), 'CODEX.md missing').toBe(true);
    expect(existsSync(join(tmpRepo, 'CLAUDE.md')), 'CLAUDE.md should not be created for codex-only').toBe(false);
    expect(existsSync(join(tmpRepo, 'AGENTS.md')), 'AGENTS.md missing for codex-only').toBe(true);

    const policy = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), 'utf8'));
    expect(policy.provider).toBe('codex');
    expect(policy.roles['change-classifier']).toBe('opus');
    expect(policy.roles['backend-engineer']).toBe('sonnet');
    expect(policy.roles['repo-context-scanner']).toBe('haiku');
  });

  it('--global-only --provider codex installs the Codex cdd-work skill without Claude assets', () => {
    const r = runCli(['init', '--global-only', '--provider', 'codex'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(existsSync(join(tmpHome, '.agents', 'skills', 'cdd-work', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmpHome, '.claude'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(tmpHome, '.cdd-kit', 'install-manifest.json'), 'utf8'));
    expect(manifest.providers).toEqual(['codex']);
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

  // A fresh `init` must arm the two write-block hooks. It writes a workflow that
  // runs `cdd-kit validate` in CI, and `enforceConfirmationHookInstallation`
  // hard-fails there without them — so leaving them opt-in meant every new project
  // failed its own first CI run on a hook the scaffold never offered to install.
  // Measured before the fix; that is the reason this test exists.
  //
  // Mutation: drop `acceptanceWrite`/`designWrite` from init's installAgentHooks
  // call -> red.
  it('arms both write-block hooks by default, so a fresh project passes its first CI run', () => {
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const settings = JSON.parse(
      readFileSync(join(tmpRepo, '.claude', 'settings.json'), 'utf8'),
    ) as { hooks: { PreToolUse: { hooks?: { type?: string; command?: string }[] }[] } };

    const commands = settings.hooks.PreToolUse.flatMap(e => e.hooks ?? []);
    for (const handler of commands) expect(handler.type).toBe('command');

    const joined = commands.map(h => h.command ?? '').join('\n');
    expect(joined).toMatch(/pre-tool-use-design-write\.sh/);
    expect(joined).toMatch(/pre-tool-use-acceptance-write\.sh/);

    // Invoked through `sh`, never `./script.sh`: chmod is a no-op on Windows, so a
    // Windows developer commits mode 100644 and a POSIX CI checkout gets
    // "permission denied" — a hook that fails open while settings.json says armed.
    expect(joined).not.toMatch(/&& \.\/\.claude\/hooks\//);
    expect(joined).toMatch(/&& sh \.\/\.claude\/hooks\/pre-tool-use-design-write\.sh/);

    for (const name of ['pre-tool-use-design-write.sh', 'pre-tool-use-acceptance-write.sh']) {
      expect(existsSync(join(tmpRepo, '.claude', 'hooks', name)), name).toBe(true);
    }
  });
});
