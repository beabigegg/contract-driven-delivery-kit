/**
 * `cdd-kit changelog build` — assemble per-change changelog fragments into
 * contracts/CHANGELOG.md (ADR 0009, the news-fragment / towncrier pattern).
 *
 * The shared contracts/CHANGELOG.md is a top-of-file append surface: every
 * parallel change editing it produces a merge conflict. Instead each change
 * writes its own fragment file `contracts/changelog.d/<change-id>.md` (no shared
 * edit, no conflict), and this command deterministically assembles them into an
 * "## Unreleased" section, sorted by change-id, at integration time.
 *
 * With --check it verifies the assembled section is in sync without writing,
 * for a CI drift gate.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';

const FRAGMENT_DIR = 'contracts/changelog.d';
const CHANGELOG_PATH = 'contracts/CHANGELOG.md';
const UNRELEASED_HEADING = '## Unreleased';

export interface ChangelogBuildOptions {
  check?: boolean;
}

export interface Fragment {
  changeId: string;
  body: string;
}

/** Read and sort fragments by change-id (deterministic assembly order). */
export function readFragments(repoRoot: string): Fragment[] {
  const dir = join(repoRoot, FRAGMENT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => ({ changeId: f.replace(/\.md$/, ''), body: readFileSync(join(dir, f), 'utf8').trim() }))
    .filter(f => f.body.length > 0);
}

/** Build the assembled "## Unreleased" block from fragments. */
export function buildUnreleasedBlock(fragments: Fragment[]): string {
  if (fragments.length === 0) return `${UNRELEASED_HEADING}\n\n_No pending contract changes._\n`;
  const entries = fragments.map(f => `### ${f.changeId}\n\n${f.body}\n`).join('\n');
  return `${UNRELEASED_HEADING}\n\n${entries}`;
}

/**
 * Splice the assembled block into the changelog, replacing any existing
 * "## Unreleased" section (up to the next "## " heading) and preserving the
 * released history below it. If no changelog exists, one is created.
 */
export function spliceChangelog(existing: string, unreleasedBlock: string): string {
  if (!existing.trim()) {
    return `# Contract Changelog\n\n${unreleasedBlock}`;
  }
  const idx = existing.indexOf(UNRELEASED_HEADING);
  if (idx === -1) {
    // Insert after the top-level title if present, else prepend.
    const lines = existing.split('\n');
    const titleIdx = lines.findIndex(l => l.startsWith('# '));
    if (titleIdx !== -1) {
      const before = lines.slice(0, titleIdx + 1).join('\n');
      const after = lines.slice(titleIdx + 1).join('\n');
      return `${before}\n\n${unreleasedBlock}\n${after.replace(/^\n+/, '')}`;
    }
    return `${unreleasedBlock}\n${existing}`;
  }
  // Replace from UNRELEASED_HEADING up to the next "## " heading.
  const after = existing.slice(idx + UNRELEASED_HEADING.length);
  const nextHeadingRel = after.indexOf('\n## ');
  const tail = nextHeadingRel === -1 ? '' : after.slice(nextHeadingRel + 1);
  const head = existing.slice(0, idx);
  return `${head}${unreleasedBlock}\n${tail}`;
}

export async function changelogBuild(opts: ChangelogBuildOptions): Promise<void> {
  const repoRoot = process.cwd();
  const fragments = readFragments(repoRoot);
  const block = buildUnreleasedBlock(fragments);

  const clPath = join(repoRoot, CHANGELOG_PATH);
  const existing = existsSync(clPath) ? readFileSync(clPath, 'utf8') : '';
  const assembled = spliceChangelog(existing, block);

  if (opts.check) {
    if (assembled.trim() !== existing.trim()) {
      log.error(`${CHANGELOG_PATH} is out of sync with ${FRAGMENT_DIR}/. Run \`cdd-kit changelog build\`.`);
      process.exit(3);
    }
    log.ok(`${CHANGELOG_PATH} is in sync with ${fragments.length} fragment(s).`);
    return;
  }

  writeFileSync(clPath, assembled, 'utf8');
  log.ok(`Assembled ${fragments.length} fragment(s) into ${CHANGELOG_PATH}.`);
}
