/**
 * Tests for `cdd-kit doctor`'s MCP registration check.
 *
 * The check is informational (level 'ok') so it never fails `--strict` — not
 * every environment uses Claude Code. Its job is observability: surface whether
 * the cdd-kit MCP server is registered, because if it is not, agents never see
 * the graph/index tools and silently fall back to `Read`.
 *
 * The Claude CLI is stubbed via CDD_CLAUDE_BIN pointing at a small node script,
 * so all branches are deterministic without a real `claude` install.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let cwd: string;
let home: string;

function setupRepo(): void {
  const r = runCli(['init', '--local-only'], { cwd, home });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
  // hasGraphLayer requires a code-map (or project agents); write a minimal map.
  mkdirSync(join(cwd, '.cdd'), { recursive: true });
  writeFileSync(join(cwd, '.cdd', 'code-map.yml'), '# generated: test\n');
}

/** Write a node stub that emulates `claude mcp list`. */
function writeClaudeStub(includeCddKit: boolean): string {
  const stub = join(cwd, 'claude-stub.js');
  const list = includeCddKit
    ? 'cdd-kit: cdd-kit mcp - ✓ Connected\\nother: foo - ✓ Connected'
    : 'other: foo - ✓ Connected';
  writeFileSync(
    stub,
    `const a = process.argv.slice(2);\n` +
      `if (a[0] === 'mcp' && a[1] === 'list') { process.stdout.write("${list}\\n"); process.exit(0); }\n` +
      `process.exit(1);\n`,
  );
  return stub;
}

beforeEach(() => {
  cwd = makeTempDir('cdd-doctor-mcp-');
  home = makeTempDir('cdd-doctor-mcp-home-');
});

afterEach(() => {
  cleanupDir(cwd);
  cleanupDir(home);
});

describe('cdd-kit doctor — MCP registration', () => {
  it('reports cdd-kit registered when claude mcp list contains it', () => {
    setupRepo();
    const stub = writeClaudeStub(true);
    const r = runCli(['doctor'], { cwd, home, env: { CDD_CLAUDE_BIN: stub } });
    expect(r.stdout).toContain('cdd-kit server is registered');
  });

  it('flags missing registration with the add command when not in the list', () => {
    setupRepo();
    const stub = writeClaudeStub(false);
    const r = runCli(['doctor'], { cwd, home, env: { CDD_CLAUDE_BIN: stub } });
    expect(r.stdout).toContain('cdd-kit not registered');
    expect(r.stdout).toContain('claude mcp add --scope user cdd-kit -- cdd-kit mcp');
  });

  it('does not fail --strict when registration is missing (informational only)', () => {
    setupRepo();
    const stub = writeClaudeStub(false);
    const r = runCli(['doctor', '--strict'], { cwd, home, env: { CDD_CLAUDE_BIN: stub } });
    // The MCP finding is level 'ok', so it must not be the cause of any failure.
    expect(r.stdout).toContain('cdd-kit not registered');
    // doctor --strict may still fail on unrelated warnings (e.g. missing context
    // indexes), but the MCP line itself is never an error/warning.
    expect(r.stdout).not.toMatch(/MCP:.*not registered.*\n.*error/i);
  });

  it('degrades gracefully when the claude CLI is absent', () => {
    setupRepo();
    const missing = join(cwd, 'no-such-claude-binary');
    const r = runCli(['doctor'], { cwd, home, env: { CDD_CLAUDE_BIN: missing } });
    expect(r.stdout).toContain('could not run `claude mcp list`');
  });

  it('emits no MCP finding for a non-cdd-kit repo (no .cdd marker)', () => {
    // A bare repo that never ran `cdd-kit init` should not be nudged, even
    // though inferProvider defaults to 'claude'.
    const stub = writeClaudeStub(false);
    const r = runCli(['doctor'], { cwd, home, env: { CDD_CLAUDE_BIN: stub } });
    expect(r.stdout).not.toContain('MCP:');
  });
});
