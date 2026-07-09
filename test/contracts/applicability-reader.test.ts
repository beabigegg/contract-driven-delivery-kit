/**
 * Unit coverage for the shared Python `applicability.py` reader (ADR 0011,
 * IP-1). This is the SOLE pass/fail authority for the `applicability:
 * not-applicable` contract marker (design.md decision 2) — every semantic
 * validator imports `classify_file` from it. There is no pytest/unittest
 * harness in this repo, so — mirroring the existing convention
 * (test/cli/validate-response-shape.test.ts) — this spawns the script
 * directly via its tiny `__main__` CLI wrapper and asserts on the JSON it
 * prints, isolating the reader from the full `validate_contracts.py` loop.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '.claude', 'skills', 'contract-driven-delivery', 'scripts', 'applicability.py',
);

function python(): string {
  for (const cmd of ['python3', 'python']) {
    if (spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0) return cmd;
  }
  return 'python3';
}

interface Classification {
  status: 'applicable' | 'not-applicable' | 'invalid';
  reason: string | null;
  error: string | null;
}

function classify(contractPath: string): Classification {
  const r = spawnSync(python(), [SCRIPT, contractPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  if (r.status !== 0) {
    throw new Error(`applicability.py failed: ${r.stdout}\n${r.stderr}`);
  }
  return JSON.parse(r.stdout.trim());
}

function writeContract(dir: string, frontmatterLines: string[]): string {
  const path = join(dir, 'contract.md');
  const fm = ['---', ...frontmatterLines, '---'].join('\n');
  writeFileSync(path, `${fm}\n\n# Contract\n`, 'utf8');
  return path;
}

describe.skipIf(!hasPython())('applicability.py reader', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir('cdd-applicability-reader-');
  });

  afterEach(() => {
    cleanupDir(tmp);
  });

  // ── AC-2: fail-closed default ──────────────────────────────────────────────
  it('classifies an unmarked contract as applicable', () => {
    const path = writeContract(tmp, ['contract: api', 'schema-version: 0.1.0']);
    expect(classify(path)).toEqual({ status: 'applicable', reason: null, error: null });
  });

  it('classifies `applicability: applicable` as applicable', () => {
    const path = writeContract(tmp, ['contract: api', 'applicability: applicable']);
    expect(classify(path)).toEqual({ status: 'applicable', reason: null, error: null });
  });

  // ── AC-1: not-applicable + reason -> skip ──────────────────────────────────
  it('classifies not-applicable with a non-empty reason as not-applicable, carrying the reason', () => {
    const path = writeContract(tmp, [
      'contract: api',
      'applicability: not-applicable',
      'applicability-reason: CLI has no HTTP API surface',
    ]);
    expect(classify(path)).toEqual({
      status: 'not-applicable',
      reason: 'CLI has no HTTP API surface',
      error: null,
    });
  });

  it('strips surrounding quotes from a quoted reason', () => {
    const path = writeContract(tmp, [
      'contract: api',
      'applicability: not-applicable',
      'applicability-reason: "CLI has no HTTP API surface"',
    ]);
    expect(classify(path).reason).toBe('CLI has no HTTP API surface');
  });

  // ── AC-3: invalid — no reason / unknown value ──────────────────────────────
  it('flags not-applicable with a missing reason as invalid', () => {
    const path = writeContract(tmp, ['contract: api', 'applicability: not-applicable']);
    const result = classify(path);
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/applicability-reason/i);
  });

  it('flags not-applicable with an empty-string reason as invalid', () => {
    const path = writeContract(tmp, [
      'contract: api',
      'applicability: not-applicable',
      'applicability-reason: ""',
    ]);
    const result = classify(path);
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/applicability-reason/i);
  });

  it('flags an unrecognized applicability value as invalid', () => {
    const path = writeContract(tmp, [
      'contract: api',
      'applicability: not-applicable-typo',
      'applicability-reason: whatever',
    ]);
    const result = classify(path);
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/unrecognized applicability value/i);
  });
});
