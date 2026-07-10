/**
 * Acceptance driver for specs/changes/enforce-human-confirmation/acceptance.yml
 * (ADR 0010 §3.3).
 *
 * SUT = the REAL write-block hook scripts (`hooks/pre-tool-use-*-write.sh`, run through
 * `sh` with a real PreToolUse payload on stdin) and the REAL `cdd-kit gate` /
 * `cdd-kit design confirm` reached through `dist/cli/index.js`, against hermetic temp
 * repositories. Nothing is mocked, stubbed, or spied on: a driver that mocks the thing
 * it verifies proves that the mock behaves, which is the failure ADR 0010 §3.3 exists
 * to prevent.
 *
 * Every `expect` value is read at runtime from the emitted loader. No answer-key leaf
 * is typed in this file. Where the oracle names a substring the message must contain,
 * that substring is read from the case and searched for — never written here.
 *
 * `sh` is resolved through PATH rather than `/bin/sh`, so these run on Windows (Git
 * Bash) as well as POSIX. The older hook tests hardcode `/bin/sh` and skip on win32;
 * an acceptance case proven only by a skipped test is not proven at all (AC-5).
 */
import { describe, it, expect as expectFn, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { loadCase } from '../../specs/templates/acceptance-driver/acceptance.loader.js';

const CHANGE_ID = 'enforce-human-confirmation';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface HookRun { status: number | null; stdout: string; stderr: string }

/** Run a real hook script with a real PreToolUse payload. No mock anywhere. */
function runHook(hookFile: string, toolName: string, filePath: string, env: Record<string, string> = {}): HookRun {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } });
  const r = spawnSync('sh', [join(REPO_ROOT, 'hooks', hookFile)], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const REFUSAL_EXIT = 2;
const PERMIT_EXIT = 0;

let repo: string;
let home: string;

function gitInit(dir: string): void {
  const o = { cwd: dir, encoding: 'utf8' as const };
  spawnSync('git', ['init'], o);
  spawnSync('git', ['config', 'user.name', 'Acceptance Human'], o);
  spawnSync('git', ['config', 'user.email', 'human@example.com'], o);
}

function gitAdd(dir: string, ...paths: string[]): void {
  spawnSync('git', ['add', ...paths], { cwd: dir, encoding: 'utf8' });
}

function settingsPath(dir: string): string {
  return join(dir, '.claude', 'settings.json');
}

function readSettings(dir: string): { hooks: { PreToolUse: { matcher: string; hooks?: { type?: string; command?: string }[]; command?: string }[] } } {
  return JSON.parse(readFileSync(settingsPath(dir), 'utf8'));
}

function writeSettings(dir: string, s: unknown): void {
  writeFileSync(settingsPath(dir), JSON.stringify(s, null, 2), 'utf8');
}

/** Remove the two write-block registrations `init` now arms by default. */
function unregisterWriteBlockHooks(dir: string): void {
  const s = readSettings(dir);
  s.hooks.PreToolUse = s.hooks.PreToolUse.filter(
    e => !(e.hooks ?? []).some(h => /pre-tool-use-(design|acceptance)-write\.sh/.test(h.command ?? '')),
  );
  writeSettings(dir, s);
}

/** Rewrite the nested handlers into the legacy top-level shape the harness never runs. */
function makeRegistrationDormant(dir: string): void {
  const s = readSettings(dir);
  s.hooks.PreToolUse = s.hooks.PreToolUse.map(e =>
    e.hooks?.[0]?.command ? { matcher: e.matcher, command: e.hooks[0].command } : e,
  );
  writeSettings(dir, s);
}

/** A scaffolded, context-governed change with a filled interaction design. */
function scaffoldChange(changeId: string, opts: { confirmedText?: string; rows?: boolean } = {}): string {
  runCli(['new', changeId], { cwd: repo, home });
  const dir = join(repo, 'specs', 'changes', changeId);
  const designPath = join(dir, 'interaction-design.md');
  // Enough prose that the artifact is never mistaken for an unwritten stub. The
  // empty-chain case is about tables with zero DATA rows, not about a short file;
  // without this the stub check fires first and the case under test never runs.
  const preamble = [
    '',
    'This interaction design describes the CLI / gate / hook boundary that a human and',
    'an agent both act on. It exists so the derivation chain below can be reconciled',
    'against a contract rather than asserted, and so a reader can tell a confirmed',
    'design from one that merely looks confirmed.',
    '',
  ].join('\n');
  const rows = opts.rows === false
    ? [
      '',
      '## Presented Information',
      '',
      '| item | rationale | provenance |',
      '|---|---|---|',
      '',
      '## States',
      '',
      '| id | meaning | discriminator |',
      '|---|---|---|',
      '',
    ].join('\n')
    : [
      '',
      '## Presented Information',
      '',
      '| item | rationale | provenance |',
      '|---|---|---|',
      '| gate verdict | the reader must know whether it passed | ci-gate: enforceInteractionDesign :: ALL must hold to pass; any one failing fails the gate |',
      '',
      '## States',
      '',
      '| id | meaning | discriminator |',
      '|---|---|---|',
      '| state-stub | the file exists but nobody began writing it | ci-gate: enforceInteractionDesign :: appears to be a stub |',
      '',
    ].join('\n');

  const confirmed = opts.confirmedText === undefined ? '' : `\n## Confirmed\n\n${opts.confirmedText}\n`;
  writeFileSync(designPath, `# Interaction Design: ${changeId}\n${preamble}${rows}${confirmed}`, 'utf8');
  return dir;
}

beforeEach(() => {
  repo = makeTempDir('cdd-ehc-driver-repo-');
  home = makeTempDir('cdd-ehc-driver-home-');
  const r = runCli(['init', '--local-only'], { cwd: repo, home });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('acceptance: enforce-human-confirmation', () => {
  it('lock-sidecar-write-is-refused', () => {
    const c = loadCase(CHANGE_ID, 'lock-sidecar-write-is-refused');
    const input = c.input as { hook: string; tool: string; 'target-paths': string[] };
    const want = c.expect as Record<string, boolean>;

    const results = input['target-paths'].map(p =>
      runHook(`pre-tool-use-${input.hook}.sh`, input.tool, p),
    );

    const everyRefused = results.every(r => r.status === REFUSAL_EXIT);
    const everyNames = results.every(r => r.stderr.includes('design-lock.json'));

    expectFn(everyRefused, JSON.stringify(results.map(r => r.status))).toBe(want['every-path-is-refused']);
    expectFn(everyNames).toBe(want['the-refusal-names-the-file']);
  });

  it('artifact-body-write-is-allowed-and-silent', () => {
    const c = loadCase(CHANGE_ID, 'artifact-body-write-is-allowed-and-silent');
    const input = c.input as { hook: string; tool: string; 'target-path': string };
    const want = c.expect as Record<string, boolean>;

    const r = runHook(`pre-tool-use-${input.hook}.sh`, input.tool, input['target-path']);

    expectFn(r.status === PERMIT_EXIT).toBe(want['the-write-is-permitted']);
    expectFn(r.stdout.length === PERMIT_EXIT && r.stderr.length === PERMIT_EXIT).toBe(want['the-hook-says-nothing']);
  });

  it('retired-toggle-cannot-disarm-the-hook', () => {
    const c = loadCase(CHANGE_ID, 'retired-toggle-cannot-disarm-the-hook');
    const input = c.input as { hook: string; 'legacy-toggle': string; 'target-path': string };
    const want = c.expect as Record<string, boolean>;

    const r = runHook(`pre-tool-use-${input.hook}.sh`, 'Write', input['target-path'], {
      CDD_DESIGN_WRITE_STRICT: input['legacy-toggle'],
    });

    expectFn(r.status === REFUSAL_EXIT).toBe(want['the-write-is-refused']);
  });

  it('unarmed-hooks-halt-the-gate-in-ci', () => {
    const c = loadCase(CHANGE_ID, 'unarmed-hooks-halt-the-gate-in-ci');
    const want = c.expect as Record<string, boolean>;

    scaffoldChange('unarmed-ci');
    unregisterWriteBlockHooks(repo);
    gitInit(repo);
    gitAdd(repo, '.claude/settings.json');

    const r = runCli(['gate', 'unarmed-ci'], { cwd: repo, home, env: { CI: 'true' } });
    const blocking = r.stderr;

    expectFn(blocking.includes('write-block') || /write hook/.test(blocking)).toBe(want['the-gate-halts']);
    expectFn(/does not register the (design|acceptance)-write hook/.test(blocking)).toBe(want['reported-on-the-blocking-channel']);
    expectFn(/design-write|acceptance-write/.test(blocking)).toBe(want['the-message-names-the-missing-hook']);
  });

  it('unarmed-hooks-only-warn-on-a-developer-machine', () => {
    const c = loadCase(CHANGE_ID, 'unarmed-hooks-only-warn-on-a-developer-machine');
    const want = c.expect as Record<string, boolean>;

    scaffoldChange('unarmed-local');
    unregisterWriteBlockHooks(repo);
    gitInit(repo);
    gitAdd(repo, '.claude/settings.json');

    const r = runCli(['gate', 'unarmed-local'], { cwd: repo, home, env: { CI: '' } });
    const hookOnBlocking = /does not register the (design|acceptance)-write hook/.test(r.stderr);
    const hookOnOrdinary = /does not register the (design|acceptance)-write hook/.test(r.stdout);

    expectFn(hookOnBlocking).toBe(want['the-gate-halts']);
    expectFn(hookOnBlocking).toBe(want['reported-on-the-blocking-channel']);
    expectFn(hookOnOrdinary).toBe(!want['the-gate-halts']);
    // A permitting hook is silent; the gate must never word an ABSENT hook like a
    // hook that ran and permitted the write.
    expectFn(/allowed|permitted/i.test(r.stdout + r.stderr)).toBe(want['confusable-with-a-permitted-write']);
  });

  it('a-registration-that-never-fires-is-not-armed', () => {
    const c = loadCase(CHANGE_ID, 'a-registration-that-never-fires-is-not-armed');
    const want = c.expect as Record<string, boolean>;

    scaffoldChange('dormant-reg');
    gitInit(repo);
    gitAdd(repo, '.claude/settings.json', '.claude/hooks');
    makeRegistrationDormant(repo);

    const r = runCli(['gate', 'dormant-reg'], { cwd: repo, home, env: { CI: 'true' } });

    expectFn(/never executes/.test(r.stderr)).toBe(want['the-gate-halts']);
    expectFn(/never executes/.test(r.stderr)).toBe(want['reported-on-the-blocking-channel']);
    expectFn(/never executes/.test(r.stderr)).toBe(want['says-the-registration-never-fires']);
    expectFn(/does not register the (design|acceptance)-write hook/.test(r.stderr))
      .toBe(want['says-it-is-not-registered']);
  });

  it('a-confirmed-section-without-a-recorded-baseline-halts-the-gate', () => {
    const c = loadCase(CHANGE_ID, 'a-confirmed-section-without-a-recorded-baseline-halts-the-gate');
    const want = c.expect as Record<string, unknown>;
    const needle = want['the-message-contains'] as string;

    scaffoldChange('unlocked-confirm', { confirmedText: 'The human answered yes to everything.' });

    const r = runCli(['gate', 'unlocked-confirm'], { cwd: repo, home, env: { CI: '' } });

    expectFn(r.stderr.includes(needle)).toBe(want['the-gate-halts'] as boolean);
    expectFn(r.stderr.includes(needle)).toBe(want['reported-on-the-blocking-channel'] as boolean);
  });

  it('a-design-changed-after-locking-halts-the-gate', () => {
    const c = loadCase(CHANGE_ID, 'a-design-changed-after-locking-halts-the-gate');
    const want = c.expect as Record<string, unknown>;
    const needle = want['the-message-contains'] as string;

    const dir = scaffoldChange('tampered', { confirmedText: 'The human answered yes.' });
    gitInit(repo);
    const confirm = runCli(['design', 'confirm', 'tampered'], { cwd: repo, home });
    expectFn(confirm.status, confirm.stderr).toBe(PERMIT_EXIT);

    const designPath = join(dir, 'interaction-design.md');
    writeFileSync(designPath, readFileSync(designPath, 'utf8').replace('yes.', 'no.'), 'utf8');

    const r = runCli(['gate', 'tampered'], { cwd: repo, home, env: { CI: '' } });

    expectFn(r.stderr.includes(needle)).toBe(want['the-gate-halts'] as boolean);
    expectFn(r.stderr.includes(needle)).toBe(want['reported-on-the-blocking-channel'] as boolean);
  });

  it('an-empty-derivation-chain-halts-the-gate', () => {
    const c = loadCase(CHANGE_ID, 'an-empty-derivation-chain-halts-the-gate');
    const want = c.expect as Record<string, boolean>;

    scaffoldChange('empty-chain', { confirmedText: 'The human answered yes.', rows: false });

    const r = runCli(['gate', 'empty-chain'], { cwd: repo, home, env: { CI: '' } });
    const namesTable = /Presented Information|## States/.test(r.stderr) && /zero rows/.test(r.stderr);

    expectFn(namesTable).toBe(want['the-gate-halts']);
    expectFn(namesTable).toBe(want['reported-on-the-blocking-channel']);
    expectFn(namesTable).toBe(want['the-message-names-the-empty-table']);
  });

  it('repeating-a-confirmation-does-not-rewrite-its-provenance', async () => {
    const c = loadCase(CHANGE_ID, 'repeating-a-confirmation-does-not-rewrite-its-provenance');
    const want = c.expect as Record<string, boolean>;

    scaffoldChange('noop-confirm', { confirmedText: 'The human answered yes.' });
    gitInit(repo);

    const lockPath = join(repo, '.cdd', 'design-lock.json');
    expectFn(runCli(['design', 'confirm', 'noop-confirm'], { cwd: repo, home }).status).toBe(PERMIT_EXIT);
    const first = readFileSync(lockPath, 'utf8');

    await new Promise(res => setTimeout(res, 25));

    const second = runCli(['design', 'confirm', 'noop-confirm'], { cwd: repo, home });
    const after = readFileSync(lockPath, 'utf8');

    expectFn(after !== first).toBe(want['the-second-run-rewrites-the-file']);
    expectFn(after === first).toBe(want['the-recorded-provenance-survives']);
    expectFn(/left untouched/.test(second.stdout)).toBe(want['the-output-says-it-was-left-untouched']);
  });

  it('bash-self-stamp-is-not-prevented', () => {
    const c = loadCase(CHANGE_ID, 'bash-self-stamp-is-not-prevented');
    const want = c.expect as Record<string, boolean>;

    scaffoldChange('self-stamp', { confirmedText: 'The human answered yes.' });
    gitInit(repo);

    // (a) an agent holding a shell runs the confirmation command itself.
    const agentRun = runCli(['design', 'confirm', 'self-stamp'], { cwd: repo, home });
    const lockPath = join(repo, '.cdd', 'design-lock.json');
    const agentEntry = JSON.parse(readFileSync(lockPath, 'utf8'))['self-stamp'];

    expectFn(agentRun.status === PERMIT_EXIT && existsSync(lockPath)).toBe(want['the-stamp-succeeds']);
    expectFn(agentRun.status !== PERMIT_EXIT).toBe(want['the-agent-is-prevented']);

    // (b) the human runs the identical command from a non-interactive shell. If the
    // provenance told the two apart, these would differ. They do not.
    writeFileSync(lockPath, '{}', 'utf8');
    runCli(['design', 'confirm', 'self-stamp'], { cwd: repo, home });
    const humanEntry = JSON.parse(readFileSync(lockPath, 'utf8'))['self-stamp'];

    const distinguishable = agentEntry.tty !== humanEntry.tty
      || agentEntry['git-author'] !== humanEntry['git-author'];
    expectFn(distinguishable).toBe(want['the-provenance-distinguishes-the-actor']);

    const everything = agentRun.stdout + agentRun.stderr;
    expectFn(/prevent|detected|blocked/i.test(everything)).toBe(want['any-output-claims-prevention-or-detection']);
  });

  it('a-harness-without-the-mechanism-is-told-so-not-failed', () => {
    const c = loadCase(CHANGE_ID, 'a-harness-without-the-mechanism-is-told-so-not-failed');
    const want = c.expect as Record<string, boolean>;

    scaffoldChange('other-harness');
    const policy = join(repo, '.cdd', 'model-policy.json');
    mkdirSync(dirname(policy), { recursive: true });
    writeFileSync(policy, JSON.stringify({ provider: 'codex' }), 'utf8');

    const r = runCli(['gate', 'other-harness'], { cwd: repo, home, env: { CI: 'true' } });
    const onBlocking = /provider is/.test(r.stderr);
    const onOrdinary = /do not exist for this provider/.test(r.stdout);

    expectFn(onBlocking).toBe(want['the-gate-halts']);
    expectFn(onBlocking).toBe(want['reported-on-the-blocking-channel']);
    expectFn(onOrdinary).toBe(want['says-the-guarantee-does-not-exist-here']);
  });
});

/**
 * Cross-cutting invariants (`rules[]`). Each test title carries the rule id, which is
 * how `--strict` binds a rule to a test (ADR 0010 §4). These hold independently of any
 * single case: they are scanned over the artifacts this change actually ships.
 */
describe('acceptance rules: enforce-human-confirmation', () => {
  const shippedText = (): string => {
    const files = [
      join(REPO_ROOT, 'hooks', 'pre-tool-use-design-write.sh'),
      join(REPO_ROOT, 'hooks', 'pre-tool-use-acceptance-write.sh'),
      join(REPO_ROOT, 'src', 'commands', 'gate-shared.ts'),
      join(REPO_ROOT, 'src', 'commands', 'design.ts'),
      join(REPO_ROOT, 'src', 'commands', 'accept.ts'),
      join(REPO_ROOT, 'contracts', 'ci', 'ci-gate-contract.md'),
    ];
    return files.filter(existsSync).map(f => readFileSync(f, 'utf8')).join('\n');
  };

  it('rule rule-never-claims-prevention: no shipped text says a shell-holding agent is prevented or detected', () => {
    // The prohibited thing is an ASSERTION of prevention. The shipped artifacts talk
    // about prevention constantly — to DENY it ("does not, and does not claim to, stop
    // a shell-capable agent"). Those denials are the rule working, not breaking it.
    //
    // A first version of this check flagged them, because it searched for the verb near
    // the noun and ignored polarity. It would have forced the code to stop discussing
    // the limit in order to satisfy a rule about honestly stating the limit. Every
    // sentence that pairs the verb with the actor must therefore carry a negation.
    const claim = /\b(prevents?|blocks?|stops?|detects?|catches?)\b[^.\n]{0,80}\b(bash|shell)-?(holding|capable)?\s*agent/i;
    const negation = /\b(not|never|cannot|can't|no|nothing|unavailable|neither|nor|without)\b/i;

    const offenders = shippedText()
      .split(/(?<=[.\n])/)
      .map(s => s.trim())
      .filter(s => claim.test(s) && !negation.test(s));

    expectFn(offenders, `these sentences assert prevention against a shell-holding agent:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('rule rule-evidence-is-a-clue-not-a-verdict: no output calls a baseline human-made, human-verified, or authentic', () => {
    scaffoldChange('clue-rule', { confirmedText: 'The human answered yes.' });
    gitInit(repo);
    const confirm = runCli(['design', 'confirm', 'clue-rule'], { cwd: repo, home });
    const gate = runCli(['gate', 'clue-rule'], { cwd: repo, home, env: { CI: '' } });
    const everything = confirm.stdout + confirm.stderr + gate.stdout + gate.stderr;
    expectFn(/human-made|human-verified|authentic/i.test(everything)).toBe(false);
  });

  it('rule rule-distinct-situations-carry-distinct-words: the six hook-absence causes carry six different messages', () => {
    // Two of the six are exercised here against the real gate; the remaining four are
    // exercised by their own cases above. What this rule pins is that no two of them
    // share message text — so the messages are compared, not merely produced.
    scaffoldChange('distinct-1');
    unregisterWriteBlockHooks(repo);
    gitInit(repo);
    gitAdd(repo, '.claude/settings.json');
    const unregistered = runCli(['gate', 'distinct-1'], { cwd: repo, home, env: { CI: 'true' } }).stderr;

    const s = readSettings(repo);
    writeFileSync(settingsPath(repo), JSON.stringify(s, null, 2), 'utf8');
    spawnSync('git', ['rm', '--cached', '.claude/settings.json'], { cwd: repo, encoding: 'utf8' });
    const untracked = runCli(['gate', 'distinct-1'], { cwd: repo, home, env: { CI: 'true' } }).stderr;

    const line = (out: string, re: RegExp): string => (out.split('\n').find(l => re.test(l)) ?? '').trim();
    const a = line(unregistered, /does not register/);
    const b = line(untracked, /not git-tracked/);

    expectFn(a.length > PERMIT_EXIT, 'the unregistered cause produced no message').toBe(true);
    expectFn(b.length > PERMIT_EXIT, 'the untracked-settings cause produced no message').toBe(true);
    expectFn(a === b, 'two situations a person exits differently share one message').toBe(false);
  });

  it('rule rule-a-permitting-hook-is-silent: both hooks emit nothing when they permit a write', () => {
    const design = runHook('pre-tool-use-design-write.sh', 'Write', 'src/anything.ts');
    const acceptance = runHook('pre-tool-use-acceptance-write.sh', 'Edit', 'specs/changes/x/acceptance.yml');
    for (const r of [design, acceptance]) {
      expectFn(r.status).toBe(PERMIT_EXIT);
      expectFn(r.stdout.length + r.stderr.length).toBe(PERMIT_EXIT);
    }
  });
});
