import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { relative } from 'path';

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

/**
 * Compute a stable digest of a list of input files. Each entry is rendered as
 * `<repo-relative-path>:<sha256-of-normalized-content>`, sorted, joined with
 * newlines, then hashed.
 *
 * This is THE `inputs-digest` algorithm: `cdd-kit context-scan` stamps it into
 * the `specs/context/*.md` frontmatter, and `cdd-kit doctor` recomputes it to
 * judge freshness. It lives here (P1-17) precisely so the writer and the
 * checker cannot drift — any drift made doctor report "inputs changed" forever.
 *
 * Repo-relative path matters: an absolute path would make the digest differ
 * between every clone (different `cwd`) even when content is identical,
 * permanently breaking the doctor comparison after a fresh clone (fixed in
 * 2.0.10).
 */
export function inputsDigest(paths: string[], cwd: string): string {
  const combined = paths.slice().sort()
    .map(p => {
      const rel = relative(cwd, p).replace(/\\/g, '/');
      return `${rel}:${sha256OfFileNormalized(p)}`;
    })
    .join('\n');
  return createHash('sha256').update(combined).digest('hex');
}
