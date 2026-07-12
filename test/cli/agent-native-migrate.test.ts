import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';

let repo: string;
let home: string;

beforeEach(() => {
  repo = makeTempDir('cdd-agent-native-migrate-'); home = makeTempDir('cdd-agent-native-migrate-home-');
  mkdirSync(join(repo, '.cdd'), { recursive: true });
  mkdirSync(join(repo, 'contracts', 'api'), { recursive: true });
  mkdirSync(join(repo, 'specs', 'changes', 'active-change'), { recursive: true });
  writeFileSync(join(repo, '.cdd', 'model-policy.json'), JSON.stringify({ provider: 'codex', roles: {} }), 'utf8');
  writeFileSync(join(repo, 'CODEX.md'), '# Legacy Codex guidance\n', 'utf8');
  writeFileSync(join(repo, 'specs', 'changes', 'active-change', 'user.txt'), 'DO NOT REWRITE\n', 'utf8');
  writeFileSync(join(repo, 'contracts', 'api', 'api-contract.md'), `# API Contract
## Endpoint Requirements
| method | path | auth | request schema | response schema | errors | tests |
|---|---|---|---|---|---|---|
| GET | /health | public | - | Health | - | yes |
## Schemas
### Health
| field | type | required | format | notes |
|---|---|---|---|---|
| ok | boolean | yes | | |
`, 'utf8');
});

afterEach(() => { cleanupDir(repo); cleanupDir(home); });

describe('agent-native migration', () => {
  it('dry-runs, applies Codex/user assets, and never rewrites active changes', () => {
    const dry = runCli(['runtime', 'migrate', '--provider', 'codex', '--json'], { cwd: repo, home });
    expect(dry.status).toBe(1);
    expect(JSON.parse(dry.stdout).ready).toBe(false);
    expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);

    mkdirSync(join(home, '.agents', 'skills', 'cdd-work'), { recursive: true });
    const customizedSkill = join(home, '.agents', 'skills', 'cdd-work', 'SKILL.md');
    writeFileSync(customizedSkill, 'USER CUSTOMIZATION\n', 'utf8');

    const apply = runCli(['runtime', 'migrate', '--provider', 'codex', '--yes', '--import-active', '--json'], { cwd: repo, home });
    expect(apply.status, apply.stderr).toBe(0);
    const jsonStart = apply.stdout.lastIndexOf('\n{\n  "schema_version"');
    const result = JSON.parse(apply.stdout.slice(jsonStart >= 0 ? jsonStart + 1 : 0)); // command logs may precede the final JSON
    expect(result.ready).toBe(true);
    expect(existsSync(join(repo, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(repo, '.cdd', 'policy.yml'))).toBe(true);
    expect(existsSync(join(repo, '.cdd', 'boundary-manifest.yml'))).toBe(true);
    expect(existsSync(join(repo, '.cdd', 'migration', 'agent-native.json'))).toBe(true);
    const migration = JSON.parse(readFileSync(join(repo, '.cdd', 'migration', 'agent-native.json'), 'utf8'));
    expect(migration.legacy_imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ change_id: 'active-change', status: 'imported' }),
    ]));
    expect(existsSync(join(repo, '.cdd', 'migration', 'guidance-audit.json'))).toBe(true);
    expect(existsSync(join(repo, '.cdd', 'migration', 'guidance-proposals', 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(home, '.agents', 'skills', 'cdd-work', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.cdd-kit', 'install-manifest.json'))).toBe(true);
    expect(readFileSync(customizedSkill, 'utf8')).toBe('USER CUSTOMIZATION\n');
    expect(readFileSync(join(repo, 'specs', 'changes', 'active-change', 'user.txt'), 'utf8')).toBe('DO NOT REWRITE\n');
  });
});
