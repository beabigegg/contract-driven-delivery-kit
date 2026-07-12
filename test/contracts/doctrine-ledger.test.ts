import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('provider-neutral doctrine ledger', () => {
  it('maps every stable doctrine rule to existing source and target files', () => {
    const ledger = yaml.load(readFileSync(join(root, 'docs/migration/agent-native-cdd-doctrine-ledger.yml'), 'utf8')) as {
      rules: Array<{ id: string; sources: string[]; target: string }>;
    };
    const ids = new Set<string>();
    expect(ledger.rules.length).toBeGreaterThanOrEqual(30);
    for (const rule of ledger.rules) {
      expect(ids.has(rule.id), `duplicate rule id ${rule.id}`).toBe(false);
      ids.add(rule.id);
      expect(existsSync(join(root, rule.target)), `missing target ${rule.target}`).toBe(true);
      expect(readFileSync(join(root, rule.target), 'utf8')).toContain(rule.id);
      for (const source of rule.sources) expect(existsSync(join(root, source)), `missing source ${source}`).toBe(true);
    }
  });
});
