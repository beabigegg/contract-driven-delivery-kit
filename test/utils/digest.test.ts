/**
 * P1-17 — the shared inputs-digest contract. context-scan stamps this digest
 * into specs/context/*.md and doctor recomputes it; both now import the SAME
 * function, so these tests pin the algorithm's portability guarantees rather
 * than two copies' incidental agreement.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, cleanupDir } from '../helpers.js';
import { inputsDigest } from '../../src/utils/digest.js';
import { findContractFiles, projectMapInputs } from '../../src/utils/context-inputs.js';

describe('inputsDigest (shared writer/checker algorithm)', () => {
  it('is identical across clones (same relative content, different absolute cwd)', () => {
    const a = makeTempDir('cdd-digest-a-');
    const b = makeTempDir('cdd-digest-b-');
    try {
      for (const root of [a, b]) {
        mkdirSync(join(root, 'contracts'), { recursive: true });
        writeFileSync(join(root, 'contracts', 'api.md'), '# API\ncontent\n', 'utf8');
      }
      const da = inputsDigest([join(a, 'contracts', 'api.md')], a);
      const db = inputsDigest([join(b, 'contracts', 'api.md')], b);
      expect(da).toBe(db);
    } finally {
      cleanupDir(a);
      cleanupDir(b);
    }
  });

  it('is order-independent but content-sensitive', () => {
    const dir = makeTempDir('cdd-digest-');
    try {
      const f1 = join(dir, 'one.md');
      const f2 = join(dir, 'two.md');
      writeFileSync(f1, 'one', 'utf8');
      writeFileSync(f2, 'two', 'utf8');
      expect(inputsDigest([f1, f2], dir)).toBe(inputsDigest([f2, f1], dir));
      const before = inputsDigest([f1, f2], dir);
      writeFileSync(f2, 'two CHANGED', 'utf8');
      expect(inputsDigest([f1, f2], dir)).not.toBe(before);
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('shared input selection (context-scan ↔ doctor lockstep)', () => {
  it('findContractFiles picks nested .md and excludes INDEX.md / CHANGELOG.md', () => {
    const dir = makeTempDir('cdd-inputs-');
    try {
      mkdirSync(join(dir, 'contracts', 'api'), { recursive: true });
      writeFileSync(join(dir, 'contracts', 'api', 'users.md'), 'x', 'utf8');
      writeFileSync(join(dir, 'contracts', 'env.md'), 'x', 'utf8');
      writeFileSync(join(dir, 'contracts', 'INDEX.md'), 'x', 'utf8');
      writeFileSync(join(dir, 'contracts', 'CHANGELOG.md'), 'x', 'utf8');
      writeFileSync(join(dir, 'contracts', 'notes.txt'), 'x', 'utf8');
      const found = findContractFiles(join(dir, 'contracts')).map(p => p.split(/[/\\]/).pop());
      expect(found.sort()).toEqual(['env.md', 'users.md']);
    } finally {
      cleanupDir(dir);
    }
  });

  it('projectMapInputs includes the context policy only when it exists', () => {
    const dir = makeTempDir('cdd-inputs-');
    try {
      expect(projectMapInputs(dir)).toEqual([]);
      mkdirSync(join(dir, '.cdd'), { recursive: true });
      writeFileSync(join(dir, '.cdd', 'context-policy.json'), '{}', 'utf8');
      expect(projectMapInputs(dir)).toEqual([join(dir, '.cdd', 'context-policy.json')]);
    } finally {
      cleanupDir(dir);
    }
  });
});
