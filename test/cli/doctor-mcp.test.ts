/**
 * Tests for `cdd-kit doctor`'s MCP registration check.
 *
 * Severity is tiered on certainty (P1-1): when `claude` is present and positively
 * reports the cdd-kit server missing on a real cdd-kit project, that is a
 * `warning` (it trips `--strict`) — we *know* agents are degraded to the slow
 * `Read` path. When we cannot verify (no `claude` CLI, or `mcp list` errored) it
 * stays informational so environments that don't use Claude Code are not
 * penalised.
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

  /** Find the MCP finding in a `doctor --json` report. */
  function mcpFinding(env: Record<string, string>): { level: string; message: string } | undefined {
    setupRepo();
    const r = runCli(['doctor', '--json'], { cwd, home, env });
    const report = JSON.parse(r.stdout) as { findings: { level: string; message: string }[] };
    return report.findings.find(f => /^MCP:/.test(f.message));
  }

  it('marks a confirmed-missing registration as a warning (level warning), not informational', () => {
    const stub = writeClaudeStub(false);
    const finding = mcpFinding({ CDD_CLAUDE_BIN: stub });
    expect(finding?.message).toContain('cdd-kit not registered');
    expect(finding?.level).toBe('warning');
  });

  it('fails --strict when registration is confirmed missing', () => {
    setupRepo();
    const stub = writeClaudeStub(false);
    const r = runCli(['doctor', '--strict'], { cwd, home, env: { CDD_CLAUDE_BIN: stub } });
    expect(r.stdout).toContain('cdd-kit not registered');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/doctor failed in strict mode/i);
  });

  it('keeps the finding informational (level ok) when the claude CLI is absent', () => {
    const missing = join(cwd, 'no-such-claude-binary');
    const finding = mcpFinding({ CDD_CLAUDE_BIN: missing });
    expect(finding?.message).toContain('could not run `claude mcp list`');
    expect(finding?.level).toBe('ok');
  });

  it('emits no MCP finding for a non-cdd-kit repo (no .cdd marker)', () => {
    // A bare repo that never ran `cdd-kit init` should not be nudged, even
    // though inferProvider defaults to 'claude'.
    const stub = writeClaudeStub(false);
    const r = runCli(['doctor'], { cwd, home, env: { CDD_CLAUDE_BIN: stub } });
    expect(r.stdout).not.toContain('MCP:');
  });
});
