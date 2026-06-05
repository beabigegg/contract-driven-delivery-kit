/**
 * Behavioral tests for hooks/pre-tool-use-contract-write.sh (ADR 0004 §6, Stage 2).
 *
 * `install-agent-hooks --contract-write` only wires this script into
 * settings.json; the script itself is the chokepoint, so its routing decision and
 * advisory/strict exit codes are exercised here by executing it directly with a
 * tool-call payload on stdin. POSIX-sh only — skipped on Windows.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The SOURCE script (single source of truth; build.js copies it into assets/).
const HOOK = resolve(__dirname, '..', '..', 'hooks', 'pre-tool-use-contract-write.sh');
const CONTRACT_REL = 'contracts/api/api-contract.md';

let repo: string;

function writeContract(): void {
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  writeFileSync(join(repo, CONTRACT_REL), '# API Contract\n', 'utf8');
}

/** Run the hook with an Edit payload for `filePath`; returns exit status + stderr. */
function runHook(
  filePath: string,
  opts: { strict?: boolean } = {},
): { status: number | null; stderr: string } {
  const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
  const env = { ...process.env };
  if (opts.strict) env.CDD_CONTRACT_WRITE_STRICT = '1';
  else delete env.CDD_CONTRACT_WRITE_STRICT;
  const r = spawnSync('/bin/sh', [HOOK], { cwd: repo, input: payload, env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr ?? '' };
}

beforeEach(() => { repo = makeTempDir('cdd-cwhook-'); });
afterEach(() => { cleanupDir(repo); });

describe.skipIf(process.platform === 'win32')('pre-tool-use-contract-write.sh', () => {
  it('advisory: nudges toward `contract set` and ALLOWS the edit (exit 0)', () => {
    writeContract();
    const r = runHook(CONTRACT_REL);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/contract (endpoint |schema )?set/);
  });

  it('strict: BLOCKS the edit (exit 2) and feeds the routing reason back', () => {
    writeContract();
    const r = runHook(CONTRACT_REL, { strict: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/contract (endpoint |schema )?set/);
    expect(r.stderr).toMatch(/CDD_CONTRACT_WRITE_STRICT=0/);
  });

  it('matches an absolute path to the API contract', () => {
    writeContract();
    const r = runHook(join(repo, CONTRACT_REL), { strict: true });
    expect(r.status).toBe(2);
  });

  it('ignores source files even in strict mode', () => {
    writeContract();
    const r = runHook('src/server/orders.ts', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('ignores other contract files that have no `contract set` form (inventory)', () => {
    writeContract();
    const r = runHook('contracts/api/api-inventory.md', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('does not match a lookalike path outside the contract tree', () => {
    writeContract();
    const r = runHook('other-contracts/api/api-contract.md', { strict: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('does not block a first-time scaffold when the contract does not exist yet', () => {
    // No writeContract(): `contract set` requires the file to exist, so a Write
    // that creates it must be allowed even in strict mode.
    const r = runHook(CONTRACT_REL, { strict: true });
    expect(r.status).toBe(0);
  });

  it('allows when the payload carries no file_path', () => {
    writeContract();
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
    const r = spawnSync('/bin/sh', [HOOK], {
      cwd: repo,
      input: payload,
      env: { ...process.env, CDD_CONTRACT_WRITE_STRICT: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
