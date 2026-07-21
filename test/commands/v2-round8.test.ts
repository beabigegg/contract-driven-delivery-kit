/**
 * Four defects from the eighth review round on PR #69.
 *
 * 1. `validate_ci_gates.py` had its OWN governance reader — the FOURTH reader of
 *    `context-governance` — that the round-7 comment-strip sweep missed because
 *    that sweep enumerated by guessing filenames rather than grepping the field.
 *    A legal `context-governance: v2 # folded` read as v1, so the CI-gate
 *    validator checked a stale standalone `ci-gates.md` while the TS gate read
 *    the same file as v2.
 * 2/3. A schema-invalid-but-parseable `classification:` crashed `cdd-kit gate`
 *    with a raw TypeError — `'lane' in classification` on a scalar, and
 *    `.trim()` on a boolean `architecture-review-reason` — BEFORE the gate could
 *    print the schema errors it had already collected. The user saw a stack
 *    trace instead of "classification must be a mapping".
 * 4. `/cdd-new`'s fixback routing table claimed to be exhaustive but matched
 *    only the `missing or empty` plan-section message; a normal untouched v2
 *    scaffold emits the other two shapes, which routed nowhere.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';
import { enforceClassificationSubstance } from '../../src/commands/gate-artifacts.js';
import { readLane } from '../../src/commands/gate-evidence.js';
import { classificationObject } from '../../src/commands/gate-shared.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(REPO_ROOT, '.claude', 'skills', 'contract-driven-delivery', 'scripts');
const py = () => (spawnSync('python3', ['--version'], { stdio: 'pipe' }).status === 0 ? 'python3' : 'python');

let tmp: string;
beforeEach(() => { tmp = makeTempDir('cdd-v2-r8-'); });
afterEach(() => { cleanupDir(tmp); });

/** Write a v2 change dir with the given tasks.yml body; returns its path. */
function changeDir(tasksBody: string): string {
  const dir = join(tmp, 'specs', 'changes', 'c');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tasks.yml'), tasksBody, 'utf8');
  return dir;
}

describe('validate_ci_gates governance reader strips an inline comment — the 4th reader (codex round 8)', () => {
  it.runIf(hasPython())('a commented governance marker is read as v2, not v1', () => {
    const probe = `
import sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS.split('\\').join('/'))})
import tempfile, validate_ci_gates as g
from pathlib import Path
for line in ['context-governance: v2 # folded', 'context-governance: v2', "context-governance: 'v2' # q"]:
    d = Path(tempfile.mkdtemp()); (d/'tasks.yml').write_text(line+'\\n', encoding='utf-8')
    print('[%s]' % g._governance(d))
`;
    const r = spawnSync(py(), ['-c', probe], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    // All three spellings must resolve to the bare value; the discriminator is
    // that the UNFIXED reader returned `v2 # folded` for the first.
    expect(r.stdout.replace(/\r/g, '').trim().split('\n')).toEqual(['[v2]', '[v2]', '[v2]']);
  });

  it('the shared helper is the single source, not a re-typed strip', () => {
    // The round-7 fix retyped nothing; this one imports strip_inline_comment.
    // Anchoring the class: a 5th reader that regexes the field must reuse it too.
    expect(readFileSync(join(SCRIPTS, 'validate_ci_gates.py'), 'utf8'))
      .toMatch(/from applicability import strip_inline_comment/);
  });
});

describe('a schema-invalid classification does not crash the gate (codex round 8)', () => {
  // classificationObject is the one guard both crash sites now route through;
  // testing it directly pins the class, the two gate calls pin the sites.
  it('classificationObject returns null for a scalar, a list, and null', () => {
    expect(classificationObject({ classification: 'bug-fix' } as never)).toBeNull();
    expect(classificationObject({ classification: ['a'] } as never)).toBeNull();
    expect(classificationObject({ classification: null } as never)).toBeNull();
    expect(classificationObject(null)).toBeNull();
  });

  it('classificationObject returns the mapping unchanged when it IS one', () => {
    const c = { lane: 'bug-fix' as const };
    expect(classificationObject({ classification: c } as never)).toBe(c);
  });

  it('enforceClassificationSubstance does not throw on a scalar classification', () => {
    const dir = changeDir('context-governance: v2\nclassification: bug-fix\ntier: 2\n');
    const errors: string[] = [];
    expect(() => enforceClassificationSubstance(dir, { classification: 'bug-fix' } as never, errors)).not.toThrow();
  });

  it('enforceClassificationSubstance does not throw on a boolean architecture-review-reason', () => {
    // `false ?? ''` is `false`; `.trim()` on it threw. The reason is non-string,
    // so it counts as "no reason" and the required-reason error still fires.
    const dir = changeDir('context-governance: v2\ntier: 2\n');
    const tasks = { classification: { 'architecture-review': true, 'architecture-review-reason': false } } as never;
    const errors: string[] = [];
    expect(() => enforceClassificationSubstance(dir, tasks, errors)).not.toThrow();
    expect(errors.some(e => e.includes('architecture-review-reason'))).toBe(true);
  });

  it('readLane does not throw when classification is a scalar', () => {
    const dir = changeDir('context-governance: v2\nclassification: bug-fix\ntier: 2\n');
    expect(() => readLane(dir)).not.toThrow();
    expect(readLane(dir)).toBeNull();
  });

  it.runIf(hasPython())('the real gate reports the schema error instead of a stack trace', () => {
    // End to end: the observable difference is "must be object" on stderr vs a
    // `TypeError: Cannot use 'in' operator` stack trace.
    const dir = join(tmp, 'specs', 'changes', 'badclass');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tasks.yml'), 'change-id: badclass\nstatus: in-progress\ntier: 2\ncontext-governance: v2\nclassification: bug-fix\ntasks: []\n', 'utf8');
    writeFileSync(join(dir, 'change-request.md'), 'x\n', 'utf8');
    writeFileSync(join(dir, 'implementation-plan.md'), 'x\n', 'utf8');
    const r = spawnSync('node', [join(REPO_ROOT, 'dist', 'cli', 'index.js'), 'gate', 'badclass'], {
      cwd: tmp, encoding: 'utf8', env: { ...process.env, CI: '' },
    });
    const out = r.stdout + r.stderr;
    expect(out).not.toMatch(/TypeError|Cannot use 'in' operator|is not a function/);
    expect(out).toMatch(/classification must be object/);
  });
});

describe('cdd-new fixback routes every plan-section failure the gate emits (codex round 8)', () => {
  const skill = () => readFileSync(join(REPO_ROOT, '.claude', 'skills', 'cdd-new', 'SKILL.md'), 'utf8');

  it('the routing table names all three Test Plan messages the gate can emit', () => {
    const s = skill();
    // These three strings are exactly what v2PlanSectionFinding returns; the
    // table previously named only the first, so an untouched scaffold (which
    // emits the second) routed nowhere despite the "exhaustive" claim.
    expect(s).toContain('missing or empty "## Test Plan" section');
    expect(s).toContain('has no acceptance-criterion → test row');
    expect(s).toContain('still holds only the scaffold');
  });

  it('the CI Gates row names the scaffold-only message too', () => {
    const s = skill();
    // The fixback ROW specifically — keyed on its re-invocation seed, not just
    // any line mentioning `## CI Gates` (the artifact-ownership table has one).
    const ciRow = s.split('\n').find(l => l.includes('PREVIOUS CI GATE PLAN FAILED GATE'));
    expect(ciRow, 'CI Gates fixback routing row').toBeTruthy();
    expect(ciRow!).toContain('still holds only the scaffold');
  });
});
