/**
 * Tests for `cdd-kit doctor --fix` enabling API conformance (P1-5).
 *
 * Plain `doctor` only *surfaces* that code-vs-contract drift detection is off
 * (informational, never trips --strict); `--fix` is the opt-in on-ramp that
 * flips it on — the switch the most-needy users would never throw themselves.
 * Enablement is gated on applicability (an API contract AND real source to drift
 * from it) so it never arms conformance on a contract-only repo.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let cwd: string;
let home: string;

/** Scaffold a repo, then add an API contract + a detectable stack. */
function setupRepo(opts: { withStack: boolean; conformance?: 'off' | 'on' | 'absent' }): void {
  const init = runCli(['init', '--local-only'], { cwd, home });
  if (init.status !== 0) throw new Error(`init failed: ${init.stderr}`);

  mkdirSync(join(cwd, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(cwd, 'contracts', 'api', 'api-contract.md'), '# API Contract\n\n| Method | Path |\n|---|---|\n| GET | /api/things |\n');

  if (opts.withStack) {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
  }

  // init scaffolds .cdd/conformance.json (disabled) from the shipped asset, so
  // start from a known state regardless of that default.
  const confPath = join(cwd, '.cdd', 'conformance.json');
  mkdirSync(join(cwd, '.cdd'), { recursive: true });
  if (opts.conformance === 'off') {
    writeFileSync(confPath, JSON.stringify({ enabled: false, apiPrefixes: ['/api'] }, null, 2) + '\n');
  } else if (opts.conformance === 'on') {
    writeFileSync(confPath, JSON.stringify({ enabled: true, apiPrefixes: ['/api'] }, null, 2) + '\n');
  } else if (opts.conformance === 'absent') {
    rmSync(confPath, { force: true });
  }
}

function conformanceEnabled(): boolean {
  const confPath = join(cwd, '.cdd', 'conformance.json');
  if (!existsSync(confPath)) return false;
  return JSON.parse(readFileSync(confPath, 'utf8')).enabled === true;
}

beforeEach(() => {
  cwd = makeTempDir('cdd-conf-fix-');
  home = makeTempDir('cdd-conf-fix-home-');
});

afterEach(() => {
  cleanupDir(cwd);
  cleanupDir(home);
});

describe('cdd-kit doctor --fix — API conformance enablement', () => {
  it('1: enables conformance when an API contract + source exist and it is off', () => {
    setupRepo({ withStack: true, conformance: 'off' });
    expect(conformanceEnabled()).toBe(false);

    const r = runCli(['doctor', '--fix'], { cwd, home });
    expect(r.stdout + r.stderr).toMatch(/enabled API conformance/i);
    expect(conformanceEnabled()).toBe(true);
  });

  it('2: seeds and enables conformance from the shipped default when no config exists', () => {
    setupRepo({ withStack: true, conformance: 'absent' });
    expect(existsSync(join(cwd, '.cdd', 'conformance.json'))).toBe(false);

    const r = runCli(['doctor', '--fix'], { cwd, home });
    expect(r.stdout + r.stderr).toMatch(/enabled API conformance/i);
    expect(conformanceEnabled()).toBe(true);
    // Seeded from the documented default, not a bare { enabled: true }.
    const cfg = JSON.parse(readFileSync(join(cwd, '.cdd', 'conformance.json'), 'utf8'));
    expect(cfg.checks).toBeDefined();
  });

  it('3: does NOT enable conformance when there is no detectable source (contract only)', () => {
    setupRepo({ withStack: false, conformance: 'off' });
    const r = runCli(['doctor', '--fix'], { cwd, home });
    expect(r.stdout + r.stderr).not.toMatch(/enabled API conformance/i);
    expect(conformanceEnabled()).toBe(false);
  });

  it('4: plain `doctor` (no --fix) only recommends, never enabling it', () => {
    setupRepo({ withStack: true, conformance: 'off' });
    const r = runCli(['doctor'], { cwd, home });
    expect(r.stdout + r.stderr).toMatch(/run `cdd-kit doctor --fix`/);
    expect(conformanceEnabled()).toBe(false);
  });

  it('5: an already-enabled conformance config is left untouched (no spurious fix)', () => {
    setupRepo({ withStack: true, conformance: 'on' });
    const r = runCli(['doctor', '--fix'], { cwd, home });
    expect(r.stdout + r.stderr).not.toMatch(/enabled API conformance/i);
    expect(conformanceEnabled()).toBe(true);
  });
});
