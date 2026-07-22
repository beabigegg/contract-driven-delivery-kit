/**
 * i18n phase 1 (#70): `accept confirm` speaks the adopter's locale.
 *
 * Boundary rule under test as much as the feature: machine-parsed grammar
 * (YAML keys, ids, flags, the `given:`/`when:`/`then:` labels that echo the
 * oracle's keys) stays English; only human-facing prose localizes. The default
 * locale is byte-for-byte the pre-i18n English output — an adopter who never
 * sets `locale:` must see zero change.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { cleanupDir, makeTempDir, runCli } from '../helpers.js';
import { readAcceptanceLock } from '../../src/utils/acceptance-hash.js';
import { resolveLocale, t } from '../../src/utils/i18n.js';
import { policyKeyCatalog } from '../../src/reconcile/reconcilers/policy-keys.js';

const CHANGE = 'i18n-flow';
const ORACLE = {
  'oracle-version': '1.0.0',
  'authored-by': 'test',
  cases: [{ id: 'c1', given: '訂單超過一萬元', when: '送出核准', then: '需要主管簽核', input: { a: 1 }, expect: { ok: true } }],
};

let repo: string;
let home: string;
beforeEach(() => { repo = makeTempDir('cdd-i18n-'); home = makeTempDir('cdd-i18n-home-'); });
afterEach(() => { cleanupDir(repo); cleanupDir(home); });

function scaffold(locale?: string): void {
  const changeDir = join(repo, 'specs', 'changes', CHANGE);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'acceptance.yml'), yaml.dump(ORACLE), 'utf8');
  if (locale !== undefined) {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, '.cdd', 'policy.yml'), `locale: ${locale}\n`, 'utf8');
  }
}

describe('resolveLocale', () => {
  it('defaults to en with no policy file, and fails open to en on a malformed one', () => {
    expect(resolveLocale(repo)).toBe('en');
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, '.cdd', 'policy.yml'), '[not: a mapping', 'utf8');
    expect(resolveLocale(repo)).toBe('en');
  });

  it('reads locale: zh-TW and rejects unknown locales back to en', () => {
    mkdirSync(join(repo, '.cdd'), { recursive: true });
    writeFileSync(join(repo, '.cdd', 'policy.yml'), 'locale: zh-TW\n', 'utf8');
    expect(resolveLocale(repo)).toBe('zh-TW');
    writeFileSync(join(repo, '.cdd', 'policy.yml'), 'locale: fr\n', 'utf8');
    expect(resolveLocale(repo)).toBe('en');
  });
});

describe('accept confirm speaks the configured locale', () => {
  it('default locale: autonomous receipt output is the exact pre-i18n English', () => {
    scaffold();
    const r = runCli(['accept', 'confirm', CHANGE, '--autonomous', '--reason', 'delegated'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Recorded AUTONOMOUS acceptance for i18n-flow — no human reviewed the criteria\./);
    expect(r.stdout).toMatch(/Reason: delegated/);
  });

  it('zh-TW: autonomous receipt localizes the prose, and the LOCK stays machine-English', () => {
    scaffold('zh-TW');
    const r = runCli(['accept', 'confirm', CHANGE, '--autonomous', '--reason', '已獲授權的委任執行'], { cwd: repo, home });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/已記錄 i18n-flow 的「自主模式」驗收/);
    expect(r.stdout).toMatch(/原因:已獲授權的委任執行/);
    // Machine layer unchanged: the recorded lock keeps its English enum values.
    const entry = readAcceptanceLock(repo)[CHANGE];
    expect(entry?.mode).toBe('autonomous');
    expect(entry?.reason).toBe('已獲授權的委任執行');
  });

  it('zh-TW: the no-terminal refusal is readable by the human it addresses', () => {
    scaffold('zh-TW');
    const r = runCli(['accept', 'confirm', CHANGE], { cwd: repo, home });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/需要互動式終端機/);
    expect(r.stdout).toMatch(/--autonomous --reason/); // the remedy command itself stays English grammar
  });
});

describe('locale is a reconciled policy key (INV-1)', () => {
  it('policy-keys catalog offers locale at safe default en — the current behavior', () => {
    const locale = policyKeyCatalog().find(c => c.key === 'locale');
    expect(locale).toBeDefined();
    expect(locale?.hasDeclaredDefault).toBe(true);
    expect(locale?.safeDefault).toBe('en');
  });
});

describe('t() fallback discipline', () => {
  it('unknown keys echo back instead of throwing, and params substitute in both locales', () => {
    expect(t(repo, 'no.such.key')).toBe('no.such.key');
    expect(t(repo, 'confirm.recorded', { id: 'x' })).toContain('x');
  });
});
