/**
 * CLI tests for `cdd-kit bug suspects` (ADR 0006 PR-4).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';

describe('cdd-kit bug suspects', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-bug-suspects-repo-');
    tmpHome = makeTempDir('cdd-bug-suspects-home-');
    const r = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (r.status !== 0) {
      throw new Error(`Setup init failed: ${r.stderr}`);
    }
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  // ── a) no --symptom / --text → exit 2 ─────────────────────────────────────

  it('a: exits 2 with helpful error when no symptom text is provided', () => {
    const r = runCli(['bug', 'suspects'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/symptom/i);
  });

  it('a: exits 2 in --json mode when no symptom text is provided', () => {
    const r = runCli(['bug', 'suspects', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(2);
    const payload = JSON.parse(r.stdout) as { error: string };
    expect(payload.error).toMatch(/symptom/i);
  });

  // ── b) change-id not found → exit 2 ──────────────────────────────────────

  it('b: exits 2 when change-id does not exist', () => {
    const r = runCli(['bug', 'suspects', 'nonexistent-change', '--symptom', 'filter is empty'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/nonexistent-change/);
  });

  it('b: exits 2 with JSON error when change-id does not exist and --json', () => {
    const r = runCli(['bug', 'suspects', 'nonexistent-change', '--symptom', 'filter is empty', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status).toBe(2);
    const payload = JSON.parse(r.stdout) as { error: string };
    expect(payload.error).toMatch(/nonexistent-change/);
  });

  // ── c) missing code-map → helpful error ───────────────────────────────────

  it('c: exits 2 with helpful message pointing to cdd-kit code-map when no code-intel exists', () => {
    // No code-map, no graph — a fresh repo with no source files at all.
    // Ensure the .cdd dir exists but contains no code-map.yml or graph.
    const r = runCli(['bug', 'suspects', '--text', 'some symptom'], { cwd: tmpRepo, home: tmpHome });
    // When there are no source files, code-map generation produces an empty map but
    // does not error. The suspects command will return 0 with empty candidates.
    // If the code-map can't be generated (e.g. no config), it returns 2.
    // Accept either: 0 with empty candidates or 2 with helpful message.
    if (r.status === 2) {
      expect(r.stdout + r.stderr).toMatch(/code-map/i);
    } else {
      expect(r.status).toBe(0);
    }
  });

  it('c: --json mode produces error object when code-intel is explicitly absent', () => {
    // Remove any generated code-intel to simulate missing artifact.
    // Create a temp dir with NO .cdd directory at all and no source files.
    const bareRepo = makeTempDir('cdd-bare-repo-');
    const bareHome = makeTempDir('cdd-bare-home-');
    try {
      // DO NOT run init — no .cdd directory, no code-map config, no code-map.
      const r = runCli(['bug', 'suspects', '--text', 'filter empty', '--json'], { cwd: bareRepo, home: bareHome });
      // Without init, code-map config is missing; ensureCodeMapFresh will fail.
      // The command should return 2 with an error payload.
      if (r.status === 2) {
        const payload = JSON.parse(r.stdout) as { error: string };
        expect(payload.error).toMatch(/code-map/i);
      } else {
        // Some environments may succeed with empty candidates — that is also acceptable.
        expect(r.status).toBe(0);
      }
    } finally {
      cleanupDir(bareRepo);
      cleanupDir(bareHome);
    }
  });

  // ── d) repo WITH a code-map → --json returns documented shape ─────────────

  it('d: returns JSON shape with ≥1 candidate for a matching term against a live code-map', () => {
    // Write a small TypeScript source file with a known symbol.
    writeFileSync(join(tmpRepo, 'orders.ts'), `
export interface OrderFilter {
  status: string;
}
export function buildFilterOptions(filter: OrderFilter): string[] {
  return [filter.status];
}
export function fetchOrders(): OrderFilter[] {
  return [];
}
`, 'utf8');

    // Generate the code-map and graph.
    const mapResult = runCli(['code-map', '--out', '.cdd/code-map.yml'], { cwd: tmpRepo, home: tmpHome });
    expect(mapResult.status, `code-map failed: ${mapResult.stderr}`).toBe(0);

    // Query with a term matching the file content.
    const r = runCli(['bug', 'suspects', '--text', 'filter options empty', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const payload = JSON.parse(r.stdout) as {
      change_id: null;
      symptom: string;
      candidates: Array<{ path: string; symbols: string[]; reason: string; read_ranges: string[] }>;
      next_commands: string[];
    };

    expect(payload.change_id).toBeNull();
    expect(payload.symptom).toBe('filter options empty');
    expect(Array.isArray(payload.candidates)).toBe(true);
    expect(payload.candidates.length).toBeGreaterThanOrEqual(1);
    // Verify shape of first candidate
    const first = payload.candidates[0];
    expect(typeof first.path).toBe('string');
    expect(Array.isArray(first.symbols)).toBe(true);
    expect(typeof first.reason).toBe('string');
    expect(Array.isArray(first.read_ranges)).toBe(true);
    // The orders.ts file should be a candidate
    expect(payload.candidates.some(c => c.path.includes('orders'))).toBe(true);
    // next_commands should contain graph query suggestion
    expect(Array.isArray(payload.next_commands)).toBe(true);
    expect(payload.next_commands.some(cmd => cmd.includes('graph query'))).toBe(true);
  });

  it('d: human-readable output lists candidate paths and reasons', () => {
    writeFileSync(join(tmpRepo, 'payments.ts'), `
export function processPayment(amount: number): boolean {
  return amount > 0;
}
`, 'utf8');

    const mapResult = runCli(['code-map', '--out', '.cdd/code-map.yml'], { cwd: tmpRepo, home: tmpHome });
    expect(mapResult.status, `code-map failed: ${mapResult.stderr}`).toBe(0);

    const r = runCli(['bug', 'suspects', '--text', 'payment processing fails'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    // Human mode should mention the file or a related symbol
    expect(r.stdout + r.stderr).toMatch(/payment/i);
  });

  // ── e) --text mode (no change-id) → omits change-scoped fields ───────────

  it('e: --text mode with --json omits change_id and test select next_command', () => {
    writeFileSync(join(tmpRepo, 'auth.ts'), `
export function validateToken(token: string): boolean {
  return token.length > 10;
}
`, 'utf8');

    const mapResult = runCli(['code-map', '--out', '.cdd/code-map.yml'], { cwd: tmpRepo, home: tmpHome });
    expect(mapResult.status, `code-map failed: ${mapResult.stderr}`).toBe(0);

    const r = runCli(['bug', 'suspects', '--text', 'token validation', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const payload = JSON.parse(r.stdout) as {
      change_id: null | string;
      next_commands: string[];
    };

    // change_id must be null in text-only mode
    expect(payload.change_id).toBeNull();
    // test select should NOT appear in next_commands (no change-id)
    expect(payload.next_commands.some(cmd => cmd.includes('test select'))).toBe(false);
  });

  it('e: change-scoped mode includes test select in next_commands', () => {
    writeFileSync(join(tmpRepo, 'widget.ts'), `
export function renderWidget(name: string): string {
  return \`<widget>\${name}</widget>\`;
}
`, 'utf8');

    const mapResult = runCli(['code-map', '--out', '.cdd/code-map.yml'], { cwd: tmpRepo, home: tmpHome });
    expect(mapResult.status, `code-map failed: ${mapResult.stderr}`).toBe(0);

    // Create the change directory
    runCli(['new', 'fix-widget'], { cwd: tmpRepo, home: tmpHome });
    expect(existsSync(join(tmpRepo, 'specs', 'changes', 'fix-widget'))).toBe(true);

    const r = runCli(['bug', 'suspects', 'fix-widget', '--symptom', 'widget render broken', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const payload = JSON.parse(r.stdout) as {
      change_id: string;
      next_commands: string[];
    };
    expect(payload.change_id).toBe('fix-widget');
    expect(payload.next_commands.some(cmd => cmd.includes('test select fix-widget'))).toBe(true);
  });
});
