/**
 * Unit tests for the shared query scorer (P0: tokenized, coverage-weighted
 * matching). These pin the new multi-word behavior directly, independent of the
 * code-map/code-graph callers that consume it.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeQuery, scoreQuery } from '../../src/code-map/query-score.js';

/** A tiered substring scorer mirroring the production one at a fixed weight. */
function sub(weight: number) {
  return (haystack: string, needle: string): number => {
    if (haystack === needle) return weight + 40;
    if (haystack.startsWith(needle)) return weight + 20;
    if (haystack.includes(needle)) return weight;
    return 0;
  };
}

describe('tokenizeQuery', () => {
  it('splits on whitespace/commas, drops stopwords and 1-char tokens, dedupes', () => {
    expect(tokenizeQuery('order export')).toEqual(['order', 'export']);
    expect(tokenizeQuery('filter options are empty')).toEqual(['filter', 'options', 'empty']);
    expect(tokenizeQuery('the user, the user')).toEqual(['user']);
    expect(tokenizeQuery('a b c')).toEqual([]); // all 1-char tokens dropped
  });

  it('keeps a path or qualified-name query as a single token (no fragmenting)', () => {
    expect(tokenizeQuery('src/orders/service.ts')).toEqual(['src/orders/service.ts']);
    expect(tokenizeQuery('Repo.save')).toEqual(['repo.save']);
  });
});

describe('scoreQuery', () => {
  const score = (hay: string, q: string) => scoreQuery(hay, q, sub(100));

  it('is byte-identical to the whole-phrase score for a single-word query', () => {
    expect(score('exportorders', 'order')).toBe(sub(100)('exportorders', 'order'));
    expect(score('user', 'user')).toBe(sub(100)('user', 'user'));
  });

  it('finds a camelCase symbol from a two-word query the old matcher missed', () => {
    // Old behavior: "exportorders".includes("order export") === false -> 0.
    expect(sub(100)('exportorders', 'order export')).toBe(0);
    expect(score('exportorders', 'order export')).toBeGreaterThan(0);
  });

  it('ranks a fuller match above a partial one (coverage)', () => {
    const full = score('exportorders', 'order export'); // matches both tokens
    const partial = score('orderlist', 'order export'); // matches only "order"
    expect(full).toBeGreaterThan(partial);
  });

  it('falls back to a single meaningful token when the rest are stopwords', () => {
    expect(sub(100)('currentuser', 'the user')).toBe(0);
    expect(score('currentuser', 'the user')).toBeGreaterThan(0);
  });

  it('returns 0 when no token matches', () => {
    expect(score('exportorders', 'invoice payment')).toBe(0);
  });
});
