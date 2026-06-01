/**
 * Tests for `cdd-kit install-agent-hooks --graph-first <mode>`.
 *
 * The command turns the graph-first PreToolUse hook from a documented file the
 * user must wire by hand into an installed entry in .claude/settings.json — the
 * same "stop governing with prose" move as the rest of the kit, applied to the
 * hook itself. It must be idempotent and must preserve unrelated settings.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let repo: string;
let home: string;

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
}

function preTool(): Array<{ matcher?: string; command?: string }> {
  const s = settings() as { hooks?: { PreToolUse?: Array<{ matcher?: string; command?: string }> } };
  return s.hooks?.PreToolUse ?? [];
}

beforeEach(() => {
  repo = makeTempDir('cdd-agenthooks-');
  home = makeTempDir('cdd-agenthooks-home-');
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit install-agent-hooks --graph-first', () => {
  it('installs the advisory hook and copies the script', () => {
    const r = runCli(['install-agent-hooks'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    expect(existsSync(join(repo, '.claude', 'hooks', 'pre-tool-use-graph-first.sh'))).toBe(true);
    const entries = preTool();
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe('Read');
    expect(entries[0].command).toBe('./.claude/hooks/pre-tool-use-graph-first.sh');
    // Advisory must NOT carry the strict env flag.
    expect(entries[0].command).not.toContain('CDD_GRAPH_FIRST_STRICT');
  });

  it('installs the strict hook with the CDD_GRAPH_FIRST_STRICT flag', () => {
    const r = runCli(['install-agent-hooks', '--graph-first', 'strict'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const entries = preTool();
    expect(entries).toHaveLength(1);
    expect(entries[0].command).toBe('CDD_GRAPH_FIRST_STRICT=1 ./.claude/hooks/pre-tool-use-graph-first.sh');
  });

  it('is idempotent and switches mode without duplicating entries', () => {
    runCli(['install-agent-hooks'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--graph-first', 'strict'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--graph-first', 'advisory'], { cwd: repo, home });

    const entries = preTool();
    expect(entries).toHaveLength(1); // replaced each time, never appended
    expect(entries[0].command).toBe('./.claude/hooks/pre-tool-use-graph-first.sh');
  });

  it('preserves unrelated settings and other PreToolUse hooks', () => {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({
        model: 'opus',
        hooks: {
          PreToolUse: [{ matcher: 'Bash', command: 'echo other' }],
          PostToolUse: [{ matcher: 'Edit', command: 'echo post' }],
        },
      }, null, 2),
      'utf8',
    );

    const r = runCli(['install-agent-hooks'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    const s = settings() as {
      model?: string;
      hooks?: {
        PreToolUse?: Array<{ matcher?: string; command?: string }>;
        PostToolUse?: Array<{ matcher?: string; command?: string }>;
      };
    };
    // Unrelated top-level key preserved.
    expect(s.model).toBe('opus');
    // Unrelated PostToolUse preserved.
    expect(s.hooks?.PostToolUse?.[0].command).toBe('echo post');
    // The pre-existing Bash PreToolUse hook is kept; ours is added alongside.
    const cmds = (s.hooks?.PreToolUse ?? []).map(e => e.command);
    expect(cmds).toContain('echo other');
    expect(cmds).toContain('./.claude/hooks/pre-tool-use-graph-first.sh');
    expect(s.hooks?.PreToolUse).toHaveLength(2);
  });

  it('rejects an invalid mode', () => {
    const r = runCli(['install-agent-hooks', '--graph-first', 'bogus'], { cwd: repo, home });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid.*mode/i);
  });

  it('fails clearly on malformed existing settings.json', () => {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'settings.json'), '{ not valid json', 'utf8');
    const r = runCli(['install-agent-hooks'], { cwd: repo, home });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/not valid json/i);
  });

  it('writes an executable hook script', () => {
    runCli(['install-agent-hooks'], { cwd: repo, home });
    const mode = statSync(join(repo, '.claude', 'hooks', 'pre-tool-use-graph-first.sh')).mode;
    if (process.platform !== 'win32') {
      expect(mode & 0o100).toBeTruthy();
    }
  });
});
