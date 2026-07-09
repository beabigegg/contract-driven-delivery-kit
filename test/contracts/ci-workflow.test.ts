/**
 * ci-gates.md § Workflow Changes (interaction-design-loop): both workflow YAML
 * files must actually invoke `cdd-kit gate` in CI, must never opt a failing
 * gate out via `continue-on-error`, must never run `cdd-kit doctor` (ADR 0012
 * §2/§6 forbids ever promoting the over-fetch advisory to a CI-run finding),
 * and must follow the version-pinning split: the adopter template pins the
 * published package to this CLI's own version; this repo's own workflow does
 * not install the published package at all (it gates itself against its own
 * build -- the same disease class as a stale global `cdd-kit` binary).
 *
 * This repo's own workflow must additionally run the lockfile/manifest sync
 * guard before `npm ci` (see tools/check-lockfile-sync.mjs): `npm ci` compares
 * the dependency tree, not the root `version`, so ten releases of drift went
 * unnoticed there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADOPTER_TEMPLATE_PATH = join(REPO_ROOT, 'github-workflows', 'contract-driven-gates.yml');
const OWN_WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'contract-driven-gates.yml');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
}

/**
 * The `run:` commands of the main job, in order.
 *
 * Assertions about what a workflow *executes* must read the parsed steps, not
 * the raw file: a `#` comment that merely mentions `npm ci` is not a step that
 * runs it. (That false positive is not hypothetical -- the comment explaining
 * why the lockfile guard precedes `npm ci` tripped the previous text-matching
 * version of the exactly-once assertion below.)
 */
function runCommands(path: string): string[] {
  const doc = yaml.load(read(path)) as { jobs: Record<string, { steps: WorkflowStep[] }> };
  return doc.jobs['contract-and-fast-tests'].steps
    .map((s) => s.run)
    .filter((r): r is string => typeof r === 'string');
}

describe('CI workflows — ci-gates.md § Workflow Changes', () => {
  for (const [label, path] of [
    ['adopter template (github-workflows/)', ADOPTER_TEMPLATE_PATH],
    ["this repo's own (.github/workflows/)", OWN_WORKFLOW_PATH],
  ] as const) {
    it(`${label}: no continue-on-error anywhere`, () => {
      expect(read(path)).not.toMatch(/continue-on-error/);
    });

    it(`${label}: no cdd-kit doctor invocation`, () => {
      expect(read(path)).not.toMatch(/\bdoctor\b/);
    });

    it(`${label}: invokes a gate step gated on changed spec directories`, () => {
      const content = read(path);
      expect(content).toMatch(/Determine changed spec directories/);
      expect(content).toMatch(/if: steps\.changed\.outputs\.ids != ''/);
      expect(content).toMatch(/gate "\$id" \$STRICT_FLAG/);
    });

    it(`${label}: --strict is applied only on push, never on pull_request`, () => {
      const content = read(path);
      expect(content).toMatch(/STRICT_FLAG="--strict"/);
      expect(content).toMatch(/\[\s*"\$\{\{\s*github\.event_name\s*\}\}"\s*=\s*"push"\s*\]/);
    });

    it(`${label}: full checkout history (fetch-depth: 0) for the changed-dirs diff`, () => {
      expect(read(path)).toMatch(/fetch-depth:\s*0/);
    });
  }

  it('adopter template pins the npm install to {{cdd-kit-version}}, not an unpinned install', () => {
    const content = read(ADOPTER_TEMPLATE_PATH);
    expect(content).toMatch(/npm install -g contract-driven-delivery@\{\{cdd-kit-version\}\}/);
  });

  it('adopter template invokes the globally-installed `cdd-kit` binary for validate/gate', () => {
    const content = read(ADOPTER_TEMPLATE_PATH);
    expect(content).toMatch(/run: cdd-kit validate/);
    expect(content).toMatch(/cdd-kit gate "\$id"/);
  });

  it("this repo's own workflow does NOT install the published package at all", () => {
    const content = read(OWN_WORKFLOW_PATH);
    expect(content).not.toMatch(/npm install -g contract-driven-delivery/);
    expect(content).not.toMatch(/\{\{cdd-kit-version\}\}/);
  });

  it("this repo's own workflow builds from source and runs validate/gate via node dist/cli/index.js", () => {
    const content = read(OWN_WORKFLOW_PATH);
    expect(content).toMatch(/npm run build/);
    expect(content).toMatch(/node dist\/cli\/index\.js validate/);
    expect(content).toMatch(/node dist\/cli\/index\.js gate "\$id"/);
  });

  it("this repo's own workflow runs npm ci exactly once", () => {
    const installs = runCommands(OWN_WORKFLOW_PATH).filter((c) => /\bnpm ci\b/.test(c));
    expect(installs.length).toBe(1);
  });

  it("this repo's own workflow guards lockfile/manifest sync BEFORE npm ci", () => {
    const commands = runCommands(OWN_WORKFLOW_PATH);
    const guardIndex = commands.findIndex((c) => /npm run check:lockfile/.test(c));
    const installIndex = commands.findIndex((c) => /\bnpm ci\b/.test(c));

    expect(guardIndex, 'no `npm run check:lockfile` step in the workflow').toBeGreaterThanOrEqual(0);
    expect(installIndex, 'no `npm ci` step in the workflow').toBeGreaterThanOrEqual(0);
    // `npm ci` compares the dependency tree, not the root `version` field, so it
    // cannot catch a lockfile whose version drifted from package.json. The guard
    // reads two JSON files and needs no node_modules -- it belongs before the
    // install, so the failure costs seconds rather than a full dependency fetch.
    expect(guardIndex).toBeLessThan(installIndex);
  });
});
