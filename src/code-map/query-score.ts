/**
 * Shared query scoring for the code-map index (`cdd-kit index query`) and the
 * native code-graph (`cdd-kit graph query`/`context`).
 *
 * The historical matcher treated the whole query as a single atomic substring:
 * `haystack.includes(query)`. That makes any multi-word query — a natural
 * language task ("filter options are empty") or even two words ("order export")
 * — score 0 against every symbol, because no single identifier contains the
 * whole phrase. Agents then had to decompose the query into one exact identifier
 * per call and retry, which is the observed "many round-trips, never finds it"
 * failure mode of graph-first exploration.
 *
 * `scoreQuery` keeps the whole-phrase score as the top signal (so single-word
 * and exact-match behavior is byte-identical to before — the gate's `--check`
 * determinism and existing snapshots are untouched) and, for multi-word
 * queries, adds a per-token pass scaled by how many tokens matched. A symbol
 * that covers more of the query ranks higher; `exportOrders` is now found by
 * "order export" in a single call.
 */

/**
 * English function words dropped from multi-word queries so noise tokens
 * ("the", "is", "of") don't match unrelated identifiers. Deliberately small and
 * conservative: it contains only articles, prepositions, conjunctions, copulas,
 * and pronouns — never code-ish terms (`set`/`get`/`map`/`list`/`type`/`data`
 * stay searchable).
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
  'be', 'as', 'at', 'by', 'it', 'its', 'this', 'that', 'with', 'from', 'into',
  'was', 'were', 'will', 'when', 'if', 'then', 'but', 'not', 'no', 'do', 'does',
  'did', 'has', 'have', 'had', 'i', 'we', 'you', 'my', 'our', 'your',
]);

/**
 * Split a query into meaningful lowercase tokens: whitespace/comma separated,
 * 1-char tokens and stopwords dropped, de-duplicated, order-preserving.
 * Identifier-internal separators (`/`, `.`, `::`) are intentionally NOT split
 * on, so a path or qualified-name query stays a single token and keeps its
 * precise whole-string match instead of fanning out into noisy fragments like
 * "src" or "ts".
 */
export function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of query.toLowerCase().split(/[\s,]+/)) {
    const token = raw.trim();
    if (token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/**
 * Score `haystack` (already lowercased) against `query` (already lowercased and
 * trimmed) using the caller's field-specific `substringScore` for both the whole
 * phrase and each token.
 *
 * - 0 meaningful tokens (query is all stopwords/short): the raw whole-phrase
 *   score, unchanged.
 * - 1 meaningful token: the better of the whole phrase and that token, so
 *   "the user" still finds `user` while a plain "user" query is identical to
 *   the old behavior.
 * - 2+ tokens: `max(wholePhrase, sum(matchedTokenScores) * coverage)`, where
 *   `coverage = matchedTokens / totalTokens`. Coverage rewards a symbol that
 *   matches more of the query so a full match outranks a single common token.
 *
 * All math is integer/deterministic; the result ordering remains stable.
 */
export function scoreQuery(
  haystack: string,
  query: string,
  substringScore: (haystack: string, needle: string) => number,
): number {
  const whole = substringScore(haystack, query.trim());
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return whole;
  if (tokens.length === 1) return Math.max(whole, substringScore(haystack, tokens[0]));

  let sum = 0;
  let matched = 0;
  for (const token of tokens) {
    const score = substringScore(haystack, token);
    if (score > 0) {
      sum += score;
      matched++;
    }
  }
  if (matched === 0) return whole;
  const coverage = matched / tokens.length;
  return Math.max(whole, Math.round(sum * coverage));
}
