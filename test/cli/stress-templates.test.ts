import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

describe('cdd-kit init copies stress/soak runner templates', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-stress-repo-');
    tmpHome = makeTempDir('cdd-stress-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('copies stress runner examples (k6, locust, artillery)', () => {
    expect(existsSync(join(tmpRepo, 'tests/templates/stress/k6-example.js'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'tests/templates/stress/locust-example.py'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'tests/templates/stress/artillery-example.yml'))).toBe(true);
  });

  it('copies soak runner examples (k6, locust)', () => {
    expect(existsSync(join(tmpRepo, 'tests/templates/soak/k6-example.js'))).toBe(true);
    expect(existsSync(join(tmpRepo, 'tests/templates/soak/locust-example.py'))).toBe(true);
  });

  it('updated load-profile.md contains Runner Config section', () => {
    const content = readFileSync(join(tmpRepo, 'tests/templates/stress/load-profile.md'), 'utf8');
    expect(content).toMatch(/## Runner Config/);
    expect(content).toMatch(/runner: k6 \| locust \| artillery/);
    expect(content).toMatch(/pass criteria/i);
  });
});
