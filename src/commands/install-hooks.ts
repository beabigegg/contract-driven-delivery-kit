import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { ASSET } from '../utils/paths.js';
import { log } from '../utils/logger.js';

const START_MARKER = '# cdd-kit-managed-block-start';
const END_MARKER   = '# cdd-kit-managed-block-end';

/**
 * Resolve the directory git uses for hooks. Asks git first (`git rev-parse
 * --git-path hooks`) so it honors `core.hooksPath`, worktrees, and submodules
 * even when `.git` is a normal directory; falls back to `.git/hooks` only when
 * git is unavailable and `.git` is a plain directory. Returns null only when it
 * soft-skipped during init; otherwise returns a path or exits (direct CLI).
 */
function resolveHooksDir(cwd: string, gitPath: string, fromInit: boolean): string | null {
  const res = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd, encoding: 'utf8' });
  if (res.status === 0 && res.stdout.trim()) {
    return resolve(cwd, res.stdout.trim());
  }

  // git unavailable or failed — fall back for the common plain-directory case.
  let gitIsDir = false;
  try { gitIsDir = statSync(gitPath).isDirectory(); } catch { /* treat as non-dir */ }
  if (gitIsDir) return join(gitPath, 'hooks');

  // `.git` is a worktree/submodule pointer and git could not resolve the path.
  const why = '`.git` is a worktree/submodule pointer and git could not resolve the hooks path';
  if (fromInit) {
    log.warn(`pre-commit gate not armed: ${why}. Run \`cdd-kit install-hooks\` in the main checkout.`);
    return null;
  }
  log.error(`cannot resolve hooks dir: ${why}. Run this in the main checkout.`);
  process.exit(1);
}

export interface InstallHooksOptions {
  /**
   * When invoked from `cdd-kit init`, a missing .git/ is a soft skip (warn and
   * return) instead of a hard exit — arming is best-effort during init.
   */
  fromInit?: boolean;
}

export async function installHooks(opts: InstallHooksOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const gitPath = join(cwd, '.git');

  if (!existsSync(gitPath)) {
    if (opts.fromInit) {
      log.warn('pre-commit gate not armed: not a git repository yet. Run `cdd-kit install-hooks` after `git init`.');
      return;
    }
    log.error('not a git repository (no .git/ found in cwd)');
    process.exit(1);
  }

  // In git worktrees and submodules `.git` is a FILE pointing at the real git
  // dir, not a directory, so `join('.git','hooks')` + mkdir throws ENOTDIR.
  // When `.git` is not a plain directory, ask git for the canonical hooks path
  // (this also honors core.hooksPath). Fall back to soft-skip/error if git is
  // unavailable so init's best-effort arming never crashes.
  const hooksDir = resolveHooksDir(cwd, gitPath, opts.fromInit ?? false);
  if (hooksDir === null) return; // soft-skipped (fromInit); message already logged
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
