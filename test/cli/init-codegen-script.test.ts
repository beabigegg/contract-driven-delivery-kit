/**
 * Tests for the contract→client codegen wiring added by `cdd-kit init`.
 *
 * The OpenAPI seam (ADR-0001) leaves client codegen to the consumer repo. To
 * keep that consumer half from being mere prose, init materializes it as two
 * editable npm scripts when a package.json is present:
 *   contract:client        regenerate the OpenAPI artifact + typed client
 *   contract:client:check  the sync gate (`openapi export --check`)
 * It must be additive, idempotent, and must never clobber existing scripts.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

let repo: string;
let home: string;

function pkg(): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
}

beforeEach(() => {
  repo = makeTempDir('cdd-init-codegen-');
  home = makeTempDir('cdd-init-codegen-home-');
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit init — contract:client codegen wiring', () => {
  it('adds contract:client and contract:client:check when a package.json exists', () => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'app', scripts: { build: 'tsc' } }, null, 2) + '\n', 'utf8');
    const r = runCli(['init', '--local-only'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    const scripts = pkg().scripts ?? {};
    expect(scripts.build).toBe('tsc'); // existing script preserved
    expect(scripts['contract:client']).toContain('cdd-kit openapi export --out');
    expect(scripts['contract:client:check']).toContain('openapi export --check');
  });

  it('is idempotent and never clobbers an existing contract:client script', () => {
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { 'contract:client': 'my-custom-codegen' } }, null, 2) + '\n',
      'utf8',
    );
    const r = runCli(['init', '--local-only'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);

    const scripts = pkg().scripts ?? {};
    // User's wiring is sacred — left exactly as-is, and no check-script injected.
    expect(scripts['contract:client']).toBe('my-custom-codegen');
    expect(scripts['contract:client:check']).toBeUndefined();
  });

  it('does not fail init when there is no package.json (non-JS backend)', () => {
    const r = runCli(['init', '--local-only'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
  });
});
