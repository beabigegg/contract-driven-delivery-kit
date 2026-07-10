import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import {
  computeDesignHash,
  gitAuthorIdentity,
  projectConfirmedRegion,
  readDesignLock,
  writeDesignLock,
} from '../../src/utils/design-hash.js';
import { makeTempDir, cleanupDir } from '../helpers.js';

// Mirrors test/utils/acceptance-hash.test.ts's conventions, but the locked
// region here is the `## Confirmed` markdown section of interaction-design.md
// (ADR 0012 §5), not a parsed YAML structure.

function doc(confirmed: string): string {
  return [
    '# Interaction Design: my-change',
    '',
    '## Open Decisions',
    '- [x] resolved question — answer',
    '',
    '## Confirmed',
    confirmed,
  ].join('\n');
}

describe('design-hash: projectConfirmedRegion', () => {
  it('extracts only the ## Confirmed section body', () => {
    const body = doc('The empty-state copy is "No orders yet."');
    expect(projectConfirmedRegion(body)).toContain('The empty-state copy is "No orders yet."');
    expect(projectConfirmedRegion(body)).not.toContain('Open Decisions');
  });

  it('returns an empty projection when ## Confirmed is absent', () => {
    const body = '# Interaction Design\n\n## Open Decisions\n- [x] q — a\n';
    expect(projectConfirmedRegion(body)).toBe('');
  });
});

describe('design-hash: computeDesignHash (canonical parsed projection, ADR 0012 §5)', () => {
  it('is a 64-char lowercase hex sha256 digest', () => {
    const hash = computeDesignHash(doc('Answer: yes.'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is unchanged when ## Confirmed is reformatted/reindented (whitespace-insensitive)', () => {
    const a = computeDesignHash(doc('Answer: yes.\n\nSecond line here.'));
    const b = computeDesignHash(doc('   Answer:    yes.   \n\n\n\n  Second   line   here.  \n\n'));
    expect(b).toBe(a);
  });

  it('is unchanged by CRLF vs LF line endings', () => {
    const lf = doc('Answer: yes.\nSecond line.');
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(computeDesignHash(crlf)).toBe(computeDesignHash(lf));
  });

  it('diverges when a ## Confirmed answer is semantically edited', () => {
    const a = computeDesignHash(doc('Answer: yes.'));
    const b = computeDesignHash(doc('Answer: no.'));
    expect(b).not.toBe(a);
  });

  it('is independent of content outside ## Confirmed (e.g. Open Decisions text)', () => {
    const bodyA = doc('Answer: yes.').replace('resolved question — answer', 'resolved question — answer (v1)');
    const bodyB = doc('Answer: yes.').replace('resolved question — answer', 'resolved question — answer (v2)');
    expect(computeDesignHash(bodyA)).toBe(computeDesignHash(bodyB));
  });

  // Hash-stability guard (IP-7 deliverable 3): adding provenance CLUE fields to
  // the LOCK must not touch the recorded design hash, which projects only the
  // `## Confirmed` region. This pin is the tripwire -- any drift in the
  // projection or digest turns it red and invalidates every existing baseline.
  it('pins the digest of a fixed ## Confirmed body (recorded hashes must not shift)', () => {
    expect(computeDesignHash(doc('The empty-state copy is "No orders yet."')))
      .toBe('748acf4f54de30c0228bc9076e1b4de38de874922d50fa425f9d06d3f32acfef');
  });
});

describe('design-hash: read/writeDesignLock (.cdd/design-lock.json)', () => {
  let tmpRepo: string;

  it('readDesignLock returns {} when the sidecar does not exist', () => {
    tmpRepo = makeTempDir('cdd-design-hash-read-');
    try {
      expect(readDesignLock(tmpRepo)).toEqual({});
    } finally {
      cleanupDir(tmpRepo);
    }
  });

  it('writeDesignLock records a baseline that readDesignLock then returns', () => {
    tmpRepo = makeTempDir('cdd-design-hash-write-');
    try {
      const hash = computeDesignHash(doc('Answer: yes.'));
      writeDesignLock(tmpRepo, 'my-change', hash);

      const lockPath = join(tmpRepo, '.cdd', 'design-lock.json');
      expect(existsSync(lockPath)).toBe(true);

      const lock = readDesignLock(tmpRepo);
      expect(lock['my-change'].hash).toBe(hash);
      expect(typeof lock['my-change']['locked-at']).toBe('string');

      const onDisk = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(onDisk['my-change'].hash).toBe(hash);
    } finally {
      cleanupDir(tmpRepo);
    }
  });

  it('writeDesignLock merges into existing entries for other changes', () => {
    tmpRepo = makeTempDir('cdd-design-hash-merge-');
    try {
      mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
      writeFileSync(join(tmpRepo, '.cdd', 'design-lock.json'), JSON.stringify({ 'other-change': { hash: 'b'.repeat(64) } }), 'utf8');

      writeDesignLock(tmpRepo, 'my-change', computeDesignHash(doc('Answer: yes.')));

      const lock = readDesignLock(tmpRepo);
      expect(lock['other-change'].hash).toBe('b'.repeat(64));
      expect(lock['my-change']).toBeDefined();
    } finally {
      cleanupDir(tmpRepo);
    }
  });

  it('readDesignLock returns {} for malformed JSON rather than throwing', () => {
    tmpRepo = makeTempDir('cdd-design-hash-malformed-');
    try {
      mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
      writeFileSync(join(tmpRepo, '.cdd', 'design-lock.json'), 'not json', 'utf8');
      expect(readDesignLock(tmpRepo)).toEqual({});
    } finally {
      cleanupDir(tmpRepo);
    }
  });
});

// Tamper-evidence CLUES (contracts/ci/ci-gate-contract.md "Tamper evidence, not
// prevention"; ADR 0012 §5). These record what the confirming process CLAIMED
// about itself. Nothing here verifies them, and every one is trivially
// forgeable -- that is the point. No assertion below may claim a baseline is
// human-made, human-verified, or authentic; the most it says is that a value
// was recorded, and what the recorder claimed.
describe('design-hash: provenance clues recorded by writeDesignLock', () => {
  const HASH = 'a'.repeat(64);
  let tmpRepo: string;

  it('records tty (boolean) and an ISO timestamp equal to locked-at on every write', () => {
    tmpRepo = makeTempDir('cdd-design-prov-tty-');
    try {
      writeDesignLock(tmpRepo, 'my-change', HASH);
      const entry = readDesignLock(tmpRepo)['my-change'];
      expect(typeof entry.tty).toBe('boolean');
      expect(typeof entry.timestamp).toBe('string');
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/); // ISO-8601
      expect(entry.timestamp).toBe(entry['locked-at']);
    } finally {
      cleanupDir(tmpRepo);
    }
  });

  it('records git-author as "Name <email>" when git resolves an identity', () => {
    tmpRepo = makeTempDir('cdd-design-prov-author-');
    try {
      spawnSync('git', ['init'], { cwd: tmpRepo });
      spawnSync('git', ['config', 'user.name', 'Test Author'], { cwd: tmpRepo });
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRepo });
      writeDesignLock(tmpRepo, 'my-change', HASH);
      expect(readDesignLock(tmpRepo)['my-change']['git-author']).toBe('Test Author <test@example.com>');
    } finally {
      cleanupDir(tmpRepo);
    }
  });

  it('omits git-author (records absence, invents nothing) when git cannot determine one', () => {
    tmpRepo = makeTempDir('cdd-design-prov-noauthor-');
    // Blind git to any ambient global/system identity so user.name/email are unset.
    const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
    const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    try {
      const emptyCfg = join(tmpRepo, 'empty.gitconfig');
      writeFileSync(emptyCfg, '', 'utf8');
      process.env.GIT_CONFIG_GLOBAL = emptyCfg;
      process.env.GIT_CONFIG_NOSYSTEM = '1';

      expect(gitAuthorIdentity(tmpRepo)).toBeUndefined();

      writeDesignLock(tmpRepo, 'my-change', HASH);
      const entry = readDesignLock(tmpRepo)['my-change'];
      expect('git-author' in entry).toBe(false);
      // Absence of a clue is not failure: the entry is still well-formed.
      expect(entry.hash).toBe(HASH);
      expect(typeof entry.tty).toBe('boolean');
    } finally {
      if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
      if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
      cleanupDir(tmpRepo);
    }
  });

  it('reads an old-code lock (hash + locked-at, no provenance) as absent evidence, not a failure', () => {
    tmpRepo = makeTempDir('cdd-design-prov-legacy-');
    try {
      mkdirSync(join(tmpRepo, '.cdd'), { recursive: true });
      // Exactly the shape the PRE-provenance writer produced.
      writeFileSync(
        join(tmpRepo, '.cdd', 'design-lock.json'),
        JSON.stringify({ 'legacy-change': { hash: HASH, 'locked-at': '2026-07-09T00:00:00.000Z' } }),
        'utf8',
      );
      const entry = readDesignLock(tmpRepo)['legacy-change'];
      // Round-trips cleanly; the old baseline still validates for gating.
      expect(entry.hash).toBe(HASH);
      // Provenance is simply absent -- undefined, never a thrown/failed read.
      expect(entry.tty).toBeUndefined();
      expect(entry.timestamp).toBeUndefined();
      expect(entry['git-author']).toBeUndefined();
    } finally {
      cleanupDir(tmpRepo);
    }
  });
});
