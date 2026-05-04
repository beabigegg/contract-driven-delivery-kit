import { relative } from 'path';

/**
 * Compute a canonical repo-relative path:
 * - Uses path.relative
 * - Replaces backslashes with forward-slashes
 * - NFC-normalizes the string
 * - No leading "./"
 */
export function canonicalRelPath(absolutePath: string, repoRoot: string): string {
  const rel = relative(repoRoot, absolutePath);
  return rel.replace(/\\/g, '/').normalize('NFC');
}

export function truncateDecorator(d: string, max = 80): string {
  const cleaned = d.replace(/\r?\n/g, ' ');
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max) + '...';
}

export function isAllCapsConst(name: string): boolean {
  // Require length >= 2 so single-letter uppercase identifiers (X, T, Y) — almost
  // always type params or component aliases in TS/JSX — fall through to the
  // function-heuristic branch instead of being classified as constants.
  return name.length >= 2 && /^[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * Check if a buffer has binary content (null bytes in first 4KB).
 */
export function isBinary(content: string): boolean {
  const head = content.slice(0, 4096);
  return head.includes('\x00');
}
