// Canonical-hash + baseline-lock util for the acceptance oracle (ADR 0010 §3.1;
// design.md Q1). The gate (src/commands/gate-acceptance.ts) uses this to detect
// an agent tampering with the human-authored answer key after authoring: a
// mismatch between the freshly computed hash and the recorded baseline fails
// with "acceptance oracle modified after authoring — human must re-confirm."
//
// Locked region: `cases[].{id,input,expect}` and `rules[].{id,statement}` only.
// `given/when/then`, `oracle-version`, `confirmation-mode`, and `authored-by` are
// excluded — they are narrative/metadata. In chat-confirmed mode, the external
// confirmation binds the same locked-region hash plus the current HEAD.
//
// The hash is computed over the PARSED, canonicalized structure -- not the raw
// file bytes -- so it is inherently independent of key order, whitespace, and
// quoting style (design.md Q1 rejects a raw-file digest for exactly this
// reason: reformatting a semantically identical file would false-alarm).

import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { normalizeContentForHash } from './digest.js';

export interface AcceptanceCase {
  id?: unknown;
  input?: unknown;
  expect?: unknown;
  [key: string]: unknown;
}

export interface AcceptanceRule {
  id?: unknown;
  statement?: unknown;
  [key: string]: unknown;
}

export interface AcceptanceFile {
  'oracle-version'?: unknown;
  'confirmation-mode'?: 'human-relock' | 'chat-confirmed' | unknown;
  'authored-by'?: unknown;
  cases?: AcceptanceCase[];
  rules?: AcceptanceRule[];
  [key: string]: unknown;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeysDeep(src[key]);
    return out;
  }
  return value;
}

function byId(a: { id?: unknown }, b: { id?: unknown }): number {
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

export function projectLockedRegion(data: AcceptanceFile): unknown {
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const projectedCases = cases
    .map((c) => ({ id: c?.id, input: c?.input, expect: c?.expect }))
    .sort(byId);
  const projectedRules = rules
    .map((r) => ({ id: r?.id, statement: r?.statement }))
    .sort(byId);
  return sortKeysDeep({ cases: projectedCases, rules: projectedRules });
}

export function computeAcceptanceHash(data: AcceptanceFile): string {
  const projected = projectLockedRegion(data);
  const canonicalJson = JSON.stringify(projected);
  const normalized = normalizeContentForHash(Buffer.from(canonicalJson, 'utf8'));
  return createHash('sha256').update(normalized).digest('hex');
}

export interface AcceptanceLockEntry {
  hash: string;
  'locked-at'?: string;
  'git-author'?: string;
  tty?: boolean;
  timestamp?: string;
  // How the acceptance was confirmed. `human` (default/legacy) = a person ran an
  // interactive confirmation after seeing the criteria. `autonomous` = the run
  // was explicitly delegated to the agent (loop mode) and no human reviewed the
  // criteria; the gate surfaces this rather than treating it as a human sign-off.
  mode?: 'human' | 'autonomous';
  reason?: string;
}

export type AcceptanceLockFile = Record<string, AcceptanceLockEntry>;

function lockPath(cwd: string): string {
  return join(cwd, '.cdd', 'acceptance-lock.json');
}

export function gitAuthorIdentity(cwd: string): string | undefined {
  try {
    const name = spawnSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' });
    const email = spawnSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8' });
    const n = name.status === 0 ? (name.stdout ?? '').trim() : '';
    const e = email.status === 0 ? (email.stdout ?? '').trim() : '';
    return n && e ? `${n} <${e}>` : undefined;
  } catch {
    return undefined;
  }
}

export function readAcceptanceLock(cwd: string): AcceptanceLockFile {
  const p = lockPath(cwd);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as AcceptanceLockFile)
      : {};
  } catch {
    return {};
  }
}

export function writeAcceptanceLock(
  cwd: string,
  changeId: string,
  hash: string,
  options: { mode?: 'human' | 'autonomous'; reason?: string } = {},
): void {
  const p = lockPath(cwd);
  const current = readAcceptanceLock(cwd);
  const now = new Date().toISOString();
  const entry: AcceptanceLockEntry = {
    hash,
    'locked-at': now,
    tty: Boolean(process.stdout.isTTY),
    timestamp: now,
  };
  const author = gitAuthorIdentity(cwd);
  if (author !== undefined) entry['git-author'] = author;
  if (options.mode) entry.mode = options.mode;
  if (options.reason && options.reason.trim()) entry.reason = options.reason.trim();
  current[changeId] = entry;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}
