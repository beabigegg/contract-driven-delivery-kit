import { readFileSync } from 'fs';
import { createHash } from 'crypto';

/**
 * Normalize a buffer for hashing so the same file produces the same hash on
 * Windows (CRLF) and Linux/Mac (LF) checkouts of the same git repo.
 *
 * Without this, every digest cdd-kit computes (`inputs-digest` for context
 * indexes, `sources-digest` for code-map) becomes per-clone-noise instead of
 * per-content-truth — a CI runner with `core.autocrlf=false` would never
 * agree with a Windows developer using `core.autocrlf=true`.
 *
 * Conversion: any `\r\n` → `\n`, then any remaining lone `\r` → `\n` (defends
 * against legacy classic-Mac CR-only files).
 */
export function normalizeContentForHash(buf: Buffer): Buffer {
  // Fast path: no carriage returns → already normalised.
  if (!buf.includes(0x0d)) return buf;
  // Convert via string round-trip. Files in cdd-kit's hash inputs (context-
  // policy.json, contract markdown, source code) are always text, so UTF-8
  // round-trip is safe.
  const text = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(text, 'utf8');
}

/**
 * SHA-256 hash of a file, with line endings normalized first. Returns the
 * empty string when the file cannot be read (caller decides how to treat
 * missing inputs — typically: count as "absent" and exclude from digest).
 */
export function sha256OfFileNormalized(path: string): string {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return '';
  }
  return createHash('sha256').update(normalizeContentForHash(buf)).digest('hex');
}
