import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import type { BoundaryOperation } from '../runtime/types.js';

type GeneratedArtifact = NonNullable<BoundaryOperation['generated_artifacts']>[number];

export function replayGeneratedArtifact(cwd: string, artifact: GeneratedArtifact, contract = 'contracts/api/api-contract.md', timeoutMs = 300_000): { passed: boolean; command: string; error?: string } {
  if (artifact.generator !== 'openapi-typescript') return { passed: false, command: '', error: `Unregistered generator: ${artifact.generator}` };
  const temp = mkdtempSync(join(tmpdir(), 'cdd-generated-'));
  const out = join(temp, 'generated.ts');
  const args = ['--no-install', 'openapi-typescript', artifact.input, '-o', out];
  try {
    const projectionArgs = [process.argv[1], 'openapi', 'export', '--contract', contract, '--check', '--out', artifact.input];
    if (/\.ya?ml$/i.test(artifact.input)) projectionArgs.push('--yaml');
    const projection = spawnSync(process.execPath, projectionArgs, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    if (projection.error || projection.status !== 0) {
      return { passed: false, command: `${process.execPath} ${projectionArgs.join(' ')}`, error: `generator input is not a current contract projection: ${projection.stderr || projection.stdout || projection.error || `exit ${projection.status}`}` };
    }
    const versionRun = spawnSync('npx', ['--no-install', 'openapi-typescript', '--version'], { cwd, encoding: 'utf8', timeout: timeoutMs });
    const actualVersion = (versionRun.stdout ?? '').trim().replace(/^v/, '');
    if (versionRun.error || versionRun.status !== 0 || actualVersion !== artifact.generator_version.replace(/^v/, '')) {
      return { passed: false, command: 'npx --no-install openapi-typescript --version', error: `registered generator version mismatch: expected ${artifact.generator_version}, observed ${actualVersion || 'unavailable'}` };
    }
    const run = spawnSync('npx', args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    const command = `npx ${args.join(' ')}`;
    if (run.error || run.status !== 0) return { passed: false, command, error: run.stderr || String(run.error ?? `exit ${run.status}`) };
    const actual = readFileSync(join(cwd, artifact.path));
    const generated = readFileSync(out);
    return { passed: actual.equals(generated), command, ...(actual.equals(generated) ? {} : { error: 'replayed generator output differs from the committed artifact' }) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
