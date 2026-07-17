/**
 * Integrity of `docs/glossary.md`.
 *
 * The glossary exists because a private term used before it is defined costs a
 * reader a grep, and cdd-kit had 17 such terms and no glossary. Its whole value
 * is the `authority` column: one hop from a term to the file that actually
 * specifies it. A broken hop is worse than no glossary — it is a pointer that
 * looks authoritative and goes nowhere, which is the same failure shape as a
 * contract claiming a check that does not exist.
 *
 * These are the only two ways the page can rot without anyone noticing: an
 * authority moves, or a term's row is deleted while the term stays in use.
 * Nothing here checks the prose; a definition being WRONG is a review problem,
 * not a mechanical one, and pretending otherwise would be a vacuous check.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GLOSSARY_REL = 'docs/glossary.md';
const GLOSSARY_ABS = join(REPO_ROOT, GLOSSARY_REL);
const source = readFileSync(GLOSSARY_ABS, 'utf8');

/** `**term**` in the first cell of a table row. */
function glossaryTerms(): string[] {
  const out: string[] = [];
  for (const line of source.split('\n')) {
    const m = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Every relative markdown link target, excluding pure anchors. */
function links(): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split('#')[0].trim();
    if (target && !target.startsWith('http')) out.push(target);
  }
  return [...new Set(out)];
}

describe('docs/glossary.md', () => {
  it('lists terms', () => {
    expect(glossaryTerms().length).toBeGreaterThan(10);
  });

  it('every authority link resolves to a file that exists', () => {
    const broken = links().filter(l => !existsSync(resolve(dirname(GLOSSARY_ABS), l)));
    expect(broken, `glossary points at ${broken.length} path(s) that do not exist`).toEqual([]);
  });

  it('every term carries an authority link, not just a definition', () => {
    // A row with no link is a definition with no source of truth behind it —
    // exactly the "prose that looks binding" this repo keeps producing.
    const linkless: string[] = [];
    for (const line of source.split('\n')) {
      const m = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|/);
      if (m && !/\]\([^)]+\)/.test(line)) linkless.push(m[1].trim());
    }
    expect(linkless, 'glossary rows with no authority link').toEqual([]);
  });

  it('every listed term is actually used somewhere in the kit', () => {
    // A term nobody uses is not vocabulary, it is clutter. Checked against the
    // shipped surfaces a reader would meet it on.
    const haystack = ['contracts', 'docs', 'src', '.claude']
      .flatMap(d => collectText(join(REPO_ROOT, d)))
      .join('\n')
      .toLowerCase();
    const unused = glossaryTerms().filter(t => {
      // A slashed row (`fat / bone / knob`) is one entry per alternative.
      const parts = t.split('/').map(p => p.trim()).filter(Boolean);
      return !parts.some(p => haystack.includes(p.toLowerCase()));
    });
    expect(unused, 'glossary defines terms nothing uses').toEqual([]);
  });

  it('the do-not-use list names a replacement for every word it bans', () => {
    // "Stop saying X" with no "say Y instead" is advice nobody can act on.
    const section = source.split('## Words that are not terms')[1] ?? '';
    const rows = section.split('\n').filter(l => /^\|\s*[a-z]/i.test(l) && !/^\|\s*-+/.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      expect(cells.length, `"${row.trim()}" has no replacement column`).toBeGreaterThanOrEqual(2);
      expect(cells[1].length, `"${cells[0]}" is banned with no replacement`).toBeGreaterThan(3);
    }
  });
});

function collectText(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const { readdirSync, statSync } = require('fs') as typeof import('fs');
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === '__pycache__') continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (/\.(md|ts|yml|json|sh|py)$/.test(entry)) out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return out;
}
