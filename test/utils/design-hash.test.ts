import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  computeDesignHash,
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
