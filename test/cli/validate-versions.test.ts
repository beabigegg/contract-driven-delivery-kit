import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { runCli, makeTempDir, cleanupDir, hasPython } from '../helpers.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Commit all staged changes in a git repo, using test identity. */
function gitCommit(repoDir: string, message: string): void {
  const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@test.test',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@test.test',
  };
  const addResult = spawnSync('git', ['add', '.'], { cwd: repoDir, env: GIT_ENV });
  if (addResult.status !== 0) {
    throw new Error(`git add failed in ${repoDir}: ${addResult.stderr?.toString()}`);
  }
  const commitResult = spawnSync(
    'git',
    ['commit', '-m', message, '--no-verify'],
    { cwd: repoDir, env: GIT_ENV },
  );
  if (commitResult.status !== 0) {
    throw new Error(
      `git commit failed in ${repoDir}: ${commitResult.stderr?.toString() ?? commitResult.stdout?.toString()}`,
    );
  }
}

/** Replace all occurrences of `from` with `to` in a file. */
function replaceInFile(filePath: string, from: string, to: string): void {
  const content = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, content.replace(from, to), 'utf8');
}

/** Replace the frontmatter block in a contract file. */
function setFrontmatter(
  filePath: string,
  fields: { contract: string; version: string; lastChanged?: string; policy?: string },
): void {
  const content = readFileSync(filePath, 'utf8');
  const lastChanged = fields.lastChanged ?? '2026-04-27';
  const policy = fields.policy ?? 'deprecate-2-minors';

  // Remove existing frontmatter (---\n...\n---\n) and replace
  const stripped = content.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
  const newFrontmatter = `---\ncontract: ${fields.contract}\nschema-version: ${fields.version}\nlast-changed: ${lastChanged}\nbreaking-change-policy: ${policy}\n---\n\n`;
  writeFileSync(filePath, newFrontmatter + stripped, 'utf8');
}

/** Read the CHANGELOG path in a repo. */
function changelogPath(repoDir: string): string {
  return join(repoDir, 'contracts', 'CHANGELOG.md');
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(!hasPython())('cdd-kit validate --versions', () => {
  let tmpRepo: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpRepo = makeTempDir('cdd-versions-repo-');
    tmpHome = makeTempDir('cdd-versions-home-');

    // Scaffold project files (uses built assets, which include frontmatter)
    const initResult = runCli(['init', '--local-only'], { cwd: tmpRepo, home: tmpHome });
    if (initResult.status !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }

    // Create initial git commit (mirrors the spec's beforeEach)
    const GIT_ENV = {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@test.test',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@test.test',
    };
    spawnSync('git', ['init'], { cwd: tmpRepo, env: GIT_ENV });
    gitCommit(tmpRepo, 'initial');
  });

  afterEach(() => {
    cleanupDir(tmpRepo);
    cleanupDir(tmpHome);
  });

  // ── Test 1 ────────────────────────────────────────────────────────────────
  it('1: fresh init pre-1.0 passes without any modification', () => {
    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/contract version validation passed/i);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it('2: pre-1.0 content change without version bump passes (draft exemption)', () => {
    // Append content to api-contract.md but do NOT change the frontmatter
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');
    appendFileSync(apiPath, '\n## Extra Section\nSome extra draft content.\n', 'utf8');

    // Do NOT commit — validate against HEAD (initial commit)
    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/contract version validation passed/i);
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it('3: post-1.0 content change without version bump fails', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    // Promote api contract to 1.0.0 and commit
    setFrontmatter(apiPath, { contract: 'api', version: '1.0.0' });
    gitCommit(tmpRepo, 'promote api to 1.0.0');

    // Now append content without bumping version
    appendFileSync(apiPath, '\n## Extra Section\nSome stable content added without bumping.\n', 'utf8');

    // Validate — must fail
    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/content changed but schema-version not bumped/i);
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  it('4: post-1.0 major bump without CHANGELOG entry fails', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    // Promote to 1.0.0 and commit
    setFrontmatter(apiPath, { contract: 'api', version: '1.0.0' });
    gitCommit(tmpRepo, 'promote api to 1.0.0');

    // Bump to 2.0.0 + add content, but NO changelog entry
    setFrontmatter(apiPath, { contract: 'api', version: '2.0.0' });
    appendFileSync(apiPath, '\n## Breaking Change\nRemoved legacy field.\n', 'utf8');

    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no changelog entry.*api 2\.0\.0|changelog entry.*api 2\.0\.0.*not found/i);
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  it('5: post-1.0 major bump with CHANGELOG entry containing ### Removed passes', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    // Promote to 1.0.0 and commit
    setFrontmatter(apiPath, { contract: 'api', version: '1.0.0' });
    gitCommit(tmpRepo, 'promote api to 1.0.0');

    // Bump to 2.0.0 + add content + add proper CHANGELOG entry
    setFrontmatter(apiPath, { contract: 'api', version: '2.0.0' });
    appendFileSync(apiPath, '\n## Breaking Change\nRemoved legacy field.\n', 'utf8');

    const cl = changelogPath(tmpRepo);
    appendFileSync(
      cl,
      '\n## [api 2.0.0] — 2026-04-27\nMajor breaking release.\n\n### Removed\n- Legacy field removed.\n',
      'utf8',
    );

    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/contract version validation passed/i);
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  it('6: post-1.0 minor version skip fails', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    // Promote to 1.0.0 and commit
    setFrontmatter(apiPath, { contract: 'api', version: '1.0.0' });
    gitCommit(tmpRepo, 'promote api to 1.0.0');

    // Skip from 1.0.0 to 1.2.0 (skip 1.1.0)
    setFrontmatter(apiPath, { contract: 'api', version: '1.2.0' });
    appendFileSync(apiPath, '\n## Skipped minor.\n', 'utf8');

    const cl = changelogPath(tmpRepo);
    appendFileSync(cl, '\n## [api 1.2.0] — 2026-04-27\n\n### Added\n- Some feature.\n', 'utf8');

    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/version skip|minor version skip/i);
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  it('7: frontmatter missing schema-version field fails', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    // Write a frontmatter without schema-version
    const content = readFileSync(apiPath, 'utf8');
    const stripped = content.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
    const badFrontmatter =
      '---\ncontract: api\nlast-changed: 2026-04-27\nbreaking-change-policy: deprecate-2-minors\n---\n\n';
    writeFileSync(apiPath, badFrontmatter + stripped, 'utf8');

    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/missing field "schema-version"|schema-version/i);
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  it('8: invalid last-changed (non-ISO date) fails', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    setFrontmatter(apiPath, {
      contract: 'api',
      version: '0.1.0',
      lastChanged: 'yesterday',
    });

    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/invalid last-changed|last-changed.*yesterday/i);
  });

  // ── Test 9 ────────────────────────────────────────────────────────────────
  it('9: major bump CHANGELOG entry without ### Removed or ### Changed (breaking) fails', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    // Promote to 1.0.0 and commit
    setFrontmatter(apiPath, { contract: 'api', version: '1.0.0' });
    gitCommit(tmpRepo, 'promote api to 1.0.0');

    // Bump to 2.0.0 + content change + CHANGELOG with only ### Added
    setFrontmatter(apiPath, { contract: 'api', version: '2.0.0' });
    appendFileSync(apiPath, '\n## Something new.\n', 'utf8');

    const cl = changelogPath(tmpRepo);
    appendFileSync(
      cl,
      '\n## [api 2.0.0] — 2026-04-27\nMajor release.\n\n### Added\n- Something added.\n',
      'utf8',
    );

    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(
      /requires.*Removed.*Changed \(breaking\)|Changed \(breaking\).*Removed/i,
    );
  });

  // ── Test 10 ───────────────────────────────────────────────────────────────
  it('10: schema-version changed without content change fails', () => {
    const apiPath = join(tmpRepo, 'contracts', 'api', 'api-contract.md');

    // Promote to 1.0.0 and commit
    setFrontmatter(apiPath, { contract: 'api', version: '1.0.0' });
    gitCommit(tmpRepo, 'promote api to 1.0.0');

    // Only change the version in frontmatter, leave body identical
    setFrontmatter(apiPath, { contract: 'api', version: '1.1.0' });
    // No content change to body

    const r = runCli(['validate', '--versions'], { cwd: tmpRepo, home: tmpHome });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/version changed without content change/i);
  });
});
