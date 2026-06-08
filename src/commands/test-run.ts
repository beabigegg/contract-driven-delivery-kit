import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { spawn, spawnSync } from 'child_process';
import yaml from 'js-yaml';
import { ensureDir } from '../utils/copy.js';
import { log } from '../utils/logger.js';
import { DEFAULT_REQUIRED_PHASES } from '../schemas/test-evidence.schema.js';

// Bounded test execution and structured evidence (ADR 0005 §4-§6). This command
// runs ONE phase of the test ladder for a tracked change, captures durable
// artifacts under test-runs/<run-id>/, caps assistant-visible output, classifies
// the first failure, and upserts the run into test-evidence.yml. Phase 4 will add
// `cdd-kit test select` so the command can be chosen from test-plan.md instead of
// being passed explicitly; until then `--command` is required.

export const PHASES = ['collect', 'targeted', 'changed-area', 'contract', 'quality', 'full'] as const;
export type Phase = (typeof PHASES)[number];

const SCHEMA_VERSION = '0.1.0';
const GENERATED_BY = 'cdd-kit test run';
const OUTPUT_CAP_CHARS = 4000;
const MAX_MESSAGE_CHARS = 500;
// Full stdout/stderr stream to disk; only this much tail is held in memory for
// classification and the capped report, so huge output never truncates the logs.
const TAIL_CAPTURE_BYTES = 256 * 1024;
// Same shape new-change.ts enforces; rejects path-escape segments such as `..`.
const SAFE_CHANGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export type RunStatus = 'passed' | 'failed' | 'timeout' | 'error' | 'no-command';

export interface FirstFailure {
  kind: string;
  nodeid?: string;
  file?: string;
  line?: number;
  message?: string;
}

export interface TestRunOptions {
  phase: string;
  command?: string;
  runId?: string;
  timeoutMs: number;
  cwd?: string;
  requiredPhases?: string[];
  json: boolean;
}

interface EvidenceRun {
  phase: string;
  status: 'passed' | 'failed';
  command: string;
  summary: string;
  junit?: string;
}

interface EvidenceFile {
  'change-id': string;
  'schema-version': string;
  'generated-by': string;
  'required-phases': string[];
  runs: EvidenceRun[];
  'final-status': 'passed' | 'failed';
}

// ── command shaping ───────────────────────────────────────────────────────────

/**
 * True only when pytest is the program actually invoked -- `pytest`, `py.test`, a
 * path ending in either, or `python[3]/py -m pytest` at the command position
 * (after leading `VAR=value` env assignments). NOT when pytest appears merely as
 * an argument to a wrapper (`npm run pytest`, `tox -e py -- python -m pytest`,
 * `echo python -m pytest`).
 */
export function isPytestCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  const program = tokens[i];
  if (!program) return false;
  const base = program.replace(/.*[/\\]/, '');
  if (base === 'pytest' || base === 'py.test') return true;
  return /^(python[0-9.]*|py)$/.test(base) && tokens[i + 1] === '-m' && tokens[i + 2] === 'pytest';
}

/**
 * Shell composition we cannot safely rewrite: appending pytest flags to a string
 * containing operators/redirects/substitutions would target the wrong command
 * (e.g. `pytest x && coverage`). Such commands run verbatim, unaugmented.
 */
export function hasShellControl(command: string): boolean {
  return /[\n;&|<>`]/.test(command) || command.includes('$(');
}

/** Quote a path for the platform shell (the command runs with shell:true). */
function shellQuote(s: string): string {
  if (process.platform === 'win32') return `"${s.replace(/"/g, '""')}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// pytest applies the LAST occurrence of a repeated option, so resolve effective
// values from the last match rather than the first.
function effectiveMaxfail(command: string): number | null {
  const re = /(?:^|\s)(?:-x\b|--maxfail[=\s]+(\d+))/g;
  let m: RegExpExecArray | null;
  let val: number | null = null;
  while ((m = re.exec(command)) !== null) val = m[1] === undefined ? 1 : parseInt(m[1], 10);
  return val;
}

function effectiveTb(command: string): string | null {
  const re = /--tb[=\s]+(\w+)/g;
  let m: RegExpExecArray | null;
  let val: string | null = null;
  while ((m = re.exec(command)) !== null) val = m[1];
  return val;
}

/**
 * Apply the bounded pytest defaults from ADR 0005 §4. Each bound is suppressed
 * only when the selected command is already AT LEAST AS STRICT (compared by the
 * last value, not mere presence). JUnit output is always pointed (shell-quoted)
 * at the run dir -- pytest honours the last `--junitxml`, so a user path cannot
 * hide the report. Callers must not pass shell-composed commands here.
 */
export function augmentPytestCommand(command: string, junitPath: string): string {
  const add: string[] = [];

  add.push(`--junitxml=${shellQuote(junitPath)}`);

  if (!/(^|\s)(-q+\b|--quiet\b)/.test(command)) add.push('-q');

  if (effectiveMaxfail(command) !== 1) add.push('--maxfail=1');

  const tb = effectiveTb(command);
  if (!(tb !== null && ['short', 'line', 'no'].includes(tb))) add.push('--tb=short');

  if (!/(^|\s)-r[a-zA-Z]+/.test(command)) add.push('-ra');

  return `${command} ${add.join(' ')}`;
}

// ── failure classification (ADR 0005 §5) ──────────────────────────────────────

function attrVal(attrs: string, key: string): string | undefined {
  // \b so key "name" does not also match inside classname="...".
  const m = attrs.match(new RegExp(`\\b${key}="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}

function clip(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.length > MAX_MESSAGE_CHARS ? `${s.slice(0, MAX_MESSAGE_CHARS)}...` : s;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function classifyErrorMessage(message: string): string {
  if (/ModuleNotFoundError|ImportError|No module named/i.test(message)) return 'import-error';
  if (/conftest|fixture|setup of|teardown of/i.test(message)) return 'fixture-error';
  return 'collection-error';
}

/**
 * Pull the first failing/erroring testcase out of a JUnit XML document. Returns
 * null on no failure or on malformed XML -- callers fall back to text/exit-code
 * classification, so a broken report never throws. Self-closing `<testcase .../>`
 * elements (passing tests) are skipped so a later failure is not misattributed.
 */
export function parseJunitFirstFailure(xml: string): FirstFailure | null {
  try {
    const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let m: RegExpExecArray | null;
    while ((m = caseRe.exec(xml)) !== null) {
      const caseAttrs = m[1];
      const body = m[2];
      if (body === undefined) continue; // self-closing testcase = passed, no body
      const fail = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
      if (!fail) continue;
      const tag = fail[1];
      const failAttrs = fail[2] ?? '';
      const inner = fail[3] ? decodeXml(fail[3]).trim() : undefined;
      const message = attrVal(failAttrs, 'message') ?? (inner ? inner.split('\n')[0] : undefined);
      const classname = attrVal(caseAttrs, 'classname');
      const name = attrVal(caseAttrs, 'name');
      const file = attrVal(caseAttrs, 'file');
      const lineStr = attrVal(caseAttrs, 'line');
      const base = file ?? classname;
      const nodeid = base && name ? `${base}::${name}` : name ?? base;
      const kind = tag === 'failure' ? 'assertion-failure' : classifyErrorMessage(message ?? inner ?? '');
      return {
        kind,
        nodeid,
        file,
        line: lineStr && /^\d+$/.test(lineStr) ? parseInt(lineStr, 10) : undefined,
        message: clip(message),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function extractNodeFromSummary(text: string): { nodeid?: string; message?: string } {
  const m = text.match(/^(?:FAILED|ERROR)\s+(\S+)(?:\s+-\s+(.*))?$/m);
  if (!m) return {};
  return { nodeid: m[1], message: clip(m[2]?.trim()) };
}

function lastMeaningfulLine(text: string): string | undefined {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return clip(lines.length ? lines[lines.length - 1] : undefined);
}

export function classifyFailure(opts: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  junitXml: string | null;
  command: string;
}): FirstFailure {
  if (opts.junitXml) {
    const fromJunit = parseJunitFirstFailure(opts.junitXml);
    if (fromJunit) return fromJunit;
  }

  const text = `${opts.stdout}\n${opts.stderr}`;
  const fromSummary = extractNodeFromSummary(text);

  if (/\bvalidate\b/.test(opts.command) && /contract/i.test(opts.command)) {
    return { kind: 'contract-drift', message: lastMeaningfulLine(text) };
  }
  if (/ModuleNotFoundError|ImportError|No module named/.test(text)) {
    return { kind: 'import-error', ...fromSummary, message: fromSummary.message ?? lastMeaningfulLine(text) };
  }
  if (/errors? during collection|ERROR collecting|cannot collect|collected 0 items/i.test(text)) {
    return { kind: 'collection-error', ...fromSummary };
  }
  if (/\bconftest\b|fixture .*error|ERROR at setup of|error setting up/i.test(text)) {
    return { kind: 'fixture-error', ...fromSummary };
  }
  if (/AssertionError|^E\s+assert|(^|\s)assert\s/m.test(text)) {
    return { kind: 'assertion-failure', ...fromSummary, message: fromSummary.message ?? lastMeaningfulLine(text) };
  }

  // pytest exit-code fallback only when this was actually pytest.
  if (isPytestCommand(opts.command)) {
    switch (opts.exitCode) {
      case 5: return { kind: 'collection-error', message: 'no tests collected' };
      case 4: return { kind: 'runner-error', message: 'pytest usage error' };
      case 3: return { kind: 'runner-error', message: 'pytest internal error' };
      case 2: return { kind: 'runner-error', message: 'pytest interrupted' };
    }
  }

  return { kind: 'unknown', ...fromSummary, message: fromSummary.message ?? lastMeaningfulLine(text) };
}

// ── evidence (ADR 0005 §6) ────────────────────────────────────────────────────

// The always-required ladder floor is included even when the caller passes a
// custom --required-phases (which only ADDS conditional phases like contract),
// so the evidence this writes matches the floor the gate enforces — a custom
// list can never silently drop collect/targeted/changed-area.
function defaultRequired(requested?: string[]): string[] {
  return requested && requested.length
    ? [...new Set([...DEFAULT_REQUIRED_PHASES, ...requested])]
    : [...DEFAULT_REQUIRED_PHASES];
}

function blankEvidence(changeId: string, requiredPhases?: string[]): EvidenceFile {
  return {
    'change-id': changeId,
    'schema-version': SCHEMA_VERSION,
    'generated-by': GENERATED_BY,
    'required-phases': defaultRequired(requiredPhases),
    runs: [],
    'final-status': 'failed',
  };
}

function computeFinalStatus(ev: EvidenceFile): 'passed' | 'failed' {
  const allPassed = ev.runs.length > 0 && ev.runs.every((r) => r.status === 'passed');
  const covered = ev['required-phases'].every((p) => ev.runs.some((r) => r.phase === p && r.status === 'passed'));
  return allPassed && covered ? 'passed' : 'failed';
}

function updateEvidence(
  changeDir: string,
  changeId: string,
  run: { phase: string; status: 'passed' | 'failed'; command: string; summary: string; junit?: string; requiredPhases?: string[] },
): void {
  const evPath = join(changeDir, 'test-evidence.yml');
  let ev: EvidenceFile;
  if (existsSync(evPath)) {
    const loaded = yaml.load(readFileSync(evPath, 'utf8'));
    ev = loaded && typeof loaded === 'object' ? (loaded as EvidenceFile) : blankEvidence(changeId, run.requiredPhases);
  } else {
    ev = blankEvidence(changeId, run.requiredPhases);
  }
  // Defensive normalization so a hand-edited file cannot crash the runner.
  if (!ev['change-id']) ev['change-id'] = changeId;
  if (!ev['schema-version']) ev['schema-version'] = SCHEMA_VERSION;
  if (!ev['generated-by']) ev['generated-by'] = GENERATED_BY;
  if (!Array.isArray(ev['required-phases']) || ev['required-phases'].length === 0) {
    ev['required-phases'] = defaultRequired(run.requiredPhases);
  }
  if (!Array.isArray(ev.runs)) ev.runs = [];

  const entry: EvidenceRun = { phase: run.phase, status: run.status, command: run.command, summary: run.summary };
  if (run.junit) entry.junit = run.junit;
  const idx = ev.runs.findIndex((r) => r.phase === run.phase);
  if (idx >= 0) ev.runs[idx] = entry;
  else ev.runs.push(entry);

  ev['final-status'] = computeFinalStatus(ev);

  // Rebuild in canonical key order so the file stays readable and diff-stable.
  const ordered: EvidenceFile = {
    'change-id': ev['change-id'],
    'schema-version': ev['schema-version'],
    'generated-by': ev['generated-by'],
    'required-phases': ev['required-phases'],
    runs: ev.runs,
    'final-status': ev['final-status'],
  };
  writeFileSync(evPath, yaml.dump(ordered, { lineWidth: 120, noRefs: true }), 'utf8');
}

// ── run id + reporting ────────────────────────────────────────────────────────

export function defaultRunId(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Reserve a fresh run dir atomically. mkdirSync without `recursive` throws EEXIST
 * if the dir already exists, so two runs that pick the same timestamp cannot both
 * win -- the loser retries the next suffix instead of racing artifact writes.
 */
function reserveGeneratedRunDir(testRunsDir: string): { runId: string; runDir: string } {
  const base = defaultRunId();
  for (let n = 1; n <= 1000; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const dir = join(testRunsDir, id);
    try {
      mkdirSync(dir);
      return { runId: id, runDir: dir };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  const id = `${base}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(testRunsDir, id);
  mkdirSync(dir, { recursive: true });
  return { runId: id, runDir: dir };
}

// Leading alnum (so it cannot start with `.`) and no `..`, so an explicit
// --run-id can never escape the test-runs directory.
function isSafeRunId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes('..');
}

function nextAction(status: RunStatus, phase: string): string {
  switch (status) {
    case 'passed': return phase === 'full' ? 'all phases green' : 'proceed to the next phase';
    case 'failed': return 'fix the first failure before running broader phases; do not waive it';
    case 'timeout': return 'investigate the timeout or raise --timeout for a legitimately long suite';
    case 'error': return 'fix the command; it could not be executed';
    default: return 'provide a bounded command for this phase';
  }
}

function capTail(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(text.length - cap), truncated: true };
}

interface RunSummary {
  change_id: string;
  phase: string;
  status: RunStatus;
  exit_code: number | null;
  command: string;
  duration_ms: number;
  first_failure: FirstFailure | null;
  artifacts: Record<string, string>;
  next_action: string;
}

function report(summary: RunSummary, stdout: string, stderr: string): void {
  log.blank();
  const headline = `test ${summary.phase}: ${summary.status} (exit ${summary.exit_code ?? 'n/a'}, ${summary.duration_ms} ms)`;
  if (summary.status === 'passed') log.ok(headline);
  else log.error(headline);

  if (summary.first_failure) {
    const ff = summary.first_failure;
    log.error(`first failure [${ff.kind}]${ff.nodeid ? ` ${ff.nodeid}` : ''}`);
    if (ff.message) log.dim(ff.message);
  }

  if (summary.status !== 'passed') {
    const combined = `${stdout}${stderr ? `\n${stderr}` : ''}`.trimEnd();
    if (combined) {
      const capped = capTail(combined, OUTPUT_CAP_CHARS);
      if (capped.truncated) {
        log.dim(`... output capped to last ${OUTPUT_CAP_CHARS} chars; full logs in ${summary.artifacts.stdout} / ${summary.artifacts.stderr}`);
      }
      process.stdout.write(`${capped.text}\n`);
    }
  }

  log.dim(`summary: ${summary.artifacts.summary}`);
  log.dim(`next: ${summary.next_action}`);
  log.blank();
}

function emitError(json: boolean, payload: Record<string, unknown>, humanMessage: string): void {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else log.error(humanMessage);
}

// ── bounded execution ─────────────────────────────────────────────────────────

interface CommandResult {
  stdoutTail: string;
  stderrTail: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  spawnError?: Error;
}

/**
 * Kill the whole process tree, not just the shell. On POSIX the command runs in
 * its own process group (detached), so a negative pid SIGKILLs the shell and any
 * test process it launched; on Windows we fall back to `taskkill /t /f`. Without
 * this, a timeout on a shell-wrapped command (e.g. `npm test`, a python wrapper)
 * would leave the real test process orphaned and unbounded (ADR 0005 §4).
 */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

function appendTail(tail: Buffer, chunk: Buffer): Buffer {
  const combined = tail.length ? Buffer.concat([tail, chunk]) : chunk;
  return combined.length > TAIL_CAPTURE_BYTES ? combined.subarray(combined.length - TAIL_CAPTURE_BYTES) : combined;
}

function runCommand(
  command: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; stdoutPath: string; stderrPath: string },
): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const start = Date.now();
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd,
      env: opts.env,
      // New process group so killTree can take down the whole tree on timeout.
      detached: process.platform !== 'win32',
    });

    // Full output streams to disk; only a bounded tail is kept in memory so a
    // huge run never truncates the durable logs (ADR 0005 §4).
    const outStream = createWriteStream(opts.stdoutPath);
    const errStream = createWriteStream(opts.stderrPath);
    let outTail: Buffer = Buffer.alloc(0);
    let errTail: Buffer = Buffer.alloc(0);
    let timedOut = false;
    let spawnError: Error | undefined;
    let settled = false;

    // Honour backpressure: if the file stream is full, pause the child pipe until
    // it drains so a slow disk cannot grow the writable buffer unbounded.
    const pump = (
      source: NodeJS.ReadableStream | null,
      sink: ReturnType<typeof createWriteStream>,
      chunk: Buffer,
      setTail: (b: Buffer) => void,
    ): void => {
      setTail(chunk);
      if (!sink.write(chunk) && source) {
        source.pause();
        sink.once('drain', () => source.resume());
      }
    };
    child.stdout?.on('data', (d: Buffer) => pump(child.stdout, outStream, d, (b) => { outTail = appendTail(outTail, b); }));
    child.stderr?.on('data', (d: Buffer) => pump(child.stderr, errStream, d, (b) => { errTail = appendTail(errTail, b); }));

    const timer = setTimeout(() => {
      timedOut = true;
      if (typeof child.pid === 'number') killTree(child.pid);
    }, opts.timeoutMs);

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let pending = 2;
      const done = (): void => {
        pending -= 1;
        if (pending > 0) return;
        resolveResult({
          stdoutTail: outTail.toString('utf8'),
          stderrTail: errTail.toString('utf8'),
          exitCode,
          durationMs: Date.now() - start,
          timedOut,
          spawnError,
        });
      };
      outStream.end(done);
      errStream.end(done);
    };

    child.on('error', (err) => { spawnError = err; finish(null); });
    child.on('close', (code) => finish(code));
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

export async function testRun(changeId: string, opts: TestRunOptions): Promise<number> {
  const cwd = process.cwd();

  if (!(PHASES as readonly string[]).includes(opts.phase)) {
    emitError(opts.json, { change_id: changeId, status: 'error', reason: `invalid phase: ${opts.phase}` },
      `Invalid --phase "${opts.phase}". Use one of: ${PHASES.join(', ')}.`);
    return 2;
  }
  if (opts.requiredPhases) {
    const bad = opts.requiredPhases.filter((p) => !(PHASES as readonly string[]).includes(p));
    if (bad.length) {
      emitError(opts.json, { change_id: changeId, status: 'error', reason: `invalid required phase(s): ${bad.join(', ')}` },
        `Invalid --required-phases entr${bad.length > 1 ? 'ies' : 'y'}: ${bad.join(', ')}. Use: ${PHASES.join(', ')}.`);
      return 2;
    }
  }

  // Validate the change id before it is ever joined into a filesystem path, so a
  // value like `../../src` cannot escape specs/changes/<id> (ADR 0005 §4 / parity
  // with new-change.ts).
  if (!SAFE_CHANGE_ID.test(changeId)) {
    emitError(opts.json, { change_id: changeId, status: 'error', reason: 'invalid change id' },
      `Invalid change id "${changeId}". Use letters, numbers, hyphens, or underscores (max 64 chars).`);
    return 2;
  }

  const changeDir = join(cwd, 'specs', 'changes', changeId);
  if (!existsSync(changeDir)) {
    emitError(opts.json, { change_id: changeId, status: 'error', reason: 'change not found' },
      `Change not found: specs/changes/${changeId}`);
    return 2;
  }

  if (!opts.command || !opts.command.trim()) {
    const reason = `No command for phase ${opts.phase}. Pass --command "<cmd>" (cdd-kit test select will provide it in a later phase).`;
    emitError(opts.json, { change_id: changeId, phase: opts.phase, status: 'no-command', reason }, reason);
    return 2;
  }

  const testRunsDir = join(changeDir, 'test-runs');
  ensureDir(testRunsDir);
  let runId: string;
  let runDir: string;
  if (opts.runId !== undefined) {
    if (!isSafeRunId(opts.runId)) {
      emitError(opts.json, { change_id: changeId, status: 'error', reason: `invalid run id: ${opts.runId}` },
        `Invalid --run-id "${opts.runId}". Use letters, numbers, dot, dash, or underscore (no "..").`);
      return 2;
    }
    runId = opts.runId;
    runDir = join(testRunsDir, runId);
    // Atomic reservation: mkdir (no recursive) throws EEXIST if the run-id was
    // already used, so a shared run-id across phases cannot overwrite artifacts.
    try {
      mkdirSync(runDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        emitError(opts.json, { change_id: changeId, status: 'error', reason: `run id already exists: ${runId}` },
          `Run id "${runId}" already exists under specs/changes/${changeId}/test-runs/. Use a fresh --run-id or omit it.`);
        return 2;
      }
      throw e;
    }
  } else {
    ({ runId, runDir } = reserveGeneratedRunDir(testRunsDir));
  }

  const junitAbs = join(runDir, 'junit.xml');

  // Only a simple pytest invocation is rewritten; shell-composed commands run
  // verbatim so flags never land on the wrong segment.
  const pytest = isPytestCommand(opts.command) && !hasShellControl(opts.command);
  const executed = pytest ? augmentPytestCommand(opts.command, junitAbs) : opts.command;
  writeFileSync(join(runDir, 'command.txt'), `${executed}\n`, 'utf8');

  const runCwd = opts.cwd ? resolve(cwd, opts.cwd) : cwd;
  const stdoutPath = join(runDir, 'stdout.log');
  const stderrPath = join(runDir, 'stderr.log');
  const res = await runCommand(executed, {
    cwd: runCwd,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    timeoutMs: opts.timeoutMs,
    stdoutPath,
    stderrPath,
  });
  const duration = res.durationMs;
  // Bounded tails (full logs are already on disk via the streams above).
  const stdout = res.stdoutTail;
  const stderr = res.stderrTail;

  let status: RunStatus;
  if (res.timedOut) status = 'timeout';
  else if (res.spawnError) status = 'error';
  else if (res.exitCode === 0) status = 'passed';
  else status = 'failed';

  const junitExists = existsSync(junitAbs);
  const junitXml = junitExists ? safeRead(junitAbs) : null;

  let firstFailure: FirstFailure | null = null;
  if (status === 'timeout') firstFailure = { kind: 'timeout', message: `command exceeded timeout of ${opts.timeoutMs} ms` };
  else if (status === 'error') firstFailure = { kind: 'runner-error', message: res.spawnError?.message ?? 'failed to start command' };
  else if (status === 'failed') firstFailure = classifyFailure({ exitCode: res.exitCode, stdout, stderr, junitXml, command: executed });

  const rel = (p: string): string => relative(cwd, p).replace(/\\/g, '/');
  const artifacts: Record<string, string> = {
    summary: rel(join(runDir, 'summary.json')),
    stdout: rel(stdoutPath),
    stderr: rel(stderrPath),
  };
  if (junitExists) artifacts.junit = rel(junitAbs);

  const summary: RunSummary = {
    change_id: changeId,
    phase: opts.phase,
    status,
    exit_code: res.exitCode,
    command: executed,
    duration_ms: duration,
    first_failure: firstFailure,
    artifacts,
    next_action: nextAction(status, opts.phase),
  };
  writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  updateEvidence(changeDir, changeId, {
    phase: opts.phase,
    status: status === 'passed' ? 'passed' : 'failed',
    command: executed,
    summary: artifacts.summary,
    junit: junitExists ? artifacts.junit : undefined,
    requiredPhases: opts.requiredPhases,
  });

  if (opts.json) console.log(JSON.stringify(summary, null, 2));
  else report(summary, stdout, stderr);

  return status === 'passed' ? 0 : 1;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
