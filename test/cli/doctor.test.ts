import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';
import { sha256OfFileNormalized } from '../../src/utils/digest.js';

describe('cdd-kit doctor', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-doctor-repo-');
    tmpHome = makeTempDir('cdd-doctor-home-');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  it('reports missing repo-level files and fails in strict mode', () => {
    const r = runCli(['doctor', '--strict'], { cwd: tmpRepo, home: tmpHome });

    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contracts is missing/i);
    expect(r.stdout + r.stderr).toMatch(/doctor failed in strict mode/i);
  });

  it('completes after init and context-scan while warning about unarmed automation nets', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const scan = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(scan.status, scan.stderr).toBe(0);

    // Point the MCP check at an absent Claude CLI so it stays informational
    // ('could not verify') regardless of whether `claude` is installed on the
    // host — otherwise a real `claude` reporting cdd-kit unregistered would add
    // a (legitimate) warning and mask the health-pass this test asserts.
    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/doctor completed with \d+ warning/i);
    expect(r.stdout + r.stderr).toMatch(/chokepoint contract-write hook: dormant/i);
    expect(r.stdout + r.stderr).toMatch(/chokepoint acceptance-write hook: dormant/i);
  });

  it('reports the acceptance-write hook as live once armed (ADR 0010 SS3.2)', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const arm = runCli(['install-agent-hooks', '--acceptance-write', 'strict'], { cwd: tmpRepo, home: tmpHome });
    expect(arm.status, arm.stderr).toBe(0);

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
    expect(r.stdout + r.stderr).toMatch(/chokepoint acceptance-write hook: live/i);
    expect(r.stdout + r.stderr).not.toMatch(/chokepoint acceptance-write hook: dormant/i);
  });

  // ── asset-manifest digest stamping + drift (ADR 0010 SS6 / design.md Q3, AC-8) ──

  it('reports no asset-manifest drift right after a clean install-agent-hooks arm', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const arm = runCli(['install-agent-hooks', '--acceptance-write', 'advisory'], { cwd: tmpRepo, home: tmpHome });
    expect(arm.status, arm.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd', 'asset-manifest.json'))).toBe(true);

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
    expect(r.stdout + r.stderr).not.toMatch(/asset-manifest:/i);
  });

  it('reports drift when an installed asset is hand-edited after install (partial/hand-edited copy)', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const arm = runCli(['install-agent-hooks', '--acceptance-write', 'advisory'], { cwd: tmpRepo, home: tmpHome });
    expect(arm.status, arm.stderr).toBe(0);

    const hookPath = join(tmpRepo, '.claude', 'hooks', 'pre-tool-use-acceptance-write.sh');
    writeFileSync(hookPath, '#!/bin/sh\n# tampered by hand\nexit 0\n', 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
    expect(r.stdout + r.stderr).toMatch(/asset-manifest: \.claude\/hooks\/pre-tool-use-acceptance-write\.sh was modified after install/i);
  });

  it('reports drift when an installed asset is missing (recorded in the manifest but not on disk)', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const arm = runCli(['install-agent-hooks', '--acceptance-write', 'advisory'], { cwd: tmpRepo, home: tmpHome });
    expect(arm.status, arm.stderr).toBe(0);

    const hookPath = join(tmpRepo, '.claude', 'hooks', 'pre-tool-use-acceptance-write.sh');
    rmSync(hookPath);

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
    expect(r.stdout + r.stderr).toMatch(/asset-manifest: \.claude\/hooks\/pre-tool-use-acceptance-write\.sh is missing/i);
  });

  it('reports drift when an installed asset differs from the currently packaged asset (stale install)', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    // Simulate a stale install: the manifest agrees with the installed file
    // (no hand-edit), but the installed content deliberately differs from
    // whatever this repo's own packaged specs/templates/acceptance.yml is --
    // never touching the real assets/ tree.
    const relpath = 'specs/templates/acceptance.yml';
    const installedAbs = join(tmpRepo, 'specs', 'templates', 'acceptance.yml');
    mkdirSync(join(tmpRepo, 'specs', 'templates'), { recursive: true });
    writeFileSync(installedAbs, 'oracle-version: 0.0.1  # deliberately stale content\n', 'utf8');

    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    const manifest = { [relpath]: { version: '0.0.1', digest: sha256OfFileNormalized(installedAbs) } };
    writeFileSync(join(tmpRepo, '.cdd', 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
    expect(r.stdout + r.stderr).toMatch(/asset-manifest: specs\/templates\/acceptance\.yml differs from the currently packaged cdd-kit asset/i);
  });

  it('agent lint accepts the "Suggested artifacts" heading and matches lint-agents (no drift)', () => {
    // Regression: doctor used to keep its own copy of the lint logic, hard-coded
    // to the old `### Required artifacts` heading. After the canonical heading
    // was renamed to `### Suggested artifacts`, doctor falsely flagged every
    // agent while `cdd-kit lint-agents` (which accepts both) reported clean.
    // Both now share collectAgentViolations(), so they must agree.
    const agentsDir = join(tmpRepo, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'test-agent.md'), [
      '---',
      'name: test-agent',
      'description: A test agent.',
      'tools: Read',
      'model: sonnet',
      '---',
      '',
      '## Read scope',
      '',
      'Source of truth: `specs/changes/<change-id>/context-manifest.md`.',
      '',
      '## Machine-Verifiable Evidence',
      '',
      'See `references/agent-log-protocol.md` for the full schema.',
      '',
      '### Suggested artifacts for this agent',
      '',
      '```yaml',
      'artifacts:',
      '  - { type: files-changed, pointer: "src/api/users.ts:10-45" }',
      '```',
      '',
    ].join('\n'), 'utf8');

    const doctor = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    const lint = runCli(['lint-agents'], { cwd: tmpRepo, home: tmpHome });

    expect(lint.stdout, lint.stderr).toMatch(/0 error\(s\)/);
    expect(doctor.stdout + doctor.stderr).toMatch(/all agent prompts pass shape checks/i);
    expect(doctor.stdout + doctor.stderr).not.toMatch(/lint-agents:.*missing.*artifacts/i);
  });

  it('warns (not silently passes) when .claude/agents exists but cannot be scanned', () => {
    // Regression for the read-failure path: when the agents dir exists but
    // readdir fails (here: it is a file, not a directory), doctor must surface
    // a warning rather than treating the unscanned prompts as a clean pass.
    mkdirSync(join(tmpRepo, '.claude'), { recursive: true });
    writeFileSync(join(tmpRepo, '.claude', 'agents'), 'not a directory', 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/agent prompts were not scanned/i);
    expect(r.stdout + r.stderr).not.toMatch(/all agent prompts pass shape checks/i);
  });

  it('warns when contracts/* changes after context-scan (hash drift)', async () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);
    const scan = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(scan.status, scan.stderr).toBe(0);

    // Hash-based check is mtime-independent (works even on git-clone where mtime resets)
    writeFileSync(join(tmpRepo, 'contracts', 'api', 'new-contract.md'), [
      '---',
      'summary: New API behavior.',
      '---',
      '',
      '# New API Contract',
    ].join('\n'), 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/contracts-index\.md inputs changed/i);
  });

  it('B5: hash-based freshness ignores mtime resets (regression)', async () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);
    const scan = runCli(['context-scan'], { cwd: tmpRepo, home: tmpHome });
    expect(scan.status, scan.stderr).toBe(0);

    // Simulate a git clone: touch every input but keep content unchanged.
    const { utimesSync } = await import('fs');
    const future = new Date(Date.now() + 10_000);
    for (const f of ['contracts/api/api-contract.md', '.cdd/context-policy.json']) {
      const p = join(tmpRepo, f);
      if (existsSync(p)) utimesSync(p, future, future);
    }

    // Absent Claude CLI → MCP check stays informational, so this regression test
    // for digest stability is not perturbed by MCP registration state.
    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/inputs changed/i);
    expect(r.stdout + r.stderr).toMatch(/doctor completed with \d+ warning/i);
  });

  it('auto-detects codex provider and checks CODEX.md', () => {
    mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
    writeFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), JSON.stringify({ provider: 'codex' }), 'utf8');
    writeFileSync(join(tmpRepo, 'CODEX.md'), '# Codex\n', 'utf8');

    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Doctor provider: codex/i);
    expect(r.stdout + r.stderr).not.toMatch(/CLAUDE\.md is missing/i);
  });

  it('writes no files during doctor', () => {
    const r = runCli(['doctor'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(tmpRepo, '.cdd'))).toBe(false);
  });

  it('PR3-5.1: --fix auto-runs context-scan when indexes are missing', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    // Indexes don't exist yet.
    expect(existsSync(join(tmpRepo, 'specs', 'context', 'project-map.md'))).toBe(false);

    const r = runCli(['doctor', '--fix'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/fixed: ran context-scan/i);
    expect(existsSync(join(tmpRepo, 'specs', 'context', 'project-map.md'))).toBe(true);
  });

  it('PR3-5.2: --fix populates empty model-policy roles', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    // Reset model-policy to empty roles.
    writeFileSync(join(tmpRepo, '.cdd', 'model-policy.json'),
      JSON.stringify({ provider: 'claude', generated_at: null, roles: {} }, null, 2) + '\n', 'utf8');

    const r = runCli(['doctor', '--fix'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/fixed: populated.*model-policy/i);

    const policy = JSON.parse(readFileSync(join(tmpRepo, '.cdd', 'model-policy.json'), 'utf8'));
    expect(Object.keys(policy.roles).length).toBeGreaterThan(10);
    expect(policy.roles['change-classifier']).toBe('opus');
  });

  it('PR3-5.3: --fix refreshes legacy indexes missing inputs-digest', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    mkdirSync(join(tmpRepo, 'specs', 'context'), { recursive: true });
    writeFileSync(join(tmpRepo, 'specs', 'context', 'project-map.md'), [
      '---',
      'artifact: project-map',
      'generated-by: cdd-kit context-scan',
      'schema-version: 1',
      `root: legacy-repo`,
      '---',
      '',
      '# Project Map',
    ].join('\n'), 'utf8');
    writeFileSync(join(tmpRepo, 'specs', 'context', 'contracts-index.md'), [
      '---',
      'artifact: contracts-index',
      'generated-by: cdd-kit context-scan',
      'schema-version: 1',
      'missing-summary-count: 0',
      '---',
      '',
      '# Contracts Index',
    ].join('\n'), 'utf8');

    const r = runCli(['doctor', '--fix'], { cwd: tmpRepo, home: tmpHome });
    expect(r.stdout + r.stderr).toMatch(/fixed: ran context-scan/i);
    expect(readFileSync(join(tmpRepo, 'specs', 'context', 'project-map.md'), 'utf8')).toMatch(/^inputs-digest:/m);
    expect(readFileSync(join(tmpRepo, 'specs', 'context', 'contracts-index.md'), 'utf8')).toMatch(/^inputs-digest:/m);
  });

  it('can emit machine-readable json for CI', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const r = runCli(['doctor', '--json'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, r.stderr).toBe(0);

    const report = JSON.parse(r.stdout);
    expect(report.provider).toBe('claude');
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.warnings).toBeGreaterThan(0);
  });

  it('reports dormant chokepoints as warnings in JSON health output', () => {
    const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    expect(init.status, init.stderr).toBe(0);

    const r = runCli(['doctor', '--json'], {
      cwd: tmpRepo,
      home: tmpHome,
      env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') },
    });
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    const finding = report.findings.find((f: { message: string }) => /chokepoint contract-write hook: dormant/.test(f.message));
    expect(finding?.level).toBe('warning');
    const acceptanceFinding = report.findings.find((f: { message: string }) => /chokepoint acceptance-write hook: dormant/.test(f.message));
    expect(acceptanceFinding?.level).toBe('warning');
  });

  // ── Applicability marker (ADR 0011): AC-4 listing + AC-7 drift warning ──────
  describe('contract applicability marker (ADR 0011)', () => {
    function writeCssContract(extraFrontmatter: string[], body: string): string {
      return [
        '---',
        'contract: css',
        'schema-version: 0.1.0',
        'last-changed: 2026-04-27',
        ...extraFrontmatter,
        '---',
        '',
        '# CSS / UI Contract',
        '',
        body,
      ].join('\n');
    }

    it('lists a not-applicable surface with its reason as informational output (AC-4, no failure)', () => {
      const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
      expect(init.status, init.stderr).toBe(0);

      writeFileSync(
        join(tmpRepo, 'contracts', 'css', 'css-contract.md'),
        writeCssContract(['applicability: not-applicable', 'applicability-reason: no CSS/UI surface'], ''),
        'utf8',
      );

      const r = runCli(['doctor', '--json'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
      const report = JSON.parse(r.stdout);
      const finding = report.findings.find((f: { message: string }) => /CSS\/UI contract .* marked applicability: not-applicable/.test(f.message));
      expect(finding).toBeTruthy();
      expect(finding.level).toBe('ok');
      expect(finding.message).toMatch(/no CSS\/UI surface/);
    });

    it('warns (never fails) when a not-applicable contract body now looks filled (AC-7 drift)', () => {
      const init = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
      expect(init.status, init.stderr).toBe(0);

      const filledBody = Array.from({ length: 20 }, (_, i) =>
        `Real substantive rule number ${i}: this line pretends the CSS contract body was actually filled in by a human.`,
      ).join('\n');
      writeFileSync(
        join(tmpRepo, 'contracts', 'css', 'css-contract.md'),
        writeCssContract(['applicability: not-applicable', 'applicability-reason: no CSS/UI surface'], filledBody),
        'utf8',
      );

      const r = runCli(['doctor', '--json'], { cwd: tmpRepo, home: tmpHome, env: { CDD_CLAUDE_BIN: join(tmpRepo, 'no-such-claude') } });
      const report = JSON.parse(r.stdout);
      const drift = report.findings.find((f: { message: string }) => /looks filled/.test(f.message));
      expect(drift).toBeTruthy();
      expect(drift.level).toBe('warning');
      expect(r.status).toBe(0); // drift is advisory — never fails doctor
    });
  });
});
