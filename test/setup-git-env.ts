import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Isolate every `git` invocation in the test suite from the host's global and
 * system git configuration. Without this, environments that enforce commit
 * signing (`commit.gpgsign = true`), a custom `core.hooksPath`, or other global
 * settings make repo-creating tests fail for reasons unrelated to the code
 * under test (e.g. `validate-versions` could not `git commit`).
 *
 * Runs once per test process (registered via `setupFiles`), before any test.
 * Git subprocesses inherit `process.env`, including the ones the CLI itself
 * spawns through `runCli`, so this covers the whole suite.
 */
const cfgDir = mkdtempSync(join(tmpdir(), 'cdd-gitcfg-'));
const emptyCfg = join(cfgDir, 'gitconfig');
writeFileSync(
  emptyCfg,
  '[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n',
);

// Point global/system config at a known-empty file and skip system config.
process.env.GIT_CONFIG_GLOBAL = emptyCfg;
process.env.GIT_CONFIG_SYSTEM = emptyCfg;
process.env.GIT_CONFIG_NOSYSTEM = '1';

// Deterministic identity (the empty global config carries no user.name/email).
process.env.GIT_AUTHOR_NAME ??= 'cdd-test';
process.env.GIT_AUTHOR_EMAIL ??= 'cdd-test@example.com';
process.env.GIT_COMMITTER_NAME ??= 'cdd-test';
process.env.GIT_COMMITTER_EMAIL ??= 'cdd-test@example.com';
