/**
 * Codex round 9 (PR #69, P1): hard links are the alias the realpath layer
 * cannot see. A hard link is not a pointer to a file — it IS the file, a second
 * directory entry for the same inode — so `realpathSync` on it returns the
 * destination's own innocent-looking path, every rule match passes, and the
 * write truncates the shared inode. `.cdd/migration/report.md` hard-linked to
 * `contracts/api.md` let `reconcile --yes` rewrite the contract THROUGH the
 * guard. The two narrow channels' own realpath checks were equally blind, and
 * their byte-proofs re-read through the same alias, so they passed while the
 * sibling name's content was destroyed.
 *
 * Unlike symlinks, NTFS hard links need no privilege (`fs.linkSync` works
 * unelevated), so every test here runs for real on Windows AND Linux — the
 * attack was reproduced on this host before the fix: nlink=2, realpath
 * unchanged, contract overwritten.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, linkSync, statSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import {
  assertWritable,
  makeGuardedWrite,
  guardedAddPolicyKeys,
  guardedReplaceMarkedRegion,
} from '../../src/reconcile/guard.js';
import { LEARNINGS_START, LEARNINGS_END } from '../../src/reconcile/reconcilers/learnings-region.js';

let tmp: string;
beforeEach(() => { tmp = makeTempDir('cdd-hardlink-'); });
afterEach(() => { cleanupDir(tmp); });

/** contracts/api.md (bucket 1) + a hard link to it at `rel`; returns both. */
function linkedPair(rel: string): { contract: string; dest: string } {
  const contract = join(tmp, 'contracts', 'api.md');
  const dest = join(tmp, rel);
  mkdirSync(join(tmp, 'contracts'), { recursive: true });
  mkdirSync(join(dest, '..'), { recursive: true });
  writeFileSync(contract, 'PRECIOUS CONTRACT CONTENT', 'utf8');
  linkSync(contract, dest);
  expect(statSync(dest).nlink, 'fixture: hard link created').toBeGreaterThan(1);
  return { contract, dest };
}

describe('guard-refusal: a hard-linked destination is refused (codex round 9, INV-2)', () => {
  it('assertWritable throws for a kit-managed spelling that is a hard link into bucket 1', () => {
    // `.cdd/migration/**` is not a bucket-1 spelling, so before the fix the
    // direct-rule layer passed it, and realpath returned the same path so the
    // alias layer passed too. The link count is the only visible signal.
    const { dest } = linkedPair('.cdd/migration/behavior-change-report.md');
    expect(() => assertWritable(dest, tmp)).toThrow(/hard link/);
  });

  it('the write is refused end-to-end and the contract content SURVIVES', () => {
    // The real-world discriminator: before the fix this write succeeded and
    // `contracts/api.md` read "overwritten" afterwards (reproduced on this
    // host). Reverting the fix turns exactly this assertion red.
    const { contract, dest } = linkedPair('.cdd/migration/behavior-change-report.md');
    const gw = makeGuardedWrite(tmp);
    expect(() => gw.writeInto(dest, 'overwritten by reconcile')).toThrow(/hard link/);
    expect(readFileSync(contract, 'utf8')).toBe('PRECIOUS CONTRACT CONTENT');
  });

  it('a hard link between two KIT-MANAGED names is refused too — safety is by link count, not by where the other name lives', () => {
    // Enumerating an inode's other names is impossible without walking the
    // filesystem, so the guard cannot prove the sibling is harmless. Fail open
    // to refuse, the guard's standing posture.
    const a = join(tmp, 'specs', 'templates', 'a.md');
    const b = join(tmp, 'specs', 'templates', 'b.md');
    mkdirSync(join(tmp, 'specs', 'templates'), { recursive: true });
    writeFileSync(a, 'template', 'utf8');
    linkSync(a, b);
    expect(() => assertWritable(b, tmp)).toThrow(/hard link/);
  });

  it('no false positive: an ordinary (nlink=1) kit-managed file stays writable', () => {
    const dest = join(tmp, 'specs', 'templates', 'plain.md');
    mkdirSync(join(tmp, 'specs', 'templates'), { recursive: true });
    writeFileSync(dest, 'old', 'utf8');
    const gw = makeGuardedWrite(tmp);
    gw.writeInto(dest, 'new');
    expect(readFileSync(dest, 'utf8')).toBe('new');
  });

  it('no false positive: a NEW file (no existing inode) is not a hard-link risk', () => {
    // Creating a file cannot truncate another inode; ENOENT must not refuse.
    const gw = makeGuardedWrite(tmp);
    gw.writeInto(join(tmp, '.cdd', 'migration', 'fresh.md'), 'created');
    expect(readFileSync(join(tmp, '.cdd', 'migration', 'fresh.md'), 'utf8')).toBe('created');
  });
});

describe('container-fail-open: the narrow channels refuse a hard-linked container (codex round 9)', () => {
  it('guardedAddPolicyKeys throws when .cdd/policy.yml is a hard link, and the sibling survives', () => {
    // The channel's byte-proof re-reads policy.yml THROUGH the same inode, so
    // it would pass while the contract's content became policy content.
    const contract = join(tmp, 'contracts', 'api.md');
    mkdirSync(join(tmp, 'contracts'), { recursive: true });
    mkdirSync(join(tmp, '.cdd'), { recursive: true });
    writeFileSync(contract, 'shadow_mode: true\n', 'utf8'); // valid YAML so parse is not the refusal
    linkSync(contract, join(tmp, '.cdd', 'policy.yml'));
    expect(() => guardedAddPolicyKeys(tmp, { new_key: false })).toThrow(/hard link/);
    expect(readFileSync(contract, 'utf8')).toBe('shadow_mode: true\n');
  });

  it('guardedReplaceMarkedRegion reports and leaves a hard-linked CLAUDE.md untouched', () => {
    const contract = join(tmp, 'contracts', 'guidance.md');
    mkdirSync(join(tmp, 'contracts'), { recursive: true });
    const body = `human text\n${LEARNINGS_START}\nold lessons\n${LEARNINGS_END}\ntrailer\n`;
    writeFileSync(contract, body, 'utf8');
    linkSync(contract, join(tmp, 'CLAUDE.md'));
    const res = guardedReplaceMarkedRegion(tmp, 'CLAUDE.md', LEARNINGS_START, LEARNINGS_END, '\nnew lessons\n');
    expect(res.replaced).toBe(false);
    expect(res.reason).toMatch(/hard link/);
    expect(readFileSync(contract, 'utf8')).toBe(body);
  });
});
