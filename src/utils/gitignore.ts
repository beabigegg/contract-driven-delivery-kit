import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Idempotently ensure a path entry exists in `.gitignore`. Creates the file if
 * absent. Returns true if the file was modified.
 *
 * Used for cdd-kit-generated local artifacts that must NOT be committed:
 * `cdd-kit refresh` / `cdd-kit migrate` backups under `.cdd/`, and the
 * `cdd-kit code-map` JSON sidecar. Without an automatic gitignore entry users
 * accidentally commit local-only files and pollute their diffs / project-map.
 */
export function ensureGitignoreEntry(
  cwd: string,
  entry: string,
  comment = 'cdd-kit generated backups (do not commit)',
): boolean {
  const path = join(cwd, '.gitignore');
  const trimmed = entry.trim();
  if (!trimmed) return false;
  const re = new RegExp(`^\\s*${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  let existing = '';
  if (existsSync(path)) existing = readFileSync(path, 'utf8');
  if (re.test(existing)) return false;
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = existing.length === 0
    ? `# ${comment}\n${trimmed}\n`
    : `${sep}\n# ${comment}\n${trimmed}\n`;
  writeFileSync(path, existing + block, 'utf8');
  return true;
}
