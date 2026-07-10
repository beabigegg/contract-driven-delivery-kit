/**
 * Behavioral tests for hooks/pre-tool-use-design-write.sh (ADR 0012 §5).
 *
 * `install-agent-hooks --design-write` only wires this script into
 * settings.json; the script itself is the chokepoint, so its routing decision
 * is exercised here by executing it directly with a tool-call payload on stdin.
 * POSIX-sh only -- skipped on Windows. Mirrors test/cli/acceptance-write-hook.test.ts.
 *
 * The hook keys off the write TARGET PATH (Decision 1, axis (a)): the lock
 * sidecar is blocked unconditionally, the artifact body is always allowed, and
 * the retired `CDD_DESIGN_WRITE_STRICT` toggle no longer changes anything. For a
 * standalone `.sh` hook the exit code (2 vs 0) + stderr IS the discriminator --
 * spawnSync runs the script alone, with no other checks to muddy the signal
 * (test-plan.md; contrast the gate-CLI tests, which must assert the stream).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', '..', 'hooks', 'pre-tool-use-design-write.sh');
const DESIGN_REL = 'specs/changes/my-change/interaction-design.md';
const LOCK_REL = '.cdd/design-lock.json';

// The retired toggle: `undefined` = unset, or a literal value that must not
// change the outcome. The path axis, not this variable, decides.
const RETIRED_TOGGLE_STATES = [undefined, '0', '1'] as const;

let repo: string;

function writeDesign(relPath: string): void {
  mkdirSync(join(repo, dirname(relPath)), { recursive: true });
  writeFileSync(join(repo, relPath), '# Interaction Design\n', 'utf8');
}

function runHook(
  filePath: string,
  opts: { legacyToggle?: string } = {},
): { status: number | null; stderr: string } {
  const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
  const env = { ...process.env };
  delete env.CDD_DESIGN_WRITE_STRICT;
  if (opts.legacyToggle !== undefined) env.CDD_DESIGN_WRITE_STRICT = opts.legacyToggle;
  const r = spawnSync('/bin/sh', [HOOK], { cwd: repo, input: payload, env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
}

beforeEach(() => { repo = makeTempDir('cdd-dwhook-'); });
afterEach(() => { cleanupDir(repo); });

describe.skipIf(process.platform === 'win32')('pre-tool-use-design-write.sh', () => {
  // T3a — a write to the lock sidecar is BLOCKED unconditionally, whatever the
  // retired toggle says. Mutation: make the lock case fall through to exit 0.
  it('T3a: blocks a write to .cdd/design-lock.json (exit 2 + stderr), toggle set OR unset', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, LOCK_REL), '{}', 'utf8');
    for (const legacyToggle of RETIRED_TOGGLE_STATES) {
      const r = runHook(LOCK_REL, { legacyToggle });
      expect(r.status, `CDD_DESIGN_WRITE_STRICT=${legacyToggle}`).toBe(2);
      expect(r.stderr).toMatch(/design-lock\.json/);
    }
  });

  it('T3a: blocks an absolute path to the lock sidecar too', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, LOCK_REL), '{}', 'utf8');
    for (const legacyToggle of RETIRED_TOGGLE_STATES) {
      const r = runHook(join(repo, LOCK_REL), { legacyToggle });
      expect(r.status, `CDD_DESIGN_WRITE_STRICT=${legacyToggle}`).toBe(2);
    }
  });

  // T3b — a write to the artifact BODY is ALLOWED, whatever the retired toggle
  // says (the sanctioned first write + transcription path). Mutation: re-add a
  // toggle branch that blocks the body.
  it('T3b: allows a write to interaction-design.md (exit 0, no stderr), toggle set OR unset', () => {
    writeDesign(DESIGN_REL);
    for (const legacyToggle of RETIRED_TOGGLE_STATES) {
      const r = runHook(DESIGN_REL, { legacyToggle });
      expect(r.status, `CDD_DESIGN_WRITE_STRICT=${legacyToggle}`).toBe(0);
      expect(r.stderr, `CDD_DESIGN_WRITE_STRICT=${legacyToggle}`).toBe('');
    }
  });

  it('T3b: allows interaction-design.md under any change id, and via an absolute path', () => {
    writeDesign('specs/changes/some-other-change/interaction-design.md');
    expect(runHook('specs/changes/some-other-change/interaction-design.md', { legacyToggle: '1' }).status).toBe(0);
    writeDesign(DESIGN_REL);
    expect(runHook(join(repo, DESIGN_REL), { legacyToggle: '1' }).status).toBe(0);
  });

  it('allows source files (exit 0, no stderr), toggle set', () => {
    const r = runHook('src/server/orders.ts', { legacyToggle: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows other change artifacts (e.g. tasks.yml), toggle set', () => {
    const r = runHook('specs/changes/my-change/tasks.yml', { legacyToggle: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows when the payload carries no file_path', () => {
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
    const r = spawnSync('/bin/sh', [HOOK], {
      cwd: repo,
      input: payload,
      env: { ...process.env, CDD_DESIGN_WRITE_STRICT: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  // T3e — a raw string compare is not a path compare. Every form below reached
  // exit 0 against the pre-canonicalization hook, measured. The Windows absolute
  // path is the one that mattered: it is what Claude Code actually sends on
  // Windows, so the "armed" write-block was a no-op on the machine that armed it.
  //
  // Mutation: delete the `norm_path=` line and compare `$path_value` directly ->
  // four of these six turn green-through (exit 0) and this test goes red.
  it.each([
    ['.cdd/design-lock.json', 'the plain relative path'],
    ['./.cdd/design-lock.json', 'a leading ./'],
    ['.cdd/./design-lock.json', 'a no-op . segment'],
    ['.cdd//design-lock.json', 'a doubled separator'],
    ['D:\\repo\\.cdd\\design-lock.json', 'a Windows absolute path (what Claude Code sends)'],
    ['.CDD/design-lock.json', 'a case-variant on a case-insensitive filesystem'],
  ])('T3e: blocks %s — %s', (variant) => {
    const r = runHook(variant);
    expect(r.status, `variant: ${variant}`).toBe(2);
    expect(r.stderr).toMatch(/design-lock\.json/);
  });

  // The canonicalizer must not start blocking things that merely look similar.
  it.each([
    'specs/changes/x/interaction-design.md',
    'src/foo.ts',
    '.cdd/code-map.yml',
    'docs/design-lock.json.md',
    '.cdd/design-lock.json.bak',
  ])('T3e: still allows %s', (allowed) => {
    expect(runHook(allowed).status, `allowed: ${allowed}`).toBe(0);
  });

  // The JSON payload escapes backslashes, so the extractor sees `\\` where the
  // real path has `\`. Canonicalization must unescape before folding separators.
  it('T3e: blocks the JSON-escaped Windows path the harness actually serializes', () => {
    const payload = '{"tool_name":"Write","tool_input":{"file_path":"D:\\\\repo\\\\.cdd\\\\design-lock.json"}}';
    const r = spawnSync('/bin/sh', [HOOK], { cwd: repo, input: payload, encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});
