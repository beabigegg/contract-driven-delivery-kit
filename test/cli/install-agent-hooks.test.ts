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

interface HookHandler { type?: string; command?: string }
interface HookEntry { matcher?: string; command?: string; hooks?: HookHandler[] }

function preTool(): HookEntry[] {
  const s = settings() as { hooks?: { PreToolUse?: HookEntry[] } };
  return s.hooks?.PreToolUse ?? [];
}

/**
 * Command an entry actually runs: Claude Code nests it under `hooks` as a
 * `{ type: 'command' }` handler, so read there first (tolerating a legacy
 * top-level `command` so the helper also works on pre-existing fixtures).
 */
function cmdOf(e: HookEntry): string | undefined {
  return e.hooks?.[0]?.command ?? e.command;
}

/**
 * The installer anchors every hook command to the project root because Claude
 * Code does not guarantee the hook's cwd is it — a bare relative `./.claude/...`
 * fails to resolve, and each hook's internal relative probes silently no-op.
 * Assertions compose this prefix with the relative invoke / strict-env form.
 */
const CD = 'cd "${CLAUDE_PROJECT_DIR:-.}" && ';

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
    // Command must be nested under `hooks` as a command handler — the shape
    // Claude Code executes; a top-level `command` would never fire.
    expect(entries[0].command).toBeUndefined();
    expect(entries[0].hooks?.[0]).toMatchObject({ type: 'command' });
    expect(cmdOf(entries[0])).toBe(CD + './.claude/hooks/pre-tool-use-graph-first.sh');
    // Advisory must NOT carry the strict env flag.
    expect(cmdOf(entries[0])).not.toContain('CDD_GRAPH_FIRST_STRICT');
  });

  it('installs the strict hook with the CDD_GRAPH_FIRST_STRICT flag', () => {
    const r = runCli(['install-agent-hooks', '--graph-first', 'strict'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    const entries = preTool();
    expect(entries).toHaveLength(1);
    expect(cmdOf(entries[0])).toBe(CD + 'CDD_GRAPH_FIRST_STRICT=1 ./.claude/hooks/pre-tool-use-graph-first.sh');
  });

  it('is idempotent and switches mode without duplicating entries', () => {
    runCli(['install-agent-hooks'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--graph-first', 'strict'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--graph-first', 'advisory'], { cwd: repo, home });

    const entries = preTool();
    expect(entries).toHaveLength(1); // replaced each time, never appended
    expect(cmdOf(entries[0])).toBe(CD + './.claude/hooks/pre-tool-use-graph-first.sh');
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
        PreToolUse?: HookEntry[];
        PostToolUse?: HookEntry[];
      };
    };
    // Unrelated top-level key preserved.
    expect(s.model).toBe('opus');
    // Unrelated PostToolUse preserved.
    expect(s.hooks?.PostToolUse?.[0].command).toBe('echo post');
    // The pre-existing Bash PreToolUse hook is kept verbatim; ours is added
    // alongside in the nested-handler shape.
    const cmds = (s.hooks?.PreToolUse ?? []).map(cmdOf);
    expect(cmds).toContain('echo other');
    expect(cmds).toContain(CD + './.claude/hooks/pre-tool-use-graph-first.sh');
    expect(s.hooks?.PreToolUse).toHaveLength(2);
  });

  it('upgrades a legacy top-level command entry to the nested handler shape', () => {
    // A prior cdd-kit version wrote the command directly on the matcher group,
    // which Claude Code never executes. Re-running must replace that broken
    // entry (matched by marker) with the correct nested shape — not append.
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Read', command: './.claude/hooks/pre-tool-use-graph-first.sh' }],
        },
      }, null, 2),
      'utf8',
    );

    const r = runCli(['install-agent-hooks'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    const entries = preTool();
    expect(entries).toHaveLength(1); // legacy entry replaced, not duplicated
    expect(entries[0].command).toBeUndefined();
    expect(cmdOf(entries[0])).toBe(CD + './.claude/hooks/pre-tool-use-graph-first.sh');
  });

  it('preserves an unrelated handler sharing the cdd matcher group on reinstall', () => {
    // A user merged another project hook into the same Read matcher group as
    // ours. Re-running must strip only OUR handler, not drop the whole group.
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'Read',
            hooks: [
              { type: 'command', command: './.claude/hooks/pre-tool-use-graph-first.sh' },
              { type: 'command', command: 'echo sibling' },
            ],
          }],
        },
      }, null, 2),
      'utf8',
    );

    const r = runCli(['install-agent-hooks', '--graph-first', 'strict'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    const allCmds = preTool().flatMap(e => (e.hooks ?? []).map(h => h.command));
    // Unrelated handler survives.
    expect(allCmds).toContain('echo sibling');
    // Ours is present exactly once and refreshed to strict mode.
    const ours = allCmds.filter(c => c?.includes('pre-tool-use-graph-first'));
    expect(ours).toHaveLength(1);
    expect(ours[0]).toBe(CD + 'CDD_GRAPH_FIRST_STRICT=1 ./.claude/hooks/pre-tool-use-graph-first.sh');
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

describe('cdd-kit install-agent-hooks --contract-write (ADR 0004 §6)', () => {
  const CW_SCRIPT = './.claude/hooks/pre-tool-use-contract-write.sh';
  const GF_SCRIPT = './.claude/hooks/pre-tool-use-graph-first.sh';

  /** The PreToolUse entry whose nested command names the given hook script. */
  function entryFor(marker: string): HookEntry | undefined {
    return preTool().find(e => cmdOf(e)?.includes(marker));
  }

  it('installs the advisory contract-write hook and copies the script', () => {
    const r = runCli(['install-agent-hooks', '--contract-write', 'advisory'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    expect(existsSync(join(repo, '.claude', 'hooks', 'pre-tool-use-contract-write.sh'))).toBe(true);
    const entry = entryFor('pre-tool-use-contract-write');
    expect(entry).toBeDefined();
    // Matches the agent's file-mutation tools.
    expect(entry?.matcher).toBe('Write|Edit|MultiEdit');
    expect(entry?.command).toBeUndefined(); // nested handler shape, not top-level
    expect(entry?.hooks?.[0]).toMatchObject({ type: 'command' });
    expect(cmdOf(entry!)).toBe(CD + CW_SCRIPT);
    expect(cmdOf(entry!)).not.toContain('CDD_CONTRACT_WRITE_STRICT');
  });

  it('installs the strict contract-write hook with the CDD_CONTRACT_WRITE_STRICT flag', () => {
    const r = runCli(['install-agent-hooks', '--contract-write', 'strict'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(cmdOf(entryFor('pre-tool-use-contract-write')!)).toBe(CD + `CDD_CONTRACT_WRITE_STRICT=1 ${CW_SCRIPT}`);
  });

  it('arming contract-write does NOT install or disturb graph-first (opt-in, independent)', () => {
    const r = runCli(['install-agent-hooks', '--contract-write', 'strict'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    // Only the contract-write hook is present; graph-first was never requested.
    expect(preTool()).toHaveLength(1);
    expect(entryFor('pre-tool-use-graph-first')).toBeUndefined();
    expect(existsSync(join(repo, '.claude', 'hooks', 'pre-tool-use-graph-first.sh'))).toBe(false);
  });

  it('a bare install-agent-hooks does NOT arm contract-write (opt-in)', () => {
    const r = runCli(['install-agent-hooks'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(entryFor('pre-tool-use-contract-write')).toBeUndefined();
    expect(existsSync(join(repo, '.claude', 'hooks', 'pre-tool-use-contract-write.sh'))).toBe(false);
  });

  it('arms graph-first and contract-write independently across separate runs', () => {
    expect(runCli(['install-agent-hooks', '--graph-first', 'advisory'], { cwd: repo, home }).status).toBe(0);
    expect(runCli(['install-agent-hooks', '--contract-write', 'strict'], { cwd: repo, home }).status).toBe(0);

    // Both hooks coexist; arming the second left the first untouched.
    expect(preTool()).toHaveLength(2);
    expect(cmdOf(entryFor('pre-tool-use-graph-first')!)).toBe(CD + GF_SCRIPT);
    expect(cmdOf(entryFor('pre-tool-use-contract-write')!)).toBe(CD + `CDD_CONTRACT_WRITE_STRICT=1 ${CW_SCRIPT}`);
  });

  it('arms both hooks in a single invocation', () => {
    const r = runCli(['install-agent-hooks', '--graph-first', 'strict', '--contract-write', 'advisory'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(preTool()).toHaveLength(2);
    expect(cmdOf(entryFor('pre-tool-use-graph-first')!)).toBe(CD + `CDD_GRAPH_FIRST_STRICT=1 ${GF_SCRIPT}`);
    expect(cmdOf(entryFor('pre-tool-use-contract-write')!)).toBe(CD + CW_SCRIPT);
  });

  it('is idempotent and switches contract-write mode without duplicating entries', () => {
    runCli(['install-agent-hooks', '--contract-write', 'advisory'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--contract-write', 'strict'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--contract-write', 'advisory'], { cwd: repo, home });

    const ours = preTool().filter(e => cmdOf(e)?.includes('pre-tool-use-contract-write'));
    expect(ours).toHaveLength(1); // replaced each time, never appended
    expect(cmdOf(ours[0])).toBe(CD + CW_SCRIPT);
  });

  it('rejects an invalid contract-write mode', () => {
    const r = runCli(['install-agent-hooks', '--contract-write', 'bogus'], { cwd: repo, home });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid.*mode/i);
  });

  it('writes an executable contract-write hook script', () => {
    runCli(['install-agent-hooks', '--contract-write', 'advisory'], { cwd: repo, home });
    const mode = statSync(join(repo, '.claude', 'hooks', 'pre-tool-use-contract-write.sh')).mode;
    if (process.platform !== 'win32') {
      expect(mode & 0o100).toBeTruthy();
    }
  });
});

describe('cdd-kit install-agent-hooks --test-runner (ADR 0005 §10)', () => {
  const TR_SCRIPT = './.claude/hooks/pre-tool-use-test-runner.sh';
  const GF_SCRIPT = './.claude/hooks/pre-tool-use-graph-first.sh';

  /** The PreToolUse entry whose nested command names the given hook script. */
  function entryFor(marker: string): HookEntry | undefined {
    return preTool().find(e => cmdOf(e)?.includes(marker));
  }

  it('installs the advisory test-runner hook on the Bash tool and copies the script', () => {
    const r = runCli(['install-agent-hooks', '--test-runner', 'advisory'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    expect(existsSync(join(repo, '.claude', 'hooks', 'pre-tool-use-test-runner.sh'))).toBe(true);
    const entry = entryFor('pre-tool-use-test-runner');
    expect(entry).toBeDefined();
    // Broad test runs arrive as Bash commands.
    expect(entry?.matcher).toBe('Bash');
    expect(entry?.command).toBeUndefined(); // nested handler shape, not top-level
    expect(entry?.hooks?.[0]).toMatchObject({ type: 'command' });
    expect(cmdOf(entry!)).toBe(CD + TR_SCRIPT);
    expect(cmdOf(entry!)).not.toContain('CDD_TEST_RUNNER_STRICT');
  });

  it('installs the strict test-runner hook with the CDD_TEST_RUNNER_STRICT flag', () => {
    const r = runCli(['install-agent-hooks', '--test-runner', 'strict'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(cmdOf(entryFor('pre-tool-use-test-runner')!)).toBe(CD + `CDD_TEST_RUNNER_STRICT=1 ${TR_SCRIPT}`);
  });

  it('a bare install-agent-hooks does NOT arm test-runner (opt-in)', () => {
    const r = runCli(['install-agent-hooks'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(entryFor('pre-tool-use-test-runner')).toBeUndefined();
    expect(existsSync(join(repo, '.claude', 'hooks', 'pre-tool-use-test-runner.sh'))).toBe(false);
  });

  it('arming test-runner does NOT install or disturb graph-first (opt-in, independent)', () => {
    const r = runCli(['install-agent-hooks', '--test-runner', 'advisory'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(preTool()).toHaveLength(1);
    expect(entryFor('pre-tool-use-graph-first')).toBeUndefined();
    expect(existsSync(join(repo, '.claude', 'hooks', 'pre-tool-use-graph-first.sh'))).toBe(false);
  });

  it('arms all three hooks in a single invocation', () => {
    const r = runCli(
      ['install-agent-hooks', '--graph-first', 'strict', '--contract-write', 'advisory', '--test-runner', 'strict'],
      { cwd: repo, home },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(preTool()).toHaveLength(3);
    expect(cmdOf(entryFor('pre-tool-use-graph-first')!)).toBe(CD + `CDD_GRAPH_FIRST_STRICT=1 ${GF_SCRIPT}`);
    expect(cmdOf(entryFor('pre-tool-use-test-runner')!)).toBe(CD + `CDD_TEST_RUNNER_STRICT=1 ${TR_SCRIPT}`);
  });

  it('is idempotent and switches test-runner mode without duplicating entries', () => {
    runCli(['install-agent-hooks', '--test-runner', 'advisory'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--test-runner', 'strict'], { cwd: repo, home });
    runCli(['install-agent-hooks', '--test-runner', 'advisory'], { cwd: repo, home });

    const ours = preTool().filter(e => cmdOf(e)?.includes('pre-tool-use-test-runner'));
    expect(ours).toHaveLength(1); // replaced each time, never appended
    expect(cmdOf(ours[0])).toBe(CD + TR_SCRIPT);
  });

  it('rejects an invalid test-runner mode', () => {
    const r = runCli(['install-agent-hooks', '--test-runner', 'bogus'], { cwd: repo, home });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid.*mode/i);
  });

  it('writes an executable test-runner hook script', () => {
    runCli(['install-agent-hooks', '--test-runner', 'advisory'], { cwd: repo, home });
    const mode = statSync(join(repo, '.claude', 'hooks', 'pre-tool-use-test-runner.sh')).mode;
    if (process.platform !== 'win32') {
      expect(mode & 0o100).toBeTruthy();
    }
  });
});
