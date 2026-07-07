/**
 * Unit tests for the changelog assembler (ADR 0009): fragment reading and the
 * idempotent splice into contracts/CHANGELOG.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildUnreleasedBlock,
  spliceChangelog,
  readFragments,
  type Fragment,
} from '../../src/commands/changelog-build.js';
import { makeTempDir, cleanupDir } from '../helpers.js';

describe('buildUnreleasedBlock', () => {
  it('renders a placeholder when there are no fragments', () => {
    expect(buildUnreleasedBlock([])).toContain('_No pending contract changes._');
  });

  it('renders one sub-section per fragment', () => {
    const frags: Fragment[] = [
      { changeId: 'add-export', body: '- api: added POST /export' },
      { changeId: 'refactor-auth', body: '- api: changed /login response' },
    ];
    const block = buildUnreleasedBlock(frags);
    expect(block).toContain('## Unreleased');
    expect(block).toContain('### add-export');
    expect(block).toContain('### refactor-auth');
    expect(block).toContain('POST /export');
  });
});

describe('spliceChangelog', () => {
  it('creates a changelog when none exists', () => {
    const out = spliceChangelog('', '## Unreleased\n\n### a\n\n- x\n');
    expect(out).toContain('# Contract Changelog');
    expect(out).toContain('### a');
  });

  it('replaces an existing Unreleased section, preserving released history', () => {
    const existing = `# Contract Changelog\n\n## Unreleased\n\n### old\n\n- stale\n\n## 1.2.0 - 2026-01-01\n\n- shipped\n`;
    const out = spliceChangelog(existing, '## Unreleased\n\n### new\n\n- fresh\n');
    expect(out).toContain('### new');
    expect(out).not.toContain('### old');
    expect(out).toContain('## 1.2.0 - 2026-01-01');
    expect(out).toContain('- shipped');
  });

  it('inserts after the title when no Unreleased section exists', () => {
    const existing = `# Contract Changelog\n\n## 1.0.0 - 2025-01-01\n\n- first\n`;
    const out = spliceChangelog(existing, '## Unreleased\n\n### a\n\n- x\n');
    expect(out.indexOf('## Unreleased')).toBeLessThan(out.indexOf('## 1.0.0'));
    expect(out).toContain('- first');
  });

  it('is idempotent — assembling twice yields the same content', () => {
    const block = '## Unreleased\n\n### a\n\n- x\n';
    const once = spliceChangelog('# Contract Changelog\n', block);
    const twice = spliceChangelog(once, block);
    expect(twice.trim()).toBe(once.trim());
  });
});

describe('readFragments', () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir('changelog-frag-'); });
  afterEach(() => { cleanupDir(dir); });

  it('reads .md fragments sorted by change-id and skips empties', () => {
    const fragDir = join(dir, 'contracts', 'changelog.d');
    mkdirSync(fragDir, { recursive: true });
    writeFileSync(join(fragDir, 'zeta.md'), '- z change', 'utf8');
    writeFileSync(join(fragDir, 'alpha.md'), '- a change', 'utf8');
    writeFileSync(join(fragDir, 'empty.md'), '   \n', 'utf8');
    writeFileSync(join(fragDir, 'notes.txt'), 'ignored', 'utf8');

    const frags = readFragments(dir);
    expect(frags.map(f => f.changeId)).toEqual(['alpha', 'zeta']);
  });

  it('returns [] when the fragment dir is absent', () => {
    expect(readFragments(dir)).toEqual([]);
  });
});
