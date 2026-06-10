import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * The input-file selection that `cdd-kit context-scan` (the writer of
 * `specs/context/*.md` and their `inputs-digest`) and `cdd-kit doctor` (the
 * freshness checker that recomputes the digest) must agree on. Before P1-17
 * each command kept its own copy with a comment pleading "the two MUST stay in
 * lockstep" — a single missed edit would make doctor report stale indexes
 * forever. Centralizing the selection (and the digest itself, see
 * `inputsDigest` in digest.ts) makes the lockstep structural.
 */

/**
 * Contract files that feed `specs/context/contracts-index.md`: every `.md`
 * under `contracts/` recursively, excluding the generated `INDEX.md` and
 * `CHANGELOG.md`.
 */
export function findContractFiles(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) findContractFiles(fullPath, found);
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md' && entry.name !== 'CHANGELOG.md') found.push(fullPath);
  }
  return found;
}

/**
 * Input files that feed `specs/context/project-map.md`: currently just the
 * context policy, when present. Absent inputs are excluded (not hashed as
 * empty) so creating the file later registers as a genuine input change.
 */
export function projectMapInputs(cwd: string): string[] {
  return [join(cwd, '.cdd', 'context-policy.json')].filter(existsSync);
}
