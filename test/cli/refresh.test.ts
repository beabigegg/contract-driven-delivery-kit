/**
 * Tests for `cdd-kit refresh` (2.0.8).
 *
 * Boundaries verified:
 *   - dry-run never writes
 *   - --yes overwrites kit-shipped templates with backup
 *   - --no-templates skips template force-refresh
 *   - hooks marker triggers re-install (and the marker travels with .cdd/)
 *   - model-policy.json roles map resyncs from ~/.claude/agents/ frontmatter
 *   - contracts/, specs/changes/, src/ never touched
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir('cdd-refresh-repo-');
  tmpHome = makeTempDir('cdd-refresh-home-');
  // Bootstrap a project so refresh has something to work with.
  const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe('cdd-kit refresh — dry-run safety', () => {
  it('1: dry-run never modifies templates', () => {
    const tplPath = join(tmpRepo, 'specs', 'templates', 'change-classification.md');
    const before = readFileSync(tplPath, 'utf8');
    // Tamper with the template so we can detect a write.
    writeFileSync(tplPath, before + '\n<!-- USER EDIT -->\n', 'utf8');
    const tampered = readFileSync(tplPath, 'utf8');

    const r = runCli(['refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/dry-run preview/i);
    expect(r.stdout + r.stderr).toMatch(/After applying, register MCP/i);
    expect(r.stdout + r.stderr).toMatch(/claude mcp add --scope user cdd-kit -- cdd-kit mcp/i);
    // File must still equal the tampered content
    expect(readFileSync(tplPath, 'utf8')).toBe(tampered);
    // No backup directory created
    expect(existsSync(join(tmpRepo, '.cdd', '.refresh-backup'))).toBe(false);
  });

  it('2: dry-run still reports what WOULD change', () => {
    const tplPath = join(tmpRepo, 'specs', 'templates', 'change-classification.md');
    writeFileSync(tplPath, 'COMPLETELY-DIFFERENT-CONTENT\n', 'utf8');
    const r = runCli(['refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/specs\/templates.*~/);
    expect(r.stdout + r.stderr).toMatch(/change-classification\.md/);
  });

  it('14: force-refreshes/adds specs/templates/acceptance.yml (ADR 0010 backfill)', () => {
    // Simulate a project that predates the acceptance-oracle template: its
    // local copy is missing entirely.
    const tplPath = join(tmpRepo, 'specs', 'templates', 'acceptance.yml');
    expect(existsSync(tplPath)).toBe(true); // init already copied it (fresh repo)
    const r = runCli(
      ['refresh', '--yes', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(tplPath)).toBe(true);
    const data = readFileSync(tplPath, 'utf8');
    expect(data).toMatch(/oracle-version: 0\.1\.0/);
  });
});

describe('cdd-kit refresh --yes — applies changes with backup', () => {
  it('3: overwrites tampered template and backs up the prior content', () => {
    const tplPath = join(tmpRepo, 'specs', 'templates', 'change-classification.md');
    const tamperedContent = '# tampered\n<!-- user edit will be overwritten -->\n';
    writeFileSync(tplPath, tamperedContent, 'utf8');

    const r = runCli(['refresh', '--yes', '--no-code-map', '--no-update', '--no-upgrade'], {
      cwd: tmpRepo, home: tmpHome,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Recommended for AI agents: enable the cdd-kit MCP server/i);
    expect(r.stdout + r.stderr).toMatch(/claude mcp add --scope user cdd-kit -- cdd-kit mcp/i);
    expect(r.stdout + r.stderr).toMatch(/cdd_graph_context/);

    // Template content should differ from the tampered version (was refreshed)
    const after = readFileSync(tplPath, 'utf8');
    expect(after).not.toBe(tamperedContent);
    expect(after).toContain('# Change Classification');

    // A backup directory should exist with the tampered content preserved
    const backupRoot = join(tmpRepo, '.cdd', '.refresh-backup');
    expect(existsSync(backupRoot)).toBe(true);
    const stamps = readdirSync(backupRoot);
    expect(stamps.length).toBeGreaterThanOrEqual(1);
    const backedUp = readFileSync(
      join(backupRoot, stamps[0], 'specs', 'templates', 'change-classification.md'),
      'utf8',
    );
    expect(backedUp).toBe(tamperedContent);

    // ADR 0010 §6 (AC-8): refresh stamps .cdd/asset-manifest.json for every
    // template it touched, keyed by repo-relative path.
    const manifestPath = join(tmpRepo, '.cdd', 'asset-manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest['specs/templates/change-classification.md']).toBeDefined();
    expect(manifest['specs/templates/change-classification.md'].digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('4: --no-templates skips template force-refresh', () => {
    const tplPath = join(tmpRepo, 'specs', 'templates', 'change-classification.md');
    const tampered = 'TAMPERED\n';
    writeFileSync(tplPath, tampered, 'utf8');

    const r = runCli(
      ['refresh', '--yes', '--no-templates', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(tplPath, 'utf8')).toBe(tampered);
    // No backup created when --no-templates is set
    expect(existsSync(join(tmpRepo, '.cdd', '.refresh-backup'))).toBe(false);
  });
});

describe('cdd-kit refresh — never touches user content', () => {
  it('5: contracts/ files are preserved verbatim', () => {
    const contractsDir = join(tmpRepo, 'contracts', 'api');
    mkdirSync(contractsDir, { recursive: true });
    const userContract = join(contractsDir, 'api-contract.md');
    const userContent = '# My API\n\n(this is user-authored)\n';
    writeFileSync(userContract, userContent, 'utf8');

    const r = runCli(
      ['refresh', '--yes', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(userContract, 'utf8')).toBe(userContent);
  });

  it('6: src/ files are preserved verbatim', () => {
    const srcDir = join(tmpRepo, 'src');
    mkdirSync(srcDir, { recursive: true });
    const userSrc = join(srcDir, 'app.ts');
    const userContent = 'export const x = 1;\n';
    writeFileSync(userSrc, userContent, 'utf8');

    const r = runCli(
      ['refresh', '--yes', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(userSrc, 'utf8')).toBe(userContent);
  });

  it('7: specs/changes/ is preserved verbatim', () => {
    const changeDir = join(tmpRepo, 'specs', 'changes', 'demo-001');
    mkdirSync(changeDir, { recursive: true });
    const log = join(changeDir, 'change-request.md');
    writeFileSync(log, '# In flight change\n', 'utf8');

    const r = runCli(
      ['refresh', '--yes', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe('# In flight change\n');
  });
});

describe('cdd-kit refresh — hooks marker', () => {
  it('8: no marker → step 4 logs "no marker" message', () => {
    expect(existsSync(join(tmpRepo, '.cdd', '.hooks-installed'))).toBe(false);
    const r = runCli(['refresh'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/no .cdd\/\.hooks-installed marker/i);
  });

  it('9: marker present (no .git) → no crash, hook step warns', () => {
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(tmpRepo, '.cdd', '.hooks-installed'), 'installed\n', 'utf8');
    const r = runCli(
      ['refresh', '--yes', '--no-templates', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/re-install code-map pre-commit hook/i);
  });
});

describe('cdd-kit refresh — auto-gitignore backup dir', () => {
  it('12: appends `.cdd/.refresh-backup/` to .gitignore on first overwrite', () => {
    // Tamper a template so refresh creates a backup
    writeFileSync(join(tmpRepo, 'specs', 'templates', 'change-classification.md'), 'TAMPERED\n', 'utf8');

    // Start without a .gitignore at all
    const giPath = join(tmpRepo, '.gitignore');
    if (existsSync(giPath)) writeFileSync(giPath, '', 'utf8');

    const r = runCli(
      ['refresh', '--yes', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);

    expect(existsSync(giPath)).toBe(true);
    expect(readFileSync(giPath, 'utf8')).toMatch(/^\.cdd\/\.refresh-backup\/\s*$/m);
    expect(r.stdout + r.stderr).toMatch(/added.*\.cdd\/\.refresh-backup\/.*\.gitignore/);
  });

  it('13: idempotent — does not duplicate the entry on a second run', () => {
    writeFileSync(join(tmpRepo, '.gitignore'), '.cdd/.refresh-backup/\nnode_modules/\n', 'utf8');
    writeFileSync(join(tmpRepo, 'specs', 'templates', 'change-classification.md'), 'TAMPERED\n', 'utf8');

    const r = runCli(
      ['refresh', '--yes', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);

    const gi = readFileSync(join(tmpRepo, '.gitignore'), 'utf8');
    const matches = gi.match(/^\.cdd\/\.refresh-backup\/\s*$/gm) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe('cdd-kit refresh — model-policy resync', () => {
  it('10: resyncs roles when ~/.claude/agents has different model frontmatter', () => {
    // Plant a fake agent in tmpHome/.claude/agents whose model differs from the
    // existing tmpRepo/.cdd/model-policy.json (which init wrote with defaults).
    const agentsHome = join(tmpHome, '.claude', 'agents');
    mkdirSync(agentsHome, { recursive: true });
    writeFileSync(
      join(agentsHome, 'backend-engineer.md'),
      `---
name: backend-engineer
description: backend
tools: Read
model: haiku
---

# stub

### Required artifacts for this agent
\`\`\`yaml
artifacts:
  - { type: files-changed, pointer: "n/a" }
\`\`\`
`,
      'utf8',
    );

    // Pre-write a model-policy.json with the OLD default
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(
      join(tmpRepo, '.cdd', 'model-policy.json'),
      JSON.stringify({ provider: 'claude', roles: { 'backend-engineer': 'sonnet' } }, null, 2),
      'utf8',
    );

    const r = runCli(
      ['refresh', '--yes', '--no-templates', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);

    const policy = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), 'utf8'));
    expect(policy.roles['backend-engineer']).toBe('haiku');
    expect(r.stdout + r.stderr).toMatch(/backend-engineer.*sonnet.*haiku/);
  });

  it('11: leaves roles untouched when frontmatter already matches', () => {
    const agentsHome = join(tmpHome, '.claude', 'agents');
    mkdirSync(agentsHome, { recursive: true });
    writeFileSync(
      join(agentsHome, 'backend-engineer.md'),
      `---
name: backend-engineer
description: backend
tools: Read
model: sonnet
---
# stub
`,
      'utf8',
    );

    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(
      join(tmpRepo, '.cdd', 'model-policy.json'),
      JSON.stringify({ provider: 'claude', roles: { 'backend-engineer': 'sonnet' } }, null, 2),
      'utf8',
    );

    const r = runCli(
      ['refresh', '--yes', '--no-templates', '--no-code-map', '--no-update', '--no-upgrade'],
      { cwd: tmpRepo, home: tmpHome },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/roles already match agent prompts/i);
  });
});
