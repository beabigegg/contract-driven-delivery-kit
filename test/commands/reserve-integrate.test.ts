/**
 * CLI-level tests for the parallel fan-out/fan-in commands (ADR 0009):
 * `cdd-kit reserve` allocates distinct lanes, `cdd-kit integrate` reports the
 * contention matrix and exits 3 on genuine surface overlap.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import type { ReservationsFile } from '../../src/commands/parallel-shared.js';

function writeApiContract(root: string, version: string): void {
  const p = join(root, 'contracts', 'api');
  mkdirSync(p, { recursive: true });
  writeFileSync(
    join(p, 'api-contract.md'),
    `---\ncontract: api\nschema-version: ${version}\n---\n\n# API\n`,
    'utf8',
  );
}

function readLedger(root: string): ReservationsFile {
  return yaml.load(readFileSync(join(root, '.cdd', 'reservations.yml'), 'utf8')) as ReservationsFile;
}

describe('cdd-kit reserve / integrate', () => {
  let dir: string;
  let home: string;
  beforeEach(() => {
    dir = makeTempDir('reserve-');
    home = makeTempDir('reserve-home-');
    writeApiContract(dir, '1.2.0');
  });
  afterEach(() => { cleanupDir(dir); cleanupDir(home); });

  it('allocates distinct ascending lanes for two concurrent changes', () => {
    const a = runCli(['reserve', 'add-export', '--contract', 'api', '--bump', 'minor', '--surface', 'endpoints/export'], { cwd: dir, home });
    expect(a.status).toBe(0);
    const b = runCli(['reserve', 'refactor-auth', '--contract', 'api', '--bump', 'minor', '--surface', 'endpoints/login'], { cwd: dir, home });
    expect(b.status).toBe(0);

    const ledger = readLedger(dir);
    const tos = ledger.reservations.map(r => r.contracts.api?.to).sort();
    expect(tos).toEqual(['1.3.0', '1.4.0']);
  });

  it('re-reserving the same change is idempotent (no lane leapfrog)', () => {
    runCli(['reserve', 'x', '--contract', 'api', '--bump', 'minor'], { cwd: dir, home });
    runCli(['reserve', 'x', '--contract', 'api', '--bump', 'minor'], { cwd: dir, home });
    const ledger = readLedger(dir);
    expect(ledger.reservations).toHaveLength(1);
    expect(ledger.reservations[0].contracts.api?.to).toBe('1.3.0');
    expect(ledger.reservations[0]['changelog-fragment']).toBe('contracts/changelog.d/x.md');
  });

  it('integrate reports a safe merge order and exits 0 for disjoint surfaces', () => {
    runCli(['reserve', 'add-export', '--contract', 'api', '--surface', 'endpoints/export'], { cwd: dir, home });
    runCli(['reserve', 'refactor-auth', '--contract', 'api', '--surface', 'endpoints/login'], { cwd: dir, home });

    const r = runCli(['integrate', '--json'], { cwd: dir, home });
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.safe).toBe(true);
    expect(report.mergeOrder).toEqual(['add-export', 'refactor-auth']);
  });

  it('integrate exits 3 when two changes share a surface', () => {
    runCli(['reserve', 'a', '--contract', 'api', '--surface', 'endpoints/export'], { cwd: dir, home });
    runCli(['reserve', 'b', '--contract', 'api', '--surface', 'endpoints/export'], { cwd: dir, home });

    const r = runCli(['integrate', '--json'], { cwd: dir, home });
    expect(r.status).toBe(3);
    const report = JSON.parse(r.stdout);
    expect(report.safe).toBe(false);
    expect(report.surfaceCollisions).toHaveLength(1);
  });

  it('integrate exits 1 when no ledger exists', () => {
    const r = runCli(['integrate'], { cwd: dir, home });
    expect(r.status).toBe(1);
  });

  it('changelog build assembles fragments and --check detects drift', () => {
    const fragDir = join(dir, 'contracts', 'changelog.d');
    mkdirSync(fragDir, { recursive: true });
    writeFileSync(join(fragDir, 'add-export.md'), '- api: added POST /export', 'utf8');

    const build = runCli(['changelog', 'build'], { cwd: dir, home });
    expect(build.status).toBe(0);
    const cl = readFileSync(join(dir, 'contracts', 'CHANGELOG.md'), 'utf8');
    expect(cl).toContain('### add-export');
    expect(cl).toContain('POST /export');

    // in sync now
    const check1 = runCli(['changelog', 'build', '--check'], { cwd: dir, home });
    expect(check1.status).toBe(0);

    // introduce drift
    writeFileSync(join(fragDir, 'new.md'), '- api: another change', 'utf8');
    const check2 = runCli(['changelog', 'build', '--check'], { cwd: dir, home });
    expect(check2.status).toBe(3);
  });
});
