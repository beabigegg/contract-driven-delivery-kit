// Human-facing message catalog (#70). BOUNDARY RULE (binding, recorded in the
// issue): anything a validator parses — headings like `## Confirmed`, YAML
// keys, enum values, rule/case ids, CLI flags — stays English forever, because
// localizing grammar tokens forks the parser (the strip_inline_comment lesson:
// two readers of one fact must not diverge). Only prose a HUMAN reads
// localizes. The first localized surface is `accept confirm`: the product's
// whole thesis is that the human supplies ground truth, and a human signs
// best what they can read in their own language.
//
// Locale comes from the adopter's `.cdd/policy.yml` `locale:` key. The key is
// registered in the policy schema with `default: 'en'`, so the policy-keys
// reconciler offers it to upgrading adopters at its safe default (INV-1: the
// default IS the current behavior). Any read failure fails open to English.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

export type Locale = 'en' | 'zh-TW';

export function resolveLocale(cwd: string): Locale {
  try {
    const p = join(cwd, '.cdd', 'policy.yml');
    if (!existsSync(p)) return 'en';
    const doc = yaml.load(readFileSync(p, 'utf8'));
    const v = doc && typeof doc === 'object' && !Array.isArray(doc)
      ? (doc as Record<string, unknown>).locale
      : undefined;
    return v === 'zh-TW' ? 'zh-TW' : 'en';
  } catch {
    return 'en';
  }
}

type Entry = { en: string; 'zh-TW': string };

const MESSAGES: Record<string, Entry> = {
  'confirm.title': {
    en: 'Acceptance criteria awaiting your approval:',
    'zh-TW': '以下驗收準則等待你的核可:',
  },
  'confirm.prompt': {
    en: 'Type "{id}" to confirm you have read and approve these criteria (Ctrl-C to abort): ',
    'zh-TW': '輸入「{id}」表示你已閱讀並核可這些準則(Ctrl-C 取消):',
  },
  'confirm.mismatch': {
    en: 'Input did not match the change id — acceptance NOT recorded.',
    'zh-TW': '輸入與 change id 不符——驗收「未」被記錄。',
  },
  'confirm.recorded': {
    en: 'Recorded human acceptance for {id}.',
    'zh-TW': '已記錄 {id} 的人工驗收。',
  },
  'confirm.commit-hint': {
    en: '.cdd/acceptance-lock.json updated. Commit it alongside the acceptance.yml change.',
    'zh-TW': '.cdd/acceptance-lock.json 已更新。請與 acceptance.yml 的變更一併 commit。',
  },
  'confirm.needs-tty': {
    en: 'cdd-kit accept confirm needs an interactive terminal so a human can review the criteria.',
    'zh-TW': 'cdd-kit accept confirm 需要互動式終端機,讓人類親自審閱準則。',
  },
  'confirm.needs-tty-hint1': {
    en: 'A person should run `cdd-kit accept confirm {id}` in a terminal, or, for an explicitly',
    'zh-TW': '請由人在終端機執行 `cdd-kit accept confirm {id}`;若這是一次明確授權的',
  },
  'confirm.needs-tty-hint2': {
    en: 'delegated loop run, use `cdd-kit accept confirm {id} --autonomous --reason "..."`.',
    'zh-TW': '委任執行,改用 `cdd-kit accept confirm {id} --autonomous --reason "..."`。',
  },
  'confirm.autonomous-recorded': {
    en: 'Recorded AUTONOMOUS acceptance for {id} — no human reviewed the criteria.',
    'zh-TW': '已記錄 {id} 的「自主模式」驗收——沒有任何人類審閱過這些準則。',
  },
  'confirm.autonomous-reason': {
    en: 'Reason: {reason}',
    'zh-TW': '原因:{reason}',
  },
  'confirm.autonomous-note': {
    en: 'The gate will surface this as an agent-delegated acceptance, not a human sign-off.',
    'zh-TW': 'gate 會將此標示為 agent 代行的驗收,而非人類簽核。',
  },
};

/** Look up a message in the adopter's locale; unknown keys echo back (never throw). */
export function t(cwd: string, key: string, params: Record<string, string> = {}): string {
  const entry = MESSAGES[key];
  const locale = resolveLocale(cwd);
  let s = entry ? (locale === 'zh-TW' ? entry['zh-TW'] : entry.en) : key;
  for (const [k, v] of Object.entries(params)) {
    s = s.split(`{${k}}`).join(v);
  }
  return s;
}
