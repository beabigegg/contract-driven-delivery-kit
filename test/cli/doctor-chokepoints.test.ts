/**
 * Tests for `cdd-kit doctor`'s chokepoint liveness dashboard.
 *
 * The kit's enforcement mechanisms are opt-in and dormant until armed, so a repo
 * can carry all the machinery yet enforce none of it. The dashboard makes that
 * observable: each chokepoint reports `live` or `dormant` with the command to
 * arm it. Findings are advisory (level 'ok') — dormant is a nudge, never a
 * `--strict` failure, since not every project wants every chokepoint.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let cwd: string;
let home: string;

function setupRepo(): void {
  // --no-arm gives the dormant baseline these tests assert against; arming is
  // the default now and is covered explicitly below.
  const r = runCli(['init', '--local-only', '--no-arm'], { cwd, home });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
}

beforeEach(() => {
  cwd = makeTempDir('cdd-chokepoints-');
  home = makeTempDir('cdd-chokepoints-home-');
});

afterEach(() => {
  cleanupDir(cwd);
  cleanupDir(home);
});

describe('cdd-kit doctor — chokepoint dashboard', () => {
  it('reports the graph-first hook as dormant on a fresh repo', () => {
    setupRepo();
    const r = runCli(['doctor'], { cwd, home });
    expect(r.stdout).toMatch(/chokepoint graph-first exploration hook:.*install-agent-hooks/);
  });

  it('arms the graph-first hook live by default (no --no-arm)', () => {
    const r0 = runCli(['init', '--local-only'], { cwd, home });
    expect(r0.status, r0.stderr).toBe(0);
    const r = runCli(['doctor'], { cwd, home });
    expect(r.stdout).toMatch(/chokepoint graph-first exploration hook: live/);
  });

  it('flips the graph-first hook to live once it is installed', () => {
    setupRepo();
    const install = runCli(['install-agent-hooks', '--graph-first', 'advisory'], { cwd, home });
    expect(install.status, install.stderr).toBe(0);
    const r = runCli(['doctor'], { cwd, home });
    expect(r.stdout).toMatch(/chokepoint graph-first exploration hook: live/);
  });

  it('reports the OpenAPI sync gate as live when a package.json script wires it', () => {
    setupRepo();
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { 'contract:client:check': 'cdd-kit openapi export --check --out openapi.json' } }, null, 2),
      'utf8',
    );
    const r = runCli(['doctor'], { cwd, home });
    expect(r.stdout).toMatch(/chokepoint OpenAPI sync gate: live/);
  });

  it('does not fail --strict on dormant chokepoints (advisory only)', () => {
    setupRepo();
    const r = runCli(['doctor', '--strict'], { cwd, home });
    // Dormant chokepoint lines must never be the error/warning that fails strict.
    expect(r.stdout).toMatch(/chokepoint pre-commit gate hook:/);
    expect(r.stdout).not.toMatch(/chokepoint .*: dormant.*\n.*\berror\b/i);
  });

  it('emits no chokepoint lines for a bare repo without .cdd', () => {
    mkdirSync(cwd, { recursive: true });
    const r = runCli(['doctor'], { cwd, home });
    expect(r.stdout).not.toContain('chokepoint ');
  });
});
