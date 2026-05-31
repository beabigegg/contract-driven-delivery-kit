/**
 * Tests for the code-vs-contract API conformance validator
 * (.claude/skills/contract-driven-delivery/scripts/validate_api_conformance.py).
 *
 * This is the mechanical net that catches frontend/backend drift against
 * contracts/api/api-contract.md — the gap the markdown-only validators leave
 * open. The validator is invoked directly here to isolate it from the rest of
 * the contract chain.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '.claude', 'skills', 'contract-driven-delivery', 'scripts', 'validate_api_conformance.py',
);

function python(): string {
  for (const cmd of ['python3', 'python']) {
    if (spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0) return cmd;
  }
  return 'python3';
}

function run(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(python(), [SCRIPT], { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function writeApiContract(repo: string, rows: string[]): void {
  const table = [
    '| method | path | auth | request schema | response schema | errors | tests |',
    '|--------|------|------|----------------|-----------------|--------|-------|',
    ...rows,
  ].join('\n');
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'),
    `---\ncontract: api\n---\n\n# API Contract\n\n## Endpoints\n${table}\n`, 'utf8');
}

function writeConfig(repo: string, cfg: Record<string, unknown>): void {
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  writeFileSync(join(repo, '.cdd', 'conformance.json'), JSON.stringify(cfg), 'utf8');
}

function writeSrc(repo: string, rel: string, content: string): void {
  const full = join(repo, 'src', rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

const ENABLED = { enabled: true, apiPrefixes: ['/api'], sourceRoots: ['src'] };

let repo: string;
beforeEach(() => { repo = makeTempDir('conformance-'); });
afterEach(() => cleanupDir(repo));

describe('validate_api_conformance.py', () => {
  it('skips when no config is present (never breaks repos that opt out)', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    const r = run(repo);
    expect(r.status).toBe(0);
    expect(r.out).toContain('skipped (no .cdd/conformance.json');
  });

  it('skips when config is present but disabled', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, { enabled: false });
    const r = run(repo);
    expect(r.status).toBe(0);
    expect(r.out).toContain('enabled": false');
  });

  it('passes when backend routes and frontend calls all match the contract', () => {
    if (!hasPython()) return;
    writeApiContract(repo, [
      '| GET | /api/users | required | - | User[] | 401 | yes |',
      '| POST | /api/users | required | User | User | 400 | yes |',
    ]);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js',
      "app.get('/api/users', h);\napp.post('/api/users', h);\n");
    writeSrc(repo, 'web/api.js',
      "axios.get('/api/users');\naxios.post('/api/users', body);\n");
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('fails when the frontend calls a path that is not in the contract', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\n");
    writeSrc(repo, 'web/api.js', "axios.get('/api/orders');\n");
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('frontend calls');
    expect(r.out).toContain('/api/orders');
  });

  it('fails when a backend route is missing from the contract', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users | required | - | User[] | 401 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\napp.delete('/api/secret', h);\n");
    const r = run(repo);
    expect(r.status).toBe(1);
    expect(r.out).toContain('backend route DELETE /api/secret');
  });

  it('normalizes route params so :id, {id} and ${id} compare equal', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/users/{id} | required | - | User | 404 | yes |']);
    writeConfig(repo, ENABLED);
    writeSrc(repo, 'server/routes.js', "app.get('/api/users/:id', h);\n");
    writeSrc(repo, 'web/api.js', 'axios.get(`/api/users/${userId}`);\n');
    const r = run(repo);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('API conformance validation passed.');
  });

  it('treats unimplemented contract endpoints as warning by default, error under strict', () => {
    if (!hasPython()) return;
    writeApiContract(repo, ['| GET | /api/ghost | required | - | X | 404 | yes |']);
    // No backend route for /api/ghost.
    writeConfig(repo, { ...ENABLED });
    writeSrc(repo, 'server/routes.js', "app.get('/api/users', h);\n");
    const lenient = run(repo);
    // /api/users is an undocumented backend route -> that already errors; isolate
    // the unimplemented check by documenting /api/users too.
    writeApiContract(repo, [
      '| GET | /api/ghost | required | - | X | 404 | yes |',
      '| GET | /api/users | required | - | User[] | 401 | yes |',
    ]);
    const lenient2 = run(repo);
    expect(lenient2.status, lenient2.out).toBe(0);
    expect(lenient2.out).toContain('has no backend route');

    writeConfig(repo, { ...ENABLED, strict: true });
    const strict = run(repo);
    expect(strict.status).toBe(1);
    void lenient;
  });
});
