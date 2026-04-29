import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { log } from '../utils/logger.js';

const DEFAULT_FORBIDDEN = [
  '.claude',
  '.git',
  'node_modules',
  'dist',
  'build',
  'assets',
  'specs/archive',
  'specs/changes',
];

function stripGlobSuffix(pattern: string): string {
  return pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
}

function getForbiddenPaths(cwd: string): string[] {
  const forbidden = new Set(DEFAULT_FORBIDDEN);
  const policyPath = join(cwd, '.cdd', 'context-policy.json');

  try {
    if (existsSync(policyPath)) {
      const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as { forbiddenPaths?: string[] };
      for (const pattern of policy.forbiddenPaths ?? []) {
        forbidden.add(stripGlobSuffix(pattern));
      }
    }
  } catch {
    log.warn('Could not parse .cdd/context-policy.json; using default context-scan excludes.');
  }

  return [...forbidden];
}

function isForbidden(relPath: string, forbidden: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return forbidden.some(pattern => normalized === pattern || normalized.startsWith(`${pattern}/`));
}

interface TreeStats {
  dirs: number;
  files: number;
  omittedDirs: number;
}

function buildTree(dir: string, cwd: string, forbidden: string[], stats: TreeStats, prefix = '', depth = 0): string {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
      return a.isDirectory() ? -1 : 1;
    });

  let output = '';
  const visible = entries.filter(entry => {
    const relPath = relative(cwd, join(dir, entry.name));
    return !isForbidden(relPath, forbidden);
  });

  visible.forEach((entry, index) => {
    const fullPath = join(dir, entry.name);
    const isLast = index === visible.length - 1;
    const connector = isLast ? '\\-- ' : '|-- ';
    output += `${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

    if (entry.isDirectory()) {
      stats.dirs += 1;
      if (depth >= 3) {
        stats.omittedDirs += 1;
        output += `${prefix}${isLast ? '    ' : '|   '}\\-- ... (max depth)\n`;
      } else {
        output += buildTree(fullPath, cwd, forbidden, stats, prefix + (isLast ? '    ' : '|   '), depth + 1);
      }
    } else {
      stats.files += 1;
    }
  });

  return output;
}

function firstHeading(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function deriveContractType(relPath: string, metadata: Record<string, string>): string {
  if (metadata.contract) return metadata.contract;
  const parts = relPath.split('/');
  return parts.length >= 2 ? parts[1] : 'unknown';
}

function parseContractMetadata(content: string): { title?: string; summary?: string; metadata: Record<string, string> } {
  const metadata: Record<string, string> = {};
  let summary: string | undefined;

  const cddMatch = content.match(/<!--\s*cdd:([\s\S]*?)-->/);
  const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = cddMatch?.[1] ?? yamlMatch?.[1];

  if (block) {
    for (const line of block.split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (!key || !value) continue;
      if (key === 'summary') summary = value;
      else metadata[key] = value;
    }
  }

  if (!summary) {
    const summaryMatch = content.match(/#+\s*Summary\s*\r?\n+([^#\r\n][^\r\n]*)/i);
    summary = summaryMatch?.[1]?.trim();
  }

  return { title: firstHeading(content), summary, metadata };
}

function findContractFiles(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) findContractFiles(fullPath, found);
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md' && entry.name !== 'CHANGELOG.md') found.push(fullPath);
  }
  return found;
}

export async function contextScan(): Promise<void> {
  const cwd = process.cwd();
  const specsContextDir = join(cwd, 'specs', 'context');
  mkdirSync(specsContextDir, { recursive: true });

  const forbidden = getForbiddenPaths(cwd);
  const treeStats: TreeStats = { dirs: 0, files: 0, omittedDirs: 0 };
  const tree = buildTree(cwd, cwd, forbidden, treeStats);
  writeFileSync(
    join(specsContextDir, 'project-map.md'),
    [
      '---',
      'artifact: project-map',
      'generated-by: cdd-kit context-scan',
      'schema-version: 1',
      `root: ${basename(cwd)}`,
      `visible-dirs: ${treeStats.dirs}`,
      `visible-files: ${treeStats.files}`,
      `omitted-dirs: ${treeStats.omittedDirs}`,
      '---',
      '',
      '# Project Map',
      '',
      'Use this deterministic map to choose candidate context paths before reading files.',
      '',
      '## Excluded Paths',
      ...forbidden.map(path => `- ${path}`),
      '',
      '## Tree',
      '',
      '```',
      `${basename(cwd)}/`,
      tree.trimEnd(),
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
  log.ok('Created specs/context/project-map.md');

  const contractFiles = findContractFiles(join(cwd, 'contracts'))
    .sort((a, b) => relative(cwd, a).localeCompare(relative(cwd, b)));
  const contractEntries: string[] = [];
  const inventoryRows: string[] = [];
  let missingSummary = 0;
  for (const file of contractFiles) {
    const relPath = relative(cwd, file).replace(/\\/g, '/');
    const dir = dirname(relPath).replace(/\\/g, '/');
    const { title, summary, metadata } = parseContractMetadata(readFileSync(file, 'utf8'));
    const contractType = deriveContractType(relPath, metadata);
    const owner = metadata.owner ?? 'unknown';
    const surface = metadata.surface ?? dir;
    const summaryText = summary ?? 'MISSING - add YAML frontmatter `summary:` or `<!-- cdd: summary: ... -->`.';

    inventoryRows.push(`| ${relPath} | ${contractType} | ${surface} | ${owner} | ${summary ? 'yes' : 'no'} |`);

    let entry = `## ${relPath}\n`;
    entry += `- path: \`${relPath}\`\n`;
    entry += `- type: ${contractType}\n`;
    entry += `- directory: ${dir}\n`;
    if (title) entry += `- title: ${title}\n`;
    for (const [key, value] of Object.entries(metadata)) {
      if (key === 'contract') continue;
      entry += `- ${key}: ${value}\n`;
    }
    entry += `- summary: ${summaryText}\n\n`;
    contractEntries.push(entry);
    if (!summary) {
      missingSummary += 1;
    }
  }

  const contractIndex = [
    '---',
    'artifact: contracts-index',
    'generated-by: cdd-kit context-scan',
    'schema-version: 1',
    `contract-count: ${contractFiles.length}`,
    `missing-summary-count: ${missingSummary}`,
    '---',
    '',
    '# Contracts Index',
    '',
    'Generated from deterministic metadata. Add YAML frontmatter fields such as `summary`, `owner`, and `surface` to improve classifier accuracy.',
    '',
    '## Contract Inventory',
    '',
    '| path | type | surface | owner | has-summary |',
    '|---|---|---|---|---|',
    ...inventoryRows,
    '',
    '## Contract Details',
    '',
    ...contractEntries,
  ].join('\n');

  writeFileSync(join(specsContextDir, 'contracts-index.md'), contractIndex, 'utf8');
  if (missingSummary > 0) {
    log.warn(`Created specs/context/contracts-index.md with ${missingSummary} missing summary warning(s).`);
  } else {
    log.ok('Created specs/context/contracts-index.md');
  }
}
