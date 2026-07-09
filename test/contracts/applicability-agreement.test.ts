/**
 * AC-6: TS `projectApplicability` (display-only projection, src/contracts/parser.ts)
 * and Python `applicability.py` (the sole pass/fail authority) must agree on
 * the classification for every fixture — the two must never diverge (design.md
 * decision 2). This is the guard against a second, silently-drifting authority.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeTempDir, cleanupDir, hasPython } from '../helpers.js';
import { stripFrontmatter, projectApplicability } from '../../src/contracts/parser.js';

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

function classifyPython(contractPath: string): { status: string; reason: string | null; error: string | null } {
  const r = spawnSync(python(), [SCRIPT, contractPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  if (r.status !== 0) throw new Error(`applicability.py failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

interface Fixture {
  name: string;
  frontmatterLines: string[];
}

const FIXTURES: Fixture[] = [
  { name: 'marked + reason', frontmatterLines: ['contract: api', 'applicability: not-applicable', 'applicability-reason: no HTTP API surface'] },
  { name: 'marked + quoted reason', frontmatterLines: ['contract: api', 'applicability: not-applicable', 'applicability-reason: "no HTTP API surface"'] },
  { name: 'marked + no reason', frontmatterLines: ['contract: api', 'applicability: not-applicable'] },
  { name: 'marked + empty-string reason', frontmatterLines: ['contract: api', 'applicability: not-applicable', 'applicability-reason: ""'] },
  { name: 'explicit applicable', frontmatterLines: ['contract: api', 'applicability: applicable'] },
  { name: 'unmarked', frontmatterLines: ['contract: api', 'schema-version: 0.1.0'] },
  { name: 'garbage value', frontmatterLines: ['contract: api', 'applicability: not-applicable-typo', 'applicability-reason: x'] },
];

describe.skipIf(!hasPython())('applicability: TS projection <-> Python reader agreement (AC-6)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir('cdd-applicability-agreement-');
  });

  afterEach(() => {
    cleanupDir(tmp);
  });

  for (const fixture of FIXTURES) {
    it(`agrees on: ${fixture.name}`, () => {
      const raw = ['---', ...fixture.frontmatterLines, '---', '', '# Contract', ''].join('\n');
      const path = join(tmp, 'contract.md');
      writeFileSync(path, raw, 'utf8');

      const { frontmatter } = stripFrontmatter(raw);
      const tsResult = projectApplicability(frontmatter);
      const pyResult = classifyPython(path);

      expect(tsResult.status).toBe(pyResult.status);
      expect(tsResult.reason ?? null).toBe(pyResult.reason);
      // Only assert both/neither error, not exact wording (the two messages are
      // independently authored but must agree on WHETHER it is an error).
      expect(!!tsResult.error).toBe(!!pyResult.error);
    });
  }
});
