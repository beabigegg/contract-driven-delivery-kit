/**
 * 4.1.0 hook-lifecycle and stamp fixes, found by the registry 3.6.0 -> 4.0.0
 * adopter rehearsal (#71, #72, #73).
 *
 * The rehearsal proved three ways an adopter's install silently rots:
 *  - #71a: no refresh step ever updated `.claude/hooks/*.sh`, so an installed
 *    hook stayed at whatever version wrote it — security fixes included.
 *  - #71b: `install-agent-hooks` (the advertised remedy) clobbered a locally
 *    modified hook with no backup, while reconcile/refresh preserve it.
 *  - #72: the behaviour-change report's HEADER re-read the manifest refresh
 *    had just stamped, claiming `current -> current` on the very first report.
 *  - #73: init's in-place fast-gate patch rewrote the workflow AFTER refresh
 *    stamped the shipped text, so doctor flagged it as hand-modified forever
 *    and the classifier would freeze it on the next upgrade.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { runCli, makeTempDir, cleanupDir } from '../helpers.js';
import { sha256OfFileNormalized } from '../../src/utils/digest.js';
import { makeGuardedWrite } from '../../src/reconcile/guard.js';
import { behaviorReportReconciler, REPORT_REL } from '../../src/reconcile/reconcilers/behavior-report.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIPPED_GRAPH_FIRST = join(REPO_ROOT, 'assets', 'hooks', 'pre-tool-use-graph-first.sh');
const SHIPPED_WORKFLOW = join(REPO_ROOT, 'assets', 'github-workflows', 'contract-driven-gates.yml');
const HOOK_REL = '.claude/hooks/pre-tool-use-graph-first.sh';

let repo: string;
let home: string;
beforeEach(() => { repo = makeTempDir('cdd-hooklife-'); home = makeTempDir('cdd-hooklife-home-'); });
afterEach(() => { cleanupDir(repo); cleanupDir(home); });

function writeHook(content: string): string {
  const dest = join(repo, HOOK_REL);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content, 'utf8');
  return dest;
}

function stampHook(digest: string, version = '3.9.0'): void {
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  writeFileSync(
    join(repo, '.cdd', 'asset-manifest.json'),
    `${JSON.stringify({ [HOOK_REL]: { version, digest } }, null, 2)}\n`,
    'utf8',
  );
}

function refreshArgs(): string[] {
  return ['refresh', '--yes', '--no-update', '--no-upgrade', '--no-code-map'];
}

function backupCopies(): string[] {
  const root = join(repo, '.cdd', '.refresh-backup');
  if (!existsSync(root)) return [];
  return readdirSync(root).map(ts => join(root, ts, HOOK_REL)).filter(p => existsSync(p));
}

describe('#71a refresh maintains .claude/hooks (digest-proven unmodified only)', () => {
  it('updates a stamped, unmodified hook to the shipped version, backup first', () => {
    const old = '#!/bin/sh\n# old shipped revision\nexit 0\n';
    const dest = writeHook(old);
    stampHook(sha256OfFileNormalized(dest));

    const r = runCli(refreshArgs(), { cwd: repo, home });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/hook updated/);

    const shipped = readFileSync(SHIPPED_GRAPH_FIRST, 'utf8');
    expect(readFileSync(dest, 'utf8')).toBe(shipped);

    const backups = backupCopies();
    expect(backups.length).toBe(1);
    expect(readFileSync(backups[0], 'utf8')).toBe(old);

    const manifest = JSON.parse(readFileSync(join(repo, '.cdd', 'asset-manifest.json'), 'utf8'));
    expect(manifest[HOOK_REL].digest).toBe(sha256OfFileNormalized(dest));
  });

  it('keeps a locally modified hook (stamp mismatch) byte-for-byte', () => {
    const modified = '#!/bin/sh\n# adopter local tweak\nexit 0\n';
    const dest = writeHook(modified);
    stampHook('0'.repeat(64)); // stamp says something else wrote it originally

    const r = runCli(refreshArgs(), { cwd: repo, home });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/locally modified — kept/);
    expect(readFileSync(dest, 'utf8')).toBe(modified);
    expect(backupCopies()).toEqual([]);
  });

  it('announces a pre-stamp (unmanaged) hook on stderr and does not touch it', () => {
    const preMarker = '#!/bin/sh\n# 3.6.0-era install, never stamped\nexit 0\n';
    const dest = writeHook(preMarker);
    // no asset-manifest at all — the 3.6.0 world

    const r = runCli(refreshArgs(), { cwd: repo, home });
    expect(r.status).toBe(0);
    // In this CLI log.warn goes to STDOUT (log.error owns stderr) — assert the
    // stream it actually uses, not the one that feels right.
    expect(r.stdout).toMatch(/predate install stamping/);
    expect(r.stdout).toMatch(/install-agent-hooks/);
    expect(readFileSync(dest, 'utf8')).toBe(preMarker);
  });

  it('never installs a hook that is not present (hooks stay opt-in)', () => {
    const r = runCli(refreshArgs(), { cwd: repo, home });
    expect(r.status).toBe(0);
    expect(existsSync(join(repo, HOOK_REL))).toBe(false);
  });
});

describe('#71b install-agent-hooks backs up a differing existing hook', () => {
  it('backs up the previous copy and says where it went', () => {
    const custom = '#!/bin/sh\n# my precious local edit\nexit 0\n';
    const dest = writeHook(custom);

    const r = runCli(['install-agent-hooks', '--graph-first', 'advisory'], { cwd: repo, home });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/backed up to/);

    expect(readFileSync(dest, 'utf8')).toBe(readFileSync(SHIPPED_GRAPH_FIRST, 'utf8'));
    const backups = backupCopies();
    expect(backups.length).toBe(1);
    expect(readFileSync(backups[0], 'utf8')).toBe(custom);
  });

  it('writes no backup and no warning when the existing hook is already the shipped one', () => {
    writeHook(readFileSync(SHIPPED_GRAPH_FIRST, 'utf8'));

    const r = runCli(['install-agent-hooks', '--graph-first', 'advisory'], { cwd: repo, home });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/backed up to/);
    expect(backupCopies()).toEqual([]);
  });
});

describe('#72 behaviour-report header honours the pre-refresh capture', () => {
  it('a captured null prints (unknown ...), never the freshly stamped version', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    // Simulate the post-refresh world the reconciler actually runs in: the
    // manifest ALREADY carries the new version by the time apply() executes.
    writeFileSync(
      join(repo, '.cdd', 'asset-manifest.json'),
      `${JSON.stringify({ 'x.md': { version: '9.9.9', digest: 'd' } })}\n`,
      'utf8',
    );
    const res = behaviorReportReconciler.apply({ cwd: repo, previousKitVersion: null }, makeGuardedWrite(repo));
    expect(res.applied).toBe(true);
    const report = readFileSync(join(repo, REPORT_REL), 'utf8');
    expect(report).toMatch(/last installed here: \(unknown/);
    expect(report).not.toMatch(/last installed here: 9\.9\.9/);
  });

  it('an ABSENT capture still falls back to reading the manifest', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(
      join(repo, '.cdd', 'asset-manifest.json'),
      `${JSON.stringify({ 'x.md': { version: '9.9.9', digest: 'd' } })}\n`,
      'utf8',
    );
    behaviorReportReconciler.apply({ cwd: repo }, makeGuardedWrite(repo));
    const report = readFileSync(join(repo, REPORT_REL), 'utf8');
    expect(report).toMatch(/last installed here: 9\.9\.9/);
  });
});

describe('#73 init re-stamps the workflow it just patched', () => {
  it('manifest digest equals the PATCHED on-disk bytes, not the shipped text', () => {
    spawnSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    // An npm stack so init detects something and the fast-gate patch fires.
    writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"1.0.0"}\n', 'utf8');
    // The workflow as refresh would have left it: shipped text + its stamp.
    const wfDest = join(repo, '.github', 'workflows', 'contract-driven-gates.yml');
    mkdirSync(dirname(wfDest), { recursive: true });
    writeFileSync(wfDest, readFileSync(SHIPPED_WORKFLOW, 'utf8'), 'utf8');
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(
      join(repo, '.cdd', 'asset-manifest.json'),
      `${JSON.stringify({ '.github/workflows/contract-driven-gates.yml': { version: '4.0.0', digest: sha256OfFileNormalized(wfDest) } }, null, 2)}\n`,
      'utf8',
    );

    const r = runCli(['init', '--hooks', '--no-arm'], { cwd: repo, home });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);

    // The patch must actually have fired, or this test proves nothing.
    const onDisk = readFileSync(wfDest, 'utf8');
    expect(sha256OfFileNormalized(wfDest)).not.toBe(sha256OfFileNormalized(SHIPPED_WORKFLOW));
    expect(onDisk).not.toMatch(/\{\{cdd-kit-version\}\}/);

    const manifest = JSON.parse(readFileSync(join(repo, '.cdd', 'asset-manifest.json'), 'utf8'));
    expect(manifest['.github/workflows/contract-driven-gates.yml'].digest).toBe(sha256OfFileNormalized(wfDest));

    // And doctor treats the patched (merge-written) workflow as healthy: the
    // packaged-staleness comparison must not fire on a file whose bytes are
    // SUPPOSED to differ from the shipped asset forever.
    const doc = runCli(['doctor'], { cwd: repo, home });
    expect(doc.stdout + doc.stderr).not.toMatch(/asset-manifest: \.github\/workflows/);
  });
});
