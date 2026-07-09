#!/usr/bin/env node
/**
 * Lockfile version-sync guard.
 *
 * `package-lock.json` records the root package's own version in two places:
 * the top-level `version`, and `packages[""].version`. `npm version` writes all
 * three (package.json + both lock fields) atomically; hand-editing the
 * `version` field in package.json writes only one.
 *
 * This repo released 2.2.0 through 3.11.0 by hand-editing package.json, so the
 * lockfile still claimed 2.1.3 -- ten releases of silent drift. Nothing caught
 * it, because nothing looks:
 *
 *   - `npm ci` does NOT fail on a root-version mismatch (verified). It only
 *     compares the DEPENDENCY tree against package.json's ranges.
 *   - `npm publish` never ships package-lock.json in the tarball, so no
 *     consumer ever sees the stale value.
 *   - `docs/release-checklist.md` said only "confirm package.json version
 *     matches CHANGELOG.md".
 *
 * So the drift was invisible from every direction except reading the file. It
 * is still worth failing on: the lockfile is the artifact `npm ci` restores in
 * CI, and a repo whose own lockfile disagrees with its own manifest cannot be
 * trusted to tell you what it built.
 *
 * The fix is always the same: `npm install --package-lock-only`, which
 * rewrites exactly those two fields when no dependency ranges changed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, `file://${ROOT}/`), 'utf8'));

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');

// packages[""] is the root package's own entry in a lockfileVersion >= 2 lock.
const rootEntry = lock.packages?.[''];

const problems = [];
if (lock.name !== pkg.name) {
  problems.push(`package-lock.json  .name                 = ${lock.name}  (package.json: ${pkg.name})`);
}
if (lock.version !== pkg.version) {
  problems.push(`package-lock.json  .version              = ${lock.version}  (package.json: ${pkg.version})`);
}
if (!rootEntry) {
  problems.push('package-lock.json  .packages[""]         = missing (lockfileVersion < 2?)');
} else if (rootEntry.version !== pkg.version) {
  problems.push(`package-lock.json  .packages[""].version = ${rootEntry.version}  (package.json: ${pkg.version})`);
}

if (problems.length > 0) {
  console.error(`Lockfile sync guard failed: package-lock.json disagrees with package.json.\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nFix: npm install --package-lock-only');
  console.error('Prevent: release with `npm version <x.y.z>`, never by hand-editing package.json.');
  process.exit(1);
}

console.log(`Lockfile sync guard passed: ${pkg.name}@${pkg.version} matches package-lock.json.`);
