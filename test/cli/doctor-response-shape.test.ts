/**
 * Tests for the `doctor` response-shape coverage finding (ADR 0007).
 *
 * The body-level data-shape gate is opt-in by adoption, so without a nudge it
 * stays dormant. doctor turns the gap into a mechanical signal an agent sees:
 * prose-only response cells warn (migrate), a typed schema + sample manifest
 * reports the gate as active.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

let repo: string;
let home: string;

function writeContract(body: string): void {
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), body, 'utf8');
}

/** A stack signal so doctor treats response-shape coverage as applicable. */
function writeStackSignal(): void {
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'app' }), 'utf8');
}

const PROSE_CONTRACT = `---
summary: API
schema-version: 1.0.0
---
# API

| method | path | auth | request schema | response schema | errors | tests |
|--------|------|------|----------------|-----------------|--------|-------|
| POST | /api/summary | public | - | success_response | - | yes |
`;

const TYPED_CONTRACT = `---
summary: API
schema-version: 1.0.0
---
# API

| method | path | auth | request schema | response schema | errors | tests |
|--------|------|------|----------------|-----------------|--------|-------|
| POST | /api/summary | public | - | Summary | - | yes |

## Schemas

### Summary

\`\`\`json-schema
{ "type": "object", "required": ["totalLots"], "properties": { "totalLots": { "type": "integer" } } }
\`\`\`
`;

beforeEach(() => {
  repo = makeTempDir('cdd-doctor-rshape-');
  home = makeTempDir('cdd-doctor-rshape-home-');
});

afterEach(() => {
  cleanupDir(repo);
  cleanupDir(home);
});

describe('cdd-kit doctor — response-shape coverage (ADR 0007)', () => {
  it('warns to migrate when response bodies are prose-only', () => {
    writeContract(PROSE_CONTRACT);
    writeStackSignal();
    const r = runCli(['doctor'], { cwd: repo, home });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/Response-shape:/);
    expect(out).toMatch(/0 with a typed response schema/);
  });

  it('warns when a typed schema exists but no sample manifest is present', () => {
    writeContract(TYPED_CONTRACT);
    writeStackSignal();
    const r = runCli(['doctor'], { cwd: repo, home });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/declare a typed response schema but tests\/contract\/response-samples\.json is absent/);
  });

  it('reports the gate as active when a typed schema and a sample manifest both exist', () => {
    writeContract(TYPED_CONTRACT);
    writeStackSignal();
    mkdirSync(join(repo, 'tests', 'contract'), { recursive: true });
    writeFileSync(join(repo, 'tests', 'contract', 'response-samples.json'),
      JSON.stringify({ 'POST /api/summary': 'samples/s.json' }), 'utf8');
    const r = runCli(['doctor'], { cwd: repo, home });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/the data-shape gate enforces response bodies/);
  });

  it('emits no response-shape finding when there is no API contract', () => {
    writeStackSignal();
    const r = runCli(['doctor'], { cwd: repo, home });
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/Response-shape:/);
  });
});
