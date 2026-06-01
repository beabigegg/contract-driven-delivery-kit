/**
 * Tests for `cdd-kit openapi export --check` — the OpenAPI sync gate.
 *
 * `--check` does not write. It verifies that the committed artifact at --out
 * still equals what the contract currently produces, exiting non-zero on drift.
 * This is the kit-owned half of the preventive chain: it guarantees the OpenAPI
 * artifact the consumer generates a typed client from is never silently stale
 * against the contract (the single source of truth).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let repo: string;
let home: string;

const CONTRACT_REL = join('contracts', 'api', 'api-contract.md');
const ARTIFACT_REL = join('contracts', 'api', 'openapi.json');

function writeContract(rows: string[]): void {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(
    join(repo, CONTRACT_REL),
    `---\ncontract: api\nsummary: Test API\nschema-version: 1.0.0\n---\n\n# API Contract\n\n## Endpoint Requirements\n${table}\n`,
    'utf8',
  );
}

beforeEach(() => {
  repo = makeTempDir('cdd-openapi-check-');
  home = makeTempDir('cdd-openapi-check-home-');
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit openapi export --check', () => {
  it('passes when the committed artifact matches the contract', () => {
    writeContract(['| GET | /api/users | required | - | User[] | 401 | yes |']);
    const gen = runCli(['openapi', 'export', '--out', ARTIFACT_REL], { cwd: repo, home });
    expect(gen.status, gen.stderr).toBe(0);
    expect(existsSync(join(repo, ARTIFACT_REL))).toBe(true);

    const check = runCli(['openapi', 'export', '--check', '--out', ARTIFACT_REL], { cwd: repo, home });
    expect(check.status, check.stdout + check.stderr).toBe(0);
    expect(check.stdout + check.stderr).toContain('in sync');
  });

  it('fails when the contract changed but the artifact was not regenerated', () => {
    writeContract(['| GET | /api/users | required | - | User[] | 401 | yes |']);
    runCli(['openapi', 'export', '--out', ARTIFACT_REL], { cwd: repo, home });

    // Drift: add an endpoint to the contract without regenerating the artifact.
    writeContract([
      '| GET | /api/users | required | - | User[] | 401 | yes |',
      '| POST | /api/users | admin | CreateUser | User | 400 | yes |',
    ]);
    const check = runCli(['openapi', 'export', '--check', '--out', ARTIFACT_REL], { cwd: repo, home });
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toMatch(/out of sync/i);
  });

  it('fails when the artifact does not exist yet', () => {
    writeContract(['| GET | /api/users | required | - | User[] | 401 | yes |']);
    const check = runCli(['openapi', 'export', '--check', '--out', ARTIFACT_REL], { cwd: repo, home });
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toMatch(/does not exist/i);
  });

  it('errors when --check is given without --out', () => {
    writeContract(['| GET | /api/users | required | - | User[] | 401 | yes |']);
    const check = runCli(['openapi', 'export', '--check'], { cwd: repo, home });
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toMatch(/requires --out/i);
  });

  it('round-trips YAML artifacts under --check', () => {
    writeContract(['| GET | /api/ping | none | - | Pong | - | yes |']);
    const out = 'contracts/api/openapi.yaml';
    runCli(['openapi', 'export', '--yaml', '--out', out], { cwd: repo, home });
    const check = runCli(['openapi', 'export', '--check', '--yaml', '--out', out], { cwd: repo, home });
    expect(check.status, check.stdout + check.stderr).toBe(0);
    // sanity: it really wrote YAML, not JSON
    expect(readFileSync(join(repo, out), 'utf8')).toMatch(/^openapi:/m);
  });
});
