import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ASSET } from '../utils/paths.js';
import { log } from '../utils/logger.js';

const START_MARKER = '# cdd-kit-managed-block-start';
const END_MARKER   = '# cdd-kit-managed-block-end';

export async function installHooks(): Promise<void> {
  const cwd = process.cwd();
  const gitDir = join(cwd, '.git');

  if (!existsSync(gitDir)) {
    log.error('not a git repository (no .git/ found in cwd)');
    process.exit(1);
  }

  const hooksDir = join(gitDir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  const dest = join(hooksDir, 'pre-commit');
  const ourHook = readFileSync(join(ASSET.hooks, 'pre-commit'), 'utf8');

  let final: string;

  if (!existsSync(dest)) {
    // No existing hook — install ours fresh
    final = ourHook;
  } else {
    const existing = readFileSync(dest, 'utf8');
    const startIdx = existing.indexOf(START_MARKER);
    const endIdx = existing.indexOf(END_MARKER);

    if (startIdx >= 0 && endIdx > startIdx) {
      // Existing cdd-kit block — replace it (idempotent)
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + END_MARKER.length);
      // Extract our block (between markers, including markers)
      const ourStart = ourHook.indexOf(START_MARKER);
      const ourEnd = ourHook.indexOf(END_MARKER) + END_MARKER.length;
      const ourBlock = ourHook.slice(ourStart, ourEnd);
      final = before + ourBlock + after;
    } else {
      // Existing non-cdd-kit hook — prepend our block
      // Extract our block contents (markers included)
      const ourStart = ourHook.indexOf(START_MARKER);
      const ourEnd = ourHook.indexOf(END_MARKER) + END_MARKER.length;
      const ourBlock = ourHook.slice(ourStart, ourEnd);
      // If existing has shebang, keep it on first line
      if (existing.startsWith('#!')) {
        const firstNewline = existing.indexOf('\n');
        const shebang = existing.slice(0, firstNewline + 1);
        const rest = existing.slice(firstNewline + 1);
        final = shebang + '\n' + ourBlock + '\n' + rest;
      } else {
        final = '#!/bin/sh\n' + ourBlock + '\n' + existing;
      }
    }
  }

  writeFileSync(dest, final, 'utf8');
  try {
    chmodSync(dest, 0o755);
  } catch { /* ignore on Windows */ }

  log.ok(`pre-commit hook installed at ${dest}`);
  log.info('cdd-kit gate will now run automatically before each commit affecting specs/changes/');
}
