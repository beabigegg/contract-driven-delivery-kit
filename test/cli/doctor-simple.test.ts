/**
 * Tests for `cdd-kit doctor --simple` (P1-2) — the plain-language health view.
 *
 * The simple view collapses every passing check into one line and leads with a
 * one-word verdict plus a single "what to do next", so a non-engineer can answer
 * "is this OK, and what now?" without reading the full technical finding list.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let cwd: string;
let home: string;

beforeEach(() => {
  cwd = makeTempDir('cdd-doctor-simple-');
  home = makeTempDir('cdd-doctor-simple-home-');
});

afterEach(() => {
  cleanupDir(cwd);
  cleanupDir(home);
});

describe('cdd-kit doctor --simple', () => {
  it('1: renders the plain view, collapsing passing checks and ending with a single next step', () => {
    const init = runCli(['init', '--local-only'], { cwd, home });
    expect(init.status, init.stderr).toBe(0);

    const r = runCli(['doctor', '--simple'], { cwd, home });
    const out = r.stdout + r.stderr;

    // Plain-view header replaces the verbose technical dump.
    expect(out).toMatch(/health — plain view/i);
    expect(out).not.toMatch(/Doctor provider:/); // the full-view header must be absent
    // Passing checks are collapsed into one count line, not listed individually.
    expect(out).toMatch(/\d+ checks? passed/);
    // Always a single-line verdict and a single next step.
    expect(out).toMatch(/Result:/);
    expect(out).toMatch(/Next:/);
  });

  it('2: a fresh repo with no context indexes routes the user to `doctor --fix`', () => {
    runCli(['init', '--local-only'], { cwd, home });
    // No context-scan was run, so there is at least one warning.
    const r = runCli(['doctor', '--simple'], { cwd, home });
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/need.*attention/i);
    expect(out).toMatch(/cdd-kit doctor --fix/);
  });

  it('3: --simple still exits non-zero under --strict when there are warnings', () => {
    runCli(['init', '--local-only'], { cwd, home });
    const r = runCli(['doctor', '--simple', '--strict'], { cwd, home });
    expect(r.status).not.toBe(0);
  });
});
